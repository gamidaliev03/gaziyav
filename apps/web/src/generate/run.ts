// AI → Generate: runs one generator job on the app's server (fal.ai behind it), shows it in
// the job center with progress and Cancel, then keeps the result under its form. It goes into Media only when the
// user takes it (+, a drag onto the timeline or a double-click) — the takes nobody wanted never clutter Media.
import { toast } from "sonner";
import { create } from "zustand";
import { insertSourceRange } from "@/components/editor/panels/assets/source/source-monitor";
import { takeOnce } from "@/media/source-result";
import type { MediaAsset } from "@/media/types";
import { EditorCore } from "@/core";
import { jobCenter } from "@/jobs/store";
import { followJob, studioApi } from "@/studio/client/api";
import { importToMedia } from "@/studio/client/editor-bridge";
import type { JobState } from "@/studio/server/jobs";

export type GeneratorKind = "voice";

const TITLE = { voice: "Voice-over" } as const;
/** The file type by its name: voices come as AAC (.m4a), with a voice effect as WAV. */
const mimeOf = (name: string) => (/\.wav$/i.test(name) ? "audio/wav" : /\.mp3$/i.test(name) ? "audio/mpeg" : "audio/mp4");

interface GenerateState {
	/** A run in progress: its stage and bar, and how to stop it (the model's download before the job, then the job). */
	running: Partial<Record<GeneratorKind, { jobId?: string; stage: string; progress: number; cancel?: () => void }>>;
	/** Finished results, newest first, until the user takes or discards them. */
	results: GenResult[];
}

export interface GenResult {
	/** The server's file id (also the preview: /api/studio/file/<id>). */
	id: string;
	kind: GeneratorKind;
	name: string;
	/** The project it was made in (each project lists its own takes). */
	projectId?: string;
}

export const useGenerateStore = create<GenerateState>(() => ({ running: {}, results: [] }));

export const resultUrl = (r: GenResult) => `/api/studio/file/${r.id}`;

const useDrafts = create<{ values: Record<string, unknown> }>(() => ({ values: {} }));

/** Like useState for the generator forms, but kept while the AI tab is closed (a typed prompt was lost on a tab switch). */
export function useDraft<T>(key: string, initial: T): [T, (value: T) => void] {
	const value = useDrafts((s) => (key in s.values ? (s.values[key] as T) : initial));
	return [value, (next: T) => useDrafts.setState((s) => ({ values: { ...s.values, [key]: next } }))];
}

/** A result into the open project's Media (once). */
export function takeResult(r: GenResult): Promise<MediaAsset> {
	return takeOnce(`gen:${r.id}`, async () => {
		const editor = EditorCore.getInstance();
		const projectId = editor.project.getActiveOrNull()?.metadata.id;
		if (!projectId) throw new Error("Open a project first.");
		const file = await studioApi.fetchFile(r.id, r.name, mimeOf(r.name));
		return importToMedia(editor, file, projectId, "result");
	});
}

export function discardResult(id: string) {
	useGenerateStore.setState((s) => ({ results: s.results.filter((r) => r.id !== id) }));
}

function setRunning(kind: GeneratorKind, value: GenerateState["running"][GeneratorKind] | null) {
	useGenerateStore.setState((s) => {
		const running = { ...s.running };
		if (value) running[kind] = value;
		else delete running[kind];
		return { running };
	});
}

