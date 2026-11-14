// motion: Gaziyav's motion helper — tracking with Apple Vision (Neural Engine), reverse and optical-flow slow
// motion with VideoToolbox (hardware decode/encode, VTFrameProcessor frame-rate conversion on macOS 15.4+).
//
//   motion probe
//       → {"neural":true|false,"subject":true|false}
//   motion track <video> --kind face|object|subject --start S --end E --at T [--rect x,y,w,h] [--point x,y]
//       Tracks forward from T to E and backward from T to S. Coordinates are normalized, top-left origin,
//       in the displayed (upright) frame. stderr: "P <0..1>" progress lines.
//       → {"frame":[w,h],"samples":[[t,x,y,w,h,angle,confidence],…]}  (t = seconds of the file, raw, unsmoothed)
//   motion reverse <video> <out.mp4> --start S --end E
//       Picture of [S,E] backwards (H.264, the source frame rate and orientation). Memory stays flat: the file is
//       read in windows from the end. Sound is done by the caller (ffmpeg areverse).
//   motion smooth <video> <out.mp4> --start S --end E --factor M --fps F [--cut T] [--cuts T1,T2,…]
//       [S,E] with M× more frames in time, written at F fps (so it plays M× slower): in-between frames come from
//       Apple's frame-interpolation network. Exit code 3 = not available on this Mac (caller uses ffmpeg).
import Accelerate
import AVFoundation
import CoreImage
import CoreMedia
import Foundation
import Vision
import VideoToolbox

setvbuf(stdout, nil, _IOFBF, 1 << 20)

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write("motion: \(message)\n".data(using: .utf8)!)
    exit(code)
}

var lastProgress = -1.0
func progress(_ p: Double) {
    let v = (max(0, min(1, p)) * 1000).rounded() / 1000
    if v - lastProgress >= 0.005 || v >= 1 {
        lastProgress = v
        FileHandle.standardError.write("P \(v)\n".data(using: .utf8)!)
    }
}

// MARK: Arguments

let argv = CommandLine.arguments
guard argv.count > 1 else { fail("usage: motion probe | track <video> … | reverse <video> <out> … | smooth <video> <out> …") }
let command = argv[1]
var positional: [String] = []
var options: [String: String] = [:]
do {
    var i = 2
    while i < argv.count {
        let a = argv[i]
        if a.hasPrefix("--"), i + 1 < argv.count { options[String(a.dropFirst(2))] = argv[i + 1]; i += 2 } else { positional.append(a); i += 1 }
    }
}
func num(_ key: String) -> Double? { options[key].flatMap(Double.init) }
func nums(_ key: String) -> [Double]? {
    guard let s = options[key] else { return nil }
    let v = s.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    return v.isEmpty ? nil : v
}

func neuralAvailable() -> Bool {
    if #available(macOS 15.4, *) { return VTFrameRateConversionConfiguration.processorSupported }
    return false
}

// MARK: Source

struct Source {
    let asset: AVURLAsset
    let track: AVAssetTrack
    let natural: CGSize
    let transform: CGAffineTransform
    let fps: Double
    let duration: Double
    let orientation: CGImagePropertyOrientation
    var display: CGSize {
        switch orientation {
        case .left, .right, .leftMirrored, .rightMirrored: return CGSize(width: natural.height, height: natural.width)
        default: return natural
        }
    }
}

func openSource(_ path: String) -> Source {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path), options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    guard let track = asset.tracks(withMediaType: .video).first else { fail("the file has no picture") }
    let t = track.preferredTransform
    let angle = (atan2(Double(t.b), Double(t.a)) * 180 / .pi).rounded()
    let orientation: CGImagePropertyOrientation
    switch Int(angle) {
    case 90: orientation = .right
    case -90, 270: orientation = .left
    case 180, -180: orientation = .down
    default: orientation = .up
    }
    let fps = Double(track.nominalFrameRate)
    return Source(asset: asset, track: track, natural: track.naturalSize, transform: t, fps: fps > 1 ? fps : 30,
                  duration: asset.duration.seconds, orientation: orientation)
}

func cm(_ s: Double) -> CMTime { CMTime(seconds: s, preferredTimescale: 600_000) }

