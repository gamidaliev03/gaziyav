// CleanUp on the selected clip or photo (inspector → AI): the object the user clicked or painted on one frame is
// removed on this Mac, the background filled in; the result lands in Media → Results and replaces the clip's picture
// in one ⌘Z step (the original stays in Media). A clip sends its visible piece plus ½ s handles.
import { toast } from "sonner";
import { create } from "zustand";
import { UpdateElementsCommand } from "@/commands/timeline";
import { EditorCore } from "@/core";
import { jobCenter } from "@/jobs/store";
import { clipSourceRange } from "@/motion/client";
import { requireModel } from "@/ondevice/client";
import { followJob, studioApi, uploadOnce } from "@/studio/client/api";
import { importToMedia } from "@/studio/client/editor-bridge";
import type { JobState } from "@/studio/server/jobs";
import type { ImageElement, TimelineElement, VideoElement } from "@/timeline";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { t } from "@/i18n";

/** What the user marked on one frame: clicks (0–1 of the frame; 1 = the object, 0 = keep) and a brush stroke. */
export interface CleanupMarks {
	/** Seconds in the media file of the frame that was marked. */
	at: number;
	points: Array<[number, number, 0 | 1]>;
	/** PNG, white = remove, the frame's size (or null). */
	brush: Blob | null;
}

type Target = VideoElement | ImageElement;

interface CleanupState {
	running: Record<string, { stage: string; progress: number; cancel: () => void }>;
}
export const useCleanupStore = create<CleanupState>(() => ({ running: {} }));

const setRunning = (id: string, value: CleanupState["running"][string] | null) =>
	useCleanupStore.setState((s) => {
		const running = { ...s.running };
		if (value) running[id] = value;
		else delete running[id];
		return { running };
	});

const sec = (t: number) => mediaTimeToSeconds({ time: t as never });

export function locate(editor: EditorCore, elementId: string): { trackId: string; clip: Target } | null {
	const t = editor.scenes.getActiveScene().tracks;
	for (const track of [t.main, ...t.overlay]) {
		const el = (track.elements as TimelineElement[]).find((e) => e.id === elementId);
		if (el?.type === "video" || el?.type === "image") return { trackId: track.id, clip: el };
	}
	return null;
}

/** The media-file second shown at the playhead (inside the clip), or the clip's first frame. */
export function markedSecond(editor: EditorCore, clip: Target): number {
	if (clip.type !== "video") return 0;
	const [s0, s1] = clipSourceRange(clip);
	const into = sec(editor.playback.getCurrentTime()) - sec(clip.startTime);
	const rate = clip.retime?.rate ?? 1;
	return Math.min(s1, Math.max(s0, s0 + Math.max(0, into) * rate));
}

