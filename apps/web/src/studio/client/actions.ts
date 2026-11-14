// What the panel buttons do: voice-over, pre-flight, lipsync and YouTube fragments, wired into the editor.
import { type DiskExport, openDiskExport } from "@/export/disk";
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import { wordsToCues } from "./captions";
import { dubPlacement, placeWords } from "@/assist/dub-timing";
import { getModel, type LipsyncModel } from "@/studio/shared/models";
import { followJob, type JobState, type Segment, studioApi, uploadOnce } from "./api";
import type { KeptOriginal } from "@/studio/server/local-provider";
import {
	clipById,
	clipPiece,
	currentClip,
	placeVoiceUnder,
	importToMedia,
	inOutSeconds,
	insertCaptions,
	isActiveProject,
	nextName,
	type LipPlace,
	placeAbove,
	placeResult,
	projectFps,
	replaceClip,
	replaceRange,
	replaceSpeech,
	roomAfter,
	snapToFrame,
	swapResultMedia,
	type ClipRef,
	voicesUnder,
} from "./editor-bridge";
import { type FitChoice, fitOptions, resolveFit, serverFit } from "./fit";
import { timelineVoiceFile } from "./voice-timeline";
import { recordTake } from "./takes";
import { draftKey, isRunning, loadPendingDurable, type PendingJob, placeOf, type Run, type RunKind, resolveKey, runningLipsyncs, useStudioStore, versionKey } from "./studio-store";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { requireModel } from "@/ondevice/client";
import { falChoice, keysOf, useFal } from "@/fal/client";
import { apiOf, falModel } from "@/fal/models";
import { onOffer } from "@/fal/video";
import { jobCenter, type PendingMedia, useJobsStore } from "@/jobs/store";
import { registerResumer } from "@/jobs/durable";
import { generateUUID } from "@/utils/id";

const store = () => useStudioStore.getState();

/** The lipsync model: the one picked in the Lipsync window for this project, else the one chosen in Settings. */
export function chosenModel(projectId?: string, _seconds?: number): LipsyncModel {
	// a draft key or a project id (its chosen clip)
	const picked = projectId ? store().draft(projectId).model : "";
	// A model picked in this window whose API has no key gives way to the pick of Settings (the default of an API with a key).
	const usable = !picked || onOffer(keysOf(useFal.getState().status)).includes(apiOf(falModel(picked)));
	return getModel(picked && usable ? picked : falChoice("lipsync").id);
}

/** kie.ai's options of its ByteDance lipsync; fal's models send nothing here. */
const kieOptions = (id: string, draft: { kieMode?: "lite" | "basic"; kieVocals?: boolean }) => (id.startsWith("volcengine/") ? { kie: { mode: draft.kieMode ?? "lite", vocals: !!draft.kieVocals } } : {});

export async function refreshServer() {
	try {
		store().setServer(await studioApi.state());
	} catch {}
}

// MARK: Slots — several clips at once (at most three lipsyncs in flight, the rest wait in line, visibly)

export const LIPSYNC_SLOTS = 3;
const holders = new Map<string, number>();
/** A «voice → lipsync» run's slot, kept from its voice to its lipsync. */
const chainSlots = new Map<string, () => void>();
const waiting: Array<{ key: string; go: () => void; onWait: (ahead: number) => void }> = [];
function tellQueue() {
	waiting.forEach((w, i) => w.onWait(i + 1 + Math.max(0, holders.size - LIPSYNC_SLOTS)));
}
/** A slot for this clip's run (a «voice → lipsync» run keeps its one slot through both). */
async function takeSlot(key: string, onWait: (ahead: number) => void, signal: AbortSignal): Promise<() => void> {
	const held = holders.get(key);
	if (held) {
		holders.set(key, held + 1);
	} else if (holders.size < LIPSYNC_SLOTS && !waiting.length) {
		holders.set(key, 1);
	} else {
		await new Promise<void>((resolve, reject) => {
			const entry = { key, go: resolve, onWait };
			waiting.push(entry);
			tellQueue();
			signal.addEventListener("abort", () => {
				const i = waiting.indexOf(entry);
				if (i >= 0) waiting.splice(i, 1);
				tellQueue();
				reject(new DOMException("cancelled", "AbortError"));
			});
		});
		holders.set(key, (holders.get(key) ?? 0) + 1);
	}
	let freed = false;
	return () => {
		if (freed) return;
		freed = true;
		const n = (holders.get(key) ?? 1) - 1;
		if (n > 0) holders.set(key, n);
		else holders.delete(key);
		while (holders.size < LIPSYNC_SLOTS && waiting.length) {
			const next = waiting.shift()!;
			holders.set(next.key, 0);
			next.go();
		}
		tellQueue();
	};
}

/** Runs one panel operation with progress, cancel and a readable error, keeping it in the store (for its clip: `key`). */
async function operate<T>(
	kind: RunKind,
	projectId: string,
	body: (ctl: Ctl) => Promise<T>,
	startedAt = Date.now(),
	key?: string,
	extra: Partial<Run> = {},
): Promise<T | undefined> {
	const s = store();
	const abort = new AbortController();
	let jobId: string | undefined;
	const update = (patch: Partial<Run>) => store().updateRun(kind, patch, key);
	s.setRun(
		kind,
		{
			kind,
			projectId,
			startedAt,
			...extra,
			...(key ? { key } : {}),
			cancel: () => {
				abort.abort();
				if (jobId) void studioApi.cancel(jobId);
			},
		},
		key,
	);
	const ctl: Ctl = {
		signal: abort.signal,
		local: (title, progress) => update({ local: { title, progress } }),
		async job(start, meta) {
			if (abort.signal.aborted) throw new DOMException("cancelled", "AbortError");
			const first = await start();
			jobId = first.id;
			// Stop pressed while the job was being started: it is cancelled on the server (and on fal) at once.
			if (abort.signal.aborted) {
				void studioApi.cancel(first.id);
				throw new DOMException("cancelled", "AbortError");
			}
			// Remembered across a window reload: the paid result is picked up again, not orphaned.
			if (meta) store().addPending({ kind, projectId, jobId: first.id, startedAt, meta: { ...meta, ...(key ? { key, draft: { ...store().draft(key), placed: undefined } } : {}) } });
			update({ job: first, local: undefined });
			const end = await followJob(first.id, (j) => update({ job: j }));
			if (end.status === "cancelled") throw new DOMException("cancelled", "AbortError");
			if (end.status === "failed") throw new Error(end.error || "The step failed");
			return end.result as any;
		},
	};
	// The paid steps of a clip take a slot: at most three clips in flight, the others wait in line (said on their panel).
	let release: (() => void) | undefined;
	let ok = false;
	try {
		if (key && (kind === "lipsync" || kind === "voiceover")) {
			release = await takeSlot(key, (ahead) => update({ queued: ahead, local: { title: "Waiting for a free slot" } }), abort.signal);
			update({ queued: undefined, local: undefined });
		}
		const result = await body(ctl);
		ok = true;
		return result;
	} catch (error) {
		const cancelled = abort.signal.aborted || (error as Error)?.name === "AbortError";
		update({ queued: undefined, error: cancelled ? "Cancelled" : (error as Error)?.message || "The step failed without details. Try again." });
		return undefined;
	} finally {
		// the voice of a «voice → lipsync» run hands its slot to the lipsync that follows
		if (key && kind === "voiceover" && extra.chain && ok && release) chainSlots.set(key, release);
		else release?.();
		if (key && kind === "lipsync") {
			chainSlots.get(key)?.();
			chainSlots.delete(key);
		}
		if (jobId) store().removePending(jobId);
	}
}

