// On-device AI in the window: status of the downloadable models, install / cancel / remove. Any feature that needs a
// model calls `await requireModel(id, { onProgress, signal })`: when it is already here this returns at once;
// otherwise its download starts right away — no question — inside the feature's own progress, and the feature's
// Cancel stops it. The one question left: not enough free disk space for it.
import { create } from "zustand";
import { openSettings } from "@/settings/settings-store";
import type { JobState } from "@/studio/server/jobs";

export type ModelId = "whisper" | "lipsync" | "voice" | "faceswap" | "cleanup" | "denoise" | "separate" | "voicechange" | "retouch" | "hear";

export interface ModelStatus {
	id: ModelId;
	title: string;
	purpose: string;
	downloadBytes: number;
	diskBytes: number;
	/** Room the install needs on the disk now (download + runtime + the unpacking), as the server will count it. */
	installBytes: number;
	installed: boolean;
	verified: boolean;
	unsupported?: string;
	note?: string;
	/** Carried by the app (the «with models» build): installs without the internet. */
	bundled?: boolean;
	/** Runs on another feature's download (Retouch on Face swap's files). */
	sharedWith?: string;
	job?: JobState;
	/** Its job is the quiet background download (Settings shows one quiet line for it). */
	background?: boolean;
	/** small: ≤ 1 GB, comes by itself in the background; large: downloads on first use (or in the background when Settings says so). */
	size?: "small" | "large";
	/** The memory the model wants (bytes), shown beside its size in Settings; 16 GB marks the heavy ones a smaller Mac is not offered. */
	minMemory?: number;
}

/** The quiet background download (ondevice/background.ts). */
export interface BackgroundStatus {
	state: "off" | "waiting-project" | "scheduled" | "downloading" | "paused" | "done";
	model?: ModelId;
	title?: string;
	progress?: number;
	reason?: string;
	large: boolean;
	left: ModelId[];
	/** What «Download large models in the background» would bring (bytes). */
	largeBytes?: number;
}

export interface OndeviceState {
	models: ModelStatus[];
	library: { folder: string };
	/** The volume the models go to: free and total bytes. */
	disk?: { free: number; total: number };
	background?: BackgroundStatus;
}

const BASE = "/api/ondevice";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${BASE}/${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), "X-Studio": "1" } });
	} catch {
		throw new Error("The app's local server is not responding. Restart the app.");
	}
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
	return data as T;
}

