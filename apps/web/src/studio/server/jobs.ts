// Long operations run as jobs: named stages with progress, a timeout per stage, and cancel at any moment.
// The panel polls a job by id; state lives in the server process (kept on globalThis so every route sees it).
import crypto from "node:crypto";
import { pausableTimeout } from "@/ondevice/thermal";
import { brandText, CancelledError, errorKey, explain, StudioError } from "./errors";

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StageState {
	id: string;
	title: string;
	status: StageStatus;
	detail?: string;
	progress?: number;
	startedAt?: number;
	endedAt?: number;
	/** Seconds; the stage fails with a clear message when it runs longer. */
	timeout: number;
	/** What the page may draw besides the text (the lipsync's pieces, each with its state). */
	data?: unknown;
}

export interface JobState {
	id: string;
	kind: string;
	status: "running" | "done" | "failed" | "cancelled";
	stages: StageState[];
	error?: string;
	/** The failure's stable key beside the English text («fal.timeout»), and its numbers: the page says it in its own words. */
	errorKey?: string;
	errorVars?: Record<string, string | number>;
	result?: unknown;
	cost: number;
	startedAt: number;
	endedAt?: number;
}

interface Entry {
	state: JobState;
	controller: AbortController;
}

const store: Map<string, Entry> =
	((globalThis as any).__studioJobs as Map<string, Entry>) ?? ((globalThis as any).__studioJobs = new Map());

export class Job {
	constructor(
		private entry: Entry,
	) {}

	get signal() {
		return this.entry.controller.signal;
	}

	private stage(id: string) {
		const s = this.entry.state.stages.find((x) => x.id === id);
		if (!s) throw new Error(`unknown stage ${id}`);
		return s;
	}

	detail(id: string, text: string) {
		this.stage(id).detail = brandText(text);
	}

	/** Data for the page on a stage (replaced whole each time). */
	data(id: string, value: unknown) {
		this.stage(id).data = value;
	}

	progress(id: string, value: number) {
		this.stage(id).progress = Math.max(0, Math.min(1, value));
	}

	charge(usd: number) {
		this.entry.state.cost += usd;
	}

	skip(id: string, detail?: string) {
		const s = this.stage(id);
		s.status = "skipped";
		if (detail) s.detail = detail;
	}

	/** Runs one stage with its timeout (which also stops the stage's work); failures get a human explanation naming the stage. */
	async step<T>(id: string, op: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const s = this.stage(id);
		s.status = "running";
		s.startedAt = Date.now();
		const stageController = new AbortController();
		const signal = AbortSignal.any([this.signal, stageController.signal]);
		let timer: { clear: () => void } | undefined;
		try {
			const timeout = new Promise<never>((_, reject) => {
				// Counts only the time the Mac was not hot (ondevice/thermal.ts): a paused model never runs out of time.
				timer = pausableTimeout(s.timeout * 1000, () => {
					const minutes = s.timeout >= 60 ? `${Math.round(s.timeout / 60)} min` : `${s.timeout} s`;
					reject(new StudioError(`"${s.title}" didn't finish within ${minutes}. Retry — it usually works the second time.`, { key: "stage.timeout", vars: { stage: s.id, seconds: s.timeout } }));
					stageController.abort();
				});
			});
			const work = op(signal);
			work.catch(() => {}); // after a timeout its rejection is expected and ignored
			const value = await Promise.race([work, timeout]);
			s.status = "done";
			s.progress = undefined;
			return value;
		} catch (error) {
			s.status = "failed";
			if (this.signal.aborted || error instanceof CancelledError) throw new CancelledError();
			throw new StudioError(explain(error, s.title), { plain: error instanceof StudioError && error.plain, ...errorKey(error) });
		} finally {
			timer?.clear();
			s.endedAt = Date.now();
		}
	}
}

export function startJob<T>(
	kind: string,
	stages: Array<{ id: string; title: string; timeout: number }>,
	body: (job: Job) => Promise<T>,
): JobState {
	prune();
	const state: JobState = {
		id: crypto.randomBytes(8).toString("hex"),
		kind,
		status: "running",
		stages: stages.map((s) => ({ ...s, title: brandText(s.title), status: "pending" })),
		cost: 0,
		startedAt: Date.now(),
	};
	const entry: Entry = { state, controller: new AbortController() };
	store.set(state.id, entry);
	const job = new Job(entry);
	body(job)
		.then((result) => {
			state.result = result;
			state.status = "done";
		})
		.catch((error) => {
			if (entry.controller.signal.aborted || error instanceof CancelledError) {
				state.status = "cancelled";
				state.error = "Cancelled";
				state.errorKey = "cancelled";
			} else {
				state.status = "failed";
				state.error = error instanceof StudioError ? error.message : explain(error);
				const k = errorKey(error);
				if (k.key) state.errorKey = k.key;
				if (k.vars) state.errorVars = k.vars;
			}
			for (const s of state.stages) if (s.status === "running") s.status = "failed";
		})
		.finally(() => {
			state.endedAt = Date.now();
		});
	return state;
}

export function getJob(id: string): JobState | null {
	return store.get(id)?.state ?? null;
}

/** The jobs running right now, of every kind (exports to a folder, AI tools, model downloads): the background model download waits for them. */
export function runningJobs(): JobState[] {
	return [...store.values()].map((e) => e.state).filter((s) => s.status === "running");
}

export function cancelJob(id: string): boolean {
	const e = store.get(id);
	if (!e || e.state.status !== "running") return false;
	e.controller.abort(new CancelledError());
	return true;
}

/** Finished jobs are forgotten after an hour. */
function prune() {
	const now = Date.now();
	for (const [id, e] of store) {
		if (e.state.endedAt && now - e.state.endedAt > 3600_000) store.delete(id);
	}
}
