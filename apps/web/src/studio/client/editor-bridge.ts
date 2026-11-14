// Between the pipeline and the OpenCut editor: which clip is selected, and how results land in the project.
import { EditorCore } from "@/core";
import { AddTrackCommand, BatchCommand, type Command } from "@/commands";
import { DeleteElementsCommand, InsertElementCommand, UpdateElementsCommand } from "@/commands/timeline";
import { buildStyledCaptionElement } from "@/subtitles/build-subtitle-text-element";
import { getCaptionStyle, getDefaultCaptionStyleId } from "@/subtitles/styles";
import { useStudioStore } from "./studio-store";
import { getInOutRange } from "@/in-out/store";
import { frameRateToFloat } from "@/fps/utils";
import { processMediaAssets } from "@/media/processing";
import { storageService } from "@/services/storage/service";
import { generateUUID } from "@/utils/id";
import type { MediaAsset } from "@/media/types";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { generatedPlacement } from "./generated-placement";
import type { CreateTimelineElement, TimelineElement, TimelineTrack, VideoElement } from "@/timeline";
import { followersOf } from "@/motion/follow";
import type { Tracker } from "@/motion/types";
import { mediaTimeFromSeconds, mediaTimeToSeconds, type MediaTime } from "@/wasm";
import { DUB_DUCK_DB } from "@/assist/dub-timing";
import { coldShaders } from "@/effects/shader-cold";
import { LIBRARY_TRANSITIONS } from "@/transitions/definitions";
import { checkTimelineInvariants } from "@/timeline/invariants";
import { useTimelineStore } from "@/timeline/timeline-store";
import { openSettings, type SettingsSection } from "@/settings/settings-store";

export interface ClipRef {
	trackId: string;
	elementId: string;
	element: VideoElement;
	asset: MediaAsset;
	/** Where the clip's piece starts inside the media file, and how long it is (seconds). */
	start: number;
	length: number;
	/** Clip position on the timeline (seconds). */
	at: number;
}

const sec = (t: MediaTime | undefined) => (t == null ? 0 : mediaTimeToSeconds({ time: t }));

/**
 * The clip for lipsync: the selected video clip, else the one chosen earlier (pinned — clearing the timeline
 * selection doesn't lose it), else the only video on the timeline.
 */
export function currentClip(editor: EditorCore): ClipRef | null {
	const assets = editor.media.getAssets();
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return null;
	const all: Array<{ track: TimelineTrack; element: TimelineElement }> = [];
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio] as TimelineTrack[]) {
		for (const element of track.elements as TimelineElement[]) all.push({ track, element });
	}
	const selected = editor.selection.getSelectedElements();
	let pick = all.find(
		(x) => x.element.type === "video" && selected.some((s) => s.elementId === x.element.id),
	);
	const videos = all.filter((x) => x.element.type === "video");
	if (!pick) {
		const projectId = editor.project.getActiveOrNull()?.metadata.id ?? "";
		const pinned = useStudioStore.getState().pins[projectId];
		if (pinned) pick = videos.find((x) => x.element.id === pinned);
	}
	if (!pick && videos.length === 1) pick = videos[0];
	if (!pick) return null;
	return clipRefOf(pick.track, pick.element as VideoElement, assets);
}

function clipRefOf(track: TimelineTrack, element: VideoElement, assets: MediaAsset[]): ClipRef | null {
	const asset = assets.find((a) => a.id === element.mediaId);
	if (!asset) return null;
	const rate = element.retime?.rate ?? 1;
	return {
		trackId: track.id,
		elementId: element.id,
		element,
		asset,
		start: sec(element.trimStart),
		length: sec(element.duration) * rate,
		at: sec(element.startTime),
	};
}

/** A video clip by its element id, wherever it is on the open timeline (a run keeps its clip whatever is selected). */
export function clipById(editor: EditorCore, elementId: string | undefined | null): ClipRef | null {
	if (!elementId) return null;
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return null;
	for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
		const element = (track.elements as TimelineElement[]).find((e) => e.id === elementId);
		if (element?.type === "video") return clipRefOf(track, element as VideoElement, editor.media.getAssets());
	}
	return null;
}

/** The id of the video clip selected on the timeline right now (for pinning), if any. */
export function selectedVideoId(editor: EditorCore): string | undefined {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return undefined;
	const selected = new Set(editor.selection.getSelectedElements().map((s) => s.elementId));
	if (!selected.size) return undefined;
	for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
		for (const element of track.elements as TimelineElement[]) {
			if (element.type === "video" && selected.has(element.id)) return element.id;
		}
	}
	return undefined;
}

/** How many video clips the timeline has (0 → the panel offers to add one). */
export function videoClipCount(editor: EditorCore): number {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return 0;
	let n = 0;
	for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
		for (const element of track.elements as TimelineElement[]) if (element.type === "video") n++;
	}
	return n;
}

export function isActiveProject(editor: EditorCore, projectId: string): boolean {
	return editor.project.getActiveOrNull()?.metadata.id === projectId;
}

/**
 * Adds a file to the media of the project the job was started in. If the user has switched to another
 * project meanwhile, the file goes straight into the origin project's storage (it shows up when reopened).
 */
