// that cut on move along by what went in, nothing is covered, and no clip is thrown onto a new track above. Pure maths
// shared by the drop (where the cursor is), «+» / double-click in Media (where the playhead is) and the import of
// several files into an empty project; the commands are in row-place.ts.
import type { SceneTracks, TimelineElement } from "@/timeline";
import { mediaTime, type MediaTime } from "@/wasm";

type Span = Pick<TimelineElement, "startTime" | "duration">;

const sorted = <T extends Span>(elements: readonly T[]) => [...elements].sort((a, b) => a.startTime - b.startTime);

/** The end of the row (0 when it is empty). */
export function rowEnd(elements: readonly Span[]): number {
	return elements.reduce((end, e) => Math.max(end, e.startTime + e.duration), 0);
}

/**
 * The cut a drop at `time` goes into: the nearer edge of the clip under it (its left half → before it, its right half →
 * after it); past the last clip → the row's end; an empty row → 0.
 */
export function rowCutAtCursor({ elements, time }: { elements: readonly Span[]; time: number }): MediaTime {
	let cut = 0;
	for (const element of sorted(elements)) {
		if (element.startTime + element.duration / 2 <= time) cut = element.startTime + element.duration;
	}
	return mediaTime({ ticks: cut });
}

/**
 * Where «+» puts a picture or a video: at the cut after the clip under the playhead; at the playhead itself when it
 * sits on a cut (within `tolerance` ticks, half a frame); at the row's end when it is past it; 0 when the row is empty.
 */
export function rowCutAtPlayhead({ elements, time, tolerance = 0 }: { elements: readonly Span[]; time: number; tolerance?: number }): MediaTime {
	if (elements.length === 0) return mediaTime({ ticks: 0 });
	const end = rowEnd(elements);
	if (time >= end - tolerance) return mediaTime({ ticks: end });
	for (const element of sorted(elements)) {
		const from = element.startTime;
		const to = element.startTime + element.duration;
		if (Math.abs(time - from) <= tolerance) return mediaTime({ ticks: from });
		if (time > from && time < to) return mediaTime({ ticks: to });
	}
	// in a gap (magnet off): the next clip's start
	const next = sorted(elements).find((e) => e.startTime > time);
	return mediaTime({ ticks: next ? next.startTime : end });
}

/**
 * The row with `items` put in at `at`, one after another, as they are (their own lengths): every main clip that
 * starts at or after `at` moves on by their total. A clip that `at` falls inside (only a caller that did not use a
 * cut) is left where it is. Returns the new main elements and where each item landed.
 */
export function insertIntoRow<T extends Span>({
	elements,
	at,
	items,
}: {
	elements: readonly TimelineElement[];
	at: number;
	items: readonly T[];
}): { moved: TimelineElement[]; starts: MediaTime[] } {
	const total = items.reduce((sum, item) => sum + item.duration, 0);
	const moved = elements.map((element) =>
		element.startTime >= at && total > 0 ? { ...element, startTime: mediaTime({ ticks: element.startTime + total }) } : element,
	);
	const starts: MediaTime[] = [];
	let cursor = at;
	for (const item of items) {
		starts.push(mediaTime({ ticks: cursor }));
		cursor += item.duration;
	}
	return { moved, starts };
}

/** The main track's elements moved as `insertIntoRow` says (the tracks object for a TracksEditCommand). */
export function withMainElements(tracks: SceneTracks, elements: TimelineElement[]): SceneTracks {
	return { ...tracks, main: { ...tracks.main, elements } as SceneTracks["main"] };
}
