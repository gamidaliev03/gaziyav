// Prints "warning" or "critical" whenever macOS says memory is getting short (and "normal" when it is fine again),
// one line each, and nothing else: Gaziyav's main process listens and the editor drops its caches before the system
// has to kill anything. Event-driven: no polling, no CPU while nothing happens. Ends when its parent closes stdin.
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
let source = DispatchSource.makeMemoryPressureSource(eventMask: [.normal, .warning, .critical], queue: .main)
source.setEventHandler {
	let event = source.data
	if event.contains(.critical) { print("critical") } else if event.contains(.warning) { print("warning") } else { print("normal") }
}
source.resume()
// The parent went away (stdin closed): so does this helper.
FileHandle.standardInput.readabilityHandler = { handle in
	if handle.availableData.isEmpty { exit(0) }
}
dispatchMain()
