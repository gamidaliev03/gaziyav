// neuralfx — Gaziyav's on-device video AI, ported from Kadr (NeuralEffects.swift, Upscaler.swift).
// Everything runs on this Mac: Apple Vision person segmentation (Neural Engine), Core Image on the GPU,
// MetalFX spatial upscaling, VideoToolbox decode and encode. Nothing is downloaded, nothing leaves the Mac.
//
//   neuralfx caps                                   → {"metalfx":true,"segmentation":true,"hevcAlpha":true,"gpu":"Apple M1 Pro"}
//   neuralfx matte   IN OUT [--mode transparent|color|blur] [--color RRGGBB] [--blur 30] [--feather 2] [--edge 0]
//                           [--quality fast|balanced|accurate]
//   neuralfx enhance IN OUT [--preset enhance|denoise] [--level 0.02] [--sharpness 0.4] [--strength 1]
//   neuralfx upscale IN OUT [--scale 2|4] [--engine metalfx|lanczos]
//   neuralfx photo   IN OUT.png [--mode transparent|color|blur] [--color RRGGBB] [--blur 30] [--feather 2] [--edge 0]
//                           (a photo's background: Vision's subject lift on macOS 14+ — people, pets, things —
//                            else its person segmentation; a PNG with alpha at the photo's own size)
//   common: [--start s] [--duration s] [--codec auto|h264|hevc|hevc-alpha|prores4444]
//
// OUT is a QuickTime movie. The source audio is copied unchanged; the picture keeps the frame times of the source.
// Progress: one JSON line about 4 times a second on stdout, {"p":0.42,"frame":180,"frames":429,"fps":61.2};
// the last line is {"done":true,…} with the size, codec, engine and average milliseconds per stage.
// The process lowers its own priority (nice 10, utility QoS, low-priority GPU queue) so the editor stays smooth and the Mac cool.
import AVFoundation
import CoreImage
import Foundation
import Metal
import MetalFX
import VideoToolbox
import Vision

let polite = ProcessInfo.processInfo.environment["NEURALFX_FULL_SPEED"] == nil
if polite {
    setpriority(PRIO_PROCESS, 0, 10)
    pthread_set_qos_class_self_np(QOS_CLASS_UTILITY, 0)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("neuralfx: \(message)\n".data(using: .utf8)!)
    exit(1)
}

let stdoutLock = NSLock()
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
    stdoutLock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    stdoutLock.unlock()
}

// MARK: - Arguments

let argv = CommandLine.arguments
guard argv.count > 1 else { fail("usage: neuralfx caps | matte|enhance|upscale IN OUT [options]") }
let op = argv[1]
let device = MTLCreateSystemDefaultDevice()

func metalFXAvailable() -> Bool {
    guard let device else { return false }
    return MTLFXSpatialScalerDescriptor.supportsDevice(device)
}

if op == "caps" {
    let encoders = (try? { () throws -> [[String: Any]] in
        var list: CFArray?
        VTCopyVideoEncoderList(nil, &list)
        return (list as? [[String: Any]]) ?? []
    }()) ?? []
    let hevcAlpha = encoders.contains { ($0[kVTVideoEncoderList_CodecType as String] as? UInt32) == kCMVideoCodecType_HEVCWithAlpha }
    emit(["metalfx": metalFXAvailable(), "segmentation": true, "hevcAlpha": hevcAlpha, "gpu": device?.name ?? "none"])
    exit(0)
}
// MARK: - Photo background (one image, no video pipeline)

