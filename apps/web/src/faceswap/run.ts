// Face swap on the selected clip (inspector → AI): the visible piece (plus ½ s of handles) goes to fal.ai (PixVerse
// Swap), the result lands in Media → Results and replaces the clip's picture in one ⌘Z step. The original stays in Media.
// A clip that already shows a swap is swapped again from its original (never a new face over the last one): the result
// remembers what it was made from (`neural`, as the AI effects do). No marks are put on any result: a personal editor.
import { toast } from "sonner";
import { create } from "zustand";
import { UpdateElementsCommand } from "@/commands/timeline";
import { EditorCore } from "@/core";
import { jobCenter } from "@/jobs/store";
import { clipSourceRange } from "@/motion/client";
import { followJob, studioApi, uploadOnce } from "@/studio/client/api";
import { processMediaAssets } from "@/media/processing";
import type { MediaAsset } from "@/media/types";
import { storageService } from "@/services/storage/service";
import { generateUUID } from "@/utils/id";
import type { JobState } from "@/studio/server/jobs";
import type { TimelineElement, VideoElement } from "@/timeline";
import { mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";

/** The made-up faces that ship with the app (public/faces/<id>.jpg). Nobody real. */
export const FACES = [
	{ id: "hero", name: "Hero" },
	{ id: "diva", name: "Diva" },
	{ id: "rebel", name: "Rebel" },
	{ id: "noir", name: "Noir" },
	{ id: "elf", name: "Elf" },
	{ id: "viking", name: "Viking" },
	{ id: "idol", name: "Idol" },
	{ id: "sage", name: "Sage" },
	{ id: "android", name: "Android" },
] as const;

export type FaceChoice = { preset: string } | { mediaId: string; consent: boolean } | { myFace: string; name: string; consent: boolean } | { look: string };

/** What a face swap result is called in `neural.effect` (the AI effects' "made from" record). */
export const FACE_SWAP_EFFECT = "ai.faceSwap";

interface FaceSwapState {
	running: Record<string, { stage: string; progress: number; cancel: () => void }>;
}
export const useFaceSwapStore = create<FaceSwapState>(() => ({ running: {} }));

const setRunning = (elementId: string, value: FaceSwapState["running"][string] | null) =>
	useFaceSwapStore.setState((s) => {
		const running = { ...s.running };
		if (value) running[elementId] = value;
		else delete running[elementId];
		return { running };
	});

const sec = (t: number) => t / TICKS_PER_SECOND;

/** PixVerse's price doubles past 5 s of input: the ½ s handles stay under it, a little below for the encoder's padding. */
const CHEAP_SECONDS = 4.9;

/** The piece that goes to fal for `from…to` of a file: the visible part and up to ½ s around it. */
export function swapPiece(from: number, to: number, full: number): { from: number; to: number } {
	const visible = to - from;
	const handle = visible <= CHEAP_SECONDS ? Math.min(0.5, (CHEAP_SECONDS - visible) / 2) : 0.5;
	return { from: Math.max(0, from - handle), to: Math.min(full, to + handle) };
}

/** The result in the project's Media (Results), with what it was made from (the project the job started in). */
async function addResult(editor: EditorCore, projectId: string, file: File, neural: NonNullable<MediaAsset["neural"]>): Promise<MediaAsset> {
	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) throw new Error("The editor couldn't read the result file");
	if (editor.project.getActiveOrNull()?.metadata.id !== projectId) {
		const stored: MediaAsset = { ...processed, id: generateUUID(), origin: "result", neural };
		await storageService.saveMediaAsset({ projectId, mediaAsset: stored });
		return stored;
	}
	const added = await editor.media.addMediaAsset({ projectId, asset: { ...processed, origin: "result", neural } });
	if (!added) throw new Error("Not enough storage space for the result — free some disk space and retry");
	return added;
}

function locate(editor: EditorCore, elementId: string): { trackId: string; clip: VideoElement } | null {
	const t = editor.scenes.getActiveScene().tracks;
	for (const track of [t.main, ...t.overlay]) {
		const el = (track.elements as TimelineElement[]).find((e) => e.id === elementId);
		if (el?.type === "video") return { trackId: track.id, clip: el };
	}
	return null;
}

