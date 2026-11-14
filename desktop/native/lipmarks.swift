// lipmarks <video>: lip landmarks for every frame with Apple Vision (Neural Engine), frames decoded by
// VideoToolbox. Prints {"w":W,"h":H,"frames":[{"outer","inner","contour","nose","crest":[[x,y]…],"hands":[[x,y,w,h]…],
// "handpts":[[[x,y]…]…],"box":[x,y,w,h],"yaw","roll","pitch","conf"} | null, …]} in pixels, top-left origin, display orientation.
// Head pose is in radians (nil → 0); handpts are the confident joints of each hand, for a hand-shaped mask.
// "leye"/"reye" are the eye outlines (face swap aligns the face by them). `--nohands` skips the hand check (faster);
// a picture (png/jpg/heic…) gives one frame.
import AVFoundation
import CoreText
import Foundation
import ImageIO
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("lipmarks: \(message)\n".data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count > 1 else { fail("usage: lipmarks <video> | lipmarks --plate <text> <height px> <out.png>") }

/// lipmarks --plate "AI-generated" 48 plate.png — the AI disclosure mark burned into every lipsync result, in Gaziyav's
/// colours: the small Gaziyav mark + white semibold text on an ink plate (#060606 at 55 %) with a faint light edge,
/// readable on light and dark footage.
if args[1] == "--plate" {
    guard args.count > 4, let height = Double(args[3]), height >= 8 else { fail("usage: lipmarks --plate <text> <height px> <out.png>") }
    let text = args[2]
    let font = CTFontCreateUIFontForLanguage(.emphasizedSystem, height * 0.52, nil)!
    let attributed = CFAttributedStringCreate(nil, text as CFString, [
        kCTFontAttributeName: font,
        kCTForegroundColorAttributeName: CGColor(red: 1, green: 1, blue: 1, alpha: 0.96),
    ] as CFDictionary)!
    let line = CTLineCreateWithAttributedString(attributed)
    let textWidth = CTLineGetTypographicBounds(line, nil, nil, nil)
    let padX = height * 0.42
    let markSize = height * 0.5, markGap = height * 0.22
    let w = Int(ceil(textWidth + padX * 2 + markSize + markGap)), h = Int(ceil(height))
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { fail("can't draw the plate") }
    let rect = CGRect(x: 0.5, y: 0.5, width: Double(w) - 1, height: Double(h) - 1)
    let path = CGPath(roundedRect: rect, cornerWidth: height * 0.3, cornerHeight: height * 0.3, transform: nil)
    ctx.addPath(path)
    ctx.setFillColor(CGColor(red: 6 / 255, green: 6 / 255, blue: 6 / 255, alpha: 0.55))
    ctx.fillPath()
    ctx.addPath(path)
    ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.18))
    ctx.setLineWidth(1)
    ctx.strokePath()
    // The mark: four petals around a point (viewBox 0…100, drawn y-down like the SVG).
    ctx.saveGState()
    ctx.translateBy(x: padX, y: (Double(h) + markSize) / 2)
    ctx.scaleBy(x: markSize / 100, y: -markSize / 100)
    let petals: [(Double, Double, Double, CGPoint, CGPoint, [Double], [Double])] = [
        (33, 33, 45, CGPoint(x: 13.6, y: 13.6), CGPoint(x: 52.4, y: 52.4), [0.965, 0.275, 0.561], [0.824, 0.188, 0.478]),
        (67, 33, -45, CGPoint(x: 86.4, y: 13.6), CGPoint(x: 47.6, y: 52.4), [0.714, 0.486, 0.969], [0.463, 0.220, 0.800]),
        (33, 67, -45, CGPoint(x: 13.6, y: 86.4), CGPoint(x: 52.4, y: 47.6), [0.396, 0.573, 0.980], [0.251, 0.396, 0.918]),
        (67, 67, 45, CGPoint(x: 86.4, y: 86.4), CGPoint(x: 47.6, y: 47.6), [0.984, 0.588, 0.275], [0.890, 0.337, 0.149]),
    ]
    for (cx, cy, deg, from, to, a, b) in petals {
        var t = CGAffineTransform(translationX: cx, y: cy).rotated(by: deg * .pi / 180)
        let ring = CGPath(ellipseIn: CGRect(x: -22, y: -9.5, width: 44, height: 19), transform: &t)
            .copy(strokingWithWidth: 11, lineCap: .round, lineJoin: .round, miterLimit: 10)
        ctx.saveGState()
        ctx.addPath(ring)
        ctx.clip()
        let g = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!, colors: [
            CGColor(red: a[0], green: a[1], blue: a[2], alpha: 1), CGColor(red: b[0], green: b[1], blue: b[2], alpha: 1),
        ] as CFArray, locations: [0, 1])!
        ctx.drawLinearGradient(g, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        ctx.restoreGState()
    }
    ctx.setBlendMode(.clear)
    ctx.fillEllipse(in: CGRect(x: 42, y: 42, width: 16, height: 16))
    ctx.setBlendMode(.normal)
    ctx.setFillColor(CGColor(red: 6 / 255, green: 6 / 255, blue: 6 / 255, alpha: 0.55))
    ctx.fillEllipse(in: CGRect(x: 42, y: 42, width: 16, height: 16))
    ctx.restoreGState()
    // Vertically centred on the cap height, so the text sits optically in the middle.
    let capHeight = Double(CTFontGetCapHeight(font))
    ctx.textPosition = CGPoint(x: padX + markSize + markGap, y: (Double(h) - capHeight) / 2.0)
    CTLineDraw(line, ctx)
    guard let image = ctx.makeImage(),
          let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[4]) as CFURL, "public.png" as CFString, 1, nil)
    else { fail("can't write the plate") }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fail("can't write the plate") }
    exit(0)
}

