// One job center for every background task: lipsync, voice-over, AI montage, YouTube download,
// speech recognition, export. Producers report here; the header chip, the tab dots, the Dock
// progress bar and macOS notifications read from here.
//
// Producers:
//   const id = jobCenter.start({ kind: "montage", title: "AI composition", tab: "media", cancel });
//   jobCenter.update(id, { stage: "Writing the plan", progress: 0.4 });
//   jobCenter.finish(id, "Added 12 elements")   |   jobCenter.fail(id, "Clear reason and fix")
// Mirrors of an existing state (one id per task) use jobCenter.upsert(id, {...}) / jobCenter.remove(id).
import { create } from "zustand";
import type { Tab } from "@/components/editor/panels/assets/assets-panel-store";

export type JobKind =
	| "lipsync"
	| "voice"
	| "montage"
	| "youtube"
	| "transcribe"
	| "export"
	| "other";

export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface Job {
	id: string;
	kind: JobKind;
	/** Short name: "Lipsync", "Voice-over", "Export". */
	title: string;
	/** What is happening right now: "Uploading video", "Synthesizing speech". */
	stage?: string;
	/** 0..1 when known. */
	progress?: number;
	status: JobStatus;
	/** Result line when done, a clear reason when failed. */
	message?: string;
	/** Second, quieter line under a done message (e.g. "in ~/Movies"). */
	messageDetail?: string;
	/** Tooltip for the message lines (e.g. the full file path). */
	messageTitle?: string;
	startedAt: number;
	endedAt?: number;
	/** Left panel tab where this task lives (gets a status dot). */
	tab?: Tab;
	/** Stops the task; shown as "Cancel" while running. */
	cancel?: () => void;
	/** Shows the result (seek/select/open a panel, Finder). */
	reveal?: () => void;
	/** Button text for reveal; default "Show". */
	revealLabel?: string;
	/** Runs the task again after an error; shown as "Retry". */
	retry?: () => void;
	/** The user has looked at the finished state; the chip and dots stop calling for attention. */
	seen?: boolean;
	/**
	 * The time left as the task itself measured it (seconds left at the time `at`): what is shown instead of a guess
	 * from the bar. `atLeast`: a later step's speed is not known yet — «at least this long». null: nothing measured yet.
	 */
	eta?: { seconds: number; at: number; atLeast?: boolean } | null;
	/** Where the result lands: a placeholder there shows this job's progress (Media tile, timeline clips). */
	place?: JobPlace;
	/** Waiting its turn (fal's queue): nothing moves yet, its placeholder breathes. */
	queued?: boolean;
	/**
	 * Durable: what continues or repeats it (its kind's resumer, src/jobs/durable.ts). A job with it is kept on disk by the
	 * shell while it runs and after it fails: a kill loses none.
	 */
	resume?: { type: string } & Record<string, unknown>;
	/** The share of the bar earlier stages already filled (the bar never goes back; jobs/store.ts nextProgress). */
	progressBase?: number;
}

/** One frame of a sprite sheet (YouTube's storyboard): `cols` × `rows` frames of `width` × `height`. */
export interface SpriteFrame {
	sheet: string;
	col: number;
	row: number;
	cols: number;
	rows: number;
	width: number;
	height: number;
}

/** A Media item that does not exist yet: it shows at once, fills with colour as the job goes, lands under `assetId`. */
export interface PendingMedia {
	assetId: string;
	/** The project it lands in (none: the open one). */
	projectId?: string;
	name: string;
	type: "video" | "image" | "audio";
	origin?: "source" | "result";
	/** What it looks like before it exists: a picture URL or one storyboard frame. */
	still?: string | SpriteFrame;
	duration?: number;
}

export interface JobPlace {
	media?: PendingMedia;
	/** Timeline elements the job reads or changes (captions, beats, clean-up): the progress shows on the clips. */
	elements?: string[];
}

export type JobInput = Omit<Job, "id" | "status" | "startedAt"> & {
	id?: string;
	status?: JobStatus;
	startedAt?: number;
};

interface JobsState {
	jobs: Job[];
}

/** How many finished jobs stay in the list. */
const KEEP_FINISHED = 8;

export const useJobsStore = create<JobsState>()(() => ({ jobs: [] }));

let counter = 0;

function setJobs(update: (jobs: Job[]) => Job[]) {
	useJobsStore.setState((s) => ({ jobs: trim(update(s.jobs)) }));
}

function trim(jobs: Job[]): Job[] {
	let finished = 0;
	return jobs.filter((j) => j.status === "running" || ++finished <= KEEP_FINISHED);
}

function patchJob(id: string, patch: Partial<Job>) {
	setJobs((jobs) => jobs.map((j) => (j.id === id ? { ...j, ...nextProgress(j, patch) } : j)));
}

/**
 * The bar never goes back while a job runs. A producer that starts a new stage from 0 (its own stage's figure) carries
 * on from where the bar is: the rest of the bar is that stage's. A dip within a stage (noise) holds the bar; an unknown
 * figure after a known one keeps the known one.
 */
export function nextProgress(job: Job, patch: Partial<Job>): Partial<Job> {
	if (!("progress" in patch) || job.status !== "running" || (patch.status && patch.status !== "running")) return patch;
	const shown = job.progress;
	const value = patch.progress;
	if (value == null) {
		if (shown == null) return patch;
		const { progress: _, ...rest } = patch;
		return rest;
	}
	const v = Math.max(0, Math.min(1, value));
	if (shown == null) return { ...patch, progress: v };
	const base = job.progressBase ?? 0;
	const mapped = base + (1 - base) * v;
	if (mapped >= shown) return { ...patch, progress: mapped };
	const newStage = patch.stage !== undefined && patch.stage !== job.stage;
	if (newStage && shown < 1) return { ...patch, progressBase: shown, progress: shown + (1 - shown) * v };
	return { ...patch, progress: shown };
}

