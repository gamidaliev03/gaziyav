// CapCut's menu on an empty part of a track: «Close gap» (the gap under the pointer) and «Close all gaps» (every gap
// of that track). The clips after a gap move left by its length; one undo step.
import { TracksEditCommand } from "@/actions/tracks-edit-command";
import type { EditorCore } from "@/core";
import type { ImageElement, SceneTracks, TimelineTrack } from "@/timeline/types";
import type { MediaTime } from "@/wasm";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { generateUUID } from "@/utils/id";
import { removeRange } from "@/in-out/keep-range";
import { splitActiveSceneAt } from "@/in-out/slice";

type Element = TimelineTrack["elements"][number];

function sorted(track: TimelineTrack): Element[] {
	return [...track.elements].sort((a, b) => a.startTime - b.startTime);
}

/** The track's clips with the gap at `time` closed (null when `time` is not in a gap before a clip). */
export function closeGapAt(track: TimelineTrack, time: number): Element[] | null {
	const clips = sorted(track);
	let end = 0;
	for (let i = 0; i < clips.length; i++) {
		const clip = clips[i];
		if (time < clip.startTime) {
			if (time < end || clip.startTime <= end) return null;
			const shift = clip.startTime - end;
			return clips.map((c, k) => (k >= i ? { ...c, startTime: (c.startTime - shift) as MediaTime } : c));
		}
		end = Math.max(end, clip.startTime + clip.duration);
	}
	return null;
}

/** The track's clips back to back from the first one (null when there is no gap). */
export function closeAllGaps(track: TimelineTrack): Element[] | null {
	const clips = sorted(track);
	if (clips.length < 2) return null;
	let end = clips[0].startTime + clips[0].duration;
	let moved = false;
	const out = clips.map((clip, i) => {
		if (i === 0) return clip;
		if (clip.startTime > end) {
			moved = true;
			const next = { ...clip, startTime: end as MediaTime };
			end = end + clip.duration;
			return next;
		}
		end = Math.max(end, clip.startTime + clip.duration);
		return clip;
	});
	return moved ? out : null;
}

const allOf = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];

function withTrack(tracks: SceneTracks, trackId: string, elements: Element[]): SceneTracks {
	const put = <T extends TimelineTrack>(track: T): T => (track.id === trackId ? ({ ...track, elements } as T) : track);
	return { overlay: tracks.overlay.map(put), main: put(tracks.main), audio: tracks.audio.map(put) };
}

function apply(editor: EditorCore, trackId: string, change: (track: TimelineTrack) => Element[] | null): boolean {
	const before = editor.scenes.getActiveScene().tracks;
	const track = [before.main, ...before.overlay, ...before.audio].find((t) => t.id === trackId);
	if (!track) return false;
	const elements = change(track);
	if (!elements) return false;
	const after = withTrack(before, trackId, elements);
	editor.command.execute({ command: new TracksEditCommand({ before, after, noEngineRipple: true }) });
	return true;
}

export function closeTrackGapAt(editor: EditorCore, trackId: string, time: number): boolean {
	return apply(editor, trackId, (track) => closeGapAt(track, time));
}

export function closeTrackGaps(editor: EditorCore, trackId: string): boolean {
	return apply(editor, trackId, closeAllGaps);
}

// --- The gap clip (blind3 F6, 14.11) -----------------------------------------------------------------------------------
// Lift on the magnetic main row leaves a GAP CLIP where the clip was (Final Cut's «Replace with Gap»): a thing in the row
// that holds the time and shows nothing (the canvas, as a hole would) — never a refusal, and the magnet keeps no hole.
// It is a hidden picture of no file, marked `params.gap`: a picture belongs on the main row (moves, drops and placement
// take it there), it renders nothing (scene-builder skips hidden), has no sound, is never «offline» (no file named), and
// is selected, moved, trimmed to any length and ripple-deleted like any clip.

/** The name a gap clip carries (Russian: ru-polish3.ts). */
export const GAP_CLIP_NAME = "Gap";

export function isGapClip(element: { type: string; params?: Record<string, unknown> }): boolean {
	return element.type === "image" && element.params?.gap === true;
}

/** A gap clip over [start, start + duration). */
export function makeGapClip({ start, duration }: { start: number; duration: number }): ImageElement {
	const base = buildElementFromMedia({ mediaId: "", mediaType: "image", name: GAP_CLIP_NAME, duration: duration as MediaTime, startTime: start as MediaTime }) as Omit<ImageElement, "id">;
	return { ...base, id: generateUUID(), hidden: true, params: { ...base.params, gap: true } } as ImageElement;
}

/** The holes of the main track (from 0, between clips), in time order. */
export function mainHoles(track: TimelineTrack): Array<{ start: number; end: number }> {
	const holes: Array<{ start: number; end: number }> = [];
	let end = 0;
	for (const clip of sorted(track)) {
		if (clip.startTime > end) holes.push({ start: end, end: clip.startTime });
		end = Math.max(end, clip.startTime + clip.duration);
	}
	return holes;
}

/** The tracks with a gap clip in every hole of the main track (the same object when it has none). */
export function fillMainHoles(tracks: SceneTracks): SceneTracks {
	const holes = mainHoles(tracks.main);
	if (holes.length === 0) return tracks;
	const gaps = holes.map((hole) => makeGapClip({ start: hole.start, duration: hole.end - hole.start }));
	const elements = [...tracks.main.elements, ...gaps].sort((a, b) => a.startTime - b.startTime);
	return { ...tracks, main: { ...tracks.main, elements } };
}

/**
 * Lift (`;`, closeGap false) and Extract (`'`, closeGap true) of the In→Out range: one step. Lift on the magnetic main
 * row leaves a gap clip of the range's length on it (blind3 F6); Extract closes the row. False when nothing was there.
 */
export function liftOrExtractRange({ editor, range, closeGap }: { editor: EditorCore; range: { start: number; end: number }; closeGap: boolean }): boolean {
	const before = editor.scenes.getActiveScene().tracks;
	const cut = splitActiveSceneAt({ editor, times: [range.start, range.end] });
	let after = removeRange({ tracks: cut, range: range as never, closeGap });
	// a locked track keeps its clips as they were: not cut, not lifted, not moved
	const keep = <T extends TimelineTrack>(track: T): T => (track.locked === true ? ((allOf(before).find((t) => t.id === track.id) as T | undefined) ?? track) : track);
	after = { overlay: after.overlay.map(keep), main: keep(after.main), audio: after.audio.map(keep) };
	if (!closeGap && editor.command.isRippleEnabled && after.main.locked !== true) after = fillMainHoles(after);
	editor.command.execute({ command: new TracksEditCommand({ before, after, selection: [], noEngineRipple: true }) });
	return true;
}