interface Ctl {
	signal: AbortSignal;
	local: (title: string, progress?: number) => void;
	job: <R>(start: () => Promise<JobState>, meta?: Record<string, unknown>) => Promise<R>;
}

function finish(kind: RunKind, text: string, key?: string) {
	store().updateRun(kind, { done: text, local: undefined }, key);
}

/**
 * Sends the clip's media file to the pipeline (once per session) and describes the piece to use: the In/Out
 * part of the clip when marked, else the whole clip.
 */
async function clipSegment(
	clip: ClipRef,
	ctl: Ctl,
	piece: { start: number; end: number } | null = null,
	length?: number,
): Promise<Segment> {
	ctl.local("Sending the clip", 0);
	const up = await uploadOnce(`media:${clip.asset.id}`, clip.asset.file, (p) => ctl.local("Sending the clip", p));
	if (piece) return { fileId: up.fileId, start: clip.start + (piece.start - clip.at), length: piece.end - piece.start };
	return { fileId: up.fileId, start: clip.start, length: length ?? clip.length };
}

/** The clip a call works on: the one named, else the selected (or chosen) one. */
function clipFor(editor: EditorCore, clipId?: string | null): ClipRef | null {
	return clipId ? clipById(editor, clipId) : currentClip(editor);
}

/** The draft key of a clip in a project (the selected / chosen clip when none is named). */
export function keyFor(editor: EditorCore, projectId: string, clipId?: string | null): string {
	return draftKey(projectId, clipId ?? currentClip(editor)?.elementId);
}

/** What will be sent for this draft: the piece, its length, and how a length mismatch is handled. */
export function lipsyncPlan(editor: EditorCore, projectId: string, clipId?: string | null) {
	const clip = clipFor(editor, clipId);
	const draft = store().draft(draftKey(projectId, clip?.elementId ?? clipId));
	const range = draft.source === "timeline" ? inOutSeconds(editor) : null;
	const piece = draft.source === "clip" && clip ? clipPiece(editor, clip) : null;
	const videoSeconds =
		draft.source === "timeline"
			? range
				? range.end - range.start
				: mediaTimeToSeconds({ time: editor.timeline.getTotalDuration() })
			: piece
				? piece.end - piece.start
				: clip?.length ?? 0;
	const speech = draft.speech?.seconds ?? 0;
	const room = draft.source === "clip" && clip ? roomAfter(clip, piece) : 0;
	// new words (typed, a file) replace the clip's speech; the sound under the clip keeps the clip as it is
	const options = fitOptions(speech, videoSeconds, room, draft.voice !== "timeline");
	const fit = resolveFit(draft.fit ?? store().lastFit, options);
	// The part of the clip that goes to fal: the In/Out piece or the whole clip — and when the speech is shorter, only
	// as much of it as the speech lasts, starting `offset` s in (the slider). The price is for what goes.
	const base = draft.source === "clip" && clip ? (piece ?? { start: clip.at, end: clip.at + clip.length }) : null;
	let sent = base;
	let maxOffset = 0;
	let offset = 0;
	if (base && speech > 0 && (fit === "loop" || fit === "trim") && speech < base.end - base.start - 0.05) {
		const fps = projectFps(editor);
		const want = Math.ceil(speech * fps - 0.001) / fps;
		maxOffset = Math.max(0, snapToFrame(editor, base.end - base.start - want));
		offset = Math.min(maxOffset, Math.max(0, snapToFrame(editor, draft.offset ?? 0)));
		const start = base.start + offset;
		sent = { start, end: Math.min(base.end, start + want) };
	}
	const sentSeconds = sent ? sent.end - sent.start : videoSeconds;
	const place = placeOf(draft, editor.command.isRippleEnabled);
	return { draft, clip, range, piece, videoSeconds, speech, options, fit, base, sent, sentSeconds, offset, maxOffset, place };
}

/**
 * The whole edit as one video for lipsyncing a sequence of cuts: the main track only, without sound (no
 * captions, texts, overlays or music go to the provider). With In/Out marked, only that range is sent.
 */
async function timelineSegment(
	editor: EditorCore,
	ctl: Ctl,
	range: { start: number; end: number } | null,
): Promise<{ segment: Segment; seconds: number }> {
	const project = editor.project.getActive();
	ctl.local("Joining the edit into one video", 0);
	const stop = editor.project.subscribe(() => {
		const st = editor.project.getExportState();
		if (st.isExporting) ctl.local("Joining the edit into one video", st.progress);
	});
	const onAbort = () => editor.project.cancelExport();
	ctl.signal.addEventListener("abort", onAbort);
	const disk = await openDiskExport();
	try {
		const result = await editor.project.export({
			options: {
				toFile: disk?.writer,
				format: "mp4",
				quality: "high",
				fps: project.settings.fps,
				includeAudio: false,
				mainTrackOnly: true,
				normalizeLoudness: false,
			},
		});
		if (result.cancelled) throw new DOMException("cancelled", "AbortError");
		if (!result.success || !(result.buffer || result.bytes)) throw new Error(`Couldn't join the edit: ${result.error ?? "export failed"}`);
		const file = result.buffer ? new File([result.buffer], "Edit.mp4", { type: "video/mp4" }) : await (disk as DiskExport).file("Edit.mp4");
		ctl.local("Sending the edit", 0);
		const up = await uploadOnce(`timeline:${Date.now()}`, file, (p) => ctl.local("Sending the edit", p));
		if (range) {
			const end = Math.min(range.end, up.duration);
			return { segment: { fileId: up.fileId, start: range.start, length: Math.max(0.5, end - range.start) }, seconds: end - range.start };
		}
		return { segment: { fileId: up.fileId, start: 0, length: null }, seconds: up.duration };
	} finally {
		disk?.discard();
		stop();
		ctl.signal.removeEventListener("abort", onAbort);
		editor.project.clearExportState();
	}
}

// MARK: Voice-over