if op == "photo" {
    guard argv.count >= 4 else { fail("usage: neuralfx photo IN OUT.png [options]") }
    var popts: [String: String] = [:]
    var k = 4
    while k + 1 < argv.count { popts[String(argv[k].dropFirst(2))] = argv[k + 1]; k += 2 }
    let pnum = { (key: String, def: Double, range: ClosedRange<Double>) -> Double in min(max(Double(popts[key] ?? "") ?? def, range.lowerBound), range.upperBound) }
    let inURL = URL(fileURLWithPath: argv[2]), outURL = URL(fileURLWithPath: argv[3])
    guard var image = CIImage(contentsOf: inURL, options: [.applyOrientationProperty: true]) else { fail("can't read the photo") }
    image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
    let e = image.extent
    let handler = VNImageRequestHandler(ciImage: image, options: [:])
    var mask: CIImage? = nil
    var engine = "vision-person"
    if #available(macOS 14.0, *) {
        let lift = VNGenerateForegroundInstanceMaskRequest()
        do {
            try handler.perform([lift])
            if let r = lift.results?.first, !r.allInstances.isEmpty {
                let buffer = try r.generateScaledMaskForImage(forInstances: r.allInstances, from: handler)
                mask = CIImage(cvPixelBuffer: buffer)
                engine = "vision-subject"
            }
        } catch {}
    }
    if mask == nil {
        let person = VNGeneratePersonSegmentationRequest()
        person.qualityLevel = .accurate
        person.outputPixelFormat = kCVPixelFormatType_OneComponent8
        do { try handler.perform([person]) } catch { fail("segmentation failed: \(error.localizedDescription)") }
        if let m = person.results?.first?.pixelBuffer { mask = CIImage(cvPixelBuffer: m) }
    }
    guard var m = mask else { fail("nobody and nothing to keep was found in this photo") }
    m = m.transformed(by: CGAffineTransform(scaleX: e.width / m.extent.width, y: e.height / m.extent.height))
    let edgeR = pnum("edge", 0, -20...20), featherR = pnum("feather", 2, 0...40)
    if edgeR >= 0.5 { m = m.clampedToExtent().applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": edgeR]).cropped(to: e) }
    else if edgeR <= -0.5 { m = m.clampedToExtent().applyingFilter("CIMorphologyMinimum", parameters: ["inputRadius": -edgeR]).cropped(to: e) }
    if featherR > 0.3 { m = m.clampedToExtent().applyingGaussianBlur(sigma: featherR).cropped(to: e) }
    let hex = (popts["color"] ?? "00CC4D").trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    let rgb = UInt32(hex, radix: 16) ?? 0x00CC4D
    let background: CIImage
    switch popts["mode"] ?? "transparent" {
    case "color": background = CIImage(color: CIColor(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255)).cropped(to: e)
    case "blur": background = image.clampedToExtent().applyingGaussianBlur(sigma: pnum("blur", 30, 0...200)).cropped(to: e)
    default: background = CIImage(color: .clear).cropped(to: e)
    }
    let out = image.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: background, kCIInputMaskImageKey: m]).cropped(to: e)
    let context = device.map { CIContext(mtlDevice: $0) } ?? CIContext()
    guard let srgb = CGColorSpace(name: CGColorSpace.sRGB) else { fail("no sRGB") }
    do { try context.writePNGRepresentation(of: out, to: outURL, format: .RGBA8, colorSpace: srgb) } catch { fail("can't write the PNG: \(error.localizedDescription)") }
    emit(["done": true, "width": Int(e.width), "height": Int(e.height), "engine": engine])
    exit(0)
}

guard ["matte", "enhance", "upscale"].contains(op), argv.count >= 4 else { fail("unknown operation \(op)") }

var opts: [String: String] = [:]
var i = 4
while i < argv.count {
    let key = argv[i]
    guard key.hasPrefix("--"), i + 1 < argv.count else { fail("bad option \(key)") }
    opts[String(key.dropFirst(2))] = argv[i + 1]
    i += 2
}
func num(_ key: String, _ fallback: Double, _ range: ClosedRange<Double>) -> Double {
    guard let raw = opts[key], let v = Double(raw), v.isFinite else { return fallback }
    return min(range.upperBound, max(range.lowerBound, v))
}
let inURL = URL(fileURLWithPath: argv[2])
let outURL = URL(fileURLWithPath: argv[3])

// MARK: - Source

