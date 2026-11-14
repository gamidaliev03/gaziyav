// Prints the Mac's thermal state ("nominal", "fair", "serious" or "critical") once at start and again whenever macOS
// changes it, one line each, and nothing else: Gaziyav's main process listens and pauses the models while the Mac is
// hot (serious, critical), continuing them when it cools. Event-driven: no polling, no CPU while nothing happens. Ends
// when its parent closes stdin.
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
func name(_ state: ProcessInfo.ThermalState) -> String {
	switch state {
	case .nominal: return "nominal"
	case .fair: return "fair"
	case .serious: return "serious"
	case .critical: return "critical"
	@unknown default: return "nominal"
	}
}
print(name(ProcessInfo.processInfo.thermalState))
NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { _ in
	print(name(ProcessInfo.processInfo.thermalState))
}
// The parent went away (stdin closed): so does this helper.
FileHandle.standardInput.readabilityHandler = { handle in
	if handle.availableData.isEmpty { exit(0) }
}
dispatchMain()
