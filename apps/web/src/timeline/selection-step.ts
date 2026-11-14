// Select the next / previous clip on the track (tlc2): for the hand that stays on the keyboard. From the anchor clip
// (the last one clicked; else the last selected) to its neighbour in time on the same track; with nothing selected,
// the main track's clip at the playhead (forwards: the one starting there or next). The playhead goes to the new clip's start (the caller seeks).
import type { ElementRef, SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";

const ordered = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];

/** The clips of a track in time order (a tie: the track's own order). */
function inTimeOrder(track: TimelineTrack): TimelineElement[] {
	return (track.elements as TimelineElement[]).map((element, index) => ({ element, index })).sort((a, b) => a.element.startTime - b.element.startTime || a.index - b.index).map(({ element }) => element);
}

/**
 * The clip to select, or null (the end of the track, a locked track, an empty one). `from`: the clip to step from;
 * null: from `playhead` on the main track — forwards the first clip that starts at it or after it, backwards the last
 * that starts at it or before it (the clip under the playhead; «at»: within `half`, half a frame).
 */
export function adjacentClip({
	tracks,
	from,
	playhead,
	half,
	direction,
}: {
	tracks: SceneTracks;
	from: ElementRef | null;
	playhead: number;
	half: number;
	direction: 1 | -1;
}): { ref: ElementRef; startTime: number } | null {
	const track = from ? ordered(tracks).find((t) => t.id === from.trackId) : tracks.main;
	if (!track || track.locked) return null;
	const clips = inTimeOrder(track);
	let next: TimelineElement | undefined;
	const at = from ? clips.findIndex((element) => element.id === from.elementId) : -1;
	if (from && at >= 0) next = clips[at + direction];
	else if (direction === 1) next = clips.find((element) => element.startTime >= playhead - half);
	else next = [...clips].reverse().find((element) => element.startTime <= playhead + half);
	return next ? { ref: { trackId: track.id, elementId: next.id }, startTime: next.startTime } : null;
}
