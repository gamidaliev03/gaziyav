// that can be rebuilt lets go of what it holds — timeline frames, tile stills, look tables, previews — so the system
// never has to kill the editor on an 8 GB Mac. Each module registers what it drops; nothing it holds is lost for good,
// it is made again when shown.

type Drop = () => void;
const drops = new Set<Drop>();
let relieved = 0;

/** Registers what to drop when memory is short; returns the unregister. */
export function onMemoryPressure(drop: Drop): () => void {
	drops.add(drop);
	return () => drops.delete(drop);
}

/** Drops every registered cache now (a «warning» or «critical» from macOS, or a test). */
export function relieveMemory(): number {
	let dropped = 0;
	for (const drop of drops) {
		try {
			drop();
			dropped++;
		} catch {
			// one cache that can't let go never stops the others
		}
	}
	relieved++;
	return dropped;
}

type LevelListener = (level: string) => void;
const levelListeners = new Set<LevelListener>();

/** Every level the shell sends («normal», «warning», «critical», «background», «foreground»): platform/memory-budget.ts. */
export function onPressureLevel(listener: LevelListener): () => void {
	levelListeners.add(listener);
	return () => levelListeners.delete(listener);
}

/** One signal from the shell (or a test): the budget hears the level first, then «warning» / «critical» drop everything. */
export function signalMemory(level: string): void {
	for (const listener of levelListeners) {
		try {
			listener(level);
		} catch {
			// a listener that fails never stops the drops
		}
	}
	if (level === "warning" || level === "critical") relieveMemory();
}

if (typeof window !== "undefined") {
	const app = (window as unknown as { studioApp?: { onMemoryPressure?: (cb: (level: string) => void) => () => void } }).studioApp;
	app?.onMemoryPressure?.(signalMemory);
	const w = window as unknown as { __studioMemory?: Record<string, unknown> };
	w.__studioMemory = { ...(w.__studioMemory ?? {}), relieve: relieveMemory, signal: signalMemory, caches: () => drops.size, relieved: () => relieved };
}
