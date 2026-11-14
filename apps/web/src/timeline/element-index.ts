import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { speedOff } from "@/timeline/speed-flags";

export interface IndexedElement {
	track: TimelineTrack;
	element: TimelineElement;
}

/**
 * Every element of a tracks object by its id, built once per tracks object (tracks are never changed in place: an edit
 * makes a new object). Lookups by id were scans of the element's track, and several things ask for every selected or
 * every mounted clip on each notification of an edit: with 324 clips selected on a two-hour film (2 792 elements) the
 * inspector's subscription alone was ~290 000 comparisons, ~5 ms, eight times per ⌫ (ideal-longform, 11.11).
 */
const indexes = new WeakMap<SceneTracks, Map<string, IndexedElement>>();

export function elementIndex(tracks: SceneTracks): ReadonlyMap<string, IndexedElement> {
	let index = indexes.get(tracks);
	if (!index) {
		index = new Map();
		// In the order the scans looked (the main track, the overlays, the audio tracks), the first one found kept:
		// should an id ever sit in two places, the answer is the scan's.
		for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio] as TimelineTrack[]) {
			for (const element of track.elements as TimelineElement[]) {
				if (!index.has(element.id)) index.set(element.id, { track, element });
			}
		}
		indexes.set(tracks, index);
	}
	return index;
}

/** The element with this id on this track, or undefined (as `track.elements.find` on the track with that id). */
export function findElementOnTrack({
	tracks,
	trackId,
	elementId,
}: {
	tracks: SceneTracks;
	trackId: string;
	elementId: string;
}): IndexedElement | undefined {
	if (!speedOff("index")) {
		const hit = elementIndex(tracks).get(elementId);
		if (hit && hit.track.id === trackId) return hit;
		// Not there, or on another track: the answer of the scan below is the same «undefined» unless an id is on two
		// tracks at once, which only the scan can tell.
		if (!hit) return undefined;
	}
	const track =
		tracks.main.id === trackId
			? tracks.main
			: (tracks.overlay.find((candidate) => candidate.id === trackId) ?? tracks.audio.find((candidate) => candidate.id === trackId));
	if (!track) return undefined;
	const element = (track.elements as TimelineElement[]).find((candidate) => candidate.id === elementId);
	return element ? { track, element } : undefined;
}

/** The element with this id on any track (the main track first, as the scans did). */
export function findElementById({ tracks, elementId }: { tracks: SceneTracks; elementId: string }): IndexedElement | undefined {
	if (!speedOff("index")) return elementIndex(tracks).get(elementId);
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
		const element = (track.elements as TimelineElement[]).find((candidate) => candidate.id === elementId);
		if (element) return { track, element };
	}
	return undefined;
}
