// The scene engine: pure functions on plain track data (no editor), each the whole of one undo step.
//
// A scene (in code a «chapter») is a span of the timeline. Moving, deleting, duplicating or copying one works on every
// track at once, by the same rules:
// - a clip that crosses a scene's edge is cut at the edge (the timeline's own split arithmetic, chapters/split.ts);
// - what lies inside the span on any track travels with it (captions, titles, stickers, effects, sounds, transitions
//   between clips inside it);
// - an element that covers the whole span and more (a music bed, an adjustment layer over the film) stays where it
//   is — except on the main track and the sounds locked to main clips, which are always cut (one long
//   recording with five scenes in it);
// - a transition whose two clips no longer touch is removed (dropOrphanTransitions);
// - locked tracks are never cut or moved.
// A move never changes the film's length.
import { dropOrphanTransitions } from "@/timeline/orphan-transitions";
import type { Bookmark, SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import type { TimelineTransition } from "@/transitions/types";
import type { MediaTime } from "@/wasm";
import { EDGE_EPS } from "./eps";
import { splitElementAt } from "./split";

/** What a scene edit changes: the open timeline's tracks and its markers (the scene marks among them). */
export interface ChapterState {
	tracks: SceneTracks;
	bookmarks: Bookmark[];
}

export interface Span {
	start: number;
	end: number;
}

export { EDGE_EPS };

type WithTransitions = { transitions?: TimelineTransition[] };
type AnyTrack = TimelineTrack & WithTransitions;
type IdMaker = () => string;

const end = (e: TimelineElement) => e.startTime + e.duration;
const mid = (e: TimelineElement) => e.startTime + e.duration / 2;
const asTime = (n: number) => Math.round(n) as MediaTime;

let counter = 0;
const defaultId: IdMaker = () =>
	typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ch-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function allTracks(tracks: SceneTracks): { track: AnyTrack; main: boolean }[] {
	return [
		...tracks.overlay.map((track) => ({ track: track as AnyTrack, main: false })),
		{ track: tracks.main as AnyTrack, main: true },
		...tracks.audio.map((track) => ({ track: track as AnyTrack, main: false })),
	];
}

function rebuild(tracks: SceneTracks, map: (track: AnyTrack, main: boolean) => AnyTrack): SceneTracks {
	return {
		overlay: tracks.overlay.map((t) => map(t as AnyTrack, false) as typeof t),
		main: map(tracks.main as AnyTrack, true) as SceneTracks["main"],
		audio: tracks.audio.map((t) => map(t as AnyTrack, false) as typeof t),
	};
}

/** Ids of the elements that are cut with the main track whatever their length: sounds locked to a main clip. */
function lockedToMain(tracks: SceneTracks): Set<string> {
	const ids = new Set<string>();
	const groups = new Set(tracks.main.elements.map((e) => e.groupId).filter(Boolean));
	for (const clip of tracks.main.elements) {
		for (const track of tracks.audio) {
			for (const sound of track.elements) {
				const sameSource = "mediaId" in clip && "mediaId" in sound && sound.mediaId === clip.mediaId;
				if ((sameSource && Math.abs(sound.startTime - clip.startTime) <= EDGE_EPS && Math.abs(end(sound) - end(clip)) <= EDGE_EPS) || (sound.groupId && groups.has(sound.groupId))) {
					ids.add(sound.id);
				}
			}
		}
	}
	return ids;
}

/**
 * A bed: covers the whole span and more (a music bed from 0, an adjustment layer over the film) and may stay whole —
 * never on the main track or locked to it.
 */
function bedOver(span: Span | null, tracks: SceneTracks) {
	const locked = lockedToMain(tracks);
	return (element: TimelineElement, main: boolean) => {
		if (!span || main || locked.has(element.id)) return false;
		const covers = element.startTime <= span.start + EDGE_EPS && end(element) >= span.end - EDGE_EPS;
		const more = element.startTime < span.start - EDGE_EPS || end(element) > span.end + EDGE_EPS;
		return covers && more;
	};
}

/**
 * Every element cut at every time in `times` that falls inside it (by more than EDGE_EPS), except the ones `keepWhole`
 * names and the locked tracks. A transition on the end cut of a clip that was cut follows its last piece.
 */
export function cutTracksAt({
	tracks,
	times,
	keepWhole = () => false,
	newId = defaultId,
}: {
	tracks: SceneTracks;
	times: number[];
	keepWhole?: (element: TimelineElement, main: boolean) => boolean;
	newId?: IdMaker;
}): SceneTracks {
	const cuts = [...new Set(times.map((t) => Math.round(t)))].sort((a, b) => a - b);
	return rebuild(tracks, (track, main) => {
		if (track.locked) return track;
		const lastPiece = new Map<string, string>();
		let changed = false;
		const elements = track.elements.flatMap((element) => {
			if (keepWhole(element, main)) return [element];
			const pieces: TimelineElement[] = [element];
			for (const t of cuts) {
				const last = pieces[pieces.length - 1];
				if (t > last.startTime + EDGE_EPS && t < end(last) - EDGE_EPS) {
					const [left, right] = splitElementAt(last, t, newId());
					pieces.splice(pieces.length - 1, 1, left, right);
				}
			}
			if (pieces.length > 1) {
				changed = true;
				lastPiece.set(element.id, pieces[pieces.length - 1].id);
			}
			return pieces;
		});
		if (!changed) return track;
		const transitions = track.transitions?.map((t) => (lastPiece.has(t.fromElementId) ? { ...t, fromElementId: lastPiece.get(t.fromElementId) as string } : t));
		return { ...track, elements, ...(track.transitions ? { transitions } : {}) } as AnyTrack;
	});
}

/** Every element moved by `delta(element)` (null = removed), kept in time order; locked tracks stay as they are. */
function shiftTracks(tracks: SceneTracks, delta: (element: TimelineElement, main: boolean) => number | null): SceneTracks {
	return rebuild(tracks, (track, main) => {
		if (track.locked) return track;
		let changed = false;
		const elements = track.elements.flatMap((element) => {
			const d = delta(element, main);
			if (d === null) {
				changed = true;
				return [];
			}
			if (d === 0) return [element];
			changed = true;
			return [{ ...element, startTime: asTime(element.startTime + d) }];
		});
		if (!changed) return track;
		elements.sort((a, b) => a.startTime - b.startTime);
		return { ...track, elements } as AnyTrack;
	});
}

const sortMarks = (bookmarks: Bookmark[]) => [...bookmarks].sort((a, b) => a.time - b.time);

/** Scene marks are frame-exact times; the first scene always has one at 0 once the scenes are edited. */
function withFirstMark(bookmarks: Bookmark[]): Bookmark[] {
	const chapters = bookmarks.filter((b) => b.chapter);
	if (chapters.length === 0 || chapters.some((b) => b.time <= EDGE_EPS)) return bookmarks;
	return sortMarks([{ time: 0 as MediaTime, chapter: true }, ...bookmarks]);
}

/** Film length: the end of the last element on any track. */
export function tracksLength(tracks: SceneTracks): number {
	let max = 0;
	for (const { track } of allTracks(tracks)) for (const e of track.elements) max = Math.max(max, end(e));
	return max;
}

/**
 * The scene `span` moved so that it starts at `to` (a scene edge outside it); the scenes between shift over by its
 * length. Nothing outside [min(start, to), max(end, to)) changes; the film keeps its length.
 */
export function moveRange({ state, span, to, newId = defaultId }: { state: ChapterState; span: Span; to: number; newId?: IdMaker }): ChapterState {
	if (to > span.start - EDGE_EPS && to < span.end + EDGE_EPS) return state;
	// The two neighbouring parts that trade places: [lo, pivot) and [pivot, hi).
	const [lo, pivot, hi] = to < span.start ? [to, span.start, span.end] : [span.start, span.end, to];
	const bed = bedOver(span, state.tracks);
	const cut = cutTracksAt({ tracks: state.tracks, times: [lo, pivot, hi], keepWhole: bed, newId });
	const shiftAt = (t: number) => (t >= lo && t < pivot ? hi - pivot : t >= pivot && t < hi ? lo - pivot : 0);
	const moved = shiftTracks(cut, (element, main) => (bed(element, main) ? 0 : shiftAt(mid(element))));
	const bookmarks = sortMarks(withFirstMark(state.bookmarks).map((b) => {
		const d = shiftAt(b.time);
		return d === 0 ? b : { ...b, time: asTime(b.time + d) };
	}));
	return { tracks: dropOrphanTransitions(moved), bookmarks };
}

/** The scene `span` removed from every track; what follows closes up. A bed over it is shortened by its length. */
export function removeRange({ state, span, newId = defaultId }: { state: ChapterState; span: Span; newId?: IdMaker }): ChapterState {
	const length = span.end - span.start;
	if (length <= 0) return state;
	const bed = bedOver(span, state.tracks);
	const cut = cutTracksAt({ tracks: state.tracks, times: [span.start, span.end], keepWhole: bed, newId });
	const shifted = shiftTracks(cut, (element, main) => {
		if (bed(element, main)) return 0;
		const m = mid(element);
		if (m >= span.start && m < span.end) return null;
		return m >= span.end ? -length : 0;
	});
	// Beds lose the scene's length from their tail (the music plays on without a jump and ends sooner).
	const tracks = rebuild(shifted, (track, main) => {
		if (track.locked || !track.elements.some((e) => bed(e, main))) return track;
		const elements = track.elements.map((e) => {
			if (!bed(e, main)) return e;
			const rate = "retime" in e && e.retime?.rate ? e.retime.rate : 1;
			return { ...e, duration: asTime(e.duration - length), trimEnd: asTime(e.trimEnd + length * rate) };
		});
		return { ...track, elements } as AnyTrack;
	});
	const bookmarks = sortMarks(
		withFirstMark(state.bookmarks).flatMap((b) => {
			if (b.time >= span.start && b.time < span.end) return [];
			return b.time >= span.end ? [{ ...b, time: asTime(b.time - length) }] : [b];
		}),
	);
	// The next scene's mark lands where the removed one started.
	return { tracks: dropOrphanTransitions(tracks), bookmarks };
}

/** A copy of the scene `span` right after it (new ids); what follows moves on by its length. Beds stay as they are. */
export function duplicateRange({ state, span, newId = defaultId }: { state: ChapterState; span: Span; newId?: IdMaker }): ChapterState {
	const length = span.end - span.start;
	if (length <= 0) return state;
	const bed = bedOver(span, state.tracks);
	const cut = cutTracksAt({ tracks: state.tracks, times: [span.start, span.end], keepWhole: bed, newId });
	const inside = (e: TimelineElement, main: boolean) => !bed(e, main) && mid(e) >= span.start && mid(e) < span.end;
	const groups = new Map<string, string>();
	const tracks = rebuild(cut, (track, main) => {
		if (track.locked) return track;
		const ids = new Map<string, string>();
		const copies: TimelineElement[] = [];
		const elements = track.elements.map((e) => {
			if (bed(e, main)) return e;
			if (inside(e, main)) {
				const id = newId();
				ids.set(e.id, id);
				const groupId = e.groupId ? (groups.get(e.groupId) ?? groups.set(e.groupId, newId()).get(e.groupId)) : undefined;
				copies.push({ ...e, id, startTime: asTime(e.startTime + length), ...(groupId ? { groupId } : {}) });
				return e;
			}
			return mid(e) >= span.end ? { ...e, startTime: asTime(e.startTime + length) } : e;
		});
		const all = [...elements, ...copies].sort((a, b) => a.startTime - b.startTime);
		const copiedTransitions = (track.transitions ?? [])
			.filter((t) => ids.has(t.fromElementId) && ids.has(t.toElementId))
			.map((t) => ({ ...t, id: newId(), fromElementId: ids.get(t.fromElementId) as string, toElementId: ids.get(t.toElementId) as string }));
		return {
			...track,
			elements: all,
			...(track.transitions ? { transitions: [...track.transitions, ...copiedTransitions] } : {}),
		} as AnyTrack;
	});
	const marks = withFirstMark(state.bookmarks);
	const bookmarks = sortMarks([
		...marks.map((b) => (b.time >= span.end ? { ...b, time: asTime(b.time + length) } : b)),
		...marks.filter((b) => b.time >= span.start && b.time < span.end).map((b) => ({ ...b, time: asTime(b.time + length) })),
	]);
	return { tracks: dropOrphanTransitions(tracks), bookmarks };
}

/** Only the scene `span`, cut out of every track (beds too) and moved to 0: a new timeline made of it. */
export function extractRange({ state, span, newId = defaultId }: { state: ChapterState; span: Span; newId?: IdMaker }): ChapterState {
	const cut = cutTracksAt({ tracks: state.tracks, times: [span.start, span.end], newId });
	const tracks = shiftTracks(cut, (e) => (mid(e) >= span.start && mid(e) < span.end ? -span.start : null));
	const bookmarks = state.bookmarks
		.filter((b) => b.time >= span.start && b.time < span.end)
		.map((b) => ({ ...b, time: asTime(b.time - span.start) }));
	return { tracks: dropOrphanTransitions(tracks), bookmarks: sortMarks(bookmarks) };
}
