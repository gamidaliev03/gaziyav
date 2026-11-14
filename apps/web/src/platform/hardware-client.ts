// The page's view of platform/hardware.ts: asked once from /api/hardware when the editor starts. Until the answer is in
// (a few ms) and when the server can't be asked (a test page, a plain browser), the tier is "standard": what the
// editor always did.
import type { Hardware, HardwareTier } from "./hardware";

let known: Hardware | null = null;
let asking: Promise<Hardware | null> | null = null;
const listeners = new Set<() => void>();

/** Asks the server once; later calls get the same answer. */
export function loadHardware(): Promise<Hardware | null> {
	if (!asking) {
		asking =
			typeof fetch === "undefined"
				? Promise.resolve(null)
				: fetch("/api/hardware")
						.then((res) => (res.ok ? (res.json() as Promise<Hardware>) : null))
						.catch(() => null)
						.then((info) => {
							rememberHardware(info);
							return info;
						});
	}
	return asking;
}

/** What the server said (and, in unit tests, a machine to try). */
export function rememberHardware(info: Hardware | null): void {
	known = info;
	for (const listener of listeners) listener();
}

/** What is known of this machine (null until /api/hardware answered). */
export function hardwareInfo(): Hardware | null {
	return known;
}

/** This machine's tier: "standard" until known. */
export function hardwareTier(): HardwareTier {
	return known?.tier ?? "standard";
}

/** The value for this machine's tier ("standard" until known): caches, decoders and defaults sized per tier. */
export function byTier<T>(values: Record<HardwareTier, T>): T {
	return values[hardwareTier()];
}

/** Told once the answer is in (for sizes set before it came). */
export function onHardware(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