/// Decoded frames of a time range, in file order.
final class FrameReader {
    let reader: AVAssetReader
    let output: AVAssetReaderTrackOutput
    init(_ src: Source, from: Double, to: Double, settings: [String: Any]) {
        guard let r = try? AVAssetReader(asset: src.asset) else { fail("can't read the video") }
        reader = r
        reader.timeRange = CMTimeRange(start: cm(max(0, from)), end: cm(max(from + 0.001, to)))
        output = AVAssetReaderTrackOutput(track: src.track, outputSettings: settings)
        output.alwaysCopiesSampleData = true
        reader.add(output)
        guard reader.startReading() else { fail("can't read the video: \(reader.error?.localizedDescription ?? "")") }
    }
    func next() -> (CVPixelBuffer, Double)? {
        while let sb = output.copyNextSampleBuffer() {
            if let pb = CMSampleBufferGetImageBuffer(sb) { return (pb, CMSampleBufferGetPresentationTimeStamp(sb).seconds) }
        }
        if reader.status == .failed { fail("video read failed: \(reader.error?.localizedDescription ?? "")") }
        return nil
    }
    func cancel() { reader.cancelReading() }
}

/// Frames of [from, to] from the end to the start, decoded window by window (bounded memory).
func backwardFrames(_ src: Source, from: Double, to: Double, settings: [String: Any], frameBytes: Int,
                    _ body: (CVPixelBuffer, Double) -> Bool) {
    let maxFrames = max(8, min(240, 320_000_000 / max(1, frameBytes)))
    let window = Double(maxFrames) / src.fps
    var end = to
    while end > from + 1e-6 {
        let start = max(from, end - window)
        let r = FrameReader(src, from: start, to: end, settings: settings)
        var frames: [(CVPixelBuffer, Double)] = []
        while let f = r.next() {
            if f.1 >= start - 1e-4 && f.1 < end - 1e-4 { frames.append(f) }
        }
        r.cancel()
        for f in frames.reversed() { if !body(f.0, f.1) { return } }
        end = start
    }
}

// MARK: Writer

final class Writer {
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    let adaptor: AVAssetWriterInputPixelBufferAdaptor
    init(path: String, size: CGSize, transform: CGAffineTransform, fps: Double) {
        let url = URL(fileURLWithPath: path)
        try? FileManager.default.removeItem(at: url)
        guard let w = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { fail("can't write \(path)") }
        writer = w
        let px = Double(size.width * size.height)
        let bitRate = Int(max(8_000_000, min(60_000_000, px * fps * 0.2)))
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(size.width),
            AVVideoHeightKey: Int(size.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitRate,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoExpectedSourceFrameRateKey: Int(fps.rounded()),
                AVVideoMaxKeyFrameIntervalKey: max(1, Int(fps.rounded())),
            ],
        ])
        input.transform = transform
        input.expectsMediaDataInRealTime = false
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
        writer.add(input)
        guard writer.startWriting() else { fail("can't start writing: \(writer.error?.localizedDescription ?? "")") }
        writer.startSession(atSourceTime: .zero)
    }
    var last = -1.0
    func append(_ pb: CVPixelBuffer, at seconds: Double) {
        // Strictly increasing timestamps (the encoder rejects equal ones).
        let t = max(seconds, last + 1e-4)
        last = t
        while !input.isReadyForMoreMediaData { usleep(2000) }
        if !adaptor.append(pb, withPresentationTime: CMTime(seconds: t, preferredTimescale: 600_000)) {
            fail("couldn't write a frame: \(writer.error?.localizedDescription ?? "")")
        }
    }
    func finish() {
        input.markAsFinished()
        let done = DispatchSemaphore(value: 0)
        writer.finishWriting { done.signal() }
        done.wait()
        if writer.status != .completed { fail("writing failed: \(writer.error?.localizedDescription ?? "")") }
    }
}

// MARK: Tracking (Vision)

func vision(_ r: CGRect) -> CGRect { CGRect(x: r.minX, y: 1 - r.maxY, width: r.width, height: r.height) }
func topLeft(_ r: CGRect) -> CGRect { CGRect(x: r.minX, y: 1 - r.maxY, width: r.width, height: r.height) }
func iou(_ a: CGRect, _ b: CGRect) -> CGFloat {
    let i = a.intersection(b)
    guard !i.isNull else { return 0 }
    let inter = i.width * i.height
    return inter / max(1e-9, a.width * a.height + b.width * b.height - inter)
}
func dist(_ a: CGRect, _ b: CGRect) -> CGFloat { hypot(a.midX - b.midX, a.midY - b.midY) }

struct Sample { var t: Double; var r: CGRect; var angle: Double; var conf: Double }

/// What the tracked object looks like: a 16×16 colour patch of its box, compared by normalized cross-correlation.
/// Vision's object tracker can latch onto the background when the object turns or passes a strong edge (the box
/// stays put with a fair confidence while the object moves on); the patch shows it, and a search around the last
/// good box finds the object again.
final class Looks {
    static let n = 16
    let ctx = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
    var template: [Float] = []