/** Swaps the face in a video clip. Resolves with true when the clip shows the result. */
export async function faceSwapClip(elementId: string, face: FaceChoice): Promise<boolean> {
	const editor = EditorCore.getInstance();
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	const at = locate(editor, elementId);
	if (!projectId || !at || useFaceSwapStore.getState().running[elementId]) return false;
	const assets = editor.media.getAssets();
	const asset = assets.find((a) => a.id === at.clip.mediaId);
	if (!asset?.file) {
		toast.error("This clip's file is missing from the project");
		return false;
	}
	// A clip that already shows a swap: the new face goes onto the original (its picture, its timing).
	let source: MediaAsset = asset;
	let shift = 0;
	if (asset.neural?.effect === FACE_SWAP_EFFECT) {
		const from = assets.find((a) => a.id === asset.neural?.sourceId);
		if (from?.file) {
			source = from;
			shift = asset.neural.offset ?? 0;
		}
	}
	const controller = new AbortController();
	let serverJob: string | null = null;
	const cancel = () => {
		controller.abort();
		if (serverJob) void studioApi.cancel(serverJob);
	};
	const doneText = "look" in face ? "Look applied" : "Face swapped";
	const center = jobCenter.start({ kind: "other", title: "look" in face ? "Face look" : "Face swap", stage: "Preparing", cancel });
	const raw = (stage: string, progress: number) => {
		setRunning(elementId, { stage, progress, cancel });
		jobCenter.update(center, { stage, progress });
	};
	const report = (stage: string, progress: number) => raw(stage, progress);
	raw("Preparing", 0);
	try {
		const [c0, c1] = clipSourceRange(at.clip);
		const [s0, s1] = [c0 + shift, c1 + shift];
		const full = source.duration ?? s1 + 1;
		const { from, to } = swapPiece(s0, s1, full);
		report("Sending the clip", 0.02);
		const up = await uploadOnce(`media:${source.id}`, source.file, (p) => report("Sending the clip", 0.02 + p * 0.05));
		let faceFileId: string | undefined;
		if ("mediaId" in face) {
			const photo = editor.media.getAssets().find((a) => a.id === face.mediaId);
			if (!photo?.file) throw new Error("The face photo is missing from Media");
			faceFileId = (await uploadOnce(`media:${photo.id}`, photo.file)).fileId;
		}
		if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
		const res = await fetch("/api/studio/jobs/faceswap", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Studio": "1" },
			body: JSON.stringify({
				fileId: up.fileId,
				from,
				to,
				...("look" in face ? { look: face.look } : "preset" in face ? { preset: face.preset } : "myFace" in face ? { myFace: face.myFace, consent: face.consent } : { faceFileId, consent: face.consent }),
			}),
		});
		const start = (await res.json().catch(() => null)) as (JobState & { error?: string }) | null;
		if (!res.ok || !start?.id) throw new Error(start?.error || "Face swap didn't start");
		serverJob = start.id;
		const done = await followJob(start.id, (s) => {
			const stage = s.stages?.find((x) => x.status === "running");
			const base = stage?.id === "swap" ? 0.12 : 0.08;
			report(stage?.detail || stage?.title || "Working", base + (stage?.progress ?? 0) * (stage?.id === "swap" ? 0.84 : 0.04));
		});
		if (done.status === "cancelled" || controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
		if (done.status !== "done") throw new Error(done.error || "Face swap stopped");
		const result = done.result as { fileId: string; name: string; duration: number; from: number };
		report("Adding the result", 0.97);
		const file = await studioApi.fetchFile(result.fileId, result.name || `${source.name.replace(/\.[^.]+$/, "") || "Clip"} · Face swap.mp4`, "video/mp4");
		const label = "look" in face ? `Face look · ${face.look}` : "preset" in face ? `Face swap · ${FACES.find((f) => f.id === face.preset)?.name ?? face.preset}` : "myFace" in face ? `Face swap · ${face.name}` : "Face swap · photo";
		const made = await addResult(editor, projectId, file, {
			effect: FACE_SWAP_EFFECT,
			key: `faceswap-${result.fileId}`,
			label,
			params: {},
			sourceId: source.id,
			originalId: source.neural?.originalId ?? source.id,
			offset: result.from,
		});
		// One undo step: the clip now shows the swapped piece, cut at the same place.
		const now = locate(editor, elementId);
		if (now && now.clip.mediaId === asset.id && editor.project.getActiveOrNull()?.metadata.id === projectId) {
			const total = made.duration ?? result.duration;
			const visible = s1 - s0;
			// A result a little shorter than asked (the service's rounding) still never shows past its own end.
			const trimStart = Math.min(Math.max(0, sec(now.clip.trimStart) + shift - result.from), Math.max(0, total - visible));
			const shown = Math.min(visible, total - trimStart);
			const patch: Partial<VideoElement> = {
				mediaId: made.id,
				trimStart: mediaTimeFromSeconds({ seconds: trimStart }),
				trimEnd: mediaTimeFromSeconds({ seconds: Math.max(0, total - trimStart - shown) }),
				sourceDuration: mediaTimeFromSeconds({ seconds: total }),
				...(shown < visible - 0.001 ? { duration: mediaTimeFromSeconds({ seconds: shown }) } : {}),
			};
			editor.command.execute({ command: new UpdateElementsCommand({ updates: [{ trackId: now.trackId, elementId, patch }] }) });
			jobCenter.finish(center, doneText);
			toast.success(doneText, { description: "⌘Z brings the original back", action: { label: "Undo", onClick: () => editor.command.undo() } });
			return true;
		}
		jobCenter.finish(center, `${doneText} — the clip changed meanwhile; the result is in Media → Results`);
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
