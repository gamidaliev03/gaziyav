// facecheck <video> [start length]: finds the face in 5 frames (of the whole video or of start…start+length)
// with Apple Vision and prints {"found":true,"frames":5,"hits":4,"box":[x,y,w,h]}
// (box in 0…1, top-left origin, averaged over hits) and "faces": EVERY face seen, followed across the frames by overlap,
// each with its box, how many frames it was in, head pose (yaw/roll in radians), the lip landmarks' confidence and
// whether a hand was at its mouth in any frame (lipsync's pre-flight judges size / angle / occlusion from these).
import AVFoundation
import Foundation
import Vision

func output(_ obj: [String: Any]) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: obj)
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}

let args = CommandLine.arguments
guard args.count > 1 else { output(["error": "usage: facecheck <video> [start length]"]) }
let rangeStart = args.count > 3 ? Double(args[2]) ?? 0 : 0
let rangeLength = args.count > 3 ? Double(args[3]) : nil
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let sem = DispatchSemaphore(value: 0)
var result: [String: Any] = [:]

Task {
    defer { sem.signal() }
    guard let total = try? await asset.load(.duration).seconds, total > 0 else {
        result = ["error": "not a video"]
        return
    }
    let from = min(max(0, rangeStart), total)
    let d = min(rangeLength ?? total, total - from)
    let gen = AVAssetImageGenerator(asset: asset)
    gen.appliesPreferredTrackTransform = true
    gen.maximumSize = CGSize(width: 720, height: 720)
    var boxes: [CGRect] = []
    var frames = 0
    struct Track { var boxes: [CGRect] = []; var yaw: [Double] = []; var roll: [Double] = []; var conf: [Double] = []; var hand = false }
    var tracks: [Track] = []
    func iou(_ a: CGRect, _ b: CGRect) -> Double {
        let i = a.intersection(b)
        if i.isNull { return 0 }
        let inter = Double(i.width * i.height)
        return inter / (Double(a.width * a.height) + Double(b.width * b.height) - inter)
    }
    for k in 1...5 {
        guard let (img, _) = try? await gen.image(at: CMTime(seconds: from + d * Double(k) / 6, preferredTimescale: 600)) else { continue }
        frames += 1
        let req = VNDetectFaceRectanglesRequest()
        if #available(macOS 12.0, *) { req.revision = VNDetectFaceRectanglesRequestRevision3 }
        let hands = VNDetectHumanHandPoseRequest()
        hands.maximumHandCount = 4
        let handler = VNImageRequestHandler(cgImage: img)
        try? handler.perform([req, hands])
        let marks = VNDetectFaceLandmarksRequest()
        marks.inputFaceObservations = req.results ?? []
        try? handler.perform([marks])
        if let face = req.results?.max(by: { $0.boundingBox.width < $1.boundingBox.width }) {
            let b = face.boundingBox
            boxes.append(CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height))
        }
        // the hands' joints (top-left origin), to see whether one is at a mouth
        let joints: [CGPoint] = (hands.results ?? []).flatMap { hand in
            ((try? hand.recognizedPoints(.all)) ?? [:]).values.filter { $0.confidence > 0.3 }.map { CGPoint(x: $0.location.x, y: 1 - $0.location.y) }
        }
        for face in marks.results ?? req.results ?? [] {
            let b = face.boundingBox
            let box = CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height)
            // the mouth: the lower third of the box, a little wider
            let mouth = CGRect(x: box.minX - box.width * 0.1, y: box.minY + box.height * 0.55, width: box.width * 1.2, height: box.height * 0.6)
            let hand = joints.filter { mouth.contains($0) }.count >= 2
            let k = tracks.firstIndex { t in t.boxes.last.map { iou($0, box) > 0.25 } ?? false }
            var t = k.map { tracks[$0] } ?? Track()
            t.boxes.append(box)
            t.yaw.append(face.yaw?.doubleValue ?? 0)
            t.roll.append(face.roll?.doubleValue ?? 0)
            t.conf.append(Double(face.landmarks?.confidence ?? 0))
            t.hand = t.hand || hand
            if let k { tracks[k] = t } else { tracks.append(t) }
        }
    }
    let mean = { (xs: [Double]) -> Double in xs.isEmpty ? 0 : xs.reduce(0, +) / Double(xs.count) }
    let faces: [[String: Any]] = tracks.map { t in
        [
            "box": [mean(t.boxes.map { Double($0.minX) }), mean(t.boxes.map { Double($0.minY) }), mean(t.boxes.map { Double($0.width) }), mean(t.boxes.map { Double($0.height) })],
            "hits": t.boxes.count,
            "yaw": (t.yaw.map { abs($0) }.max() ?? 0) as Double,
            "roll": mean(t.roll),
            "conf": (t.conf.min() ?? 0) as Double,
            "hand": t.hand,
        ]
    }
    guard !boxes.isEmpty else {
        result = ["found": false, "frames": frames, "hits": 0, "faces": faces]
        return
    }
    let n = Double(boxes.count)
    let box = [boxes.map(\.minX), boxes.map(\.minY), boxes.map(\.width), boxes.map(\.height)]
        .map { $0.reduce(0) { $0 + Double($1) } / n }
    result = ["found": true, "frames": frames, "hits": boxes.count, "box": box, "faces": faces]
}
sem.wait()
output(result)
