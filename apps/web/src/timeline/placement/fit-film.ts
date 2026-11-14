// ends (library/client.ts cutToVideoEnd: «Music fitted to the video's length») carries `params.fitFilm`; after every
// step its end — and so its fade-out, which is measured from the end — moves to the film's new end: a faster clip, a
// trim, a delete, an insert. Never black under music, never music cut hard (blind1 S1-1: after a 2× speed the reel
// ended with 3.5 s of black under the song). Moving the song, trimming its head or its tail by hand ends the relation.
// The history manager runs this after each step and gives the songs back exactly on ⌘Z (core/managers/commands.ts).
import type { SceneTracks, TimelineElement } from "@/timeline";
import { mediaTime } from "@/wasm";

export const FIT_FILM = "fitFilm";

type Audio = Extract<TimelineElement, { type: "audio" }>;

export const isFittedToFilm = (element: TimelineElement): element is Audio => element.type === "audio" && element.params?.[FIT_FILM] === true;

/** Where the picture ends (the main track and the tracks above it), in ticks. */
export function filmEnd(tracks: SceneTracks): number {
	let end = 0;
	for (const track of [tracks.main, ...tracks.overlay]) {
		for (const element of track.elements as TimelineElement[]) end = Math.max(end, element.startTime + element.duration);
	}
	return end;
}

const rateOf = (element: Audio): number | null => (!element.retime ? 1 : element.retime.mode === "curve" ? null : element.retime.rate);

/** The fitted songs as they are now: what ⌘Z gives back (id → the fields this rule changes). */
export type FitSnapshot = Map<string, { duration: number; trimEnd: number; fitted: boolean }>;

export function snapshotFitted(tracks: SceneTracks | null): FitSnapshot {
	const out: FitSnapshot = new Map();
	if (!tracks) return out;
	for (const track of tracks.audio) {
		for (const element of track.elements as TimelineElement[]) {
			if (isFittedToFilm(element)) out.set(element.id, { duration: element.duration, trimEnd: element.trimEnd, fitted: true });
		}
	}
	return out;
}

/**
 * The fitted songs a step touched by hand (moved, to another track or in time; its head or its tail trimmed while the
 * film's end stayed): the relation ends for them.
 */
export function endedByHand(before: SceneTracks | null, after: SceneTracks | null): string[] {
	if (!before || !after) return [];
	const was = new Map<string, { track: string; element: Audio }>();
	for (const track of before.audio) {
		for (const element of track.elements as TimelineElement[]) if (isFittedToFilm(element)) was.set(element.id, { track: track.id, element });
	}
	if (was.size === 0) return [];
	const sameFilm = filmEnd(before) === filmEnd(after);
	const ended: string[] = [];
	for (const track of after.audio) {
		for (const element of track.elements as TimelineElement[]) {
			const old = was.get(element.id);
			if (!old || element.type !== "audio") continue;
			const moved = old.track !== track.id || old.element.startTime !== element.startTime || old.element.trimStart !== element.trimStart;
			const tail = old.element.duration !== element.duration && sameFilm;
			if (moved || tail || element.params?.[FIT_FILM] !== true) ended.push(element.id);
		}
	}
	return ended;
}

function patchAudio(tracks: SceneTracks, patch: (element: Audio, trackIndex: number) => Audio | null): SceneTracks {
	let changed = false;
	const audio = tracks.audio.map((track, trackIndex) => {
		let trackChanged = false;
		const elements = (track.elements as TimelineElement[]).map((element) => {
			if (element.type !== "audio") return element;
			const next = patch(element, trackIndex);
			if (!next || next === element) return element;
			trackChanged = true;
			return next;
		});
		if (!trackChanged) return track;
		changed = true;
		return { ...track, elements } as typeof track;
	});
	return changed ? { ...tracks, audio } : tracks;
}

/** The relation ends for these songs (their flag goes; their length stays as it is). */
export function dropFit(tracks: SceneTracks, ids: readonly string[]): SceneTracks {
	if (ids.length === 0) return tracks;
	const set = new Set(ids);
	return patchAudio(tracks, (element) => {
		if (!set.has(element.id) || element.params?.[FIT_FILM] === undefined) return null;
		const { [FIT_FILM]: _gone, ...params } = element.params;
		return { ...element, params } as Audio;
	});
}

/**
 * Every fitted song ends where the film ends: never past the end of its file, never into the next sound on its track,
 * never shorter than a tick past its start. Returns the same object when nothing moves.
 */
export function followFilm(tracks: SceneTracks): SceneTracks {
	const end = filmEnd(tracks);
	if (end <= 0) return tracks;
	return patchAudio(tracks, (element, trackIndex) => {
		if (!isFittedToFilm(element)) return null;
		// a locked track takes no edit, this rule's either (tlc2 A1, tlmove rule 3; undofix 14.11: the engine fuzz found a
		// fitted song on a locked track shortened by a trim of the film)
		if (tracks.audio[trackIndex].locked === true) return null;
		const rate = rateOf(element);
		if (rate === null || rate <= 0) return null;
		let target = end - element.startTime;
		if (target < 1) return null;
		// the file's own end
		target = Math.min(target, element.duration + Math.floor(element.trimEnd / rate));
		// the next sound on the same track
		for (const other of tracks.audio[trackIndex].elements as TimelineElement[]) {
			if (other.id !== element.id && other.startTime >= element.startTime + 1) target = Math.min(target, other.startTime - element.startTime);
		}
		if (target < 1 || target === element.duration) return null;
		const trimEnd = Math.max(0, element.trimEnd + Math.round((element.duration - target) * rate));
		return { ...element, duration: mediaTime({ ticks: target }), trimEnd: mediaTime({ ticks: trimEnd }) } as Audio;
	});
}

/** ⌘Z: the songs this rule changed in the step go back to what they were (exactly), their flag too. */
export function restoreFitted(tracks: SceneTracks, snapshot: FitSnapshot): SceneTracks {
	if (snapshot.size === 0) return tracks;
	return patchAudio(tracks, (element) => {
		const was = snapshot.get(element.id);
		if (!was) return null;
		const flagged = element.params?.[FIT_FILM] === true;
		if (element.duration === was.duration && element.trimEnd === was.trimEnd && flagged === was.fitted) return null;
		const params = was.fitted ? { ...element.params, [FIT_FILM]: true } : element.params;
		return { ...element, duration: mediaTime({ ticks: was.duration }), trimEnd: mediaTime({ ticks: was.trimEnd }), params } as Audio;
	});
}