    /// The picture `pb` (upright) as Core Image, and a patch of `r` (top-left normalized) scaled to `w`×`h` pixels.
    func patch(_ img: CIImage, _ r: CGRect, _ w: Int, _ h: Int) -> [Float] {
        let e = img.extent
        let crop = CGRect(x: e.minX + r.minX * e.width, y: e.minY + (1 - r.maxY) * e.height, width: max(1, r.width * e.width), height: max(1, r.height * e.height))
        let scaled = img.cropped(to: crop)
            .transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
            .transformed(by: CGAffineTransform(scaleX: CGFloat(w) / crop.width, y: CGFloat(h) / crop.height))
        var px = [UInt8](repeating: 0, count: w * h * 4)
        ctx.render(scaled, toBitmap: &px, rowBytes: w * 4, bounds: CGRect(x: 0, y: 0, width: w, height: h), format: .RGBA8, colorSpace: nil)
        var out = [Float](repeating: 0, count: w * h * 3)
        for i in 0..<(w * h) { for c in 0..<3 { out[i * 3 + c] = Float(px[i * 4 + c]) } }
        return out
    }

    /// Likeness of two equal patches, −1…1 (normalized cross-correlation over all three colours).
    static func ncc(_ a: [Float], _ b: [Float]) -> Float {
        let n = Float(a.count)
        var ma: Float = 0, mb: Float = 0
        vDSP_meanv(a, 1, &ma, vDSP_Length(a.count))
        vDSP_meanv(b, 1, &mb, vDSP_Length(b.count))
        var sab: Float = 0, saa: Float = 0, sbb: Float = 0
        for i in 0..<a.count { let x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y }
        _ = n
        return saa > 1 && sbb > 1 ? sab / (saa * sbb).squareRoot() : 0
    }

    /// The box of `size` around `around` (top-left normalized) whose patch is most like the object, and how much.
    func search(_ img: CIImage, around: CGRect) -> (CGRect, Float)? {
        let n = Looks.n
        let reach: CGFloat = 2.5   // box sizes each way
        let area = CGRect(x: around.minX - around.width * reach, y: around.minY - around.height * reach,
                          width: around.width * (1 + 2 * reach), height: around.height * (1 + 2 * reach))
            .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard area.width > around.width, area.height > around.height else { return nil }
        // The area at the scale where the box is n×n.
        let aw = Int((area.width / around.width * CGFloat(n)).rounded()), ah = Int((area.height / around.height * CGFloat(n)).rounded())
        let big = patch(img, area, aw, ah)
        var best: (Int, Int, Float) = (0, 0, -1)
        var win = [Float](repeating: 0, count: n * n * 3)
        for oy in 0...(ah - n) {
            for ox in 0...(aw - n) {
                for y in 0..<n { for x in 0..<n { for c in 0..<3 { win[(y * n + x) * 3 + c] = big[((oy + y) * aw + ox + x) * 3 + c] } } }
                let s = Looks.ncc(template, win)
                if s > best.2 { best = (ox, oy, s) }
            }
        }
        // Patch rows run bottom-up (Core Image): row oy from the bottom of the area.
        let x = area.minX + CGFloat(best.0) / CGFloat(aw) * area.width
        let yTop = area.maxY - CGFloat(best.1 + n) / CGFloat(ah) * area.height
        return (CGRect(x: x, y: yTop, width: around.width, height: around.height), best.2)
    }
}

