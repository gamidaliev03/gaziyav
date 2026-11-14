// One tap of the Force Touch trackpad per line on stdin ("alignment", "level" or "generic", optionally followed by a
// word saying why), the way Final Cut and Keynote tap when something snaps. Gaziyav's main process keeps it running and
// writes a line per event. Blocking read: no CPU while nothing happens. Ends on stdin EOF, so it dies with the app (a
// quit, a crash or kill -9 all close the pipe).
//
// The public call NSHapticFeedbackManager.defaultPerformer.perform → CGSActuateDeviceWithPattern(main connection,
// device 0, pattern 15) → the window server sets the actuation on the trackpad being touched. The server checks only that
// the caller has a window-server connection, not that it is the frontmost app, so a helper started by the app works.
// The connection is opened at start (NSEvent.mouseLocation, ~70 ms) so the first tap is not late.
// The Mac's own setting (System Settings → Trackpad → Force Click and haptic feedback) is honoured: no tap when off.
// HAPTIC_LOG=<file> (Gaziyav's test mode only): each line read is written there with the time it was performed.
import AppKit

setvbuf(stdout, nil, _IOLBF, 0)
let started = Date()
_ = NSEvent.mouseLocation
let performer = NSHapticFeedbackManager.defaultPerformer

var log: FileHandle?
if let path = ProcessInfo.processInfo.environment["HAPTIC_LOG"], !path.isEmpty {
	if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
	log = FileHandle(forWritingAtPath: path)
	log?.seekToEndOfFile()
}

// The trackpad's own switch, read again at most every 2 s (a change in System Settings applies at once enough).
var allowed = true
var checkedAt = Date.distantPast
func systemAllows() -> Bool {
	if Date().timeIntervalSince(checkedAt) < 2 { return allowed }
	checkedAt = Date()
	let prefs = UserDefaults(suiteName: "com.apple.AppleMultitouchTrackpad")
	let detents = prefs?.object(forKey: "ActuateDetents") as? Int
	let suppressed = prefs?.object(forKey: "ForceSuppressed") as? Int
	allowed = detents != 0 && suppressed != 1
	return allowed
}
_ = systemAllows()
print("ready \(Int(Date().timeIntervalSince(started) * 1000))")

while let line = readLine() {
	let words = line.split(separator: " ")
	guard let first = words.first else { continue }
	let pattern: NSHapticFeedbackManager.FeedbackPattern
	switch first {
	case "alignment": pattern = .alignment
	case "level": pattern = .levelChange
	case "generic": pattern = .generic
	default: continue
	}
	let on = systemAllows()
	if on { performer.perform(pattern, performanceTime: .now) }
	if let log {
		let stamp = String(format: "%.1f", Date().timeIntervalSince1970 * 1000)
		log.write("\(stamp) \(line)\(on ? "" : " system-off")\n".data(using: .utf8)!)
	}
}
exit(0)