let asset = AVURLAsset(url: inURL, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
guard let vtrack = asset.tracks(withMediaType: .video).first else { fail("the file has no picture") }
let atrack = asset.tracks(withMediaType: .audio).first
let natural = vtrack.naturalSize
let transform = vtrack.preferredTransform
let fps = Double(vtrack.nominalFrameRate > 0 ? vtrack.nominalFrameRate : 30)
let full = asset.duration.seconds
let start = num("start", 0, 0...max(0, full))
let length = num("duration", full - start, 0.01...max(0.01, full - start))
let range = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600_000), duration: CMTime(seconds: length, preferredTimescale: 600_000))
let inW = Int(natural.width.rounded()), inH = Int(natural.height.rounded())
guard inW >= 16, inH >= 16 else { fail("the picture is too small (\(inW)×\(inH))") }

// Matte and Enhance work upright (Vision wants people the right way up); Upscale keeps the file's orientation.
let rotated = !transform.isIdentity && op != "upscale"
let orientation: CGImagePropertyOrientation = {
    let t = transform
    switch (t.a, t.b, t.c, t.d) {
    case (0, 1, -1, 0): return .right
    case (0, -1, 1, 0): return .left
    case (-1, 0, 0, -1): return .down
    default: return .up
    }
}()
let uprightW = (orientation == .left || orientation == .right) ? inH : inW
let uprightH = (orientation == .left || orientation == .right) ? inW : inH

// MARK: - Settings per operation

let scale = op == "upscale" ? (num("scale", 2, 1...4) >= 3 ? 4 : 2) : 1
let outW = op == "upscale" ? inW * scale : uprightW
let outH = op == "upscale" ? inH * scale : uprightH
let mode = opts["mode"] ?? "transparent"
let transparent = op == "matte" && mode == "transparent"
let codecName: String = {
    let asked = opts["codec"] ?? "auto"
    if asked != "auto" { return asked }
    if transparent { return "hevc-alpha" }
    // H.264 decodes everywhere; above its limits (4096×2304) use HEVC.
    return max(outW, outH) > 4096 || outW * outH > 4096 * 2304 ? "hevc" : "h264"
}()
let codec: AVVideoCodecType = {
    switch codecName {
    case "hevc": return .hevc
    case "hevc-alpha": return .hevcWithAlpha
    case "prores4444": return .proRes4444
    default: return .h264
    }
}()

// MARK: - Reader / writer

let reader: AVAssetReader
do { reader = try AVAssetReader(asset: asset) } catch { fail("can't read the file: \(error.localizedDescription)") }
reader.timeRange = range
let vout = AVAssetReaderTrackOutput(track: vtrack, outputSettings: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferMetalCompatibilityKey as String: true,
    kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
])
vout.alwaysCopiesSampleData = false
reader.add(vout)
var aout: AVAssetReaderTrackOutput?
if let atrack {
    let o = AVAssetReaderTrackOutput(track: atrack, outputSettings: nil) // compressed: copied as is
    o.alwaysCopiesSampleData = false
    if reader.canAdd(o) { reader.add(o); aout = o }
}

let tmpURL = outURL.deletingLastPathComponent().appendingPathComponent(".\(outURL.lastPathComponent).part.mov")
try? FileManager.default.removeItem(at: tmpURL)
let writer: AVAssetWriter
do { writer = try AVAssetWriter(outputURL: tmpURL, fileType: .mov) } catch { fail("can't write \(outURL.path): \(error.localizedDescription)") }