/// Box (top-left normalized) of the foreground instance under `point` (or the biggest one).
func subjectBox(_ pb: CVPixelBuffer, _ orientation: CGImagePropertyOrientation, point: CGPoint?) -> CGRect? {
    if #available(macOS 14.0, *) {
        let req = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cvPixelBuffer: pb, orientation: orientation, options: [:])
        if (try? handler.perform([req])) != nil, let obs = req.results?.first, !obs.allInstances.isEmpty {
            let labels = obs.instanceMask
            CVPixelBufferLockBaseAddress(labels, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(labels, .readOnly) }
            let w = CVPixelBufferGetWidth(labels), h = CVPixelBufferGetHeight(labels), row = CVPixelBufferGetBytesPerRow(labels)
            if let base = CVPixelBufferGetBaseAddress(labels)?.assumingMemoryBound(to: UInt8.self) {
                var boxes: [Int: (Int, Int, Int, Int, Int)] = [:]   // label → x0, y0, x1, y1, count
                for y in 0..<h {
                    for x in 0..<w {
                        let l = Int(base[y * row + x])
                        guard l != 0 else { continue }
                        let b = boxes[l] ?? (x, y, x, y, 0)
                        boxes[l] = (min(b.0, x), min(b.1, y), max(b.2, x), max(b.3, y), b.4 + 1)
                    }
                }
                var pick: Int?
                if let p = point {
                    let px = min(w - 1, max(0, Int(p.x * CGFloat(w)))), py = min(h - 1, max(0, Int(p.y * CGFloat(h))))
                    let hit = Int(base[py * row + px])
                    if hit != 0 { pick = hit } else {
                        pick = boxes.min { a, b in
                            let ca = CGPoint(x: CGFloat(a.value.0 + a.value.2) / 2 / CGFloat(w), y: CGFloat(a.value.1 + a.value.3) / 2 / CGFloat(h))
                            let cb = CGPoint(x: CGFloat(b.value.0 + b.value.2) / 2 / CGFloat(w), y: CGFloat(b.value.1 + b.value.3) / 2 / CGFloat(h))
                            return hypot(ca.x - p.x, ca.y - p.y) < hypot(cb.x - p.x, cb.y - p.y)
                        }?.key
                    }
                } else {
                    pick = boxes.max { $0.value.4 < $1.value.4 }?.key
                }
                if let l = pick, let b = boxes[l] {
                    return CGRect(x: CGFloat(b.0) / CGFloat(w), y: CGFloat(b.1) / CGFloat(h),
                                  width: CGFloat(b.2 - b.0 + 1) / CGFloat(w), height: CGFloat(b.3 - b.1 + 1) / CGFloat(h))
                }
            }
        }
    }
    // Older systems / nothing found: the most salient object.
    let req = VNGenerateObjectnessBasedSaliencyImageRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: pb, orientation: orientation, options: [:])
    guard (try? handler.perform([req])) != nil, let objects = req.results?.first?.salientObjects, !objects.isEmpty else { return nil }
    let o: VNRectangleObservation
    if let p = point {
        let vp = CGPoint(x: p.x, y: 1 - p.y)
        o = objects.first { $0.boundingBox.contains(vp) } ?? objects.max { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }!
    } else {
        o = objects.max { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }!
    }
    return topLeft(o.boundingBox)
}