export async function importToMedia(
	editor: EditorCore,
	file: File,
	projectId?: string,
	origin: "source" | "result" = "result",
	/** The id its placeholder in Media shows under (src/jobs/components/pending-media.tsx). */
	id?: string,
): Promise<MediaAsset> {
	if (projectId && !isActiveProject(editor, projectId)) {
		const [processed] = await processMediaAssets({ files: [file] });
		if (!processed) throw new Error("The editor couldn't read the result file");
		const asset: MediaAsset = { ...processed, id: id ?? generateUUID(), origin };
		await storageService.saveMediaAsset({ projectId, mediaAsset: asset });
		return asset;
	}
	const project = editor.project.getActive();
	if (!project) throw new Error("No project is open");
	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) throw new Error("The editor couldn't read the result file");
	const asset = await editor.media.addMediaAsset({ projectId: project.metadata.id, asset: { ...processed, origin, id } });
	if (!asset) throw new Error("Not enough editor storage space — free some disk space and retry");
	return asset;
}

/**
 * A generated clip or picture on the timeline at `at` seconds (generated-placement.ts: under the titles and captions, on
 * the main track only where it lands as asked, `track: "new"` a new track): where it really landed — the start the
 * timeline gave it and its track — or null when the timeline refused it.
 */
export function placeGenerated(editor: EditorCore, asset: MediaAsset, at: number, o: { track?: string } = {}): { elementId: string; trackId: string; start: number; end: number; role: string; newTrack: boolean } | null {
	const tracks = editor.scenes.getActiveScene().tracks;
	const duration = mediaTimeFromSeconds({ seconds: asset.duration ?? 5 });
	const startTime = mediaTimeFromSeconds({ seconds: Math.max(0, at) });
	const before = new Set([tracks.main, ...tracks.overlay, ...tracks.audio].flatMap((t) => (t.elements as TimelineElement[]).map((e) => e.id)));
	const trackIds = new Set([tracks.main, ...tracks.overlay].map((t) => t.id));
	const element = buildElementFromMedia({ mediaId: asset.id, mediaType: asset.type, name: asset.name, duration, startTime });
	const slack = mediaTimeFromSeconds({ seconds: 0.5 / projectFps(editor) });
	editor.timeline.insertElement({ element, placement: generatedPlacement(tracks, startTime, duration, o.track, slack) });
	const now = editor.scenes.getActiveScene().tracks;
	const all = [{ t: now.main as TimelineTrack, role: "main video" }, ...now.overlay.map((t, i) => ({ t: t as TimelineTrack, role: `overlay ${i + 1} (top=1)` }))];
	for (const { t, role } of all) {
		const el = (t.elements as TimelineElement[]).find((e) => !before.has(e.id) && "mediaId" in e && e.mediaId === asset.id);
		if (el) return { elementId: el.id, trackId: t.id, start: sec(el.startTime), end: sec((el.startTime + el.duration) as MediaTime), role, newTrack: !trackIds.has(t.id) };
	}
	return null;
}

/** Puts an asset on the timeline at `at` seconds (on a free track). */
export function placeOnTimeline(editor: EditorCore, asset: MediaAsset, at: number) {
	const duration = mediaTimeFromSeconds({ seconds: asset.duration ?? 5 });
	const element = buildElementFromMedia({
		mediaId: asset.id,
		mediaType: asset.type,
		name: asset.name,
		duration,
		startTime: mediaTimeFromSeconds({ seconds: at }),
	});
	editor.timeline.insertElement({ element, placement: { mode: "auto" } });
}

/** The timeline In/Out range in seconds, when marked (I / O keys). */
export function inOutSeconds(editor: EditorCore): { start: number; end: number } | null {
	const r = getInOutRange({ duration: editor.timeline.getTotalDuration() });
	return r ? { start: sec(r.start as MediaTime), end: sec(r.end as MediaTime) } : null;
}

/**
 * The part of the clip inside In/Out (timeline seconds) — only that piece is sent, paid and replaced.
 * null when nothing is marked, the range misses the clip, or it covers the whole clip.
 */
const LIPSYNC_USES_CLIP_ONLY = true;

export function clipPiece(editor: EditorCore, clip: ClipRef): { start: number; end: number } | null {
	// Lipsync is a plugin on the selected clip exactly as trimmed (the user's rule); the timeline In/Out is not used.
	if (LIPSYNC_USES_CLIP_ONLY) return null;
	const r = inOutSeconds(editor);
	if (!r || (clip.element.retime?.rate ?? 1) !== 1) return null;
	const clipEnd = clip.at + clip.length;
	// On the frame grid, so the replaced piece lines up frame-exactly with its neighbours.
	const start = snapToFrame(editor, Math.max(r.start, clip.at));
	const end = snapToFrame(editor, Math.min(r.end, clipEnd));
	if (end - start < 0.3) return null;
	if (start <= clip.at + 0.02 && end >= clipEnd - 0.02) return null;
	return { start, end };
}

/** Seconds of the same footage right after the piece (or after the clip's trim end) — for "Use more video". */
export function roomAfter(clip: ClipRef, piece: { start: number; end: number } | null): number {
	if (piece) return Math.max(0, clip.at + clip.length - piece.end);
	return Math.max(0, (clip.asset.duration ?? 0) - (clip.start + clip.length));
}

/**
 * Replaces only the In/Out piece of the clip with the lipsync result: the clip is split around it (left part
 * trimmed, right part re-inserted after the result), captions added — all one ⌘Z.
 */
/**
 * Ripple after a replaced piece: every element (all tracks) that starts at or after `from` s moves by `delta` s, so a
 * longer result pushes the rest of the edit along and a shorter one pulls it up — sync across tracks kept. Null when
 * the lengths match (under half a frame). `except`: the clip being replaced.
 */