let sourceRate = Double(vtrack.estimatedDataRate)
let pixelRatio = Double(outW * outH) / Double(inW * inH)
// About the source's quality per pixel (upscales need less per pixel), within 2…120 Mbit/s.
let bitRate = Int(min(120_000_000, max(sourceRate * 1.1 * pow(pixelRatio, 0.6), Double(outW * outH) * fps * 0.07, 2_000_000)))
var compression: [String: Any] = [:]
if codec != .proRes4444 {
    compression[AVVideoAverageBitRateKey] = bitRate
    compression[AVVideoExpectedSourceFrameRateKey] = Int(fps.rounded())
    // A keyframe every second and no reordering: the editor seeks and scrubs these files quickly.
    compression[AVVideoMaxKeyFrameIntervalKey] = max(1, Int(fps.rounded()))
    compression[AVVideoAllowFrameReorderingKey] = false
}
if codec == .hevcWithAlpha {
    compression[kVTCompressionPropertyKey_AlphaChannelMode as String] = kVTAlphaChannelMode_PremultipliedAlpha
    compression[kVTCompressionPropertyKey_TargetQualityForAlpha as String] = 0.9
}
var vsettings: [String: Any] = [
    AVVideoCodecKey: codec, AVVideoWidthKey: outW, AVVideoHeightKey: outH,
    AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
    ],
]
if !compression.isEmpty { vsettings[AVVideoCompressionPropertiesKey] = compression }
guard writer.canApply(outputSettings: vsettings, forMediaType: .video) else { fail("this Mac can't encode \(codecName) at \(outW)×\(outH)") }
let vin = AVAssetWriterInput(mediaType: .video, outputSettings: vsettings)
vin.expectsMediaDataInRealTime = false
if op == "upscale" { vin.transform = transform }
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vin, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: outW, kCVPixelBufferHeightKey as String: outH,
    kCVPixelBufferMetalCompatibilityKey as String: true,
    kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
])
writer.add(vin)
var ain: AVAssetWriterInput?
if let atrack, aout != nil {
    let hint = (atrack.formatDescriptions.first).map { $0 as! CMFormatDescription }
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: hint)
    input.expectsMediaDataInRealTime = false
    if writer.canAdd(input) { writer.add(input); ain = input }
}

guard reader.startReading() else { fail("can't decode the file: \(reader.error?.localizedDescription ?? "unknown error")") }
guard writer.startWriting() else { fail("can't start writing: \(writer.error?.localizedDescription ?? "unknown error")") }
writer.startSession(atSourceTime: .zero)

// MARK: - GPU

let ci: CIContext = {
    var o: [CIContextOption: Any] = [.workingColorSpace: NSNull(), .outputColorSpace: NSNull(), .cacheIntermediates: false,
                                     .priorityRequestLow: polite, .name: "neuralfx"]
    o[.useSoftwareRenderer] = false
    if let device { return CIContext(mtlDevice: device, options: o) }
    return CIContext(options: o)
}()

// Remove Background: one stateful request for the whole clip (Vision smooths the mask between frames).
let segmentation: VNGeneratePersonSegmentationRequest = {
    let r = VNGeneratePersonSegmentationRequest()
    switch opts["quality"] ?? "balanced" {
    case "accurate": r.qualityLevel = .accurate
    case "fast": r.qualityLevel = .fast
    default: r.qualityLevel = .balanced
    }
    r.outputPixelFormat = kCVPixelFormatType_OneComponent8
    return r
}()
let sequence = VNSequenceRequestHandler()

func hexColor(_ s: String?) -> CIColor {
    let hex = (s ?? "00CC4D").trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    guard hex.count == 6, let v = UInt32(hex, radix: 16) else { return CIColor(red: 0, green: 0.8, blue: 0.3) }
    return CIColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255)
}
let bgColor = hexColor(opts["color"])
let blur = num("blur", 30, 0...200)
let feather = num("feather", 2, 0...40)
let edge = num("edge", 0, -20...20)
let preset = opts["preset"] ?? "enhance"
let level = num("level", 0.02, 0...0.1)
let sharpness = num("sharpness", 0.4, 0...2)
let strength = num("strength", 1, 0...2)

var stageMs: [String: Double] = ["decode": 0, "ai": 0, "render": 0, "encode": 0]
func nowMs() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1e6 }

func upright(_ pb: CVPixelBuffer) -> CIImage {
    var image = CIImage(cvPixelBuffer: pb)
    if rotated {
        image = image.oriented(orientation)
        image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
    }
    return image
}

