// Where a generated clip or picture goes on the timeline (B10/C12, 10.11): «auto» put it on the first free video track
// from the top — above the titles and captions (Claude moved its titles to a new top track every round) — or on the
// magnetic main track, whose magnet moved it to the end of the cut while the answer said the time that was asked
// (16 results «parked» at 0 s stacked on 15 tracks, the project grew to 445 s). Now: on the main track only when it lands
// exactly where it was asked (the main track's end, or an empty one at 0); else on the topmost free video track UNDER
// every text, graphic and adjustment track, or a new one there; `track:"new"` always makes that new track. Pure (ticks).
import type { SceneTracks, TimelineTrack } from "@/timeline";
import type { MediaTime } from "@/wasm";
import { canPlaceTimeSpansOnTrack } from "@/timeline/placement/overlap";

export type GeneratedPlacement = { mode: "explicit"; trackId: string } | { mode: "auto"; newTrack: true; insertIndex: number };

/** Tracks a generated picture stays under (they cover the picture: titles, captions, stickers, adjustment layers). */
const COVERS = new Set(["text", "graphic", "effect"]);

/**
 * The placement of a generated visual of `duration` at `start` (ticks); `want`: "new" (a new track) or a track id.
 * `slack`: how close to the main track's end counts as its end (half a frame).
 */
export function generatedPlacement(tracks: SceneTracks, start: MediaTime, duration: MediaTime, want?: string, slack = 0): GeneratedPlacement {
	const overlay = tracks.overlay as TimelineTrack[];
	// the lowest track that covers pictures: a new one goes right under it (top of the overlays when there is none)
	let under = -1;
	overlay.forEach((t, i) => {
		if (COVERS.has(t.type)) under = i;
	});
	const fresh: GeneratedPlacement = { mode: "auto", newTrack: true, insertIndex: under + 1 };
	if (want === "new") return fresh;
	if (want && want !== "auto") {
		const named = [tracks.main as TimelineTrack, ...overlay].find((t) => t.type === "video" && (t.id === want || t.id.startsWith(want)));
		// the main track takes it as an insert (its magnet makes room); another track only where it is free
		if (named && (named.id === tracks.main.id || canPlaceTimeSpansOnTrack({ track: named, timeSpans: [{ startTime: start, duration }] }))) return { mode: "explicit", trackId: named.id };
	}
	const main = tracks.main as TimelineTrack;
	const end = main.elements.reduce((e, el) => Math.max(e, el.startTime + el.duration), 0);
	if (main.elements.length ? Math.abs(start - end) <= slack : start <= slack) return { mode: "explicit", trackId: main.id };
	const span = [{ startTime: start, duration }];
	const free = overlay.find((t, i) => i > under && t.type === "video" && canPlaceTimeSpansOnTrack({ track: t, timeSpans: span }));
	return free ? { mode: "explicit", trackId: free.id } : fresh;
}