function rippleFrom(editor: EditorCore, from: number, delta: number, except: string): Command | null {
	if (Math.abs(delta) < 0.5 / projectFps(editor)) return null;
	const tracks = editor.scenes.getActiveScene().tracks;
	const updates: Array<{ trackId: string; elementId: string; patch: Partial<TimelineElement> }> = [];
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio] as TimelineTrack[]) {
		const els = (track.elements as TimelineElement[]).filter((el) => el.id !== except);
		const later = els.filter((el) => sec(el.startTime) >= from - 0.001);
		if (!later.length) continue;
		// A pull never runs into what is still there before `from` on this track (music or a caption across it):
		// the later ones come up as far as they can.
		let move = delta;
		if (delta < 0) {
			const firstLater = Math.min(...later.map((el) => sec(el.startTime)));
			const before = els.filter((el) => sec(el.startTime) < from - 0.001).map((el) => sec(el.startTime) + sec(el.duration));
			const floor = before.length ? Math.max(...before) : 0;
			move = Math.max(delta, Math.min(0, floor - firstLater));
		}
		if (Math.abs(move) < 0.001) continue;
		for (const el of later) updates.push({ trackId: track.id, elementId: el.id, patch: { startTime: mediaTimeFromSeconds({ seconds: Math.max(0, sec(el.startTime) + move) }) } as Partial<TimelineElement> });
	}
	return updates.length ? new UpdateElementsCommand({ updates }) : null;
}

/**
 * Another version of a lipsynced piece on the clip that shows one: its media, its whole length (the clips after it move
 * along, as on the first replacement), the clip's place and look kept. One ⌘Z.
 */
export function swapResultMedia(editor: EditorCore, trackId: string, elementId: string, asset: MediaAsset): boolean {
	const el = editor.timeline.getTrackById({ trackId })?.elements.find((e) => e.id === elementId) as VideoElement | undefined;
	if (!el) return false;
	const T = (s: number) => mediaTimeFromSeconds({ seconds: Math.max(0, s) });
	const total = wholeFrames(editor, asset.duration ?? sec(el.duration));
	const frame = 1 / projectFps(editor);
	const trimStart = Math.min(sec(el.trimStart), Math.max(0, total - frame));
	const length = Math.max(frame, total - trimStart);
	const delta = length - sec(el.duration);
	const update = new UpdateElementsCommand({
		updates: [{ trackId, elementId, patch: { mediaId: asset.id, name: asset.name, sourceDuration: T(total), trimStart: T(trimStart), trimEnd: T(0), duration: T(length) } as unknown as Partial<TimelineElement> }],
	});
	const ripple = rippleFrom(editor, sec(el.startTime) + sec(el.duration), delta, elementId);
	editor.command.execute({ command: new BatchCommand(withRipple([update], ripple, delta)) });
	return true;
}

/** The commands of a replacement with the ripple in the right order: a push first (room for the longer result), a pull last. */
function withRipple(commands: Command[], ripple: Command | null, delta: number): Command[] {
	if (!ripple) return commands;
	return delta > 0 ? [ripple, ...commands] : [...commands, ripple];
}

/** The result's length on the timeline: a frame or two longer than the piece (the model's rounding) is cut to the piece. */
function fitToPiece(editor: EditorCore, asset: MediaAsset, piece: { start: number; end: number }): number {
	const pieceLen = piece.end - piece.start;
	const whole = wholeFrames(editor, asset.duration ?? pieceLen);
	return whole > pieceLen && whole - pieceLen < 2.5 / projectFps(editor) ? pieceLen : whole;
}

/** Where a lipsync result goes (the Lipsync panel's «Where»). */
export type LipPlace = "replace" | "above" | "insert";

/**
 * The result in place of `piece` of the clip (the parts of the clip before and after the piece stay as they were).
 * "replace": the result keeps the piece's start; a longer result pushes what follows only by its overflow (never over
 * another clip), a shorter one leaves the rest where it was. "insert": what follows moves by the difference either
 * way. On the magnetic main track (ripple on) nothing may leave a gap, so it works as "insert" there.
 * Returns the result's element id (to highlight it).
 */