/// The person mask of one frame (Vision, Neural Engine), copied out of Vision's buffer so it can be kept for blending.
func segment(_ pb: CVPixelBuffer) -> CIImage? {
    let t0 = nowMs()
    do {
        if rotated { try sequence.perform([segmentation], on: upright(pb)) } else { try sequence.perform([segmentation], on: pb) }
    } catch { fail("person segmentation failed: \(error.localizedDescription)") }
    stageMs["ai"]! += nowMs() - t0
    guard let m = segmentation.results?.first?.pixelBuffer else { return nil }
    let w = CVPixelBufferGetWidth(m), h = CVPixelBufferGetHeight(m)
    var copy: CVPixelBuffer?
    CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_OneComponent8, [kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any]] as CFDictionary, &copy)
    guard let copy else { return nil }
    CVPixelBufferLockBaseAddress(m, .readOnly); CVPixelBufferLockBaseAddress(copy, [])
    let srcRow = CVPixelBufferGetBytesPerRow(m), dstRow = CVPixelBufferGetBytesPerRow(copy)
    if let s = CVPixelBufferGetBaseAddress(m), let d = CVPixelBufferGetBaseAddress(copy) {
        for y in 0..<h { memcpy(d + y * dstRow, s + y * srcRow, w) }
    }
    CVPixelBufferUnlockBaseAddress(copy, []); CVPixelBufferUnlockBaseAddress(m, .readOnly)
    return CIImage(cvPixelBuffer: copy)
}

/// Kadr's Remove Background composite, plus an edge control: the mask is grown (edge > 0) or tightened (edge < 0), then feathered.
func matte(_ pb: CVPixelBuffer, _ rawMask: CIImage?) -> CIImage {
    let image = upright(pb)
    let e = image.extent
    guard var mask = rawMask else { return transparent ? CIImage(color: .clear).cropped(to: e) : image }
    mask = mask.transformed(by: CGAffineTransform(scaleX: e.width / mask.extent.width, y: e.height / mask.extent.height))
    if edge >= 0.5 {
        mask = mask.clampedToExtent().applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": edge]).cropped(to: e)
    } else if edge <= -0.5 {
        mask = mask.clampedToExtent().applyingFilter("CIMorphologyMinimum", parameters: ["inputRadius": -edge]).cropped(to: e)
    }
    if feather > 0.3 { mask = mask.clampedToExtent().applyingGaussianBlur(sigma: feather).cropped(to: e) }
    let background: CIImage
    switch mode {
    case "color": background = CIImage(color: bgColor).cropped(to: e)
    case "blur": background = image.clampedToExtent().applyingGaussianBlur(sigma: blur).cropped(to: e)
    default: background = CIImage(color: .clear).cropped(to: e)
    }
    return image.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: background, kCIInputMaskImageKey: mask]).cropped(to: e)
}

/// The mask between two segmented frames: a cross-fade of their masks (Vision runs at ≤ 30 masks per second).
func between(_ a: CIImage?, _ b: CIImage?, _ t: Double) -> CIImage? {
    guard let a else { return b }
    guard let b else { return a }
    let bb = b.transformed(by: CGAffineTransform(scaleX: a.extent.width / b.extent.width, y: a.extent.height / b.extent.height))
    return a.applyingFilter("CIDissolveTransition", parameters: [kCIInputTargetImageKey: bb, kCIInputTimeKey: t]).cropped(to: a.extent)
}