export async function voiceover(
	editor: EditorCore,
	projectId: string,
	resume?: { jobId: string; startedAt: number; meta: { name: string; key?: string; clipId?: string; chain?: boolean } },
	opts: { resumed?: boolean; clipId?: string | null; chain?: boolean } = {},
): Promise<Run | undefined> {
	const clipId = opts.clipId ?? resume?.meta.clipId ?? (resume?.meta.key?.split("|")[1] || undefined);
	const clip = clipFor(editor, clipId);
	const key = resume?.meta.key ?? keyFor(editor, projectId, clip?.elementId ?? clipId);
	const draft = store().draft(key);
	const chain = !!(opts.chain ?? resume?.meta.chain);
	await operate("voiceover", projectId, async (ctl) => {
		type R = { voiceId: string; fileId: string; duration: number; text: string; words?: Array<{ text: string; start: number; end: number }> };
		if (resume) return completeVoice(editor, key, await ctl.job<R>(() => studioApi.job(resume.jobId)), resume.meta.name, ctl);
		if (opts.resumed) ctl.local("Paid before the restart: resuming that job");
		const text = draft.text.trim();
		if (!text) throw new Error("Type the voice-over text (or use AI script)");
		// The voice runs on fal.ai; the word timings on this Mac (Whisper downloads here on first use, inside this progress).
		{
			ctl.local("Checking the speech model");
			await requireModel("whisper", { signal: ctl.signal, onProgress: (f: number, label: string) => ctl.local(label, f) });
		}
		let source: Segment | undefined;
		if (draft.voice === "clone") {
			if (!clip) throw new Error("Select the video clip on the timeline to take the voice from (click it)");
			// The person's own voice: from the original footage, also when the clip shows a lipsync version.
			source = await clipSegment(originalOf(editor, projectId, clip), ctl);
		}
		ctl.local("Starting the voice-over");
		const name = nextName(editor, `Voice · ${clip?.asset.name.replace(/\.[^.]+$/, "") || draft.voiceName || "speech"}`, ".m4a");
		const r = await ctl.job<R>(
			() =>
				studioApi.startVoiceover({
					source,
					voiceId: draft.voice === "clone" ? undefined : draft.voice,
					voiceName: draft.voiceName || clip?.asset.name.replace(/\.[^.]+$/, "") || "Voice",
					text,
					language: draft.dub?.text === text ? draft.dub.language : undefined, // Translate & dub (assist6)
				}),
			{ name, key, clipId: clip?.elementId, chain },
		);
		await completeVoice(editor, key, r, name, ctl);
	}, resume?.startedAt, key, { chain });
	return store().clipRuns[`voiceover|${key}`];
}

async function completeVoice(
	editor: EditorCore,
	key: string,
	r: { voiceId: string; fileId: string; duration: number; text: string; name?: string; words?: Array<{ text: string; start: number; end: number }> },
	name: string,
	ctl: Ctl,
) {
	{
		ctl.local("Adding the voice to Media");
		// The server's format (AAC .m4a, or WAV after a voice effect) names the file in Media.
		const ext = /\.wav$/i.test(r.name ?? "") ? ".wav" : /\.mp3$/i.test(r.name ?? "") ? ".mp3" : ".m4a";
		name = name.replace(/\.[a-z0-9]+$/i, ext);
		const file = await studioApi.fetchFile(r.fileId, name, ext === ".wav" ? "audio/wav" : ext === ".mp3" ? "audio/mpeg" : "audio/mp4");
		const asset = await importToMedia(editor, file, key.split("|")[0]);
		store().patch(key, {
			voice: r.voiceId, // the cloned voice is reused from now on — no second clone fee
			speech: { fileId: r.fileId, mediaId: asset.id, name, seconds: r.duration, text: r.text, voiceId: r.voiceId, words: r.words },
		});
		await refreshServer();
		finish("voiceover", `Done: ${name} · ${r.duration.toFixed(1)} s. Listen to it below.`, key);
	}
}

/** The whole edit on the timeline. */
function wholeEdit(editor: EditorCore) {
	return { start: 0, end: mediaTimeToSeconds({ time: editor.timeline.getTotalDuration() }) };
}

/**
 * The voice on the pipeline side for a video at `span` on the timeline: the audio under it when that is the voice
 * (taken now, so it matches the piece being sent), else the voiced speech file.
 */
async function voiceFileFor(editor: EditorCore, key: string, ctl: Ctl, span: { start: number; end: number } | null): Promise<string> {
	if (store().draft(key).voice !== "timeline") return speechFile(editor, key);
	if (!span) throw new Error("Select the video clip for lipsync on the timeline (click it)");
	ctl.local("Taking the audio under the clip");
	return (await timelineVoiceFile(editor, span.start, span.end)).fileId;
}

/** The voiced speech file on the pipeline side (re-sent from the project's media after a restart). */
async function speechFile(editor: EditorCore, key: string): Promise<string> {
	const speech = store().draft(key).speech;
	if (!speech) throw new Error("Press Voice first and listen to the voice");
	const asset = speech.mediaId ? editor.media.getAssets().find((a) => a.id === speech.mediaId) : undefined;
	if (!asset) return speech.fileId;
	const up = await uploadOnce(`media:${asset.id}`, asset.file);
	return up.fileId;
}

export function speechIsCurrent(projectId: string): boolean {
	const d = store().draft(projectId);
	if (d.voice === "file") return d.speech?.voiceId === "file"; // the user's own audio: the text doesn't matter
	if (d.voice === "timeline") return d.speech?.voiceId === "timeline"; // the audio under the clip, taken when sent
	return !!d.speech && d.speech.text === d.text.trim() && (d.voice === "clone" || d.speech.voiceId === d.voice);
}

// MARK: Pre-flight

/**
 * The pre-flight. With `o.voice` the words are still to be voiced: the server prices the voice (and, without a sound
 * yet, the lipsync on `o.estimateSeconds` of speech) from its own table — the page never computes a price itself.
 */
export async function preflight(
	editor: EditorCore,
	projectId: string,
	signal: AbortSignal,
	clipId?: string | null,
	o: { voice?: { chars: number; clone: boolean }; estimateSeconds?: number; voiceOnly?: boolean; fit?: FitChoice } = {},
) {
	const clip = clipFor(editor, clipId);
	const key = keyFor(editor, projectId, clip?.elementId ?? clipId);
	const draft = store().draft(key);
	if (o.estimateSeconds != null || o.voiceOnly) {
		if (!clip) return null;
		// nothing is sent for an estimate: the server needs only the piece's length and the picture's smaller side
		const model0 = chosenModel(key, o.estimateSeconds);
		const piece = clipPiece(editor, clip);
		const a = clip.asset;
		const side = a.width && a.height ? Math.min(a.width, a.height) : 0;
		return studioApi.preflight(
			{ estimate: { seconds: o.estimateSeconds ?? 0, length: piece ? piece.end - piece.start : clip.length, side, fps: a.fps }, voice: o.voice, voiceOnly: o.voiceOnly, model: model0.id, fit: serverFit(o.fit ?? "trim"), ...kieOptions(model0.id, draft) },
			signal,
		);
	}
	if (!draft.speech) return null;
	const ctl: Ctl = { signal, local: () => {}, job: async () => undefined as any };
	let video: Segment;
	if (draft.source === "timeline") {
		// Exporting just to check would be slow; the check uses the montage length only.
		const first = firstVideoClip(editor);
		if (!first) return null;
		video = await clipSegment(first, ctl);
		const range = inOutSeconds(editor);
		video.length = range ? range.end - range.start : mediaTimeToSeconds({ time: editor.timeline.getTotalDuration() });
	} else {
		if (!clip) return null;
		// What will go: the piece as long as the speech (from the slider's start), not the whole clip — from the original
		// footage, as the run itself sends it (a clip showing a version never matched its own cached result).
		video = await clipSegment(originalOf(editor, projectId, clip), ctl, lipsyncPlan(editor, projectId, clip.elementId).sent ?? clipPiece(editor, clip));
	}
	const span =
		draft.source === "timeline" ? (inOutSeconds(editor) ?? wholeEdit(editor)) : clip ? (lipsyncPlan(editor, projectId, clip.elementId).sent ?? { start: clip.at, end: clip.at + clip.length }) : null;
	const audioFileId = await voiceFileFor(editor, key, ctl, span);
	const model = chosenModel(key, draft.speech.seconds);
	const { fit } = lipsyncPlan(editor, projectId, clip?.elementId);
	return studioApi.preflight({ video, audioFileId, voice: o.voice, model: model.id, fit: serverFit(fit), ...kieOptions(model.id, draft) }, signal);
}