func runTrack() {
    guard let path = positional.first else { fail("usage: motion track <video> --kind … --start … --end … --at …") }
    let kind = options["kind"] ?? "face"
    let src = openSource(path)
    let start = max(0, num("start") ?? 0)
    let end = min(src.duration > 0 ? src.duration : .greatestFiniteMagnitude, num("end") ?? src.duration)
    guard end > start else { fail("empty time range") }
    let at = min(max(num("at") ?? start, start), end)
    let k = min(1, 960 / max(src.natural.width, src.natural.height))
    let tw = Int((src.natural.width * k / 2).rounded()) * 2, th = Int((src.natural.height * k / 2).rounded()) * 2
    let settings: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
        kCVPixelBufferWidthKey as String: tw, kCVPixelBufferHeightKey as String: th,
    ]
    let step = src.fps > 32 ? 2 : 1
    let total = max(1.0, (end - start) * src.fps / Double(step))
    var done = 0.0
    func tick() { done += 1; if Int(done) % 5 == 0 { progress(min(0.99, done / total)) } }

    var seedRect: CGRect? = nil
    if let r = nums("rect"), r.count == 4, r[2] > 0.004, r[3] > 0.004 { seedRect = CGRect(x: r[0], y: r[1], width: r[2], height: r[3]) }
    var seedPoint: CGPoint? = nil
    if let p = nums("point"), p.count == 2 { seedPoint = CGPoint(x: p[0], y: p[1]) }
    if kind == "object" && seedRect == nil { fail("draw a box around what to track") }

    // One pass in one direction from the seed frame: forward (file order) or backward (reverse order).
    func pass(_ frames: (( CVPixelBuffer, Double) -> Bool) -> Void) -> [Sample] {
        var out: [Sample] = []
        var index = 0
        switch kind {
        case "face":
            var prev: CGRect? = nil   // Vision coords
            frames { pb, t in
                defer { index += 1 }
                if index % step != 0 { return true }
                tick()
                let req = VNDetectFaceRectanglesRequest()
                if #available(macOS 13.0, *) { req.revision = VNDetectFaceRectanglesRequestRevision3 }
                let handler = VNImageRequestHandler(cvPixelBuffer: pb, orientation: src.orientation, options: [:])
                try? handler.perform([req])
                let faces = req.results ?? []
                var pick: VNFaceObservation? = nil
                if let p = prev {
                    pick = faces.max { iou($0.boundingBox, p) < iou($1.boundingBox, p) }
                        .flatMap { iou($0.boundingBox, p) > 0.05 || dist($0.boundingBox, p) < 0.25 ? $0 : nil }
                } else if let sp = seedPoint {
                    let vp = CGPoint(x: sp.x, y: 1 - sp.y)
                    pick = faces.first { $0.boundingBox.insetBy(dx: -0.05, dy: -0.05).contains(vp) }
                        ?? faces.min { hypot($0.boundingBox.midX - vp.x, $0.boundingBox.midY - vp.y) < hypot($1.boundingBox.midX - vp.x, $1.boundingBox.midY - vp.y) }
                } else if let sr = seedRect {
                    let v = vision(sr)
                    pick = faces.max { iou($0.boundingBox, v) < iou($1.boundingBox, v) }
                } else {
                    pick = faces.max { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }
                }
                if let f = pick {
                    prev = f.boundingBox
                    let roll = (f.roll?.doubleValue ?? 0) * 180 / .pi
                    out.append(Sample(t: t, r: topLeft(f.boundingBox), angle: roll, conf: Double(f.confidence)))
                } else if let last = out.last {
                    out.append(Sample(t: t, r: last.r, angle: last.angle, conf: 0))
                }
                return true
            }
        default:   // object / subject: Vision's object tracker from the seed box
            var last: VNDetectedObjectObservation? = nil
            var good: CGRect? = nil   // the last box that looked like the object (top-left normalized)
            let looks = Looks()
            let sequence = VNSequenceRequestHandler()
            frames { pb, t in
                defer { index += 1 }
                if index % step != 0 { return true }
                tick()
                if last == nil {
                    var box = seedRect
                    if kind == "subject" || box == nil { box = subjectBox(pb, src.orientation, point: seedPoint) ?? box }
                    guard let b = box else { return true }
                    seedRect = b
                    last = VNDetectedObjectObservation(boundingBox: vision(b))
                    good = b
                    looks.template = looks.patch(CIImage(cvPixelBuffer: pb).oriented(src.orientation), b, Looks.n, Looks.n)
                    out.append(Sample(t: t, r: b, angle: 0, conf: 1))
                    return true
                }
                let req = VNTrackObjectRequest(detectedObjectObservation: last!)
                req.trackingLevel = .accurate
                try? sequence.perform([req], on: pb, orientation: src.orientation)
                let img = CIImage(cvPixelBuffer: pb).oriented(src.orientation)
                var found: (CGRect, Double)? = nil
                if let obs = req.results?.first as? VNDetectedObjectObservation, obs.confidence > 0.15 {
                    let box = topLeft(obs.boundingBox)
                    let like = Looks.ncc(looks.template, looks.patch(img, box, Looks.n, Looks.n))
                    if like > 0.5 {
                        found = (box, Double(obs.confidence))
                        last = obs
                    }
                }
                // Drifted (the box no longer looks like the object) or lost: look for it around the last good box.
                if found == nil, let g = good, let (box, like) = looks.search(img, around: g), like > 0.7 {
                    found = (box, Double(like))
                    last = VNDetectedObjectObservation(boundingBox: vision(box))
                }
                if let (box, conf) = found {
                    good = box
                    out.append(Sample(t: t, r: box, angle: 0, conf: conf))
                } else if let s = out.last {
                    out.append(Sample(t: t, r: s.r, angle: 0, conf: 0))
                }
                return true
            }
        }
        return out
    }

    let forward = pass { body in
        let r = FrameReader(src, from: at, to: end, settings: settings)
        while let f = r.next() { if !body(f.0, f.1) { break } }
        r.cancel()
    }
    // The seed the forward pass settled on (the subject box / the face) starts the backward pass.
    if kind == "face", let first = forward.first { seedRect = first.r; seedPoint = nil }
    var backward: [Sample] = []
    if at > start + 0.01 {
        backward = pass { body in
            backwardFrames(src, from: start, to: at, settings: settings, frameBytes: tw * th * 3 / 2, body)
        }
    }
    let samples = (backward.reversed() + forward).filter { $0.t >= start - 0.05 && $0.t <= end + 0.05 }
    guard !samples.isEmpty else {
        fail(kind == "face" ? "No face found in this clip" : kind == "subject" ? "No subject found — click on a person or object" : "Couldn't follow it — try a tighter box")
    }
    progress(1)
    let d = src.display
    func r4(_ v: Double) -> Double { (v * 10000).rounded() / 10000 }
    let rows = samples.map { s in
        "[\(r4(s.t)),\(r4(Double(s.r.minX))),\(r4(Double(s.r.minY))),\(r4(Double(s.r.width))),\(r4(Double(s.r.height))),\((s.angle * 10).rounded() / 10),\((s.conf * 100).rounded() / 100)]"
    }
    print("{\"frame\":[\(Int(d.width)),\(Int(d.height))],\"fps\":\(src.fps),\"samples\":[\(rows.joined(separator: ","))]}")
}

