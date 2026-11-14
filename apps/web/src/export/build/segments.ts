// Export as a build (render, 11.11): the film is cut into stretches that are rendered, encoded and kept one by one, so
// an export that was interrupted goes on from what is done and a small change renders only what it touches. The user
// sees none of it: one press, one file (the stretches are joined as they are muxed, each starting on a key frame).
//
// This file: where the stretches begin. They begin at cut points — a frame where a clip, a title, a sticker or an
// effect layer starts or ends — and a long stretch between two cut points is divided every few seconds, counted from
// its own start. So the stretches of an untouched part of the film are the same from one export to the next, also when
// everything before it got shorter or longer by whole frames.

/** No stretch is longer than this: also the longest wait between two key frames of the file (as before: 5 s). */
export const MAX_SEGMENT_SECONDS = 5;
/** A stretch between two cut points shorter than this joins the next one (fast cutting: not a key frame per shot). */
export const MIN_SEGMENT_SECONDS = 1;

export interface SegmentRange {
	/** the first frame of the export in this stretch */
	start: number;
	/** how many frames */
	frames: number;
}

/** The frame of the export that first shows what begins at `ticks` (frames are drawn at 0, ticksPerFrame, …). */
export const frameAt = (ticks: number, ticksPerFrame: number) => Math.max(0, Math.ceil(ticks / ticksPerFrame - 1e-9));

/**
 * The frames where something on the picture's tracks starts or ends, in order, without doubles, inside (0, frameCount).
 * `elements`: every visible element of the tracks that are drawn, as start and length in ticks.
 */
export function cutFrames({ elements, ticksPerFrame, frameCount }: { elements: Iterable<{ startTime: number; duration: number }>; ticksPerFrame: number; frameCount: number }): number[] {
	const cuts = new Set<number>();
	for (const element of elements) {
		for (const ticks of [element.startTime, element.startTime + element.duration]) {
			const frame = frameAt(ticks, ticksPerFrame);
			if (frame > 0 && frame < frameCount) cuts.add(frame);
		}
	}
	return [...cuts].sort((a, b) => a - b);
}

/**
 * The stretches of an export of `frameCount` frames at `fps`: each ends at the first cut point at least
 * MIN_SEGMENT_SECONDS after its start, or after MAX_SEGMENT_SECONDS when no cut point comes sooner. Every frame is in
 * exactly one stretch, in order.
 */
export function segmentRanges({ cuts, frameCount, fps }: { cuts: readonly number[]; frameCount: number; fps: number }): SegmentRange[] {
	const ranges: SegmentRange[] = [];
	if (!(frameCount > 0)) return ranges;
	const max = Math.max(1, Math.round(MAX_SEGMENT_SECONDS * fps));
	const min = Math.max(1, Math.min(max, Math.round(MIN_SEGMENT_SECONDS * fps)));
	let start = 0;
	let next = 0;
	while (start < frameCount) {
		while (next < cuts.length && cuts[next] < start + min) next++;
		const cut = next < cuts.length ? cuts[next] : frameCount;
		let end = Math.min(cut, start + max, frameCount);
		// a tail shorter than the minimum is not left alone at the end of a long stretch: it joins it
		if (frameCount - end < min && frameCount - start <= max + min) end = frameCount;
		ranges.push({ start, frames: end - start });
		start = end;
	}
	return ranges;
}