export const jobCenter = {
	start(input: JobInput): string {
		const id = input.id ?? `job-${Date.now().toString(36)}-${++counter}`;
		const job: Job = { status: "running", startedAt: Date.now(), ...input, id };
		setJobs((jobs) => [job, ...jobs.filter((j) => j.id !== id)]);
		return id;
	},
	/** Creates the job if needed, otherwise merges the patch (keeps its place in the list). */
	upsert(id: string, input: JobInput) {
		const existing = useJobsStore.getState().jobs.find((j) => j.id === id);
		if (!existing) {
			jobCenter.start({ ...input, id });
			return;
		}
		const finishedNow = existing.status === "running" && input.status && input.status !== "running";
		patchJob(id, {
			...input,
			id,
			...(finishedNow ? { endedAt: input.endedAt ?? Date.now(), seen: false } : {}),
		});
	},
	update(id: string, patch: Partial<Omit<Job, "id">>) {
		patchJob(id, patch);
	},
	finish(id: string, message?: string) {
		patchJob(id, { status: "done", message, endedAt: Date.now(), progress: 1, cancel: undefined, seen: false });
	},
	fail(id: string, error: string) {
		patchJob(id, { status: "error", message: error, endedAt: Date.now(), cancel: undefined, seen: false });
	},
	/** The user stopped it: nothing to report, drop it from the list. */
	cancelled(id: string) {
		jobCenter.remove(id);
	},
	remove(id: string) {
		setJobs((jobs) => jobs.filter((j) => j.id !== id));
	},
	clearFinished() {
		setJobs((jobs) => jobs.filter((j) => j.status === "running"));
	},
	markSeen(filter: (job: Job) => boolean = () => true) {
		const { jobs } = useJobsStore.getState();
		if (!jobs.some((j) => j.status !== "running" && !j.seen && filter(j))) return;
		setJobs((list) => list.map((j) => (j.status !== "running" && !j.seen && filter(j) ? { ...j, seen: true } : j)));
	},
};

export type JobSignal = "running" | "done" | "error" | null;

/** What a tab dot shows: running wins, then an unseen error, then an unseen result. */
export function signalFor(jobs: Job[], tab?: Tab): JobSignal {
	const own = tab ? jobs.filter((j) => j.tab === tab) : jobs;
	if (own.some((j) => j.status === "running")) return "running";
	if (own.some((j) => j.status === "error" && !j.seen)) return "error";
	if (own.some((j) => j.status === "done" && !j.seen)) return "done";
	return null;
}

/**
 * Seconds left: the task's own measure when it gives one (it counts down between its reports), else estimated from
 * the progress; null while there is nothing to go by yet.
 */
export function etaSeconds(job: Job, now = Date.now()): number | null {
	if (job.status !== "running") return null;
	if (job.eta !== undefined) return job.eta === null ? null : Math.max(0, Math.round(job.eta.seconds - (now - job.eta.at) / 1000));
	if (job.progress == null || job.progress < 0.05 || job.progress >= 1) return null;
	const elapsed = (now - job.startedAt) / 1000;
	if (elapsed < 3) return null;
	return Math.max(1, Math.round((elapsed / job.progress) * (1 - job.progress)));
}

/** "0:42", "12:05", "1:02:03". */
export function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// --- Native side: Dock progress bar and a notification when a task ends while the app is in the background.
interface StudioApp {
	setProgress?: (value: number | null) => void;
	notify?: (title: string, body: string) => void;
}

function nativeApp(): StudioApp | undefined {
	if (typeof window === "undefined") return undefined;
	return (window as unknown as { studioApp?: StudioApp }).studioApp;
}

/** What the Dock bar was last told, and the series (page-readable: tests measure the Dock through it). */
export const dockEcho: { last: number | null; history: Array<number | null> } = { last: null, history: [] };

/** The aggregate of the running jobs: the mean of the measured ones (0..1), -1 when none is measured, null when idle. */
export function aggregateProgress(jobs: readonly Job[]): number | null {
	const running = jobs.filter((j) => j.status === "running");
	if (running.length === 0) return null;
	const measured = running.filter((j) => j.progress != null);
	return measured.length ? Math.round((measured.reduce((a, j) => a + (j.progress ?? 0), 0) / measured.length) * 100) / 100 : -1;
}

if (typeof window !== "undefined") {
	let lastDock: number | null = null;
	useJobsStore.subscribe((state, prev) => {
		const app = nativeApp();
		const dock = aggregateProgress(state.jobs);
		if (dock !== lastDock) {
			lastDock = dock;
			dockEcho.last = dock;
			dockEcho.history.push(dock);
			if (dockEcho.history.length > 600) dockEcho.history.splice(0, 100);
			// -1 → indeterminate bar (Electron draws it for values > 1); null hides it.
			app?.setProgress?.(dock === -1 ? 2 : dock);
		}
		// CRAFT.md §10: only an export that ends while the app is not in front posts a notification — one, with the file's
		// name (flagged for the lead's review). Every other job tells it on its own object.
		for (const job of state.jobs) {
			if (job.kind !== "export") continue;
			if (job.status !== "done" && job.status !== "error") continue;
			const before = prev.jobs.find((j) => j.id === job.id);
			if (before && before.status !== "running") continue;
			if (!before && job.status !== "error") continue;
			const background = document.hidden || !document.hasFocus();
			if (!background) continue;
			const title = job.status === "done" ? `${job.title} finished` : `${job.title} failed`;
			app?.notify?.(title, job.message ?? "");
		}
	});
	(window as unknown as { __studioJobs: unknown }).__studioJobs = { store: useJobsStore, jobCenter, dock: dockEcho };
}