export function replaceRange(
	editor: EditorCore,
	clip: ClipRef,
	piece: { start: number; end: number },
	asset: MediaAsset,
	captions?: CaptionCue[],
	/** The result plays silent: its voice is the audio under it on the timeline. */
	muted = false,
	under?: VoicesUnder,
	place: Exclude<LipPlace, "above"> = "insert",
): { trackId: string; elementId: string } {
	const T = (s: number) => mediaTimeFromSeconds({ seconds: Math.max(0, s) });
	const el = under?.last ? ({ ...clip.element, params: under.last.params } as VideoElement) : clip.element;
	const clipEnd = clip.at + clip.length;
	const resultLen = fitToPiece(editor, asset, piece);
	const commands: Command[] = [];
	if (under?.elements.length) commands.push(new DeleteElementsCommand({ elements: under.elements }));
	if (piece.start > clip.at + 0.01) {
		commands.push(
			new UpdateElementsCommand({
				updates: [
					{
						trackId: clip.trackId,
						elementId: clip.elementId,
						patch: {
							duration: T(piece.start - clip.at),
							trimEnd: T(sec(el.trimEnd) + (clipEnd - piece.start)),
							params: { ...el.params, fadeOut: SEAM },
						} as Partial<TimelineElement>,
					},
				],
			}),
		);
	} else {
		commands.push(new DeleteElementsCommand({ elements: [{ trackId: clip.trackId, elementId: clip.elementId }] }));
	}
	// On the timeline the piece ends with the clip at the latest ("Use more video" sends footage past its end).
	const pieceLen = Math.min(piece.end, clipEnd) - piece.start;
	const tracks = editor.scenes.getActiveScene().tracks;
	const magnetic = editor.command.isRippleEnabled && clip.trackId === tracks.main.id;
	const mode = magnetic ? "insert" : place;
	// The rest of the clip always follows the result straight away. What comes after it on the timeline moves by the
	// whole difference (insert, either way), or (replace) only as far as it must so that nothing is covered.
	const grow = resultLen - pieceLen;
	let shift = grow;
	if (mode === "replace") {
		const track = editor.timeline.getTrackById({ trackId: clip.trackId });
		const next = ((track?.elements ?? []) as TimelineElement[])
			.filter((e) => e.id !== clip.elementId && sec(e.startTime) >= clipEnd - 0.001)
			.map((e) => sec(e.startTime));
		const nextStart = next.length ? Math.min(...next) : Number.POSITIVE_INFINITY;
		shift = Math.max(0, clipEnd + grow - nextStart);
	}
	const insertResult = new InsertElementCommand({
		element: resultElement(el, asset, piece.start, resultLen, clip.start + (piece.start - clip.at), muted),
		placement: { mode: "explicit", trackId: clip.trackId },
	});
	commands.push(insertResult);
	if (piece.end < clipEnd - 0.01) {
		const { id: _id, ...rest } = el;
		commands.push(
			new InsertElementCommand({
				element: {
					...rest,
					startTime: T(piece.start + resultLen),
					duration: T(clipEnd - piece.end),
					trimStart: T(sec(el.trimStart) + (piece.end - clip.at)),
					trimEnd: el.trimEnd,
					params: { ...el.params, fadeIn: SEAM },
				} as unknown as CreateTimelineElement,
				placement: { mode: "explicit", trackId: clip.trackId },
			}),
		);
	}
	commands.push(...captionCommands(editor, captions, piece.start + resultLen));
	// The whole clip went (nothing of it stays before the result): layers that followed its trackers follow the result.
	if (piece.start <= clip.at + 0.01) commands.push(...refollow(editor, clip.elementId, insertResult.getElementId(), (el as { trackers?: Tracker[] }).trackers));
	editor.command.execute({ command: new BatchCommand(withRipple(commands, rippleFrom(editor, Math.min(piece.end, clipEnd), shift, clip.elementId), shift)) });
	return { trackId: clip.trackId, elementId: insertResult.getElementId() };
}

/**
 * New words replace the clip's speech (lipa, 14.11, the lead's decision): the clip takes the result's length — the result
 * stands where the clip started, made from the clip's footage from `from` s in, and the rest of the clip is trimmed off,
 * so nothing of the old words is heard after the new line. What follows moves by the magnet's rule (the magnetic main
 * track and «Insert» close up; «In place» off the magnet leaves the gap). «Above»: the result on a new track over the clip,
 * which is trimmed to the same length and muted under it. One ⌘Z brings it all back. Returns the result's element.
 */
export function replaceSpeech(
	editor: EditorCore,
	clip: ClipRef,
	/** Seconds into the clip where the sent piece starts. */
	from: number,
	asset: MediaAsset,
	{ captions, muted = false, under, place = "insert", muteSource = true }: { captions?: CaptionCue[]; muted?: boolean; under?: VoicesUnder; place?: LipPlace; muteSource?: boolean } = {},
): { trackId: string; elementId: string } {
	const T = (s: number) => mediaTimeFromSeconds({ seconds: Math.max(0, s) });
	const el = under?.last ? ({ ...clip.element, params: under.last.params } as VideoElement) : clip.element;
	const clipEnd = clip.at + clip.length;
	const offset = Math.max(0, Math.min(from, clip.length));
	const resultLen = Math.min(fitToPiece(editor, asset, { start: 0, end: clip.length - offset }), wholeFrames(editor, asset.duration ?? clip.length));
	const tracks = editor.scenes.getActiveScene().tracks;
	const magnetic = editor.command.isRippleEnabled && clip.trackId === tracks.main.id;
	const commands: Command[] = [];
	if (under?.elements.length) commands.push(new DeleteElementsCommand({ elements: under.elements }));
	let result: { trackId: string; elementId: string };
	if (place === "above") {
		const overlayIndex = tracks.overlay.findIndex((t) => t.id === clip.trackId);
		const addTrack = new AddTrackCommand({ type: "video", index: overlayIndex >= 0 ? overlayIndex : tracks.overlay.length });
		const insert = new InsertElementCommand({ element: resultElement(clip.element, asset, clip.at, resultLen, clip.start + offset, muted), placement: { mode: "explicit", trackId: addTrack.getTrackId() } });
		const rate = el.retime?.rate ?? 1;
		commands.push(
			addTrack,
			insert,
			new UpdateElementsCommand({
				updates: [
					{
						trackId: clip.trackId,
						elementId: clip.elementId,
						patch: {
							duration: T(resultLen / rate),
							trimStart: T(sec(el.trimStart) + offset),
							trimEnd: T(sec(el.trimEnd) + Math.max(0, clip.length - offset - resultLen)),
							params: { ...el.params, ...(muteSource ? { muted: true } : {}) },
						} as Partial<TimelineElement>,
					},
				],
			}),
		);
		result = { trackId: addTrack.getTrackId(), elementId: insert.getElementId() };
	} else {
		const insert = new InsertElementCommand({ element: resultElement(el, asset, clip.at, resultLen, clip.start + offset, muted), placement: { mode: "explicit", trackId: clip.trackId } });
		commands.push(new DeleteElementsCommand({ elements: [{ trackId: clip.trackId, elementId: clip.elementId }] }), insert);
		commands.push(...refollow(editor, clip.elementId, insert.getElementId(), (el as { trackers?: Tracker[] }).trackers));
		result = { trackId: clip.trackId, elementId: insert.getElementId() };
	}
	commands.push(...captionCommands(editor, captions, clip.at + resultLen));
	// the magnet closes the gap the trim left (and «Insert» does anywhere); «In place» off the magnet keeps it
	const delta = clip.at + resultLen - clipEnd;
	const ripple = magnetic || place === "insert" ? rippleFrom(editor, clipEnd, delta, clip.elementId) : null;
	editor.command.execute({ command: new BatchCommand(withRipple(commands, ripple, delta)) });
	return result;
}

