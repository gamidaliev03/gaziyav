// voiceisolate <in.wav> <out.wav> [mix 0...100]
// Offline voice isolation with Apple's on-device AUSoundIsolation (the effect behind
// "Voice Isolation"): removes background noise, music and room from speech. No network.
// Exit codes: 0 ok, 2 bad arguments / unreadable input, 3 the audio unit is missing
// (macOS < 13), 4 render failure.
import AVFoundation
import AudioToolbox
import Foundation

func fail(_ code: Int32, _ message: String) -> Never {
	FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
	exit(code)
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail(2, "usage: voiceisolate <in.wav> <out.wav> [mix 0-100]") }
let mix = args.count >= 4 ? Float(args[3]) ?? 100 : 100

let input: AVAudioFile
do { input = try AVAudioFile(forReading: URL(fileURLWithPath: args[1])) } catch { fail(2, "cannot read input: \(error)") }
let format = input.processingFormat

let description = AudioComponentDescription(
	componentType: kAudioUnitType_Effect,
	componentSubType: 0x766F6973, // 'vois'
	componentManufacturer: kAudioUnitManufacturer_Apple,
	componentFlags: 0,
	componentFlagsMask: 0
)
guard AudioComponentFindNext(nil, [description]) != nil else { fail(3, "AUSoundIsolation is not available on this Mac") }

let engine = AVAudioEngine()
let player = AVAudioPlayerNode()
let isolation = AVAudioUnitEffect(audioComponentDescription: description)
engine.attach(player)
engine.attach(isolation)
engine.connect(player, to: isolation, format: format)
engine.connect(isolation, to: engine.mainMixerNode, format: format)

// Wet/dry: the unit exposes it as its first global parameter ("Mix", percent).
if let tree = isolation.auAudioUnit.parameterTree {
	for p in tree.allParameters where p.identifier.lowercased().contains("mix") || p.displayName.lowercased().contains("mix") {
		p.value = max(p.minValue, min(p.maxValue, mix))
	}
}

do {
	try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
	try engine.start()
} catch { fail(4, "cannot start the audio engine: \(error)") }

player.scheduleFile(input, at: nil)
player.play()

// Optional so it can be released before exit: AVAudioFile writes the final RIFF/data sizes
// when it is closed (top-level globals are never deinitialised).
var output: AVAudioFile?
do {
	output = try AVAudioFile(
		forWriting: URL(fileURLWithPath: args[2]),
		settings: [
			AVFormatIDKey: kAudioFormatLinearPCM,
			AVSampleRateKey: format.sampleRate,
			AVNumberOfChannelsKey: format.channelCount,
			AVLinearPCMBitDepthKey: 16,
			AVLinearPCMIsFloatKey: false,
			AVLinearPCMIsBigEndianKey: false,
		],
		commonFormat: .pcmFormatFloat32,
		interleaved: false
	)
} catch { fail(2, "cannot write output: \(error)") }

guard let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: engine.manualRenderingMaximumFrameCount) else {
	fail(4, "cannot allocate a buffer")
}
// Latency compensation: drop the unit's reported latency (or an explicit override in
// frames, argv[4], measured once with a click track) from the start and write exactly
// input.length frames, so the processed clip lines up sample-for-sample with the source.
let reported = AVAudioFramePosition((isolation.auAudioUnit.latency * format.sampleRate).rounded())
let latency = args.count >= 5 ? AVAudioFramePosition(args[4]) ?? reported : reported
FileHandle.standardError.write("latency \(latency) frames\n".data(using: .utf8)!)
let total = input.length + latency
var skip = latency
var written: AVAudioFramePosition = 0
while engine.manualRenderingSampleTime < total {
	let frames = min(AVAudioFrameCount(total - engine.manualRenderingSampleTime), buffer.frameCapacity)
	do {
		let status = try engine.renderOffline(frames, to: buffer)
		if status == .error { fail(4, "render error") }
		if status != .success { continue }
		var start = AVAudioFramePosition(0)
		if skip > 0 {
			start = min(skip, AVAudioFramePosition(buffer.frameLength))
			skip -= start
		}
		let keep = min(AVAudioFramePosition(buffer.frameLength) - start, input.length - written)
		if keep <= 0 { continue }
		if start > 0 || keep < AVAudioFramePosition(buffer.frameLength) {
			guard let part = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: AVAudioFrameCount(keep)) else { fail(4, "alloc") }
			part.frameLength = AVAudioFrameCount(keep)
			for ch in 0..<Int(buffer.format.channelCount) {
				memcpy(part.floatChannelData![ch], buffer.floatChannelData![ch] + Int(start), Int(keep) * MemoryLayout<Float>.size)
			}
			try output!.write(from: part)
		} else {
			try output!.write(from: buffer)
		}
		written += keep
	} catch { fail(4, "render failed: \(error)") }
}
engine.stop()
output = nil