function firstVideoClip(editor: EditorCore): ClipRef | null {
	const saved = editor.selection.getSelectedElements();
	const main = editor.scenes.getActiveSceneOrNull()?.tracks.main;
	const first = main?.elements.find((e) => e.type === "video");
	if (!main || !first) return null;
	editor.selection.setSelectedElements({ elements: [{ trackId: main.id, elementId: first.id }] });
	const clip = currentClip(editor);
	editor.selection.setSelectedElements({ elements: saved });
	return clip;
}

// MARK: Lipsync

/** Everything needed to land a lipsync result — saved with the job so it survives a window reload. */
interface LipsyncMeta {
	name: string;
	/** For the before/after compare: the original media and where the piece starts in it. */
	beforeAssetId?: string;
	beforeStart?: number;
	source: "clip" | "timeline";
	clip: { trackId: string; elementId: string; at: number; length: number } | null;
	piece: { start: number; end: number } | null;
	range: { start: number; end: number } | null;
	replace: boolean;
	/** Where the result goes (older saved jobs have only `replace`). */
	place?: LipPlace;
	muteOriginal: boolean;
	words: Array<{ text: string; start: number; end: number }> | null;
	/** The voice is the audio under the video on the timeline: the result plays silent over it (never doubled). */
	silent?: boolean;
	/** The timeline it was started on: the result lands there, even when another one is open by then. */
	sceneId?: string;
	/** The fal model it runs on. */
	model?: string;
	/** The clip's draft key (its run, card and versions). */
	key?: string;
	/** New words replace the clip's speech: the clip takes the result's length (fit «trim»); seconds into the clip it starts. */
	trimFrom?: number;
}

/**
 * "Audio only" in the Lipsync panel: the voice goes on an audio track under the clip (its own sound muted if asked),
 * captions from the voice's word timings if asked — the picture is untouched. Free, one ⌘Z.
 */
export function voiceOnly(editor: EditorCore, projectId: string, clipId?: string | null) {
	const clip = clipFor(editor, clipId);
	const key = keyFor(editor, projectId, clip?.elementId ?? clipId);
	const draft = store().draft(key);
	const asset = draft.speech ? editor.media.getAssets().find((a) => a.id === draft.speech!.mediaId) : undefined;
	if (!clip || !asset) {
		toast.error(clip ? "Voice the text first" : "Select the clip on the timeline");
		return;
	}
	if (draft.voice === "timeline") {
		toast.error("This voice is already on the timeline. Use Lipsync for the face.");
		return;
	}
	// A dub keeps the original's timing (starts where the person starts talking, fitted to how long they talk).
	const timing = draft.dub && draft.dub.text === draft.speech?.text && draft.dub.at != null && draft.dub.span ? { at: draft.dub.at, span: draft.dub.span } : null;
	const place = timing ? { ...dubPlacement({ clipAt: clip.at, voiceSeconds: asset.duration ?? draft.speech?.seconds ?? 5, timing }), at: timing.at } : undefined;
	const words = draft.voice !== "file" && draft.captions ? draft.speech?.words : undefined;
	const captions = words?.length ? wordsToCues(place ? placeWords(words, place.rate) : words, place ? place.start : clip.at) : undefined;
	const placed = placeVoiceUnder(editor, asset, clip, draft.muteOriginal, captions, place, draft.placed);
	store().patch(key, { placed: [...(draft.placed ?? []), placed].slice(-20) });
	store().pin(projectId, clip.elementId);
	const what = [draft.muteOriginal ? "the clip is muted" : place ? "the original speech is quieter" : "", place && place.rate !== 1 ? "timed to the original speech" : "", captions?.length ? "captions added" : ""].filter(Boolean).join(", ");
	toast.success(`The voice is under the clip${what ? ` — ${what}` : ""}`, {
		description: "⌘Z puts everything back",
		action: { label: "Undo", onClick: () => editor.command.undo() },
	});
}

export async function lipsync(
	editor: EditorCore,
	projectId: string,
	resume?: { jobId: string; startedAt: number; meta: LipsyncMeta },
	opts: { fresh?: boolean; resumed?: boolean; clipId?: string | null; maxUsd?: number; seed?: number; guidance?: number } = {},
): Promise<Run | undefined> {
	const clipId = opts.clipId ?? resume?.meta.clip?.elementId;
	const plan = lipsyncPlan(editor, projectId, clipId);
	const { draft, clip: shown, range, piece: marked, sent, videoSeconds, speech, fit, place } = plan;
	const key = resume?.meta.key ?? keyFor(editor, projectId, shown?.elementId ?? clipId);
	// A clip that shows a version is lipsynced again from its original footage (the new version joins the same list).
	const clip = shown ? originalOf(editor, projectId, shown) : null;
	const model = chosenModel(key, draft.speech?.seconds);
	// Only the piece that goes is sent, paid and replaced (In/Out, or as long as the speech). "Use more video" takes the
	// footage right after it (past the clip's end when the whole clip goes: the source has more).
	const extra = fit === "extend" ? speech - videoSeconds + 0.04 : 0;
	const piece =
		clip && extra > 0
			? marked
				? { start: marked.start, end: snapToFrame(editor, Math.min(clip.at + clip.length, marked.end + extra)) }
				: { start: clip.at, end: clip.at + clip.length + extra }
			: sent;
	await operate(
		"lipsync",
		projectId,
		async (ctl) => {
			type R = { fileId: string; duration: number };
			if (resume) return completeLipsync(editor, projectId, await ctl.job<R>(() => studioApi.job(resume.jobId)), { key, ...resume.meta }, ctl);
			if (opts.resumed) ctl.local("Paid before the restart: resuming that job");
			if (!speechIsCurrent(key)) throw new Error("The text or voice changed — press Voice again first");
			let video: Segment;
			if (draft.source === "timeline") {
				video = (await timelineSegment(editor, ctl, range)).segment;
			} else {
				if (!clip) throw new Error("Select the video clip for lipsync on the timeline (click it)");
				video = await clipSegment(clip, ctl, piece);
			}
			const span =
				draft.source === "timeline" ? (range ?? wholeEdit(editor)) : piece ?? (clip ? { start: clip.at, end: clip.at + clip.length } : null);
			const audioFileId = await voiceFileFor(editor, key, ctl, span);
			ctl.local("Starting the lipsync");
			const meta: LipsyncMeta = {
				name: nextName(
					editor,
					draft.source === "timeline" || !clip
						? "Lipsync · edit"
						: `Lipsync · ${clip.asset.name.replace(/\.[^.]+$/, "")} · ${stamp(clip.start + (piece ? piece.start - clip.at : 0))}`,
					".mp4",
				),
				source: draft.source,
				beforeAssetId: clip?.asset.id,
				beforeStart: clip ? clip.start + (piece ? piece.start - clip.at : 0) : 0,
				clip: clip ? { trackId: clip.trackId, elementId: clip.elementId, at: clip.at, length: clip.length } : null,
				piece,
				range,
				replace: place !== "above",
				place,
				muteOriginal: draft.muteOriginal,
				words: draft.captions && draft.speech?.words?.length ? draft.speech.words : null,
				silent: draft.voice === "timeline",
				sceneId: editor.scenes.getActiveSceneOrNull()?.id,
				model: model.title,
				key,
				// new words replace the clip's speech: the whole clip goes, the result stands where it started
				...(fit === "trim" && draft.source === "clip" && clip && sent ? { trimFrom: sent.start - clip.at } : {}),
			};
			const r = await ctl.job<R>(
				() => studioApi.startLipsync({ video, audioFileId, model: model.id, fit: serverFit(fit), fresh: opts.fresh, ...(opts.maxUsd != null ? { maxUsd: opts.maxUsd } : {}), ...(opts.seed != null ? { seed: opts.seed } : {}), ...(opts.guidance != null ? { guidance: opts.guidance } : {}), ...kieOptions(model.id, draft) }),
				{ ...meta },
			);
			await completeLipsync(editor, projectId, r, meta, ctl);
		},
		resume?.startedAt,
		key,
	);
	return store().clipRuns[`lipsync|${key}`];
}