/**
 * «Above the clip»: the result on a new track right above the clip's, at the piece's start, with the clip's look; the
 * clip itself stays where it is and, when asked, is muted for as long as the result speaks (only that part: the clip
 * is split there), so two voices never sound together. One ⌘Z. Returns the result's element id.
 */
export function placeAbove(
	editor: EditorCore,
	clip: ClipRef,
	piece: { start: number; end: number },
	asset: MediaAsset,
	{ muteSource = true, captions, muted = false, under }: { muteSource?: boolean; captions?: CaptionCue[]; muted?: boolean; under?: VoicesUnder } = {},
): { trackId: string; elementId: string } {
	const T = (s: number) => mediaTimeFromSeconds({ seconds: Math.max(0, s) });
	const tracks = editor.scenes.getActiveScene().tracks;
	const resultLen = fitToPiece(editor, asset, piece);
	// Track order: overlay[0] is the top one, the main track sits under the last overlay.
	const overlayIndex = tracks.overlay.findIndex((t) => t.id === clip.trackId);
	const addTrack = new AddTrackCommand({ type: "video", index: overlayIndex >= 0 ? overlayIndex : tracks.overlay.length });
	const insert = new InsertElementCommand({
		element: resultElement(clip.element, asset, piece.start, resultLen, clip.start + (piece.start - clip.at), muted),
		placement: { mode: "explicit", trackId: addTrack.getTrackId() },
	});
	const commands: Command[] = [addTrack, insert];
	// A «Voice only» voice under the clip goes: the result speaks the new words (never two voices).
	if (under?.elements.length) commands.push(new DeleteElementsCommand({ elements: under.elements }));
	if (muteSource) {
		const el = clip.element;
		const clipEnd = clip.at + clip.length;
		const from = Math.max(clip.at, piece.start);
		const to = Math.min(clipEnd, piece.start + resultLen);
		const quiet = { ...el.params, muted: true };
		if (from <= clip.at + 0.01 && to >= clipEnd - 0.01) {
			commands.push(new UpdateElementsCommand({ updates: [{ trackId: clip.trackId, elementId: clip.elementId, patch: { params: quiet } as Partial<TimelineElement> }] }));
		} else {
			// Split: the part under the result is a muted copy; before and after it the clip plays as it did.
			const { id: _id, ...rest } = el;
			const part = (start: number, end: number, params: VideoElement["params"]) =>
				new InsertElementCommand({
					element: { ...rest, startTime: T(start), duration: T(end - start), trimStart: T(sec(el.trimStart) + (start - clip.at)), trimEnd: T(sec(el.trimEnd) + (clipEnd - end)), params } as unknown as CreateTimelineElement,
					placement: { mode: "explicit", trackId: clip.trackId },
				});
			commands.push(new DeleteElementsCommand({ elements: [{ trackId: clip.trackId, elementId: clip.elementId }] }));
			if (from > clip.at + 0.01) commands.push(part(clip.at, from, el.params));
			commands.push(part(from, to, quiet));
			if (to < clipEnd - 0.01) commands.push(part(to, clipEnd, el.params));
		}
	}
	commands.push(...captionCommands(editor, captions, piece.start + resultLen));
	editor.command.execute({ command: new BatchCommand(commands) });
	return { trackId: addTrack.getTrackId(), elementId: insert.getElementId() };
}

export interface CaptionCue {
	text: string;
	startTime: number;
	duration: number;
}

/** Caption commands on a new text track; cues never run past `until` (the end of the result video). */
function captionCommands(editor: EditorCore, cues: CaptionCue[] | undefined, until: number, source?: string): Command[] {
	const fitted = (cues ?? [])
		.filter((c) => c.startTime < until - 0.05)
		.map((c) => ({ ...c, duration: Math.min(c.duration, until - c.startTime) }));
	if (!fitted.length) return [];
	const addTrack = new AddTrackCommand({ type: "text", index: 0 });
	const trackId = addTrack.getTrackId();
	const canvasSize = editor.project.getActive().settings.canvasSize;
	// Same look as the Captions tab: the style chosen there (Hormozi by default).
	const style = getCaptionStyle(getDefaultCaptionStyleId());
	return [
		addTrack,
		...fitted.map(
			(caption, index) =>
				new InsertElementCommand({
					placement: { mode: "explicit", trackId },
					element: (() => {
						const element = buildStyledCaptionElement({ index, caption, canvasSize, style });
						return source ? { ...element, params: { ...element.params, "caption.source": source } } : element;
					})(),
				}),
		),
	];
}