func enhance(_ pb: CVPixelBuffer) -> CIImage {
    let image = upright(pb)
    let e = image.extent
    var out = image.applyingFilter("CINoiseReduction", parameters: ["inputNoiseLevel": level, "inputSharpness": sharpness])
    if preset == "enhance" {
        // Kadr's Denoise, then a gentle finish scaled by --strength (1 = default, 0 = denoise only, 2 = twice as much):
        // luminance sharpening, lifted shadows, a touch of contrast and colour.
        let k = strength
        out = out.applyingFilter("CISharpenLuminance", parameters: ["inputSharpness": 0.35 * k, "inputRadius": 1.5])
        out = out.applyingFilter("CIHighlightShadowAdjust", parameters: ["inputShadowAmount": 0.18 * k, "inputHighlightAmount": 1 - 0.04 * k])
        out = out.applyingFilter("CIColorControls", parameters: ["inputSaturation": 1 + 0.06 * k, "inputContrast": 1 + 0.05 * k, "inputBrightness": 0.005 * k])
        out = out.applyingFilter("CIVibrance", parameters: ["inputAmount": 0.12 * k])
    }
    return out.cropped(to: e)
}

// MetalFX: one scaler per pass (4× is two 2× passes when a single pass isn't supported).
var textureCache: CVMetalTextureCache?
if let device { CVMetalTextureCacheCreate(nil, nil, device, nil, &textureCache) }
let queue = device?.makeCommandQueue()
struct Pass { let scaler: MTLFXSpatialScaler; let out: MTLTexture; let inW: Int; let inH: Int }
var passes: [Pass] = []
var engine = op == "upscale" ? (opts["engine"] ?? "metalfx") : (op == "matte" ? "vision" : "coreimage")
if op == "upscale" && engine == "metalfx" {
    func makePass(_ w: Int, _ h: Int, _ ow: Int, _ oh: Int) -> Pass? {
        guard let device else { return nil }
        let d = MTLFXSpatialScalerDescriptor()
        d.inputWidth = w; d.inputHeight = h; d.outputWidth = ow; d.outputHeight = oh
        d.colorTextureFormat = .bgra8Unorm; d.outputTextureFormat = .bgra8Unorm
        d.colorProcessingMode = .perceptual
        guard let scaler = d.makeSpatialScaler(device: device) else { return nil }
        let td = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: ow, height: oh, mipmapped: false)
        td.storageMode = .private
        td.usage = [scaler.outputTextureUsage, .shaderRead]
        guard let tex = device.makeTexture(descriptor: td) else { return nil }
        return Pass(scaler: scaler, out: tex, inW: w, inH: h)
    }
    if metalFXAvailable(), queue != nil, textureCache != nil {
        if let one = makePass(inW, inH, outW, outH) {
            passes = [one]
        } else if scale == 4, let a = makePass(inW, inH, inW * 2, inH * 2), let b = makePass(inW * 2, inH * 2, outW, outH) {
            passes = [a, b]
        }
    }
    if passes.isEmpty { engine = "lanczos" }
}

func texture(_ pb: CVPixelBuffer) -> MTLTexture? {
    guard let textureCache else { return nil }
    var t: CVMetalTexture?
    CVMetalTextureCacheCreateTextureFromImage(nil, textureCache, pb, nil, .bgra8Unorm, CVPixelBufferGetWidth(pb), CVPixelBufferGetHeight(pb), 0, &t)
    return t.flatMap(CVMetalTextureGetTexture)
}