/**
 * The podcast's one button (rule J): the new words are voiced in the clip's own voice, then the clip speaks them — one
 * run for the clip, its stages visible, one slot of the three. The voice is skipped when it is already made.
 */
export async function speakAndLipsync(editor: EditorCore, projectId: string, clipId: string, opts: { fresh?: boolean; agreedUsd?: number; seed?: number; guidance?: number } = {}): Promise<Run | undefined> {
	const key = draftKey(projectId, clipId);
	let maxUsd: number | undefined;
	if (!speechIsCurrent(key)) {
		const v = await voiceover(editor, projectId, undefined, { clipId, chain: true });
		if (!v?.done || !speechIsCurrent(key)) {
			chainSlots.get(key)?.();
			chainSlots.delete(key);
			return v;
		}
		// the press agreed to an estimate: the lipsync of the real voice may cost what is left of it, never more (the
		// server plans it and stops before sending anything above — errorKey lipsync.over_limit)
		if (opts.agreedUsd != null) maxUsd = Math.max(0, opts.agreedUsd - (v.job?.cost ?? 0));
	}
	return lipsync(editor, projectId, undefined, { clipId, fresh: opts.fresh, maxUsd, seed: opts.seed, guidance: opts.guidance });
}

/** lip5: the run key of a clip's sample (its own run: its progress, stop and error, never the clip's lipsync). */
export const sampleKey = (key: string) => `${key}#sample`;

/**
 * A sample before the whole (rule E): the server lipsyncs only the hardest ~3 s of what the run would send (the same
 * piece, sound and model, `mode: "sample"`) and the answer plays in the panel — nothing is placed, no undo step. A job
 * like any other: progress, stop, an error in one line, picked up again after a quit (resumePaid).
 */
export async function lipsyncSample(editor: EditorCore, projectId: string, clipId?: string | null, resume?: { jobId: string; startedAt: number; meta: Record<string, unknown> }, opts: { sampleModel?: string } = {}): Promise<Run | undefined> {
	const plan = lipsyncPlan(editor, projectId, clipId);
	const { draft, clip: shown, sent, fit } = plan;
	const key = (resume?.meta.owner as string | undefined) ?? keyFor(editor, projectId, shown?.elementId ?? clipId);
	const skey = sampleKey(key);
	const clip = shown ? originalOf(editor, projectId, shown) : null;
	const model = chosenModel(key, draft.speech?.seconds);
	await operate(
		"lipsync",
		projectId,
		async (ctl) => {
			type R = { fileId: string; duration: number; cost?: number; sample?: { from: number; to: number; model: string } };
			let r: R;
			let before = { beforeAssetId: resume?.meta.beforeAssetId as string | undefined, beforeStart: Number(resume?.meta.beforeStart) || 0 };
			if (resume) r = await ctl.job<R>(() => studioApi.job(resume.jobId));
			else {
				if (!speechIsCurrent(key)) throw new Error("The text or voice changed — press Voice again first");
				if (!clip) throw new Error("Select the video clip for lipsync on the timeline (click it)");
				const piece = sent ?? { start: clip.at, end: clip.at + clip.length };
				const video = await clipSegment(clip, ctl, piece);
				const audioFileId = await voiceFileFor(editor, key, ctl, piece);
				before = { beforeAssetId: clip.asset.id, beforeStart: video.start };
				ctl.local("Starting the lipsync");
				r = await ctl.job<R>(() => studioApi.startLipsync({ video, audioFileId, model: model.id, fit: serverFit(fit), mode: "sample", ...(opts.sampleModel ? { sampleModel: opts.sampleModel } : {}), ...kieOptions(model.id, draft) }), { sample: true, sampleModel: opts.sampleModel, owner: key, clipId: shown?.elementId, ownerDraft: { ...draft, placed: undefined }, ...before });
			}
			store().updateRun("lipsync", { done: "Sample ready", local: undefined, sample: { fileId: r.fileId, from: r.sample?.from ?? 0, to: r.sample?.to ?? r.duration, model: r.sample?.model ?? model.id, cost: r.cost, ...before } }, skey);
		},
		resume?.startedAt,
		skey,
	);
	return store().clipRuns[`lipsync|${skey}`];
}

/** How many lipsyncs are in flight or waiting, every clip (the header's chip counts them too). */
export const lipsyncsInFlight = () => runningLipsyncs(store()).length;

