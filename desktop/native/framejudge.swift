// framejudge <image>… : what an editor sees in a frame, as numbers, with Apple Vision on this Mac (free, no download).
// One JSON line per image:
//   {"file","w","h","aesthetic" (−1…1, macOS 15+, else null),"utility","sharp" (Laplacian variance at 320 px),
//    "luma","lumaStd","clipHi","clipLo" (shares of blown / crushed pixels),"castR","castB" (red / blue cast, −1…1),
//    "colorful" (Hasler–Süsstrunk),"edges" (busy-ness 0…1),"horizon" (degrees, null when none),
//    "horizonLine" (0…1: how straight a line runs across the frame at that angle), "horizonGain" (that, minus the
//    same for a level line: a real tilted horizon gains, a face or a crowd doesn't),
//    "salient":[x,y,w,h]|null,"faces":[{"box":[x,y,w,h],"quality","eyes" (openness 0…1),"roll","yaw"}],
//    "faceLuma","faceClip","salientLuma","salientClip" (exposure of the main face and of the subject)}
// Boxes are 0…1 with a top-left origin. Built by build.sh into Resources/bin; production/server/judge.ts runs it.
import CoreGraphics
import Foundation
import ImageIO
import Vision

func emit(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}

func round3(_ v: Double) -> Double { (v * 1000).rounded() / 1000 }

func topLeftBox(_ r: CGRect) -> [Double] {
    [round3(Double(r.origin.x)), round3(Double(1 - r.origin.y - r.size.height)), round3(Double(r.size.width)), round3(Double(r.size.height))]
}

/// RGBA pixels of the image drawn at `width` px wide.
func pixels(_ image: CGImage, width: Int) -> (data: [UInt8], w: Int, h: Int)? {
    let w = max(16, min(width, image.width))
    let h = max(16, Int((Double(image.height) * Double(w) / Double(image.width)).rounded()))
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let ok: Bool = data.withUnsafeMutableBytes { buf in
        guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
        ctx.interpolationQuality = .medium
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return true
    }
    return ok ? (data, w, h) : nil
}

/// The picture inside letterbox / pillarbox bars (rows and columns of one flat dark colour at the edges): a photo fitted
/// into a taller frame is judged on the photo, not on the bars.
func contentRect(_ px: [UInt8], _ w: Int, _ h: Int) -> (x0: Int, y0: Int, x1: Int, y1: Int) {
    func flatDark(_ idx: [Int]) -> Bool {
        var s = 0.0, s2 = 0.0
        for i in idx { let y = (0.2126 * Double(px[i * 4]) + 0.7152 * Double(px[i * 4 + 1]) + 0.0722 * Double(px[i * 4 + 2])) / 255; s += y; s2 += y * y }
        let m = s / Double(idx.count)
        return m < 0.06 && s2 / Double(idx.count) - m * m < 0.0004
    }
    var y0 = 0, y1 = h, x0 = 0, x1 = w
    while y0 < h / 2 && flatDark(Array((y0 * w)..<(y0 * w + w))) { y0 += 1 }
    while y1 > h / 2 && flatDark(Array(((y1 - 1) * w)..<((y1 - 1) * w + w))) { y1 -= 1 }
    while x0 < w / 2 && flatDark(stride(from: y0 * w + x0, to: y1 * w, by: w).map { $0 }) { x0 += 1 }
    while x1 > w / 2 && flatDark(stride(from: y0 * w + x1 - 1, to: y1 * w, by: w).map { $0 }) { x1 -= 1 }
    return (x0, y0, x1, y1)
}

