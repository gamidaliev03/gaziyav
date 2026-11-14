// Warm models: the voice generator stays loaded between jobs, so the next voice-over starts at once instead of
// reading gigabytes of weights again (a dub of several clips, another take).
// The helper runs with --serve: "READY" once its model is loaded, then one JSON job per stdin line, each answered by
// "DONE 0" or "DONE 1"; its STATUS / PROGRESS / ERROR lines reach the job exactly as in a one-off run.
// Memory comes first: on a Mac under 32 GB only one model stays warm, any other heavy job sends it away (ml-queue), and
// an idle one leaves after a few minutes. A cancelled job ends its worker (the next job loads the model again).
import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import { CancelledError, StudioError } from "./errors";
import { hardware } from "@/platform/hardware";
import { pausableTimeout, trackProcess } from "@/ondevice/thermal";
import type { RunResult } from "./tools";

interface Worker {
	key: string;
	child: ChildProcess;
	ready: boolean;
	busy: boolean;
	timer?: NodeJS.Timeout;
	/** The running job's line handler and completion. */
	job?: { onLine: (line: string) => void; done: (status: number) => void };
	stderr: string;
	pending?: string;
	/** Stops the thermal watch of its process (ondevice/thermal.ts) when it leaves. */
	untrack?: () => void;
}

const workers: Map<string, Worker> = ((globalThis as any).__studioWarm as Map<string, Worker>) ?? ((globalThis as any).__studioWarm = new Map());

/**
 * Warm workers need a helper with --serve: the Mac helpers have it (Windows runs every job on its own). An 8 GB Mac
 * (tier base) keeps none: each voice-over or song loads its model and gives the memory back when it is done.
 */
export const warmSupported = () => os.platform() === "darwin" && hardware().tier !== "base";

/** Enough memory to keep several models warm next to the editor (32 GB and more). */
const roomy = () => hardware().tier === "pro";

function stop(w: Worker) {
	if (w.timer) clearTimeout(w.timer);
	w.untrack?.();
	workers.delete(w.key);
	try {
		if (w.child.pid) process.kill(-w.child.pid, "SIGKILL");
	} catch {
		w.child.kill("SIGKILL");
	}
}

/** Sends idle warm models away before another heavy job (all of them on a Mac under 32 GB), except `keep`. */
export function evictWarm(keep?: string) {
	if (roomy()) return;
	for (const w of [...workers.values()]) if (w.key !== keep && !w.busy) stop(w);
}

if (!(globalThis as any).__studioWarmExitHook) {
	(globalThis as any).__studioWarmExitHook = true;
	process.on("exit", () => {
		for (const w of [...workers.values()]) stop(w);
	});
}

function start(key: string, bin: string, argv: string[]): Worker {
	const child = spawn(bin, argv, { stdio: ["pipe", "pipe", "pipe"], detached: true, windowsHide: true });
	const w: Worker = { key, child, ready: false, busy: false, stderr: "" };
	workers.set(key, w);
	// Low priority, like the one-off runs (nice 10): editing stays smooth.
	try {
		if (child.pid) os.setPriority(child.pid, 10);
	} catch {}
	// It stands still while the Mac is hot, busy or not (ondevice/thermal.ts).
	if (child.pid) w.untrack = trackProcess(child.pid);
	let partial = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		partial += chunk.toString();
		const lines = partial.split(/\r?\n/);
		partial = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			if (line === "READY") {
				w.ready = true;
				if (w.pending !== undefined) {
					child.stdin?.write(w.pending);
					w.pending = undefined;
				}
			} else if (line.startsWith("DONE ")) {
				const job = w.job;
				w.job = undefined;
				job?.done(Number(line.slice(5)) || 0);
			} else w.job?.onLine(line);
		}
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		w.stderr = (w.stderr + chunk.toString()).slice(-20_000);
	});
	const gone = (code: number | null) => {
		if (workers.get(key) === w) workers.delete(key);
		if (w.timer) clearTimeout(w.timer);
		w.untrack?.();
		const job = w.job;
		w.job = undefined;
		job?.done(code || 1);
	};
	child.on("exit", gone);
	child.on("error", () => gone(1));
	child.stdin?.on("error", () => {});
	return w;
}

/**
 * Loads `key`'s model ahead of its first job (the user is writing what it will say), unless it is loaded already. It
 * leaves after `idleSeconds` without a job, like after one. The caller checks that nothing heavy is at work.
 */
export function prewarm({ key, bin, argv, idleSeconds }: { key: string; bin: string; argv: string[]; idleSeconds: number }): boolean {
	if (!warmSupported() || workers.has(key)) return false;
	evictWarm(key);
	const w = start(key, bin, [...argv, "--serve"]);
	w.timer = setTimeout(() => stop(w), idleSeconds * (roomy() ? 3 : 1) * 1000);
	return true;
}

/**
 * Runs one job on the warm worker `key` (started with `bin argv --serve` when there is none), as `run()` would run the
 * one-off command: same lines, same result shape. `idleSeconds` keeps the model loaded after the job.
 */
export function runWarm({
	key,
	bin,
	argv,
	request,
	idleSeconds,
	timeout,
	signal,
	onLine,
}: {
	key: string;
	bin: string;
	/** The helper's arguments for --serve (the model's location). */
	argv: string[];
	request: Record<string, unknown>;
	/** How long the model stays loaded after the job (×3 on a Mac with 32 GB or more). */
	idleSeconds: number;
	timeout: number;
	signal?: AbortSignal;
	onLine: (line: string) => void;
}): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new CancelledError());
		evictWarm(key);
		let w = workers.get(key);
		if (w?.busy) return reject(new StudioError("The model is busy with another job. Try again in a moment."));
		if (!w) w = start(key, bin, [...argv, "--serve"]);
		const worker = w;
		if (worker.timer) clearTimeout(worker.timer);
		worker.busy = true;
		worker.stderr = "";
		let finished = false;
		const finish = () => {
			finished = true;
			timer.clear();
			signal?.removeEventListener("abort", onAbort);
			worker.busy = false;
		};
		// Counts only the time the Mac was not hot (the worker stands still meanwhile).
		const timer = pausableTimeout(timeout * 1000, () => {
			if (finished) return;
			finish();
			stop(worker);
			reject(new StudioError(`The model didn't finish within ${Math.round(timeout)} s`));
		});
		const onAbort = () => {
			if (finished) return;
			finish();
			stop(worker);
			reject(new CancelledError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		worker.job = {
			onLine,
			done: (status) => {
				if (finished) return;
				finish();
				// A Mac with 32 GB or more keeps it three times longer.
				if (workers.get(key) === worker) worker.timer = setTimeout(() => stop(worker), idleSeconds * (roomy() ? 3 : 1) * 1000);
				resolve({ status, stdout: "", stderr: worker.stderr });
			},
		};
		const line = `${JSON.stringify(request)}\n`;
		if (worker.ready) worker.child.stdin?.write(line);
		else worker.pending = line;
	});
}