async function post(path: string, body: unknown): Promise<JobState> {
	const res = await fetch(`/api/studio/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify(body) });
	const start = (await res.json().catch(() => null)) as (JobState & { error?: string }) | null;
	if (!res.ok || !start?.id) throw new Error(start?.error || "CleanUp didn't start");
	return start;
}

async function sendMarks(editor: EditorCore, clip: Target, marks: CleanupMarks) {
	const asset = editor.media.getAssets().find((a) => a.id === clip.mediaId);
	if (!asset?.file) throw new Error("This clip's file is missing from the project");
	const up = await uploadOnce(`media:${asset.id}`, asset.file);
	const brush = marks.brush ? (await uploadOnce(`cleanup-brush:${crypto.randomUUID()}`, new File([marks.brush], "brush.png", { type: "image/png" }))).fileId : undefined;
	return { asset, fileId: up.fileId, brushFileId: brush };
}

/**
 * The object's outline on the marked frame (an image URL to show over it) and how much of the frame it covers. The
 * first one gets the model, inside this very wait (`onStage`: «Downloading the model · 450 MB · 12 %»).
 */
export async function previewObject(elementId: string, marks: CleanupMarks, onStage?: (stage: string) => void): Promise<{ url: string; area: number }> {
	const editor = EditorCore.getInstance();
	const at = locate(editor, elementId);
	if (!at) throw new Error("Select the clip again");
	await requireModel("cleanup", { onProgress: (_f, label) => onStage?.(label) });
	onStage?.("Finding the object");
	const { fileId, brushFileId } = await sendMarks(editor, at.clip, marks);
	const start = await post("jobs/cleanup-preview", { fileId, at: marks.at, points: marks.points, brushFileId });
	const done = await followJob(start.id, () => {});
	if (done.status !== "done") throw new Error(done.error || "Couldn't find the object");
	const r = done.result as { fileId: string; area: number };
	return { url: studioApi.fileUrl(r.fileId), area: r.area };
}

/** Removes the marked object. Resolves with true when the clip shows the result. */
export async function cleanupClip(elementId: string, marks: CleanupMarks): Promise<boolean> {
	const editor = EditorCore.getInstance();
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	const at = locate(editor, elementId);
	if (!projectId || !at || useCleanupStore.getState().running[elementId]) return false;
	const controller = new AbortController();
	let serverJob: string | null = null;
	const cancel = () => {
		controller.abort();
		if (serverJob) void studioApi.cancel(serverJob);
	};
	const center = jobCenter.start({ kind: "other", title: "CleanUp", stage: "Preparing", cancel, place: { elements: [elementId] } });
	const raw = (stage: string, progress: number) => {
		setRunning(elementId, { stage, progress, cancel });
		jobCenter.update(center, { stage, progress });
	};
	// A first-use download fills the first 30 %; the work after it fills the rest, so the bar never goes back.
	let floor = 0;
	const report = (stage: string, progress: number) => raw(stage, floor + (1 - floor) * progress);
	raw("Preparing", 0);
	try {
		await requireModel("cleanup", {
			signal: controller.signal,
			onProgress: (f, label) => {
				floor = 0.3 * f;
				raw(label, floor);
			},
		});
		report("Sending the clip", 0.02);
		const { asset, fileId, brushFileId } = await sendMarks(editor, at.clip, marks);
		const video = at.clip.type === "video";
		const [s0, s1] = video ? clipSourceRange(at.clip as VideoElement) : [0, 0];
		const full = asset.duration ?? s1 + 1;
		const from = video ? Math.max(0, s0 - 0.5) : 0;
		const to = video ? Math.min(full, s1 + 0.5) : 0;
		if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
		const start = await post("jobs/cleanup", { fileId, from, to, at: marks.at, points: marks.points, brushFileId });
		serverJob = start.id;
		const done = await followJob(start.id, (s) => {
			const stage = s.stages?.find((x) => x.status === "running");
			report(stage?.detail || stage?.title || "Working", (stage?.id === "clean" ? 0.08 : 0.04) + (stage?.progress ?? 0) * (stage?.id === "clean" ? 0.88 : 0.04));
		});
		if (done.status === "cancelled" || controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
		if (done.status !== "done") throw new Error(done.error || "CleanUp stopped");
		const result = done.result as { fileId: string; name: string; duration: number; from: number; photo: boolean };
		report("Adding the result", 0.97);
		const file = await studioApi.fetchFile(result.fileId, result.name, result.photo ? "image/png" : "video/mp4");
		const made = await importToMedia(editor, file, projectId, "result");
		const now = locate(editor, elementId);
		if (now && now.clip.mediaId === asset.id && editor.project.getActiveOrNull()?.metadata.id === projectId) {
			let patch: Partial<VideoElement | ImageElement> = { mediaId: made.id };
			if (now.clip.type === "video") {
				// The same cut of the cleaned piece: one undo step brings the original back.
				const total = made.duration ?? result.duration;
				const trimStart = Math.max(0, sec(now.clip.trimStart) - result.from);
				const visible = s1 - s0;
				patch = {
					mediaId: made.id,
					trimStart: mediaTimeFromSeconds({ seconds: trimStart }),
					trimEnd: mediaTimeFromSeconds({ seconds: Math.max(0, total - trimStart - visible) }),
					sourceDuration: mediaTimeFromSeconds({ seconds: total }),
				};
			}
			editor.command.execute({ command: new UpdateElementsCommand({ updates: [{ trackId: now.trackId, elementId, patch: patch as Partial<TimelineElement> }] }) });
			jobCenter.finish(center, t("Object removed"));
			toast.success(t("Object removed"), { description: t("⌘Z brings the original back"), action: { label: t("Undo"), onClick: () => editor.command.undo() } });
			return true;
		}
		jobCenter.finish(center, "Object removed — the clip changed meanwhile; the result is in Media → Results");
		return false;
	} catch (error) {
		const e = error as Error;
		if (e.name === "AbortError" || controller.signal.aborted) {
			jobCenter.cancelled(center);
			return false;
		}
		jobCenter.fail(center, e.message);
		toast.error(e.message);
		return false;
	} finally {
		setRunning(elementId, null);
	}
}
