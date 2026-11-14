import type { SceneTracks, TimelineElement, VideoTrack } from "@/timeline";
import { type MediaTime, mediaTime, ZERO_MEDIA_TIME } from "@/wasm";

export const MAIN_TRACK_NAME = "Main Track";

export function getEarliestMainTrackElement({
	mainTrack,
	excludeElementId,
}: {
	mainTrack: VideoTrack;
	excludeElementId?: string;
}): TimelineElement | null {
	const elements = mainTrack.elements.filter((element) => {
		return !excludeElementId || element.id !== excludeElementId;
	});
	if (elements.length === 0) {
		return null;
	}

	return elements.reduce((earliestElement, element) => {
		return element.startTime < earliestElement.startTime
			? element
			: earliestElement;
	});
}

export function enforceMainTrackStart({
	tracks,
	targetTrackId,
	requestedStartTime,
	excludeElementId,
}: {
	tracks: SceneTracks;
	targetTrackId: string;
	requestedStartTime: MediaTime;
	excludeElementId?: string;
}): MediaTime {
	if (tracks.main.id !== targetTrackId) {
		return requestedStartTime;
	}

	const earliestElement = getEarliestMainTrackElement({
		mainTrack: tracks.main,
		excludeElementId,
	});
	if (!earliestElement) {
		return ZERO_MEDIA_TIME;
	}

	if (requestedStartTime <= earliestElement.startTime) {
		return ZERO_MEDIA_TIME;
	}

	return requestedStartTime;
}

/**
 * The main track with its magnet (CapCut): its clips back to back from 0 in their order — a gap closes, an overlap
 * makes room (a clip that got longer, at a slower speed, pushes the next ones on; it covered them). A stretch that a
 * compound clip of main-track clips covers from the track above stays as it is: the compound plays there. `fresh`:
 * the clips the step added — on a tie with a clip already there they go first (an insert, not after it). Returns
 * the same object when the track is packed already.
 */
export function packMainTrack({ tracks, fresh }: { tracks: SceneTracks; fresh?: ReadonlySet<string> }): SceneTracks {
	const elements = tracks.main.elements;
	if (elements.length === 0) return tracks;
	const order = [...elements].sort(
		(a, b) => a.startTime - b.startTime || Number(fresh?.has(b.id) ?? false) - Number(fresh?.has(a.id) ?? false),
	);
	const compounds = tracks.overlay.flatMap((track) =>
		(track.elements as TimelineElement[]).filter((element) => element.type === "graphic" && element.params?.compound === true),
	);
	const covered = (from: number, to: number) => compounds.some((c) => c.startTime <= from && c.startTime + c.duration >= to);
	let at = 0;
	let changed = false;
	const packed = order.map((element) => {
		let start = at;
		// a gap a compound clip fills is kept
		if (element.startTime > at && covered(at, element.startTime)) start = element.startTime;
		at = start + element.duration;
		if (start === element.startTime) return element;
		changed = true;
		return { ...element, startTime: mediaTime({ ticks: start }) };
	});
	if (!changed) return tracks;
	return { ...tracks, main: { ...tracks.main, elements: packed } as typeof tracks.main };
}

/** The main track's cut nearest a time: after every clip whose middle is left of it (0 before the first). */
export function mainTrackCutAt({ elements, time }: { elements: readonly TimelineElement[]; time: number }): MediaTime {
	let cut = 0;
	for (const element of [...elements].sort((a, b) => a.startTime - b.startTime)) {
		if (element.startTime + element.duration / 2 <= time) cut = element.startTime + element.duration;
	}
	return mediaTime({ ticks: cut });
}

/**
 * No two items at once on a track above or below the main one: an item a step put over another (a title or a sound
 * linkage carried along with its clip, onto something already there) moves to the nearest track of its kind that is
 * free at its time — a new one beside its own when none is. `moved`: the items the step placed or moved (they are
 * the ones that go; the others stay). Returns the same object when nothing overlaps.
 */
export function separateOverlaps({ tracks, moved }: { tracks: SceneTracks; moved: ReadonlySet<string> }): SceneTracks {
	type Track = SceneTracks["overlay"][number] | SceneTracks["audio"][number];
	const end = (e: TimelineElement) => e.startTime + e.duration;
	const fits = (track: Track, e: TimelineElement) => !(track.elements as TimelineElement[]).some((x) => x.startTime < end(e) && e.startTime < end(x));
	const settle = <T extends Track>(list: T[], step: -1 | 1): T[] | null => {
		let changed = false;
		const out = [...list];
		for (let i = 0; i < out.length; i++) {
			const sorted = [...(out[i].elements as TimelineElement[])].sort((a, b) => a.startTime - b.startTime);
			const keep: TimelineElement[] = [];
			const evict: TimelineElement[] = [];
			for (const e of sorted) {
				const clash = keep.find((k) => k.startTime < end(e) && e.startTime < end(k));
				if (!clash) keep.push(e);
				else if (moved.has(e.id) || !moved.has(clash.id)) evict.push(e);
				else {
					keep.splice(keep.indexOf(clash), 1, e);
					evict.push(clash);
				}
			}
			if (evict.length === 0) continue;
			changed = true;
			out[i] = { ...out[i], elements: keep } as T;
			for (const e of evict) {
				// the nearest free track of the same kind on its side (an overlay above, as an added layer goes: an effect
				// layer only acts on what is below it; a sound below)
				let target = -1;
				for (let j = i + step; j >= 0 && j < out.length; j += step) {
					if (out[j].type === out[i].type && fits(out[j], e)) {
						target = j;
						break;
					}
				}
				if (target >= 0) {
					out[target] = { ...out[target], elements: [...(out[target].elements as TimelineElement[]), e] } as T;
				} else {
					const at = step < 0 ? i : i + 1;
					// its id from the item's: a redo makes the same track (and one that is new on this timeline)
					const track = { ...out[i], id: freshId(e.id), name: out[i].name, elements: [e] } as T;
					out.splice(at, 0, track);
					if (at <= i) i++;
				}
			}
		}
		return changed ? out : null;
	};
	// a new overlay track goes right above its track; a new sound track right below its own
	// Every track id the timeline has, so a new track's id is new: an item evicted again later — from the very track its
	// first eviction made, `track-<its id>` — made a second track of that id, and every rule after it broke (unique-ids,
	// rows out of order: pro-reliable's 60-min soak, 88 times from cycle 85).
	const taken = new Set([...tracks.overlay, tracks.main, ...tracks.audio].map((track) => track.id));
	const freshId = (itemId: string) => {
		let id = `track-${itemId}`;
		for (let n = 2; taken.has(id); n++) id = `track-${itemId}-${n}`;
		taken.add(id);
		return id;
	};
	const overlay = settle(tracks.overlay, -1);
	const audio = settle(tracks.audio, 1);
	if (!overlay && !audio) return tracks;
	return { ...tracks, ...(overlay ? { overlay } : {}), ...(audio ? { audio } : {}) };
}