/// Renders one source frame into `dst` (a writer buffer of outW×outH).
func process(_ pb: CVPixelBuffer, into dst: CVPixelBuffer, mask: CIImage? = nil) {
    switch op {
    case "upscale" where engine == "metalfx":
        guard let src = texture(pb), let dstTex = texture(dst), let cb = queue?.makeCommandBuffer() else { fail("GPU textures unavailable") }
        let t0 = nowMs()
        var input = src
        for p in passes {
            p.scaler.colorTexture = input
            p.scaler.outputTexture = p.out
            p.scaler.inputContentWidth = p.inW
            p.scaler.inputContentHeight = p.inH
            p.scaler.encode(commandBuffer: cb)
            input = p.out
        }
        if let blit = cb.makeBlitCommandEncoder() { blit.copy(from: input, to: dstTex); blit.endEncoding() }
        cb.commit()
        cb.waitUntilCompleted()
        stageMs["ai"]! += nowMs() - t0
    case "upscale":
        let image = CIImage(cvPixelBuffer: pb).applyingFilter("CILanczosScaleTransform", parameters: ["inputScale": Double(scale), "inputAspectRatio": 1.0])
        let t0 = nowMs()
        ci.render(image, to: dst, bounds: CGRect(x: 0, y: 0, width: outW, height: outH), colorSpace: nil)
        stageMs["render"]! += nowMs() - t0
    default:
        let image = op == "matte" ? matte(pb, mask) : enhance(pb)
        let t0 = nowMs()
        if transparent {
            // Fully transparent first: CIBlendWithMask leaves the cut-out area clear, but the pool reuses buffers.
            ci.render(CIImage(color: .clear).cropped(to: CGRect(x: 0, y: 0, width: outW, height: outH)), to: dst)
        }
        ci.render(image, to: dst, bounds: CGRect(x: 0, y: 0, width: outW, height: outH), colorSpace: nil)
        stageMs["render"]! += nowMs() - t0
    }
}

// MARK: - Run

let totalFrames = max(1, Int((length * fps).rounded()))
let group = DispatchGroup()
let videoQueue = DispatchQueue(label: "neuralfx.video", qos: polite ? .utility : .userInitiated)
let audioQueue = DispatchQueue(label: "neuralfx.audio", qos: .utility)
let began = nowMs()
var frames = 0
var lastEmit = 0.0
var lastPts = CMTime.zero
var frameDur = CMTime(seconds: 1 / fps, preferredTimescale: 600_000)
var failure: String?

func shifted(_ sb: CMSampleBuffer) -> CMSampleBuffer? {
    var count: CMItemCount = 0
    CMSampleBufferGetSampleTimingInfoArray(sb, entryCount: 0, arrayToFill: nil, entriesNeededOut: &count)
    guard count > 0 else { return sb }
    var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
    CMSampleBufferGetSampleTimingInfoArray(sb, entryCount: count, arrayToFill: &timing, entriesNeededOut: &count)
    for k in 0..<count {
        if timing[k].presentationTimeStamp.isValid { timing[k].presentationTimeStamp = timing[k].presentationTimeStamp - range.start }
        if timing[k].decodeTimeStamp.isValid { timing[k].decodeTimeStamp = timing[k].decodeTimeStamp - range.start }
    }
    var out: CMSampleBuffer?
    CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sb, sampleTimingEntryCount: count, sampleTimingArray: &timing, sampleBufferOut: &out)
    return out
}

/// Remove Background segments at most `maskfps` frames per second (30 by default); frames in between get a
/// cross-fade of the neighbouring masks. A 60 fps clip needs half the Neural Engine work and looks the same.
let maskStride = op == "matte" ? max(1, Int((fps / num("maskfps", 30, 5...240)).rounded())) : 1
var pending: [(sb: CMSampleBuffer, pb: CVPixelBuffer, pts: CMTime)] = []
var lastMask: CIImage?
var sourceIndex = 0

/// Renders and appends one frame (waits while the encoder is busy). False = stop (failure is set).
func write(_ pb: CVPixelBuffer, _ pts: CMTime, _ mask: CIImage?) -> Bool {
    guard let pool = adaptor.pixelBufferPool else { failure = "no output buffers"; return false }
    var dst: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &dst)
    guard let dst else { failure = "out of memory for output frames"; return false }
    autoreleasepool { process(pb, into: dst, mask: mask) }
    let te = nowMs()
    while !vin.isReadyForMoreMediaData { usleep(500) }
    if !adaptor.append(dst, withPresentationTime: pts) {
        failure = "couldn't write a frame: \(writer.error?.localizedDescription ?? "unknown error")"
        return false
    }
    stageMs["encode"]! += nowMs() - te
    lastPts = pts
    frames += 1
    let now = nowMs()
    if now - lastEmit > 250 {
        lastEmit = now
        let elapsed = (now - began) / 1000
        emit(["p": min(0.99, Double(frames) / Double(totalFrames)), "frame": frames, "frames": totalFrames,
              "fps": (Double(frames) / max(0.001, elapsed) * 10).rounded() / 10])
    }
    return true
}