async function completeLipsync(editor: EditorCore, projectId: string, r: { fileId: string; duration: number }, meta: LipsyncMeta, ctl: Ctl) {
	const { name, source, piece, range } = meta;
	const key = meta.key ?? draftKey(projectId, meta.clip?.elementId);
	const finish = (kind: RunKind, text: string) => store().updateRun(kind, { done: text, local: undefined }, key);
	ctl.local("Adding the result to the project");
	const kept = (r as { kept?: KeptOriginal[] }).kept ?? [];
	const file = await studioApi.fetchFile(r.fileId, name, "video/mp4");
	const asset = await importToMedia(editor, file, projectId);
	if (!isActiveProject(editor, projectId)) {
		finish("lipsync", `Done: ${name} was added to Media of the project you started the lipsync in.`);
		return;
	}
	// Another timeline opened while it ran: back to the one it was made on (it went onto whichever was open).
	if (meta.sceneId && !editor.scenes.returnTo({ sceneId: meta.sceneId })) {
		finish("lipsync", `Done: ${name} was added to Media (its timeline was deleted).`);
		return;
	}
	const fresh = source === "clip" && meta.clip ? currentClipById(editor, meta.clip) : null;
	// what was selected before the result lands (the landing's own commands change the selection)
	const selectedBefore = editor.selection.getSelectedElements();
	const trim = meta.trimFrom != null && !!fresh && fresh.at === meta.clip?.at && fresh.length === meta.clip?.length;
	const at = source === "timeline" ? range?.start ?? 0 : trim ? fresh!.at : piece ? piece.start : fresh?.at ?? meta.clip?.at ?? 0;
	const captions = meta.words ? wordsToCues(meta.words, at) : undefined;
	const subs = captions?.length ? " with captions" : "";
	// A «Voice only» dub under the clip is replaced by this one (unless the lipsync speaks that very audio: silent).
	const under = fresh && !meta.silent ? voicesUnder(editor, fresh.elementId, store().draft(key).placed) : undefined;
	const place: LipPlace = meta.place ?? (meta.replace ? "replace" : "above");
	let landed: { trackId: string; elementId: string } | null = null;
	if (trim && fresh) {
		// New words replace the clip's speech: the clip takes the voice's length, the rest is trimmed off (one ⌘Z).
		landed = replaceSpeech(editor, fresh, meta.trimFrom ?? 0, asset, { captions, muted: meta.silent, under, place, muteSource: meta.muteOriginal });
		finish("lipsync", place === "above" ? `Done: ${name}${subs} is above the clip; the clip is trimmed to it and muted. ⌘Z brings it back.` : `Done: ${name}${subs} replaced the clip's speech; the rest of the clip is trimmed off. ⌘Z brings it back.`);
		store().pin(projectId, undefined);
	} else if (fresh && piece && fresh.at === meta.clip?.at && fresh.length === meta.clip?.length) {
		if (place === "above") {
			landed = placeAbove(editor, fresh, piece, asset, { muteSource: meta.muteOriginal, captions, muted: meta.silent, under });
			finish("lipsync", `Done: ${name}${subs} is on a new track above the clip${meta.muteOriginal ? " (the clip is muted under it)" : ""}. ⌘Z removes it.`);
		} else {
			landed = replaceRange(editor, fresh, piece, asset, captions, meta.silent, under, place);
			finish(
				"lipsync",
				place === "insert"
					? `Done: ${name}${subs} was inserted in place of the piece; what follows moved along. ⌘Z brings the original back.`
					: `Done: ${name}${subs} is in place of the piece; the rest of the clip follows it. ⌘Z brings the original back.`,
			);
		}
		store().pin(projectId, undefined);
	} else if (fresh && meta.replace && !piece) {
		replaceClip(editor, fresh, asset, captions, meta.silent, under);
		store().pin(projectId, undefined);
		finish("lipsync", `Done: ${name}${subs} replaced the clip. ⌘Z brings the original back.`);
	} else {
		// On top of the edit: the clip under it is muted when asked, so the old voice isn't heard twice.
		const under = source === "clip" && fresh && meta.muteOriginal ? [{ trackId: fresh.trackId, elementId: fresh.elementId }] : undefined;
		placeResult(editor, asset, at, { muteOriginal: source === "timeline" && meta.muteOriginal && !range, mute: under, captions, muted: meta.silent, over: fresh ?? undefined });
		finish("lipsync", `Done: ${name}${subs} was added on top of the ${source === "clip" ? "clip" : "edit"}${under ? " (the clip is muted)" : ""}. ⌘Z removes it.`);
	}
	if (kept.length) {
		const run = store().clipRuns[`lipsync|${key}`] ?? store().runs.lipsync;
		if (run?.done) {
			store().updateRun(
				"lipsync",
				{ done: `${run.done} The original face was kept in ${kept.length === 1 ? "1 place" : `${kept.length} places`} (${[...new Set(kept.map((k) => k.reason))].join(", ")}).` },
				key,
			);
		}
	}
	// A piece lipsynced again (its clip already shows a version) joins that piece's list, not a new one.
	const all = store().versions;
	const known = Object.keys(all).find((k) => k.startsWith(`${projectId}|`) && all[k].some((v) => v.assetId === meta.beforeAssetId));
	const pieceKey = known ?? versionKey(projectId, meta.beforeAssetId, meta.beforeStart ?? 0);
	store().addVersion(pieceKey, {
		assetId: asset.id,
		name,
		model: meta.model ?? "",
		createdAt: Date.now(),
		length: asset.duration ?? r.duration,
		cost: (r as { cost?: number }).cost,
	});
	store().updateRun(
		"lipsync",
		{
			resultAt: at,
			result: {
				assetId: asset.id,
				beforeAssetId: meta.beforeAssetId,
				beforeStart: meta.beforeStart ?? 0,
				length: asset.duration ?? r.duration,
				replaced: !!(fresh && place !== "above"),
				kept: kept.map((k) => ({ ...k, from: at + k.from, to: at + k.to })),
				elementId: landed?.elementId,
			},
		},
		key,
	);
	// The result clip carries the clip's draft (its words, sound, model): selected, it shows them, «free · made before».
	if (landed) {
		const from = store().draft(key);
		store().patch(draftKey(projectId, landed.elementId), { ...from, offset: 0 });
	}
	// lip3: the clip it landed as carries the takes (original = take 0) and what its lips follow now (stale marks)
	if (source === "clip") recordTake(editor, { projectId, key: pieceKey, originalId: meta.beforeAssetId, offset: meta.beforeStart ?? 0, assetId: asset.id, sourceElementId: meta.clip?.elementId, elementId: landed?.elementId });
	// The result is highlighted on the timeline (selected: the panel shows it and its versions now) — only when the user
	// is not working on another clip meanwhile (several clips run at once).
	if (landed && (!selectedBefore.length || selectedBefore.some((x) => x.elementId === meta.clip?.elementId))) editor.selection.setSelectedElements({ elements: [landed] });
}

// MARK: Resume after a window reload

let resumed = false;

/** Re-attaches to paid jobs that were running when the window reloaded, so their results still land. */
export function resumePendingJobs(editor: EditorCore) {
	if (resumed) return;
	resumed = true;
	void (async () => {
		// the jobs IndexedDB kept (a kill −9 can lose localStorage's newest writes), with the drafts they were made from
		const kept = await loadPendingDurable().catch(() => ({}) as Record<string, PendingJob>);
		const known = store().pending;
		const merged = { ...kept, ...known };
		if (Object.keys(merged).length !== Object.keys(known).length) useStudioStore.setState({ pending: merged });
		for (const job of Object.values(merged)) {
			const meta = job.meta as { key?: string; draft?: Record<string, unknown> };
			if (meta.key && meta.draft && !store().drafts[meta.key]?.speech) store().patch(meta.key, meta.draft);
		}
		resumeAll(editor);
	})();
}

function resumeAll(editor: EditorCore) {
	for (const job of Object.values(store().pending)) {
		if (Date.now() - job.startedAt > 6 * 3600_000) {
			store().removePending(job.jobId);
			continue;
		}
		if (job.kind === "fragment") void resumeFragment(editor, job);
		else if (job.kind === "voiceover" || job.kind === "lipsync") void resumePaid(editor, job);
	}
}

/**
 * A voice or lipsync job that was running when the window went away. The server still has it: its result is picked up. The
 * server was restarted (⌘Q, a crash) and forgot it: the same step runs again and comes back to the paid request the server
 * holds on disk for 3 hours (fal/server.ts, studio/server/pipeline.ts) — nothing is charged twice. It used to end as
 * «Lipsync failed: Job not found» with the paid job alive at fal (check-flow A7, 06.11).
 */