/** Captions alone (from the voice-over), as one ⌘Z. */
export function insertCaptions(editor: EditorCore, cues: CaptionCue[], until = Number.POSITIVE_INFINITY, source?: string): number {
	const commands = captionCommands(editor, cues, until, source);
	if (commands.length) {
		editor.command.execute({ command: new BatchCommand(commands) });
		editor.selection.clearSelection();
	}
	return Math.max(0, commands.length - 1);
}

/**
 * Replaces the clip with the lipsynced video at the same place, with captions if given — one BatchCommand,
 * so one ⌘Z brings the original back.
 */
/** Short audio crossfade at every cut the lipsync makes (seconds) — no click at the seam. */
const SEAM = 0.03;

export function projectFps(editor: EditorCore): number {
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	const f = fps ? frameRateToFloat(fps) : 30;
	return Number.isFinite(f) && f > 0 ? f : 30;
}

/** Nearest frame boundary of the project (seconds). */
export function snapToFrame(editor: EditorCore, t: number): number {
	const fps = projectFps(editor);
	return Math.round(t * fps) / fps;
}

/** Whole frames only, so the result never ends on a half frame (no black flash before the next part). */
function wholeFrames(editor: EditorCore, seconds: number): number {
	const fps = projectFps(editor);
	return Math.max(1, Math.floor(seconds * fps + 0.001)) / fps;
}

/**
 * The original clip's trackers in the result's own seconds: the result file starts at `from` s of the old media and
 * runs `length` s at normal speed, so every sample moves by −from (samples outside the piece are dropped). The face
 * stays where it was in the frame, so the boxes still fit; the tracker ids stay, so layers that follow them keep going.
 */
function trackersForResult(trackers: Tracker[] | undefined, from: number, length: number): Tracker[] | undefined {
	if (!trackers?.length) return undefined;
	const out = trackers
		.map((t) => ({
			...t,
			samples: t.samples
				.filter((s) => s[0] >= from - 0.05 && s[0] <= from + length + 0.05)
				.map(([time, ...rest]) => [Math.max(0, Math.round((time - from) * 10000) / 10000), ...rest]),
		}))
		.filter((t) => t.samples.length > 0);
	return out.length ? out : undefined;
}

/**
 * The lipsync result as a timeline element that keeps the original clip's look: same transform, opacity,
 * effects and masks, so it sits exactly where the original was; tiny audio fades at both seams.
 * Not carried over: speed (the result plays at normal speed), the Reverse link (the result is its own picture, so
 * turning Reverse "off" can never swap it for the old file) and the source length. Trackers are re-timed to the result.
 */
function resultElement(original: VideoElement, asset: MediaAsset, at: number, length: number, from: number, muted = false): CreateTimelineElement {
	const {
		id: _id,
		retime: _retime,
		sourceDuration: _sd,
		reversed: _reversed,
		trackers,
		...look
	} = original as VideoElement & { sourceDuration?: unknown };
	return {
		...look,
		mediaId: asset.id,
		name: asset.name,
		startTime: mediaTimeFromSeconds({ seconds: at }),
		duration: mediaTimeFromSeconds({ seconds: length }),
		trimStart: mediaTimeFromSeconds({ seconds: 0 }),
		trimEnd: mediaTimeFromSeconds({ seconds: Math.max(0, (asset.duration ?? length) - length) }),
		trackers: trackersForResult(trackers, from, length),
		params: { ...original.params, muted, fadeIn: SEAM, fadeOut: SEAM },
	} as unknown as CreateTimelineElement;
}

/** Layers that followed a tracker of the old clip follow the same tracker on the result (same ⌘Z). */
function refollow(editor: EditorCore, oldId: string, newId: string, kept: Tracker[] | undefined): Command[] {
	const ids = new Set((kept ?? []).map((t) => t.id));
	const updates = followersOf(editor.scenes.getActiveScene().tracks, oldId)
		.filter((f) => !!f.element.follow && ids.has(f.element.follow.trackerId))
		.map((f) => ({
			trackId: f.trackId,
			elementId: f.element.id,
			patch: { follow: { ...f.element.follow!, clipId: newId } } as Partial<TimelineElement>,
		}));
	return updates.length ? [new UpdateElementsCommand({ updates })] : [];
}

export function replaceClip(editor: EditorCore, clip: ClipRef, asset: MediaAsset, captions?: CaptionCue[], muted = false, under?: VoicesUnder) {
	// A «Voice only» voice under the clip goes too: the result speaks the new words itself (with the clip's own sound).
	const remove = new DeleteElementsCommand({ elements: [{ trackId: clip.trackId, elementId: clip.elementId }, ...(under?.elements ?? [])] });
	const original = under?.last ? ({ ...clip.element, params: under.last.params } as VideoElement) : clip.element;
	const element = resultElement(original, asset, clip.at, wholeFrames(editor, asset.duration ?? clip.length), clip.start, muted);
	const insert = new InsertElementCommand({ element, placement: { mode: "explicit", trackId: clip.trackId } });
	const subs = captionCommands(editor, captions, clip.at + (asset.duration ?? clip.length));
	const follow = refollow(editor, clip.elementId, insert.getElementId(), (element as { trackers?: Tracker[] }).trackers);
	// The result goes in after the captions, so it is the selected clip afterwards; then its followers are re-pointed.
	// A longer or shorter result moves the rest of the edit along (ripple).
	const delta = wholeFrames(editor, asset.duration ?? clip.length) - clip.length;
	const ripple = rippleFrom(editor, clip.at + clip.length, delta, clip.elementId);
	editor.command.execute({ command: new BatchCommand(withRipple([remove, ...subs, insert, ...follow], ripple, delta)) });
}

