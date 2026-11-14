import type { TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";

export interface MainTrackReorder {
	/** Where the clips go in, in the timeline as it is now (the cut between two clips that stay). */
	insertIndex: number;
	/** The main track's elements after the drop: dragged clips at the cut, the rest closed up / pushed along. */
	elements: TimelineElement[];
	/** Ids of the clips at the cut (the dragged ones, or their copies). */
	insertedIds: string[];
	/** The drop changes nothing (dropped back where they were). */
	isNoop: boolean;
}

/**
 * CapCut's magnetic main track: dragging clips along it moves them to the cut nearest the pointer instead of
 * overlapping their neighbours (which used to throw them onto a new track above). The clips that stay close up the
 * gap the dragged ones left; those after the cut move along by the dragged clips' length. With `copyIds` (⌥-drag)
 * the originals stay and copies go in at the cut.
 */
export function planMainTrackReorder({
	elements,
	movingIds,
	pointerTime,
	copyIds,
	copyElement = (element, id) => ({ ...element, id }),
	incomingIds,
}: {
	elements: readonly TimelineElement[];
	movingIds: ReadonlySet<string>;
	/** Clips brought in from another track: they leave no gap here to close (the clips after the cut move along). */
	incomingIds?: ReadonlySet<string>;
	pointerTime: number;
	copyIds?: ReadonlyMap<string, string>;
	/** Makes a ⌥ copy (the editor gives it fresh keyframe ids too). */
	copyElement?: (element: TimelineElement, id: string) => TimelineElement;
}): MainTrackReorder | null {
	const sorted = [...elements].sort((a, b) => a.startTime - b.startTime);
	const moving = sorted.filter((element) => movingIds.has(element.id));
	if (moving.length === 0) return null;
	// A ⌥ copy keeps the originals where they are: on the main track they stay in the row, from a layer they stay on the
	// layer (they were moved off it instead of copied).
	const stay = copyIds ? sorted.filter((element) => !incomingIds?.has(element.id)) : sorted.filter((element) => !movingIds.has(element.id));

	// The magnet closes the time the dragged clips leave (copies leave nothing): each clip that stays starts earlier by
	// the length of the dragged clips that ended before it. One pass over the clips in time order — this runs on every
	// pointer move of a drag, and with a sum per clip and a search per clip below it was ~5 ms a move on a 1 791-clip
	// track (ideal-longform, 11.11).
	const leaving = copyIds
		? []
		: moving
				.filter((other) => !incomingIds?.has(other.id))
				.map((other) => ({ end: other.startTime + other.duration, duration: other.duration as number }))
				.sort((a, b) => a.end - b.end);
	let gone = 0;
	let left = 0;
	const closedStart = stay.map((element) => {
		while (left < leaving.length && leaving[left].end <= element.startTime) gone += leaving[left++].duration;
		return element.startTime - gone;
	});
	// A clip that ends up where it is stays the same object: what follows (the preview, the drop) then touches only
	// the clips that move.
	const placed = (element: TimelineElement, startTime: number): TimelineElement =>
		startTime === element.startTime ? element : { ...element, startTime: startTime as MediaTime };

	// The cut nearest the pointer: after every clip whose middle, where it is on screen now, is left of it. (The
	// closed-up layout's middles swapped a neighbour as soon as the drag began: a 1 s drag passed it.)
	let insertIndex = 0;
	while (
		insertIndex < stay.length &&
		stay[insertIndex].startTime + stay[insertIndex].duration / 2 < pointerTime
	) {
		insertIndex++;
	}
	const cut = insertIndex > 0 ? closedStart[insertIndex - 1] + stay[insertIndex - 1].duration : (closedStart[0] ?? 0);

	// The dragged clips land as ONE block at the cut, back to back in their timeline order (blind3 F1: a selection with
	// clips between its members kept its spacing and left 59.6 s of black in the film; clips from two layers overlapped).
	let at = cut;
	const inserted = moving.map((element) => {
		const copyId = copyIds?.get(element.id);
		const startTime = at as MediaTime;
		at += element.duration;
		return { ...(copyId ? copyElement(element, copyId) : element), startTime };
	});
	const blockLength = at - cut;
	const next = [
		...stay.slice(0, insertIndex).map((element, index) => placed(element, closedStart[index])),
		...inserted,
		...stay.slice(insertIndex).map((element, index) => placed(element, closedStart[insertIndex + index] + blockLength)),
	];

	const startBefore = new Map<string, number>();
	for (const element of sorted) if (!startBefore.has(element.id)) startBefore.set(element.id, element.startTime);
	const isNoop = !copyIds && next.every((element) => startBefore.get(element.id) === element.startTime);
	return { insertIndex, elements: next, insertedIds: inserted.map((element) => element.id), isNoop };
}