async function resumePaid(editor: EditorCore, job: PendingJob) {
	const meta = job.meta as { clip?: { elementId?: string } | null; clipId?: string; key?: string; chain?: boolean };
	// The clip the job was for (the selection is empty after a relaunch): by its id, whatever is selected.
	const clipId = meta.clip?.elementId ?? meta.clipId ?? (meta.key?.split("|")[1] || undefined);
	const known = await studioApi.job(job.jobId).then(() => true).catch((e: Error) => !/not found|no longer known|restarted/i.test(e.message));
	// lip5: a sample comes back to its panel (never to the timeline); a server that forgot it runs it again — the paid
	// request is held on disk, nothing is charged twice
	if ((job.meta as { sample?: boolean }).sample) {
		const m = job.meta as Record<string, unknown>;
		// the clip's own draft (its sound) as it was at the press: a kill −9 can lose the newest localStorage writes
		const owner = m.owner as string | undefined;
		if (owner && m.ownerDraft && !store().drafts[owner]?.speech) store().patch(owner, m.ownerDraft as Parameters<ReturnType<typeof store>["patch"]>[1]);
		if (known) return lipsyncSample(editor, job.projectId, m.clipId as string | undefined, job as never);
		store().removePending(job.jobId);
		if (editor.project.getActiveOrNull()?.metadata.id !== job.projectId) return;
		return lipsyncSample(editor, job.projectId, m.clipId as string | undefined, undefined, { sampleModel: m.sampleModel as string | undefined });
	}
	const then = async (v: Run | undefined) => {
		// a «voice → lipsync» run picked up after a restart goes on to its lipsync
		if (job.kind === "voiceover" && meta.chain && v?.done && clipId) await lipsync(editor, job.projectId, undefined, { clipId });
	};
	if (known) {
		if (job.kind === "voiceover") return then(await voiceover(editor, job.projectId, job as never));
		return lipsync(editor, job.projectId, job as never);
	}
	store().removePending(job.jobId);
	if (editor.project.getActiveOrNull()?.metadata.id !== job.projectId) return;
	if (clipId) store().pin(job.projectId, clipId);
	if (job.kind === "voiceover") return then(await voiceover(editor, job.projectId, undefined, { resumed: true, clipId, chain: meta.chain }));
	return lipsync(editor, job.projectId, undefined, { resumed: true, clipId });
}

/** 0:03 */
const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The clip may have moved while the lipsync ran; find it again by id. */
function currentClipById(editor: EditorCore, clip: { trackId: string; elementId: string } | null): ClipRef | null {
	if (!clip) return null;
	const saved = editor.selection.getSelectedElements();
	const track = editor.timeline.getTrackById({ trackId: clip.trackId });
	if (!track?.elements.some((e) => e.id === clip.elementId)) return null;
	editor.selection.setSelectedElements({ elements: [{ trackId: clip.trackId, elementId: clip.elementId }] });
	const fresh = currentClip(editor);
	editor.selection.setSelectedElements({ elements: saved });
	return fresh;
}

// MARK: YouTube fragment

export interface FragmentArgs {
	url: string;
	start: number;
	end: number;
	title: string;
	full?: boolean;
}

let lastFragmentFailure = "";
/** Why the last YouTube download did not land ("Cancelled" when it was stopped). */
export const fragmentError = () => lastFragmentFailure;

/** The name the server gives the piece (pipeline.ts startFragment), so its placeholder sorts where the item lands. */
function pieceName({ title, start, end, full }: FragmentArgs): string {
	const base = (title || "YouTube").replace(/[/\\:@]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
	const fmt = (s: number) => {
		const t = Math.round(s);
		return `${Math.floor(t / 60)}.${String(t % 60).padStart(2, "0")}`;
	};
	return `${full ? base : `${base} ${fmt(start)}-${fmt(end)}`}.mp4`;
}

/** The share of a server job that is done: its finished stages and the running one's own figure. */
function jobFraction(j: JobState): number {
	const n = j.stages.length || 1;
	let done = 0;
	for (const st of j.stages) done += st.status === "done" ? 1 : st.status === "running" ? Math.max(0, Math.min(1, st.progress ?? 0)) : 0;
	return Math.min(1, done / n);
}

/** The server's result file, read with its progress (a whole long video is a big file). */
async function fetchWithProgress(id: string, name: string, onProgress: (f: number) => void, signal: AbortSignal): Promise<File> {
	const res = await fetch(studioApi.fileUrl(id), { signal });
	if (!res.ok || !res.body) return studioApi.fetchFile(id, name, "video/mp4");
	const total = Number(res.headers.get("content-length")) || 0;
	const reader = res.body.getReader();
	const parts: Uint8Array[] = [];
	let got = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
		got += value.byteLength;
		if (total) onProgress(Math.min(1, got / total));
	}
	return new File(parts as BlobPart[], name, { type: "video/mp4" });
}

/**
 * A YouTube (or any link's) piece into Media. Its item is there at once — grey, the still of the chosen piece, the
 * percent on it — and fills with colour as it downloads; at 100 % the real item takes its place (the same id, the same
 * spot). Stop: the × on it. A failure stays there, dimmed, with a retry glyph. Several run side by side. Resolves when
 * it landed (true) or did not (false; `fragmentError()` says why).
 */