let noHands = args.contains("--nohands")
guard let input = args.dropFirst().first(where: { !$0.hasPrefix("--") }) else { fail("usage: lipmarks <video|picture> [--nohands]") }

/// The face of one picture or frame: outlines in pixels (top-left origin), box and head pose, or "null".
func faceJSON(_ face: VNFaceObservation?, w: Double, h: Double, hands: String = "[]", handPts: String = "[]") -> String {
    guard let face, let lm = face.landmarks, lm.outerLips != nil else { return "null" }
    let size = CGSize(width: w, height: h)
    func points(_ region: VNFaceLandmarkRegion2D?) -> String {
        guard let region else { return "[]" }
        // pointsInImage uses a bottom-left origin.
        return "[" + region.pointsInImage(imageSize: size).map { String(format: "[%.1f,%.1f]", $0.x, h - $0.y) }.joined(separator: ",") + "]"
    }
    let b = face.boundingBox
    let box = String(format: "[%.1f,%.1f,%.1f,%.1f]", b.minX * w, (1 - b.maxY) * h, b.width * w, b.height * h)
    let pose = String(
        format: "\"yaw\":%.3f,\"roll\":%.3f,\"pitch\":%.3f,\"conf\":%.3f",
        face.yaw?.doubleValue ?? 0, face.roll?.doubleValue ?? 0, face.pitch?.doubleValue ?? 0, Double(lm.confidence)
    )
    return "{\"outer\":\(points(lm.outerLips)),\"inner\":\(points(lm.innerLips)),\"contour\":\(points(lm.faceContour)),"
        + "\"nose\":\(points(lm.nose)),\"crest\":\(points(lm.noseCrest)),\"leye\":\(points(lm.leftEye)),\"reye\":\(points(lm.rightEye)),"
        + "\"hands\":\(hands),\"handpts\":\(handPts),\"box\":\(box),\(pose)}"
}

/// The biggest face Vision finds through `handler` (rectangles rev. 3 carry the head pose, landmarks refine them).
func biggestFace(_ handler: VNImageRequestHandler, also extra: [VNRequest] = []) -> VNFaceObservation? {
    let rects = VNDetectFaceRectanglesRequest()
    rects.revision = VNDetectFaceRectanglesRequestRevision3
    try? handler.perform([rects] + extra)
    let req = VNDetectFaceLandmarksRequest()
    req.inputFaceObservations = rects.results ?? []
    try? handler.perform([req])
    return req.results?.max(by: { $0.boundingBox.width < $1.boundingBox.width })
}