func statistics(_ image: CGImage) -> (stats: [String: Any], luma: [Double], w: Int, h: Int, all: [UInt8], fw: Int, fh: Int) {
    guard let (all, fw, fh) = pixels(image, width: 320) else { return ([:], [], 0, 0, [], 0, 0) }
    let r0 = contentRect(all, fw, fh)
    let w = max(8, r0.x1 - r0.x0), h = max(8, r0.y1 - r0.y0)
    var px = [UInt8](repeating: 0, count: w * h * 4)
    for y in 0..<h { for x in 0..<w { let s = ((y + r0.y0) * fw + (x + r0.x0)) * 4, d = (y * w + x) * 4; px[d] = all[s]; px[d + 1] = all[s + 1]; px[d + 2] = all[s + 2]; px[d + 3] = all[s + 3] } }
    let bars = [Double(r0.y0) / Double(fh), Double(fh - r0.y1) / Double(fh), Double(r0.x0) / Double(fw), Double(fw - r0.x1) / Double(fw)].map { round3($0) }
    let n = w * h
    var luma = [Double](repeating: 0, count: n)
    var sum = 0.0, sum2 = 0.0, hi = 0, lo = 0
    var rg = 0.0, rg2 = 0.0, yb = 0.0, yb2 = 0.0, castR = 0.0, castB = 0.0, mids = 0
    for i in 0..<n {
        let r = Double(px[i * 4]) / 255, g = Double(px[i * 4 + 1]) / 255, b = Double(px[i * 4 + 2]) / 255
        let y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        luma[i] = y
        sum += y
        sum2 += y * y
        if y > 0.98 { hi += 1 }
        if y < 0.02 { lo += 1 }
        let a = (r - g) * 255, c = (0.5 * (r + g) - b) * 255
        rg += a; rg2 += a * a; yb += c; yb2 += c * c
        // Cast is read in the mid-tones (skin, walls, sky), where a grade shows.
        if y > 0.2 && y < 0.8 { castR += r - y; castB += b - y; mids += 1 }
    }
    let mean = sum / Double(n)
    let std = sqrt(max(0, sum2 / Double(n) - mean * mean))
    let mrg = rg / Double(n), myb = yb / Double(n)
    let srg = sqrt(max(0, rg2 / Double(n) - mrg * mrg)), syb = sqrt(max(0, yb2 / Double(n) - myb * myb))
    let colorful = sqrt(srg * srg + syb * syb) + 0.3 * sqrt(mrg * mrg + myb * myb)
    // Sharpness: variance of the 4-neighbour Laplacian (0…255 scale); busy-ness: share of strong gradients.
    var lap = 0.0, lap2 = 0.0, edges = 0, m = 0
    for y in 1..<(h - 1) {
        for x in 1..<(w - 1) {
            let i = y * w + x
            let l = (4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w]) * 255
            lap += l; lap2 += l * l
            let gx = (luma[i + 1] - luma[i - 1]) * 255, gy = (luma[i + w] - luma[i - w]) * 255
            if gx * gx + gy * gy > 900 { edges += 1 }
            m += 1
        }
    }
    let lm = lap / Double(max(1, m))
    let sharp = lap2 / Double(max(1, m)) - lm * lm
    return ([
        "sharp": round3(sharp), "luma": round3(mean), "lumaStd": round3(std),
        "clipHi": round3(Double(hi) / Double(n)), "clipLo": round3(Double(lo) / Double(n)),
        "castR": round3(mids > 0 ? castR / Double(mids) : 0), "castB": round3(mids > 0 ? castB / Double(mids) : 0),
        "colorful": round3(colorful), "edges": round3(Double(edges) / Double(max(1, m))), "bars": bars,
    ], luma, w, h, all, fw, fh)
}

/// How straight a light/dark step runs across the picture at `deg` degrees (y down, Vision's sign): the best row's
/// share of columns that step the same way. A sea or roof line scores high at its angle; Vision's horizon on a face, a
/// crowd or a pattern finds no such line, or finds it no better than a level one.
func lineCoherence(_ luma: [Double], _ w: Int, _ h: Int, _ deg: Double) -> Double {
    guard w >= 16, h >= 16, luma.count >= w * h else { return 0 }
    let s = tan(deg * .pi / 180)
    let d = max(2, h / 60)
    let xs = Array(stride(from: Int(Double(w) * 0.04), to: Int(Double(w) * 0.96), by: 2))
    var best = 0.0
    for y0 in Int(Double(h) * 0.08)..<Int(Double(h) * 0.92) {
        var pos = 0, neg = 0, valid = 0
        for x in xs {
            let yi = Int((Double(y0) + s * (Double(x) - Double(w) / 2)).rounded())
            if yi - d < 0 || yi + d >= h { continue }
            valid += 1
            let diff = luma[(yi + d) * w + x] - luma[(yi - d) * w + x]
            if diff > 0.04 { pos += 1 } else if diff < -0.04 { neg += 1 }
        }
        if valid < xs.count * 6 / 10 { continue }
        best = max(best, Double(max(pos, neg)) / Double(valid))
    }
    return best
}

