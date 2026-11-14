// Picking an edge or a cut from the keyboard: the one nearest the playhead (Final Cut's [ ] \).
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { TOUCH_TICKS } from "./core";
import type { TrimSelection } from "./store";

const listTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];

/**
 * The edit nearest `time` on a track: `out` — the end of a clip (the left side of a cut, a ripple of the outgoing
 * clip), `in` — the start of a clip (the right side), `roll` — a cut between two touching clips. Of two at the same
 * distance the earlier one. Null when the track has none (no clips; for a roll, no two that touch) or is locked.
 */
export function nearestEdit({ tracks, trackId, time, pick }: { tracks: SceneTracks; trackId: string; time: number; pick: "out" | "in" | "roll" }): TrimSelection | null {
	const track = listTracks(tracks).find((t) => t.id === trackId);
	if (!track || track.locked) return null;
	const sorted = [...(track.elements as TimelineElement[])].sort((a, b) => a.startTime - b.startTime);
	let best: { selection: TrimSelection; distance: number } | null = null;
	const offer = (selection: TrimSelection, at: number) => {
		const distance = Math.abs(at - time);
		if (!best || distance < best.distance) best = { selection, distance };
	};
	sorted.forEach((element, i) => {
		const end = element.startTime + element.duration;
		if (pick === "out") offer({ kind: "ripple", trackId, elementId: element.id, side: "right" }, end);
		else if (pick === "in") offer({ kind: "ripple", trackId, elementId: element.id, side: "left" }, element.startTime);
		else {
			const next = sorted[i + 1];
			if (next && Math.abs(next.startTime - end) <= TOUCH_TICKS) offer({ kind: "roll", trackId, leftId: element.id, rightId: next.id }, end);
		}
	});
	return (best as { selection: TrimSelection } | null)?.selection ?? null;
}

/** Where a picked edge or cut is on the timeline now; null when its clips are gone or (a roll) no longer touch. */
export function editTime(tracks: SceneTracks, selection: TrimSelection): number | null {
	const track = listTracks(tracks).find((t) => t.id === selection.trackId);
	if (!track || track.locked) return null;
	const find = (id: string) => (track.elements as TimelineElement[]).find((element) => element.id === id);
	if (selection.kind === "roll") {
		const left = find(selection.leftId);
		const right = find(selection.rightId);
		if (!left || !right || Math.abs(left.startTime + left.duration - right.startTime) > TOUCH_TICKS) return null;
		return right.startTime;
	}
	const element = find(selection.elementId);
	if (!element) return null;
	return selection.side === "left" ? element.startTime : element.startTime + element.duration;
}