// MARK: Reverse

func runReverse() {
    guard positional.count >= 2 else { fail("usage: motion reverse <video> <out.mp4> --start S --end E") }
    let src = openSource(positional[0])
    let start = max(0, num("start") ?? 0)
    let end = min(src.duration, num("end") ?? src.duration)
    guard end > start else { fail("empty time range") }
    let writer = Writer(path: positional[1], size: src.natural, transform: src.transform, fps: src.fps)
    let settings: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
    let frameBytes = Int(src.natural.width * src.natural.height * 1.5)
    // A frame shown over [t, next) in the file is shown over [end − next, end − t) in the result.
    var nextT = end
    let total = max(1.0, (end - start) * src.fps)
    var n = 0.0
    backwardFrames(src, from: start, to: end, settings: settings, frameBytes: frameBytes) { pb, t in
        writer.append(pb, at: max(0, end - nextT))
        nextT = t
        n += 1
        if Int(n) % 10 == 0 { progress(min(0.99, n / total)) }
        return true
    }
    writer.finish()
    progress(1)
    print("{\"frames\":\(Int(n))}")
}

// MARK: Optical-flow slow motion

/// Apple's interpolator hands its frames back in its own tone and colour (dark, red-tinted next to the decoded ones):
/// a fixed per-channel tone curve, learned from the first pairs by matching the made frames' histograms to the real
/// neighbours', brings them back. Fixed after the first pairs, so the curve itself never flickers.
final class ToneMatch {
    static let bins = 4096
    var made = [[Double]](repeating: [Double](repeating: 0, count: bins), count: 3)
    var real = [[Double]](repeating: [Double](repeating: 0, count: bins), count: 3)
    var pairs = 0
    var lut: [[Float]]? = nil
    var scratch: [Float] = []

    private func floats(_ pb: CVPixelBuffer, into f: inout [Float]) -> (Int, Int, Int)? {
        let w = CVPixelBufferGetWidth(pb) * 4, h = CVPixelBufferGetHeight(pb), rowBytes = CVPixelBufferGetBytesPerRow(pb)
        guard let base = CVPixelBufferGetBaseAddress(pb) else { return nil }
        if f.count != w * h { f = [Float](repeating: 0, count: w * h) }
        f.withUnsafeMutableBufferPointer { fp in
            var half = vImage_Buffer(data: base, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: rowBytes)
            var flt = vImage_Buffer(data: fp.baseAddress, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w * 4)
            vImageConvert_Planar16FtoPlanarF(&half, &flt, 0)
        }
        return (w, h, rowBytes)
    }

    /// Bins in √x: the made frames sit in the dark end, where plain bins would be too coarse.
    private func histogram(_ f: [Float], into hist: inout [[Double]], weight: Double) {
        let n = Double(ToneMatch.bins - 1)
        var i = 0
        while i + 3 < f.count {
            for c in 0..<3 { hist[c][Int(max(0, min(1, Double(f[i + c]))).squareRoot() * n)] += weight }
            i += 4 * 3 // every 3rd pixel is plenty
        }
    }

    /// Learns from one more pair (until it has enough), then fixes the curve.
    func learn(made pb: CVPixelBuffer, a: CVPixelBuffer, b: CVPixelBuffer, phase: Float) {
        guard lut == nil else { return }
        var f: [Float] = []
        for (buf, w, isMade) in [(pb, 1.0, true), (a, Double(1 - phase), false), (b, Double(phase), false)] {
            CVPixelBufferLockBaseAddress(buf, .readOnly)
            if floats(buf, into: &f) != nil {
                if isMade { histogram(f, into: &made, weight: w) } else { histogram(f, into: &real, weight: w) }
            }
            CVPixelBufferUnlockBaseAddress(buf, .readOnly)
        }
        pairs += 1
        if pairs >= 6 { lut = curve() }
    }

    /// The curve from what was seen so far (fixed once six pairs were seen).
    private func curve() -> [[Float]]? {
        var out = [[Float]]()
        for c in 0..<3 {
            let mt = made[c].reduce(0, +), rt = real[c].reduce(0, +)
            guard mt > 0, rt > 0 else { return nil }
            // Made value at the middle of bin i → the real value with the same share of pixels below it (inside the
            // real bin by linear interpolation), both in √x.
            var curve = [Float](repeating: 0, count: ToneMatch.bins)
            var mc = 0.0, rc = 0.0, j = 0
            let n = Double(ToneMatch.bins - 1)
            for i in 0..<ToneMatch.bins {
                let target = mc + made[c][i] / mt / 2
                mc += made[c][i] / mt
                while j < ToneMatch.bins - 1, rc + real[c][j] / rt < target { rc += real[c][j] / rt; j += 1 }
                let inBin = real[c][j] > 0 ? min(1, max(0, (target - rc) / (real[c][j] / rt))) : 0.5
                let root = (Double(j) + inBin) / n
                curve[i] = Float(root * root)
            }
            for i in 1..<ToneMatch.bins where curve[i] < curve[i - 1] { curve[i] = curve[i - 1] }
            out.append(curve)
        }
        return out
    }