let pictureTypes: Set<String> = ["png", "jpg", "jpeg", "heic", "heif", "webp", "tif", "tiff", "bmp", "gif"]
if pictureTypes.contains(URL(fileURLWithPath: input).pathExtension.lowercased()) {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: input) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(src, 0, nil)
    else { fail("can't read the picture") }
    let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any]
    let orient = CGImagePropertyOrientation(rawValue: (props?[kCGImagePropertyOrientation] as? UInt32) ?? 1) ?? .up
    let rotated = [.left, .right, .leftMirrored, .rightMirrored].contains(orient)
    let w = Double(rotated ? image.height : image.width), h = Double(rotated ? image.width : image.height)
    let face = biggestFace(VNImageRequestHandler(cgImage: image, orientation: orient))
    print("{\"w\":\(Int(w)),\"h\":\(Int(h)),\"frames\":[\(faceJSON(face, w: w, h: h))]}")
    exit(0)
}

let asset = AVURLAsset(url: URL(fileURLWithPath: input))
let sem = DispatchSemaphore(value: 0)
var json = ""

/// The CGImagePropertyOrientation that turns stored frames into what the player shows.
func orientation(_ t: CGAffineTransform) -> CGImagePropertyOrientation {
    switch (t.a, t.b, t.c, t.d) {
    case (0, 1, -1, 0): return .right
    case (0, -1, 1, 0): return .left
    case (-1, 0, 0, -1): return .down
    default: return .up
    }
}

Task {
    defer { sem.signal() }
    guard let track = try? await asset.loadTracks(withMediaType: .video).first,
          let natural = try? await track.load(.naturalSize),
          let transform = try? await track.load(.preferredTransform)
    else { fail("no video track") }
    let orient = orientation(transform)
    let rotated = orient == .right || orient == .left
    let w = Double(rotated ? natural.height : natural.width)
    let h = Double(rotated ? natural.width : natural.height)
    guard let reader = try? AVAssetReader(asset: asset) else { fail("can't read the video") }
    let out = AVAssetReaderTrackOutput(track: track, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
    ])
    out.alwaysCopiesSampleData = false
    reader.add(out)
    guard reader.startReading() else { fail(reader.error?.localizedDescription ?? "can't start reading") }

    var frames: [String] = []
    var frameIndex = 0
    var lastHands: [VNHumanHandPoseObservation] = []
    while let sample = out.copyNextSampleBuffer() {
        guard let pixels = CMSampleBufferGetImageBuffer(sample) else { continue }
        // Hands near the mouth must stay original (a generated mouth painted over fingers is the worst glitch).
        // Hand pose is the expensive part, so it runs on every 2nd frame and the result is reused in between.
        let handReq = VNDetectHumanHandPoseRequest()
        handReq.maximumHandCount = 2
        let checkHands = !noHands && frameIndex % 2 == 0
        frameIndex += 1
        let face = biggestFace(VNImageRequestHandler(cvPixelBuffer: pixels, orientation: orient), also: checkHands ? [handReq] : [])
        if checkHands { lastHands = handReq.results ?? [] }
        var handPoints: [String] = []
        let hands = lastHands.compactMap { hand -> String? in
            let pts = ((try? hand.recognizedPoints(.all)) ?? [:]).values.filter { $0.confidence > 0.3 }
            guard pts.count >= 4 else { return nil }
            let xs = pts.map { $0.location.x * w }, ys = pts.map { (1 - $0.location.y) * h }
            handPoints.append("[" + zip(xs, ys).map { String(format: "[%.1f,%.1f]", $0, $1) }.joined(separator: ",") + "]")
            return String(format: "[%.1f,%.1f,%.1f,%.1f]", xs.min()!, ys.min()!, xs.max()! - xs.min()!, ys.max()! - ys.min()!)
        }
        frames.append(faceJSON(face, w: w, h: h, hands: "[" + hands.joined(separator: ",") + "]", handPts: "[" + handPoints.joined(separator: ",") + "]"))
    }
    if reader.status == .failed { fail(reader.error?.localizedDescription ?? "decode failed") }
    json = "{\"w\":\(Int(w)),\"h\":\(Int(h)),\"frames\":[" + frames.joined(separator: ",") + "]}"
}
sem.wait()
print(json)
