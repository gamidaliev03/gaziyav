// The Mac's temperature, for the models (docs/CLOUD-AND-MAC.md): a fanless Air under a generator gets hot; macOS then
// throttles everything, the editor included. The shell watches ProcessInfo.thermalState (Resources/bin/thermal) and
// tells the server here (POST /api/ondevice/thermal); the page learns it the same way it learns about memory (IPC).
// - serious / critical: every running model process stands still (SIGSTOP to its process group) and a model about to
//   start waits (run({ heavy }) → waitCool); the quiet background download waits too (background.ts).
// - back to fair / nominal: SIGCONT, the waiting ones start. Nothing is cancelled, nothing is refused.
// - exports are not touched: the hardware codec barely heats the chip, and the user wants the file.
// Timers (a tool's timeout, a stage's) count only the time the Mac was not hot, so a long pause never ends a job.
// STUDIO_FAKE_THERMAL=serious (tests, the dev server) is the level at start.
import { CancelledError } from "@/studio/server/errors";

export type ThermalLevel = "nominal" | "fair" | "serious" | "critical";
export const THERMAL_LEVELS: readonly ThermalLevel[] = ["nominal", "fair", "serious", "critical"];

export interface ThermalStatus {
	level: ThermalLevel;
	/** When this level began (ms since the epoch). */
	since: number;
	/** serious or critical: the models are paused. */
	hot: boolean;
	/** Model processes standing still right now. */
	paused: number;
}

interface Tracked {
	pid: number;
	/** Signal the whole process group (a detached tool and its children) or the one process. */
	group: boolean;
	stopped: boolean;
}

interface Runtime {
	level: ThermalLevel;
	since: number;
	tracked: Map<number, Tracked>;
	listeners: Set<(level: ThermalLevel, was: ThermalLevel) => void>;
	/** process.kill, or a stand-in in the unit test. */
	kill: (pid: number, signal: NodeJS.Signals) => void;
}

export function parseThermal(value: unknown): ThermalLevel | null {
	const level = typeof value === "string" ? value.trim().toLowerCase() : "";
	return THERMAL_LEVELS.find((l) => l === level) ?? null;
}

export const isHotLevel = (level: ThermalLevel) => level === "serious" || level === "critical";

// One state for the server's lifetime (the dev server reloads this module).
const g = globalThis as typeof globalThis & { __studioThermal?: Runtime };
g.__studioThermal ??= {
	level: parseThermal(process.env.STUDIO_FAKE_THERMAL) ?? "nominal",
	since: Date.now(),
	tracked: new Map(),
	listeners: new Set(),
	kill: (pid, signal) => process.kill(pid, signal),
};
const rt: Runtime = g.__studioThermal;

/** The unit test's stand-in for process.kill (returns the real one back when called with nothing). */
export function configureThermal(options: { kill?: Runtime["kill"] } = {}) {
	rt.kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
}

export const thermalLevel = (): ThermalLevel => rt.level;
/** serious or critical: the models stand still. */
export const isHot = (): boolean => isHotLevel(rt.level);

export function thermalStatus(): ThermalStatus {
	return { level: rt.level, since: rt.since, hot: isHot(), paused: [...rt.tracked.values()].filter((t) => t.stopped).length };
}

function signalTracked(t: Tracked, signal: "SIGSTOP" | "SIGCONT") {
	try {
		rt.kill(t.group ? -t.pid : t.pid, signal);
		t.stopped = signal === "SIGSTOP";
	} catch {
		// Gone already: it leaves the list when its caller untracks it.
	}
}

/** The shell's report (and the tests'): a new level pauses or continues every tracked model process. */
export function setThermalLevel(level: ThermalLevel): ThermalStatus {
	const was = rt.level;
	if (level !== was) {
		rt.level = level;
		rt.since = Date.now();
		const hot = isHotLevel(level);
		if (hot !== isHotLevel(was)) {
			for (const t of rt.tracked.values()) if (hot ? !t.stopped : t.stopped) signalTracked(t, hot ? "SIGSTOP" : "SIGCONT");
			console.log(`[thermal] ${level}: ${hot ? `${rt.tracked.size} model process(es) paused until the Mac cools down` : "the models continue"}`);
		}
		for (const listener of [...rt.listeners]) {
			try {
				listener(level, was);
			} catch {}
		}
	}
	return thermalStatus();
}

/** Told of every change of level (the queue, the timers). */
export function onThermal(listener: (level: ThermalLevel, was: ThermalLevel) => void): () => void {
	rt.listeners.add(listener);
	return () => {
		rt.listeners.delete(listener);
	};
}

/**
 * A model process to pause while the Mac is hot (paused at once when it already is). `group`: the process leads its
 * own group (spawned detached) and the signal goes to all of it. Returns the untrack, for when the process is done.
 */
export function trackProcess(pid: number, { group = true }: { group?: boolean } = {}): () => void {
	const t: Tracked = { pid, group, stopped: false };
	rt.tracked.set(pid, t);
	if (isHot()) signalTracked(t, "SIGSTOP");
	return () => {
		rt.tracked.delete(pid);
	};
}

/** Resolves when the Mac is not hot (at once when it isn't); the caller's cancel ends the wait. */
export function waitCool(signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(new CancelledError());
	if (!isHot()) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const off = onThermal((level) => {
			if (isHotLevel(level)) return;
			off();
			signal?.removeEventListener("abort", onAbort);
			resolve();
		});
		const onAbort = () => {
			off();
			reject(new CancelledError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * setTimeout that counts only the time the Mac is not hot: a paused model mustn't run into its time limit. `clear`
 * cancels it; `elapsed()` is the counted time (ms).
 */
export function pausableTimeout(ms: number, fn: () => void): { clear: () => void; elapsed: () => number } {
	let left = ms;
	let startedAt = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let counted = 0;
	let done = false;
	const stop = () => {
		if (!timer) return;
		clearTimeout(timer);
		timer = null;
		const ran = Date.now() - startedAt;
		counted += ran;
		left = Math.max(0, left - ran);
	};
	const go = () => {
		if (done || timer) return;
		startedAt = Date.now();
		timer = setTimeout(() => {
			timer = null;
			counted += Date.now() - startedAt;
			done = true;
			off();
			fn();
		}, left);
	};
	const off = onThermal((level) => {
		if (isHotLevel(level)) stop();
		else go();
	});
	if (!isHot()) go();
	return {
		clear: () => {
			done = true;
			stop();
			off();
		},
		elapsed: () => counted + (timer ? Date.now() - startedAt : 0),
	};
}