async function post(path: string, body: unknown): Promise<JobState> {
	const res = await fetch(`/api/studio/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify(body) });
	const data = await res.json().catch(() => null);
	if (!res.ok || !data?.id) throw new Error(data?.error || "The generator didn't start");
	return data as JobState;
}

/** Generates and keeps the result under its form; with `place` (Gaziyav AI) it also goes onto the timeline at the
 * playhead. Resolves with true when it was made (and placed). */
/** About how long a take takes on an M1-class Mac (the bar's pace while the generator tells nothing). */
const TYPICAL_SECONDS: Record<GeneratorKind, number> = { voice: 12 };

// Claude's calls wait their turn (several voices asked at once, while a generation runs in the background); the
// panel's button refuses instead, as it is disabled while one runs.
const turns: Partial<Record<GeneratorKind, Promise<unknown>>> = {};

export async function generate(
	kind: GeneratorKind,
	body: Record<string, unknown>,
	options?: { place?: boolean; queue?: boolean; toMedia?: (asset: MediaAsset) => void },
): Promise<boolean> {
	if (options?.queue) {
		const prev = turns[kind] ?? Promise.resolve();
		const mine = prev.catch(() => {}).then(async () => {
			while (useGenerateStore.getState().running[kind]) await new Promise((r) => setTimeout(r, 300));
			return generate(kind, body, { ...options, queue: false });
		});
		turns[kind] = mine.catch(() => {});
		return mine;
	}
	if (useGenerateStore.getState().running[kind]) return false;
	const editor = EditorCore.getInstance();
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	if (!projectId) return false;
	// First use: the model downloads right here, inside this progress, before anything else; the panel's Cancel (and
	// the job list's) stops that download, later the job.
	const download = new AbortController();
	const stopDownload = () => download.abort();
	setRunning(kind, { stage: "Preparing", progress: 0, cancel: stopDownload });
	const center = jobCenter.start({ kind: kind === "voice" ? "voice" : "other", title: TITLE[kind], stage: "Preparing", cancel: stopDownload });
	try {
		const floor = 0;
		const start = await post(`jobs/generate-${kind}`, body);
		const stopJob = () => void studioApi.cancel(start.id);
		setRunning(kind, { jobId: start.id, stage: "Starting", progress: floor, cancel: stopJob });
		jobCenter.update(center, { cancel: stopJob });
		// The bar always moves and never goes back: a step that tells nothing of its progress (the voice) moves by the
		// time such a job usually takes (never past 90 %); the real figures take over once they are ahead.
		const t0 = Date.now();
		let shown = floor;
		const done = await followJob(start.id, (s) => {
			const stage = s.stages?.find((x) => x.status === "running");
			const label = stage?.detail || stage?.title || "Working";
			const told = stage?.progress ?? 0;
			const guess = 0.9 * (1 - Math.exp(-(Date.now() - t0) / 1000 / TYPICAL_SECONDS[kind]));
			shown = Math.max(shown, floor + (1 - floor) * (told > 0 ? told : guess));
			setRunning(kind, { jobId: start.id, stage: label, progress: shown, cancel: stopJob });
			jobCenter.update(center, { stage: label, progress: shown });
		});
		if (done.status === "cancelled") {
			jobCenter.update(center, { status: "cancelled", cancel: undefined });
			return false;
		}
		if (done.status !== "done") throw new Error(done.error || "The generator stopped");
		const out = done.result as { fileId: string; name: string };
		const result: GenResult = { id: out.fileId, kind, name: out.name, projectId: editor.project.getActiveOrNull()?.metadata.id };
		useGenerateStore.setState((s) => ({ results: [result, ...s.results].slice(0, 30) }));
		jobCenter.finish(center, "Ready");
		if (editor.project.getActiveOrNull()?.metadata.id === projectId) {
			if (options?.place) insertSourceRange({ editor, asset: await takeResult(result) });
			else if (options?.toMedia) options.toMedia(await takeResult(result));
		}
		return true;
	} catch (error) {
		const e = error as Error;
		if (e.name === "AbortError") {
			jobCenter.update(center, { status: "cancelled", cancel: undefined });
			return false;
		}
		jobCenter.fail(center, e.message);
		toast.error(e.message);
		return false;
	} finally {
		setRunning(kind, null);
	}
}

export function cancelGenerate(kind: GeneratorKind) {
	const run = useGenerateStore.getState().running[kind];
	if (run?.cancel) run.cancel();
	else if (run?.jobId) void studioApi.cancel(run.jobId);
}