/// Frames waiting for the next mask, written with masks blended between `lastMask` and `next`.
func flush(_ next: CIImage?) -> Bool {
    let n = pending.count
    for (k, f) in pending.enumerated() {
        let t = Double(k + 1) / Double(n + 1)
        if !write(f.pb, f.pts, next == nil ? lastMask : between(lastMask, next, t)) { return false }
    }
    pending.removeAll()
    return true
}

group.enter()
vin.requestMediaDataWhenReady(on: videoQueue) {
    func finish() { vin.markAsFinished(); group.leave() }
    while vin.isReadyForMoreMediaData {
        let td = nowMs()
        guard let sb = vout.copyNextSampleBuffer() else {
            if op == "matte" && !flush(nil) { reader.cancelReading() }
            finish()
            return
        }
        stageMs["decode"]! += nowMs() - td
        guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb) - range.start
        if pts.seconds < -0.0005 { continue }
        if pts.seconds > length + 0.0005 { continue }
        let d = CMSampleBufferGetDuration(sb)
        if d.isValid && d.seconds > 0 { frameDur = d }
        var ok = true
        if op == "matte" {
            if sourceIndex % maskStride == 0 {
                let mask = segment(pb)
                ok = flush(mask) && write(pb, pts, mask)
                lastMask = mask
            } else {
                pending.append((sb, pb, pts))
            }
            sourceIndex += 1
        } else {
            ok = write(pb, pts, nil)
        }
        if !ok { reader.cancelReading(); finish(); return }
    }
}
if let ain, let aout {
    group.enter()
    ain.requestMediaDataWhenReady(on: audioQueue) {
        while ain.isReadyForMoreMediaData {
            guard let sb = aout.copyNextSampleBuffer() else {
                ain.markAsFinished()
                group.leave()
                return
            }
            let pts = CMSampleBufferGetPresentationTimeStamp(sb) - range.start
            let dur = CMSampleBufferGetDuration(sb)
            if pts.seconds + (dur.isValid ? dur.seconds : 0) <= 0 { continue } // entirely before the piece (priming is kept and trimmed by the writer)
            if pts.seconds > length { continue }
            if let s = shifted(sb) { _ = ain.append(s) }
        }
    }
}
group.wait()

if let failure { reader.cancelReading(); writer.cancelWriting(); try? FileManager.default.removeItem(at: tmpURL); fail(failure) }
if reader.status == .failed { writer.cancelWriting(); try? FileManager.default.removeItem(at: tmpURL); fail("decoding failed: \(reader.error?.localizedDescription ?? "")") }
guard frames > 0 else { writer.cancelWriting(); fail("no frames in that piece") }
writer.endSession(atSourceTime: lastPts + frameDur)
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { try? FileManager.default.removeItem(at: tmpURL); fail("writing failed: \(writer.error?.localizedDescription ?? "")") }
try? FileManager.default.removeItem(at: outURL)
do { try FileManager.default.moveItem(at: tmpURL, to: outURL) } catch { fail("can't save \(outURL.path): \(error.localizedDescription)") }

let seconds = (nowMs() - began) / 1000
var avg: [String: Double] = [:]
for (k, v) in stageMs { avg[k] = (v / Double(frames) * 100).rounded() / 100 }
var result: [String: Any] = ["done": true, "out": outURL.path, "width": outW, "height": outH, "frames": frames]
result["seconds"] = (seconds * 100).rounded() / 100
result["fps"] = (Double(frames) / max(0.001, seconds) * 10).rounded() / 10
result["codec"] = codecName
result["engine"] = engine
result["alpha"] = transparent
result["msPerFrame"] = avg
result["quality"] = op == "matte" ? (opts["quality"] ?? "balanced") : ""
emit(result)