export const ondeviceApi = {
	status: () => request<OndeviceState>("status"),
	install: (id: ModelId) => request<JobState>(`install/${id}`, { method: "POST" }),
	repair: (id: ModelId) => request<JobState>(`repair/${id}`, { method: "POST" }),
	cancel: (id: ModelId) => request<{ cancelled: boolean }>(`cancel/${id}`, { method: "POST" }),
	remove: (id: ModelId) => request<{ removed: boolean }>(`remove/${id}`, { method: "POST" }),
	background: (body: { project?: true; busy?: string[]; large?: boolean }) =>
		request<BackgroundStatus>("background", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
	setLibrary: (folder: string) =>
		request<{ folder: string }>("library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder }) }),
};

interface Store {
	state: OndeviceState | null;
	error: string | null;
	/** The one question a feature can ask: which model has no room on the disk. */
	prompt: ModelId | null;
	refresh: () => Promise<OndeviceState | null>;
}

export const useOndeviceStore = create<Store>((set) => ({
	state: null,
	error: null,
	prompt: null,
	refresh: async () => {
		try {
			const state = await ondeviceApi.status();
			set({ state, error: null });
			return state;
		} catch (error) {
			set({ error: (error as Error).message });
			return null;
		}
	},
}));

/** Opens Settings → AI → AI on this Mac (the one place the models are managed; Settings is mounted for the whole app). */
export function openOndevice() {
	openSettings("ondevice");
}

const waiters = new Map<ModelId, Array<{ resolve: () => void; reject: (e: Error) => void }>>();

/** Called by the prompt when the model is installed or the user gave up. */
export function settlePrompt(id: ModelId, ok: boolean, why?: string) {
	const list = waiters.get(id) ?? [];
	waiters.delete(id);
	for (const w of list) {
		if (ok) w.resolve();
		else w.reject(Object.assign(new Error(why || "Cancelled"), { name: why ? "Error" : "AbortError" }));
	}
	if (useOndeviceStore.getState().prompt === id) useOndeviceStore.setState({ prompt: null });
}

/** How a feature waits for its model: the download's progress in its own progress line; its Cancel stops it. */
export interface ModelWait {
	onProgress?: (fraction: number, label: string) => void;
	signal?: AbortSignal;
}

/** A download job's overall progress (its stages: files, then the Python packages). */
export function jobProgress(job: JobState | undefined): number {
	if (!job) return 0;
	const stage = job.stages.find((st) => st.status === "running");
	const done = job.stages.filter((st) => st.status === "done" || st.status === "skipped").length;
	return Math.min(1, (done + (stage?.progress ?? 0)) / Math.max(1, job.stages.length));
}

/** A job's error as one calm sentence: the stage's name the server puts first («Downloading the model (0.6 GB): …») goes. */
export function calmError(text: string | undefined): string {
	const s = (text ?? "").trim();
	const tail = /^[^:]{3,80}: (.+)$/.exec(s)?.[1];
	return tail && /[.!?]$/.test(tail) ? tail : s || "The download failed";
}

/** What the asker and the activity list show while the model comes: bytes when the files are all it does. */
function waitLabel(model: ModelStatus, job: JobState | undefined, f: number): string {
	const files = job?.stages.length === 1 ? job.stages[0] : undefined;
	if (files && model.downloadBytes > 0) return `Downloading the model · ${f * model.downloadBytes < 1e6 ? "0 MB" : formatBytes(f * model.downloadBytes)} / ${formatBytes(model.downloadBytes)}`;
	return `Downloading the model · ${formatBytes(model.downloadBytes)} · ${Math.round(f * 100)} %`;
}

/** The model's job in the one job list (and on disk: a kill brings it back failed with ↻; jobs/point-source.ts resumes it). */
export const modelJobId = (id: ModelId) => `model-${id}`;

/**
 * Resolves when the model is on this Mac. When it isn't, its download starts at once — no question — and shows in the
 * feature's own progress («Downloading the model · 120 MB / 574 MB») and as a Job in the activity list (Cancel there,
 * ↻ after a failure, durable). Started in Settings or by a feature, it is the same download: each shows it. A dead host
 * is said within seconds (download.ts CONTACT_MS) in one sentence. The one question: not enough free disk space.
 */
export async function requireModel(id: ModelId, wait: ModelWait = {}): Promise<void> {
	const state = await useOndeviceStore.getState().refresh();
	const model = state?.models.find((m) => m.id === id);
	if (model?.installed) return;
	if (model?.unsupported) throw new Error(model.unsupported);
	if (!model) throw new Error("This feature isn't in this build of the app.");
	const running = model.job?.status === "running";
	// The same figure the server refuses on, plus a little for what the feature itself writes meanwhile.
	if (!running && state?.disk && state.disk.free > 0 && state.disk.free < model.installBytes + 256e6) {
		useOndeviceStore.setState({ prompt: id });
		throw new Error(`Not enough free space for ${model.title}: it needs ${formatBytes(model.installBytes)} to download and set up, the disk has ${formatBytes(state.disk.free)} free.`);
	}
	const { jobCenter } = await import("@/jobs/store");
	const jobId = modelJobId(id);
	const retry = () => void requireModel(id).catch(() => {});
	jobCenter.start({
		id: jobId,
		kind: "other",
		title: model.title,
		stage: waitLabel(model, undefined, 0),
		progress: 0,
		cancel: () => void ondeviceApi.cancel(id).catch(() => {}),
		resume: { type: "ondevice-model", model: id },
	});
	// Asked even when it is already downloading: a download the background queue started then goes at full speed and
	// stops giving way (the feature is waiting for it now); the server never starts a second one.
	try {
		await ondeviceApi.install(id);
	} catch (error) {
		const why = calmError((error as Error).message);
		jobCenter.fail(jobId, why);
		jobCenter.update(jobId, { retry });
		throw new Error(why);
	}
	let shown = 0;
	return new Promise<void>((resolve, reject) => {
		let timer: ReturnType<typeof setInterval> | null = null;
		const end = (outcome: "done" | "failed" | "cancelled", why?: string) => {
			if (timer) clearInterval(timer);
			timer = null;
			wait.signal?.removeEventListener("abort", onAbort);
			const calm = calmError(why);
			if (outcome === "done") jobCenter.finish(jobId);
			else if (outcome === "failed") {
				jobCenter.fail(jobId, calm);
				jobCenter.update(jobId, { retry });
			} else jobCenter.cancelled(jobId);
			if (outcome === "done") {
				// One quiet moment, then the row leaves (the feature carries on with its own job).
				setTimeout(() => jobCenter.remove(jobId), 1500);
				resolve();
			} else reject(outcome === "cancelled" ? new DOMException("Cancelled", "AbortError") : new Error(calm));
		};
		const onAbort = () => {
			void ondeviceApi.cancel(id).catch(() => {});
			end("cancelled");
		};
		if (wait.signal?.aborted) return onAbort();
		wait.signal?.addEventListener("abort", onAbort, { once: true });
		const tick = async () => {
			const m = (await useOndeviceStore.getState().refresh())?.models.find((x) => x.id === id);
			if (!m || !timer) return;
			if (m.installed) return void end("done");
			if (m.unsupported) return void end("failed", m.unsupported);
			const status = m.job?.status;
			if (status === "failed") return void end("failed", m.job?.error);
			if (status === "cancelled") return void end("cancelled");
			// The bar never goes back (a resumed file starts its reading again from what is on disk).
			shown = Math.max(shown, jobProgress(m.job));
			const label = waitLabel(m, m.job, shown);
			wait.onProgress?.(shown, label);
			jobCenter.update(jobId, { stage: label, progress: shown });
		};
		timer = setInterval(() => void tick(), 600);
		void tick();
	});
}

export const formatBytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