export async function downloadFragment(
	editor: EditorCore,
	projectId: string,
	args: FragmentArgs,
	opts: {
		/** Kept for callers; the download shows on its Media item now, never in a toast. */
		dialogOpen?: () => boolean;
		still?: PendingMedia["still"];
		/** The item's id (a retry keeps its place). */
		assetId?: string;
		/** A download that was running when the window reloaded. */
		resume?: { jobId: string; startedAt: number };
	} = {},
): Promise<boolean> {
	const assetId = opts.assetId ?? generateUUID();
	const id = `youtube:${assetId}`;
	// Durable (src/jobs/durable.ts): on disk while it runs; a kill brings it back on its item, retryable.
	const resume = { type: "youtube", projectId, args, still: opts.still, assetId };
	const abort = new AbortController();
	let serverId = opts.resume?.jobId;
	const startedAt = opts.resume?.startedAt ?? Date.now();
	const retry = args.url
		? () => {
				jobCenter.remove(id);
				void downloadFragment(editor, projectId, args, { still: opts.still, assetId });
			}
		: undefined;
	jobCenter.start({
		id,
		kind: "youtube",
		title: args.title || "YouTube",
		tab: "media",
		startedAt,
		resume: opts.resume ? { ...resume, serverJobId: opts.resume.jobId } : resume,
		place: {
			media: {
				assetId,
				projectId,
				name: pieceName(args),
				type: "video",
				origin: "source",
				still: opts.still,
				duration: args.full ? undefined : Math.max(0, args.end - args.start),
			},
		},
		cancel: () => {
			abort.abort();
			if (serverId) void studioApi.cancel(serverId);
		},
	});
	const stopped = () => new DOMException("cancelled", "AbortError");
	try {
		if (!serverId) {
			const first = await studioApi.startFragment(args);
			serverId = first.id;
			if (abort.signal.aborted) {
				void studioApi.cancel(first.id);
				throw stopped();
			}
			// Remembered across a window reload: the piece still lands, in its place.
			jobCenter.update(id, { resume: { ...resume, serverJobId: first.id } });
		}
		// The download itself is 90 % of the bar; reading the file into the editor the rest.
		jobCenter.update(id, { progress: 0 });
		// the piece's real first frame replaces the YouTube still as soon as the server has it (CRAFT.md §1)
		let preview: string | undefined;
		const end = await followJob(serverId, (j) => {
			const shot = j.stages.find((st) => st.detail?.startsWith("preview:"))?.detail?.slice(8);
			const job = shot && !preview ? useJobsStore.getState().jobs.find((x) => x.id === id) : undefined;
			if (shot && job?.place?.media) {
				preview = shot;
				jobCenter.update(id, { place: { ...job.place, media: { ...job.place.media, still: studioApi.fileUrl(shot) } } });
			}
			jobCenter.update(id, { progress: 0.9 * jobFraction(j) });
		});
		if (abort.signal.aborted || end.status === "cancelled") throw stopped();
		if (end.status === "failed") throw new Error(end.error || "The video didn't download");
		const r = end.result as { fileId: string; name: string };
		const file = await fetchWithProgress(r.fileId, r.name, (f) => jobCenter.update(id, { progress: 0.9 + 0.07 * f }), abort.signal);
		jobCenter.update(id, { progress: 0.97, cancel: undefined });
		await importToMedia(editor, file, projectId, "source", assetId);
		void fetch(studioApi.fileUrl(r.fileId), { method: "DELETE", headers: { "X-Studio": "1" } }); // the editor keeps its own copy
		if (preview) void fetch(studioApi.fileUrl(preview), { method: "DELETE", headers: { "X-Studio": "1" } });
		jobCenter.finish(id, r.name);
		lastFragmentFailure = "";
		return true;
	} catch (error) {
		if (abort.signal.aborted || (error as Error)?.name === "AbortError") {
			lastFragmentFailure = "Cancelled";
			jobCenter.cancelled(id);
			return false;
		}
		lastFragmentFailure = (error as Error)?.message || "The video didn't download";
		jobCenter.fail(id, lastFragmentFailure);
		if (retry) jobCenter.update(id, { retry });
		return false;
	}
}

type FragmentResume = { projectId: string; args: FragmentArgs; still?: PendingMedia["still"]; assetId: string; serverJobId?: string };
registerResumer("youtube", {
	resume: (r) => {
		const m = r.resume as unknown as FragmentResume;
		void import("@/core").then(({ EditorCore }) =>
			downloadFragment(EditorCore.getInstance(), m.projectId, m.args, {
				still: m.still,
				assetId: m.assetId,
				resume: m.serverJobId ? { jobId: m.serverJobId, startedAt: r.startedAt } : undefined,
			}),
		);
	},
	retry: (r) => {
		const m = r.resume as unknown as FragmentResume;
		void import("@/core").then(({ EditorCore }) => downloadFragment(EditorCore.getInstance(), m.projectId, m.args, { still: m.still, assetId: m.assetId }));
	},
});

/** A YouTube download that was running when the window reloaded (kept by the old pending list): its item comes back where it was and lands. */
async function resumeFragment(editor: EditorCore, job: PendingJob) {
	const m = (job.meta ?? {}) as Partial<FragmentArgs> & { assetId?: string; still?: PendingMedia["still"] };
	await downloadFragment(
		editor,
		job.projectId,
		{ url: m.url ?? "", start: m.start ?? 0, end: m.end ?? 0, title: m.title ?? "YouTube", full: m.full },
		{ still: m.still, assetId: m.assetId, resume: { jobId: job.jobId, startedAt: job.startedAt } },
	);
}

// MARK: Captions from the voice-over (exact word timings from the TTS — no speech recognition needed)

/** Adds captions for the current voice-over at the clip's position. Returns a message for the user. */
export function captionsFromVoice(editor: EditorCore, projectId: string): string {
	const speech = store().draft(projectId).speech;
	if (!speech?.words?.length) return "No word timings — voice the text again";
	const at = store().draft(projectId).source === "timeline" ? 0 : currentClip(editor)?.at ?? 0;
	const n = insertCaptions(editor, wordsToCues(speech.words, at));
	return n ? `Captions added: ${n} lines. ⌘Z removes them` : "No words for captions";
}

// MARK: AI text

export type ScriptAction = { kind: "write"; idea: string } | { kind: "improve" } | { kind: "fit" };

/** DeepSeek writes/edits the words to speak; the old text comes back with "Restore previous" in the toast. */
export async function aiScript(
	projectId: string,
	action: ScriptAction,
	{ seconds, context, signal }: { seconds: number; context: string; signal?: AbortSignal },
): Promise<void> {
	const before = store().draft(projectId).text;
	const { text } = await studioApi.script({ action, current: before.trim(), seconds, context }, signal);
	if (signal?.aborted) return;
	store().patch(projectId, { text });
	toast.success(action.kind === "fit" ? "Text shortened to fit the video" : "Text ready", {
		action: before.trim() ? { label: "Restore previous", onClick: () => store().patch(projectId, { text: before }) } : undefined,
	});
}

// MARK: Lipsync versions

/**
 * Shows another version of a lipsynced piece: the clip that shows one of the piece's versions now gets the chosen one
 * (same place and length; one ⌘Z). Returns false when no clip on the timeline shows a version of this piece.
 */
export function applyLipVersion(editor: EditorCore, key: string, assetId: string): boolean {
	const versions = store().versions[key] ?? [];
	const ids = new Set(versions.map((v) => v.assetId));
	const chosen = editor.media.getAssets().find((a) => a.id === assetId);
	if (!chosen) {
		toast.error("This version is no longer in Media.");
		return false;
	}
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return false;
	for (const track of [tracks.main, ...tracks.overlay]) {
		for (const el of track.elements as Array<{ id: string; type: string; mediaId?: string }>) {
			if (el.type !== "video" || !el.mediaId || !ids.has(el.mediaId) || el.mediaId === assetId) continue;
			swapResultMedia(editor, track.id, el.id, chosen);
			// The version chip lights up in the panel: no toast (it would sit over the Lipsync button). ⌘Z swaps back.
			return true;
		}
	}
	toast.error("No clip shows this now. Drag it from Media → Results.");
	return false;
}

/**
 * The piece a lipsync or a voice clone works from: a clip that already shows a version of a piece goes back to that
 * piece's original footage (never a lipsync of a lipsync, never a clone of the new voice).
 */
export function originalOf(editor: EditorCore, projectId: string, clip: ClipRef): ClipRef {
	const all = store().versions;
	const key = Object.keys(all).find((k) => k.startsWith(`${projectId}|`) && all[k].some((v) => v.assetId === clip.asset.id));
	if (!key) return clip;
	const [, assetId, tenths] = key.split("|");
	const asset = editor.media.getAssets().find((a) => a.id === assetId);
	if (!asset?.file) return clip;
	return { ...clip, asset, start: Number(tenths) / 10 + clip.start };
}