/// Mean luma and blown share inside a box (top-left 0…1) of the RGBA pixels.
func regionExposure(_ px: [UInt8], _ w: Int, _ h: Int, _ box: [Double]) -> (luma: Double, clip: Double)? {
    guard box.count == 4, w > 0, h > 0 else { return nil }
    let x0 = max(0, Int(box[0] * Double(w))), y0 = max(0, Int(box[1] * Double(h)))
    let x1 = min(w, Int(((box[0] + box[2]) * Double(w)).rounded(.up))), y1 = min(h, Int(((box[1] + box[3]) * Double(h)).rounded(.up)))
    guard x1 - x0 >= 2, y1 - y0 >= 2 else { return nil }
    var s = 0.0, clip = 0, n = 0
    for y in y0..<y1 {
        for x in x0..<x1 {
            let i = (y * w + x) * 4
            let l = (0.2126 * Double(px[i]) + 0.7152 * Double(px[i + 1]) + 0.0722 * Double(px[i + 2])) / 255
            s += l
            if l > 0.98 { clip += 1 }
            n += 1
        }
    }
    return (s / Double(n), Double(clip) / Double(n))
}

/// Eye openness from the landmark contour: height over width of the eye's points (open ≈ 0.25–0.45, shut < 0.12),
/// scaled to 0…1 (0.3 → 1).
func openness(_ region: VNFaceLandmarkRegion2D?) -> Double? {
    guard let pts = region?.normalizedPoints, pts.count >= 4 else { return nil }
    let xs = pts.map { Double($0.x) }, ys = pts.map { Double($0.y) }
    let width = (xs.max() ?? 0) - (xs.min() ?? 0)
    guard width > 0 else { return nil }
    let ratio = ((ys.max() ?? 0) - (ys.min() ?? 0)) / width
    return min(1, max(0, ratio / 0.3))
}

func judge(_ file: String) -> [String: Any] {
    let url = URL(fileURLWithPath: file)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let full = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        return ["file": file, "error": "unreadable"]
    }
    var out: [String: Any] = ["file": file, "w": full.width, "h": full.height]
    let st = statistics(full)
    let stats = st.stats
    for (k, v) in stats { out[k] = v }
    // Vision looks at the picture inside the bars (a letterboxed photo's horizon and faces), boxes mapped back to the frame.
    let bars = (stats["bars"] as? [Double]) ?? [0, 0, 0, 0]
    let W = Double(full.width), H = Double(full.height)
    // A little inside the bars: one dark row left at an edge is enough to blind the horizon detector.
    let inset = { (share: Double, size: Double) -> Double in share > 0.005 ? share * size + max(6, size * 0.012) : 0 }
    let x0 = inset(bars[2], W), x1 = W - inset(bars[3], W), y0 = inset(bars[0], H), y1 = H - inset(bars[1], H)
    let crop = CGRect(x: x0.rounded(), y: y0.rounded(), width: max(16, (x1 - x0).rounded()), height: max(16, (y1 - y0).rounded()))
    let image = (bars.contains { $0 > 0.01 } ? full.cropping(to: crop) : nil) ?? full
    let mapBox: (CGRect) -> [Double] = { r in
        let b = topLeftBox(r)
        let cw = Double(image.width) / W, ch = Double(image.height) / H
        let ox = image === full ? 0 : x0 / W, oy = image === full ? 0 : y0 / H
        return [round3(ox + b[0] * cw), round3(oy + b[1] * ch), round3(b[2] * cw), round3(b[3] * ch)]
    }
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    let landmarks = VNDetectFaceLandmarksRequest()
    let quality = VNDetectFaceCaptureQualityRequest()
    let horizon = VNDetectHorizonRequest()
    let saliency = VNGenerateAttentionBasedSaliencyImageRequest()
    // Text in the corners of a frame is a watermark or a channel logo (stock and re-uploads): B-roll to avoid.
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .fast
    text.usesLanguageCorrection = false
    var requests: [VNRequest] = [landmarks, quality, horizon, saliency, text]
    var aesthetics: VNRequest? = nil
    if #available(macOS 15.0, *) {
        let a = VNCalculateImageAestheticsScoresRequest()
        aesthetics = a
        requests.append(a)
    }
    do { try handler.perform(requests) } catch { out["visionError"] = error.localizedDescription }
    var faces: [[String: Any]] = []
    let qualities = (quality.results ?? []).map { ($0.boundingBox, Double($0.faceCaptureQuality ?? 0)) }
    for f in landmarks.results ?? [] {
        var face: [String: Any] = ["box": mapBox(f.boundingBox)]
        if let q = qualities.min(by: { abs($0.0.midX - f.boundingBox.midX) + abs($0.0.midY - f.boundingBox.midY) < abs($1.0.midX - f.boundingBox.midX) + abs($1.0.midY - f.boundingBox.midY) }) {
            face["quality"] = round3(q.1)
        }
        let l = openness(f.landmarks?.leftEye), r = openness(f.landmarks?.rightEye)
        if let l = l, let r = r { face["eyes"] = round3((l + r) / 2) } else if let e = l ?? r { face["eyes"] = round3(e) }
        if let roll = f.roll { face["roll"] = round3(Double(truncating: roll) * 180 / .pi) }
        if let yaw = f.yaw { face["yaw"] = round3(Double(truncating: yaw) * 180 / .pi) }
        faces.append(face)
    }
    out["faces"] = faces
    // Words, not specks: three letters or more, read with some confidence (foliage and gravel read as "text" at a glance).
    let words = (text.results ?? []).filter { ($0.topCandidates(1).first?.confidence ?? 0) > 0.5 && ($0.topCandidates(1).first?.string.count ?? 0) >= 3 }
    out["text"] = words.count
    out["cornerText"] = words.filter { o in
        let b = o.boundingBox
        let cx = b.midX, cy = b.midY
        return (cx < 0.3 || cx > 0.7) && (cy < 0.2 || cy > 0.8) && b.height < 0.12
    }.count
    if let h = horizon.results?.first {
        let deg = Double(h.angle) * 180 / .pi
        out["horizon"] = round3(deg)
        // Is there a line at that angle at all, and is it straighter than a level one?
        if st.w >= 16 {
            let at = lineCoherence(st.luma, st.w, st.h, deg), level = lineCoherence(st.luma, st.w, st.h, 0)
            out["horizonLine"] = round3(at)
            out["horizonGain"] = round3(at - level)
        }
    } else { out["horizon"] = NSNull() }
    if let s = saliency.results?.first?.salientObjects?.max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) {
        out["salient"] = mapBox(s.boundingBox)
    } else { out["salient"] = NSNull() }
    // Exposure where it matters: the main face and the subject (a white backdrop is high-key, a blown face is not).
    let mainFace = faces.compactMap { $0["box"] as? [Double] }.max { $0[2] * $0[3] < $1[2] * $1[3] }
    if let b = mainFace, let e = regionExposure(st.all, st.fw, st.fh, b) { out["faceLuma"] = round3(e.luma); out["faceClip"] = round3(e.clip) }
    if let b = out["salient"] as? [Double], let e = regionExposure(st.all, st.fw, st.fh, b) { out["salientLuma"] = round3(e.luma); out["salientClip"] = round3(e.clip) }
    if #available(macOS 15.0, *), let a = aesthetics as? VNCalculateImageAestheticsScoresRequest, let r = a.results?.first {
        out["aesthetic"] = round3(Double(r.overallScore))
        out["utility"] = r.isUtility
    } else {
        out["aesthetic"] = NSNull()
    }
    return out
}