/**
 * Puts a result above the montage at `at` (new track), optionally muting the original video clips so the
 * new voice isn't doubled, plus captions — all one ⌘Z.
 */
export function placeResult(
	editor: EditorCore,
	asset: MediaAsset,
	at: number,
	{
		muteOriginal = false,
		mute,
		captions,
		muted = false,
		over,
	}: { muteOriginal?: boolean; mute?: Array<{ trackId: string; elementId: string }>; captions?: CaptionCue[]; muted?: boolean; over?: ClipRef } = {},
) {
	const tracks = editor.scenes.getActiveScene().tracks;
	const mutes: Array<{ trackId: string; elementId: string; patch: Partial<TimelineElement> }> = [];
	for (const m of mute ?? []) {
		const element = editor.timeline.getTrackById({ trackId: m.trackId })?.elements.find((e) => e.id === m.elementId);
		if (element) mutes.push({ ...m, patch: { params: { ...element.params, muted: true } } as Partial<TimelineElement> });
	}
	if (muteOriginal) {
		for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
			for (const element of track.elements as TimelineElement[]) {
				if (element.type !== "video") continue;
				mutes.push({
					trackId: track.id,
					elementId: element.id,
					patch: { params: { ...element.params, muted: true } } as Partial<TimelineElement>,
				});
			}
		}
	}
	// Over a clip: the result keeps that clip's look (position, scale, effects), so it covers it exactly, a track above.
	const element = over
		? (resultElement(over.element, asset, at, wholeFrames(editor, asset.duration ?? 5), over.start + (at - over.at), muted) as ReturnType<typeof buildElementFromMedia>)
		: buildElementFromMedia({
				mediaId: asset.id,
				mediaType: asset.type,
				name: asset.name,
				duration: mediaTimeFromSeconds({ seconds: asset.duration ?? 5 }),
				startTime: mediaTimeFromSeconds({ seconds: at }),
			});
	if (muted) element.params = { ...element.params, muted: true };
	const commands: Command[] = [];
	if (mutes.length) commands.push(new UpdateElementsCommand({ updates: mutes }));
	commands.push(...captionCommands(editor, captions, at + (asset.duration ?? 5)));
	commands.push(new InsertElementCommand({ element, placement: { mode: "auto" } })); // last: the result stays selected
	editor.command.execute({ command: new BatchCommand(commands) });
}

/** "Audio only": the voice goes under the selected clip (its own sound muted if asked) — one ⌘Z, no lipsync. */
/**
 * The voice on an audio track under the clip, one ⌘Z. A "Voice only" dub (`dub`) keeps the original's timing: it starts
 * where the person starts talking and is fitted to how long they talk (dub-timing.ts); the original speech is muted
 * (`muteClip`) or, for a dub, ducked under it.
 */
/** What one voice-over put under a clip (its voice and captions) and the clip's sound before it: the next one under that
 * clip replaces it (never a second voice) and mutes or ducks from the same level. */
export interface PlacedVoice {
	clipId: string;
	elements: Array<{ trackId: string; elementId: string }>;
	params: TimelineElement["params"];
}

function elementRefs(editor: EditorCore) {
	const t = editor.scenes.getActiveScene().tracks;
	return [t.main, ...t.overlay, ...t.audio].flatMap((track) => track.elements.map((e) => ({ trackId: track.id, elementId: e.id })));
}

export interface VoicesUnder {
	/** On the timeline now. */
	elements: Array<{ trackId: string; elementId: string }>;
	/** The newest of them: the clip's sound before it. */
	last?: PlacedVoice;
}

/** The «Voice only» voices put under this clip that are on the timeline now. */
export function voicesUnder(editor: EditorCore, clipId: string, placed: PlacedVoice[] = []): VoicesUnder {
	const now = new Set(elementRefs(editor).map((r) => r.elementId));
	const mine = placed.filter((v) => v.clipId === clipId);
	return {
		elements: mine.flatMap((v) => v.elements.filter((r) => now.has(r.elementId))),
		last: [...mine].reverse().find((v) => v.elements.some((r) => now.has(r.elementId))),
	};
}

export function placeVoiceUnder(
	editor: EditorCore,
	asset: MediaAsset,
	clip: ClipRef,
	muteClip: boolean,
	captions?: CaptionCue[],
	dub?: { at: number; start: number; rate: number; duration: number },
	earlier: PlacedVoice[] = [],
): PlacedVoice {
	const seconds = asset.duration ?? 5;
	const element = buildElementFromMedia({
		mediaId: asset.id,
		mediaType: asset.type,
		name: asset.name,
		duration: mediaTimeFromSeconds({ seconds: dub ? dub.duration : seconds }),
		startTime: mediaTimeFromSeconds({ seconds: dub ? dub.start : clip.at }),
	});
	if (dub && dub.rate !== 1 && element.type === "audio") {
		element.retime = { rate: dub.rate, maintainPitch: true };
		element.sourceDuration = mediaTimeFromSeconds({ seconds });
	}
	// The voices this clip already has under it (any of them: ⌘Z may have brought an older one back) go, in this step.
	const { elements: replaced, last } = voicesUnder(editor, clip.elementId, earlier);
	const before = last ? last.params : clip.element.params;
	const commands: Command[] = [];
	if (replaced.length) commands.push(new DeleteElementsCommand({ elements: replaced }));
	const params: Record<string, number | boolean> | null = muteClip ? { muted: true } : dub ? { volume: Number(before?.volume ?? 0) + DUB_DUCK_DB } : null;
	if (params || last) {
		commands.push(
			new UpdateElementsCommand({
				updates: [{ trackId: clip.trackId, elementId: clip.elementId, patch: { params: { ...before, ...params } } as Partial<TimelineElement> }],
			}),
		);
	}
	commands.push(...captionCommands(editor, captions, (dub ? dub.start + dub.duration : clip.at + seconds)));
	commands.push(new InsertElementCommand({ element, placement: { mode: "auto" } }));
	const existing = new Set(elementRefs(editor).map((r) => r.elementId));
	editor.command.execute({ command: new BatchCommand(commands) });
	// The clip stays the selected one, so the panel keeps showing it.
	editor.selection.setSelectedElements({ elements: [{ trackId: clip.trackId, elementId: clip.elementId }] });
	return { clipId: clip.elementId, elements: elementRefs(editor).filter((r) => !existing.has(r.elementId)), params: before };
}