    /// Applies the curve in place (learning first, from the first pairs).
    func apply(_ pb: CVPixelBuffer) {
        guard let lut = lut ?? curve() else { return }
        CVPixelBufferLockBaseAddress(pb, [])
        defer { CVPixelBufferUnlockBaseAddress(pb, []) }
        guard let (w, h, rowBytes) = floats(pb, into: &scratch), let base = CVPixelBufferGetBaseAddress(pb) else { return }
        let n = Float(ToneMatch.bins - 1)
        scratch.withUnsafeMutableBufferPointer { f in
            var i = 0
            while i + 3 < f.count {
                for c in 0..<3 {
                    let x = max(0, min(1, f[i + c])).squareRoot() * n
                    let k = Int(x), t = x - Float(k)
                    let lo = lut[c][k], hi = lut[c][min(k + 1, ToneMatch.bins - 1)]
                    f[i + c] = lo + (hi - lo) * t
                }
                i += 4
            }
            var half = vImage_Buffer(data: base, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: rowBytes)
            var flt = vImage_Buffer(data: f.baseAddress, height: vImagePixelCount(h), width: vImagePixelCount(w), rowBytes: w * 4)
            vImageConvert_PlanarFtoPlanar16F(&flt, &half, 0)
        }
    }
}

@available(macOS 15.4, *)
func runSmooth() async {
    guard positional.count >= 2 else { fail("usage: motion smooth <video> <out.mp4> --start S --end E --factor M --fps F") }
    let src = openSource(positional[0])
    let start = max(0, num("start") ?? 0)
    // (not cut to the file: a file at a higher rate ends up to a frame after the master's last frame — 137 frames of 24 are
    // 343 at 60, 342.5 of them inside the master — and the frames past its end hold the last one; exp, 14.11)
    let end = num("end") ?? src.duration
    let factor = max(1, min(40, num("factor") ?? 2))
    let fps = max(1, min(240, num("fps") ?? 30))
    // --cut T: a hard cut at T seconds of the source (the cover ends there): no frame is made across it — before T the
    // frame before, from T on the frame after (exp, 14.11: the cover and the first frame came out as a blend)
    // --cuts T1,T2,…: every cut of the film (exp2, 14.11): a shot never blends into the next one — interpolation runs only
    // inside a shot; a wanted time between the last frame of one shot and the first of the next shows one of them.
    let cuts = ((nums("cuts") ?? []) + (num("cut").map { [$0] } ?? [])).filter { $0 > 0 }.sorted()
    guard end > start else { fail("empty time range") }
    let w = Int(src.natural.width), h = Int(src.natural.height)
    guard VTFrameRateConversionConfiguration.processorSupported,
          let config = VTFrameRateConversionConfiguration(frameWidth: w, frameHeight: h, usePrecomputedFlow: false,
                                                          qualityPrioritization: .normal, revision: VTFrameRateConversionConfiguration.defaultRevision)
    else { fail("frame interpolation is not available on this Mac", code: 3) }
    let processor = VTFrameProcessor()
    var tone = ToneMatch()
    do { try processor.startSession(configuration: config) } catch { fail("frame interpolation is not available: \(error.localizedDescription)", code: 3) }
    let format = config.frameSupportedPixelFormats.first?.uint32Value ?? kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    var attrs = config.destinationPixelBufferAttributes
    attrs[kCVPixelBufferWidthKey as String] = w
    attrs[kCVPixelBufferHeightKey as String] = h
    // The made frames in exactly the decoded frames' format: anything else came out dark and red-tinted next to the
    // real frames — a strong flicker in the slow motion.
    attrs[kCVPixelBufferPixelFormatTypeKey as String] = format
    var pool: CVPixelBufferPool?
    CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &pool)
    guard let pool else { fail("can't allocate frames", code: 3) }

    let reader = FrameReader(src, from: max(0, start - 0.2), to: min(src.duration, end + 0.2), settings: [
        kCVPixelBufferPixelFormatTypeKey as String: format,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
    ])
    let writer = Writer(path: positional[1], size: src.natural, transform: src.transform, fps: fps)
    let outCount = max(1, Int(((end - start) * factor * fps).rounded()))
    // Output frame k shows the source at start + k / (factor · fps).
    func want(_ k: Int) -> Double { start + Double(k) / (factor * fps) }
    func ts(_ s: Double) -> CMTime { CMTime(seconds: s, preferredTimescale: 600_000) }

    guard var a = reader.next() else { fail("the clip has no frames") }
    var b = reader.next()
    // Skip to the pair around the first wanted time.
    while let nb = b, nb.1 <= want(0) { a = nb; b = reader.next() }
    var k = 0
    var lastPairEnd: Double? = nil
    while k < outCount {
        let wk = want(k)
        if let nb = b, nb.1 <= wk { a = nb; b = reader.next(); continue }
        guard let nb = b, nb.1 > a.1 else {
            // Past the last frame: hold it.
            writer.append(a.0, at: Double(k) / fps); k += 1
            if k % 10 == 0 { progress(Double(k) / Double(outCount)) }
            continue
        }
        // Every wanted time inside this pair, at once.
        var ks: [Int] = []
        var phases: [Float] = []
        var j = k
        while j < outCount, want(j) < nb.1 {
            ks.append(j)
            phases.append(Float((want(j) - a.1) / (nb.1 - a.1)))
            j += 1
        }
        let cutHere = cuts.first { a.1 < $0 - 1e-4 && nb.1 >= $0 - 1e-4 }
        let acrossCut = cutHere != nil
        // a new shot has its own light: the tone curve is learned again from its own first pairs
        if acrossCut { tone = ToneMatch(); lastPairEnd = nil }
        let needed = acrossCut ? [] : phases.enumerated().filter { $0.element >= 0.02 && $0.element <= 0.98 }
        var made: [Int: CVPixelBuffer] = [:]
        if !needed.isEmpty {
            var dsts: [VTFrameProcessorFrame] = []
            var bufs: [CVPixelBuffer] = []
            for (_, p) in needed {
                var d: CVPixelBuffer?
                CVPixelBufferPoolCreatePixelBuffer(nil, pool, &d)
                guard let d else { continue }
                // The source's colour description (primaries, transfer, matrix, range): the encoder then treats made
                // and real frames the same.
                CVBufferPropagateAttachments(a.0, d)
                guard let df = VTFrameProcessorFrame(buffer: d, presentationTimeStamp: ts(a.1 + (nb.1 - a.1) * Double(p))) else { continue }
                dsts.append(df); bufs.append(d)
            }
            if dsts.count == needed.count,
               let sf = VTFrameProcessorFrame(buffer: a.0, presentationTimeStamp: ts(a.1)),
               let nf = VTFrameProcessorFrame(buffer: nb.0, presentationTimeStamp: ts(nb.1)),
               let params = VTFrameRateConversionParameters(sourceFrame: sf, nextFrame: nf, opticalFlow: nil,
                                                            interpolationPhase: needed.map { $0.element },
                                                            submissionMode: lastPairEnd == a.1 ? .sequential : .random,
                                                            destinationFrames: dsts) {
                do {
                    try await processor.process(parameters: params)
                    for (i, (idx, _)) in needed.enumerated() {
                        // Back to the real frames' tone (see ToneMatch), or every made frame is a dark flash.
                        tone.learn(made: bufs[i], a: a.0, b: nb.0, phase: needed[i].element)
                        tone.apply(bufs[i])
                        CVBufferPropagateAttachments(a.0, bufs[i])
                        made[idx] = bufs[i]
                    }
                    lastPairEnd = nb.1
                } catch {
                    lastPairEnd = nil
                }
            }
        }
        for (i, kk) in ks.enumerated() {
            let p = phases[i]
            let frame = cutHere.map { want(kk) < $0 - 1e-4 ? a.0 : nb.0 } ?? (made[i] ?? (p < 0.5 ? a.0 : nb.0))
            writer.append(frame, at: Double(kk) / fps)
        }
        k = j
        progress(Double(k) / Double(outCount))
        if ks.isEmpty { a = nb; b = reader.next() }
    }
    reader.cancel()
    writer.finish()
    progress(1)
    print("{\"frames\":\(outCount),\"neural\":true}")
}

// MARK: Main

switch command {
case "probe":
    var subject = false
    if #available(macOS 14.0, *) { subject = true }
    print("{\"neural\":\(neuralAvailable()),\"subject\":\(subject)}")
case "track":
    runTrack()
case "reverse":
    runReverse()
case "smooth":
    if #available(macOS 15.4, *) {
        guard neuralAvailable() else { fail("frame interpolation is not available on this Mac", code: 3) }
        await runSmooth()
    } else {
        fail("frame interpolation needs macOS 15.4 or later", code: 3)
    }
default:
    fail("unknown command \(command)")
}
fflush(stdout)
exit(0)