/// Watermarks and channel logos: the four corners read carefully (accurate text recognition on small regions), which
/// the fast whole-frame pass misses on a busy picture. framejudge --corners <image>… prints {"file","cornerText"}.
func corners(_ file: String) -> [String: Any] {
    let url = URL(fileURLWithPath: file)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        return ["file": file, "error": "unreadable"]
    }
    let regions = [CGRect(x: 0, y: 0, width: 0.38, height: 0.24), CGRect(x: 0.62, y: 0, width: 0.38, height: 0.24),
                   CGRect(x: 0, y: 0.76, width: 0.38, height: 0.24), CGRect(x: 0.62, y: 0.76, width: 0.38, height: 0.24)]
    let requests: [VNRecognizeTextRequest] = regions.map { r in
        let q = VNRecognizeTextRequest()
        q.recognitionLevel = .accurate
        q.usesLanguageCorrection = false
        q.regionOfInterest = r
        return q
    }
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try? handler.perform(requests)
    let found = requests.reduce(0) { n, q in n + (q.results ?? []).filter { ($0.topCandidates(1).first?.confidence ?? 0) > 0.4 && ($0.topCandidates(1).first?.string.count ?? 0) >= 3 }.count }
    return ["file": file, "cornerText": found]
}

var files = Array(CommandLine.arguments.dropFirst())
if files.isEmpty {
    emit(["error": "usage: framejudge [--corners] <image>…"])
    exit(1)
}
if files.first == "--corners" {
    files.removeFirst()
    for file in files { emit(corners(file)) }
    exit(0)
}
for file in files { emit(judge(file)) }