/** Unique, readable result names: "Voice · clip.mp3", "Lipsync · clip · 0:03.mp4", then "… 2.mp4". */
export function nextName(editor: EditorCore, base: string, ext: string): string {
	const names = new Set(editor.media.getAssets().map((a) => a.name));
	if (!names.has(`${base}${ext}`)) return `${base}${ext}`;
	for (let i = 2; ; i++) {
		const n = `${base} ${i}${ext}`;
		if (!names.has(n)) return n;
	}
}

// Lets the app's self-tests check how results land in the project without paying for a real lipsync.
if (typeof window !== "undefined") {
	(window as unknown as { __studioBridge: unknown }).__studioBridge = {
		editor: () => EditorCore.getInstance(),
		/** Timeline ticks in one second (tests read element times in seconds). */
		ticksPerSecond: () => mediaTimeFromSeconds({ seconds: 1 }) as unknown as number,
		currentClip,
		importToMedia,
		replaceClip,
		replaceRange,
		clipPiece,
		placeOnTimeline,
		// Timeline drag test (gaziyav-timeline-dnd.mjs): captions from cues, as Auto captions puts them.
		insertCaptions,
		// Lipsync walk (lipsync-walk.mjs): how loud one media's clips sound in the timeline's own mix from…to (RMS; 0 = silent)
		// — «nothing of the old words after the new line», heard rather than read off the clips.
		mediaLoudness: async (mediaId: string, from: number, to: number) => {
			const { createTimelineAudioBuffer } = await import("@/media/audio");
			const ed = EditorCore.getInstance();
			const tracks = ed.scenes.getActiveScene().tracks;
			const keep = <T extends { elements: unknown[] }>(t: T): T => ({ ...t, elements: (t.elements as Array<{ mediaId?: string }>).filter((e) => e.mediaId === mediaId) });
			const only = { ...tracks, main: keep(tracks.main), overlay: tracks.overlay.map(keep), audio: tracks.audio.map(keep) } as typeof tracks;
			const rate = 16000;
			const buffer = await createTimelineAudioBuffer({ tracks: only, mediaAssets: ed.media.getAssets(), duration: Math.max(to, 0.1), sampleRate: rate, stage: "mix" });
			if (!buffer) return 0;
			const data = buffer.getChannelData(0);
			let sum = 0;
			let n = 0;
			for (let i = Math.max(0, Math.floor(from * rate)); i < Math.min(data.length, Math.ceil(to * rate)); i++) {
				sum += data[i] * data[i];
				n++;
			}
			return n ? Math.sqrt(sum / n) : 0;
		},
		// Lipsync placement test (gaziyav-lipsync-place.mjs): the main-track magnet on or off, as its timeline button does.
		setMagnet: (on: boolean) => useTimelineStore.setState({ rippleEditingEnabled: on }),
		// The same test: CapCut's Linkage on or off (what lies over a main clip goes with it), as its timeline button does.
		setLinkage: (on: boolean) => useTimelineStore.setState({ linkageEnabled: on }),
		// Settings as the Mac menu opens it (no pointer event on the page): gaziyav-fixfinal.mjs, the tasks popover (D8).
		openSettings: (section?: SettingsSection) => openSettings(section),
		// Export quality test (export-quality.mjs): drop the kept originals, as a project from before them loads.
		forgetEditingOriginals: () => EditorCore.getInstance().media.forgetEditingOriginals(),
		// Speed test of a transition's first drop (transition-cold.mjs): these transitions' shaders as on a Mac that
		// never compiled them. Returns how many changed.
		coldTransitions: (names: string[] | null, tag: number) =>
			coldShaders({ ids: LIBRARY_TRANSITIONS.filter((d) => !names || names.includes(d.name)).map((d) => d.type), tag }),
		// Timeline invariants in test runs (core/managers/timeline-audit.ts): what failed after the steps so far (and how
		// many ⌘Z had nothing exact to compare with), and the rules on the timeline as it is now.
		invariantViolations: () => {
			const scope = globalThis as { __gaziyavInvariantViolations?: unknown[]; __gaziyavInvariantDrift?: number };
			return { violations: [...(scope.__gaziyavInvariantViolations ?? [])], drift: scope.__gaziyavInvariantDrift ?? 0 };
		},
		checkInvariants: () => {
			const ed = EditorCore.getInstance();
			const scene = ed.scenes.getActiveSceneOrNull();
			return scene ? checkTimelineInvariants({ tracks: scene.tracks, magnet: ed.command.isRippleEnabled, selection: ed.selection.getSnapshot() }) : [];
		},
	};
}
