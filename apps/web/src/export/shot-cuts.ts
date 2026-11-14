// «Smooth frames» never blends across a cut (exp2, 14.11): the times where the picture changes from one shot to the
// next, for the frame interpolator's hard boundaries (`motion smooth --cuts`). A shot is a piece of one source on a
// visible video track: the cuts are where such pieces start and end, inside the exported span. A split that goes on
// in the same source without a jump (the razor alone) is no cut: interpolating through it is what the user wants.
import type { SceneTracks, VideoTrack } from "@/timeline/types";

type Piece = VideoTrack["elements"][number];

const sourceOf = (e: Piece): string | null => ("mediaId" in e ? e.mediaId : null);

/** b goes on where a ended in the same source, at the same speed (a razor cut, nothing taken out). */
function continues(a: Piece, b: Piece): boolean {
	const media = sourceOf(a);
	if (!media || media !== sourceOf(b)) return false;
	if (a.startTime + a.duration !== b.startTime) return false;
	const rate = (e: Piece) => ("retime" in e && e.retime ? e.retime.rate : 1);
	if (Math.abs(rate(a) - rate(b)) > 1e-9 || ("retime" in a && a.retime?.mode === "curve") || ("retime" in b && b.retime?.mode === "curve")) return false;
	if ("reversed" in a && a.reversed) return false;
	if ("reversed" in b && b.reversed) return false;
	return Math.abs(a.trimStart + a.duration * rate(a) - b.trimStart) <= 1;
}

/**
 * The cuts of the film in seconds from the start of the exported span (`range` in ticks, else the whole timeline),
 * sorted, each strictly inside the span. `ticksPerSecond` converts the timeline's ticks.
 */
export function shotCuts(tracks: SceneTracks, ticksPerSecond: number, range?: { start: number; end: number }): number[] {
	const video = [tracks.main, ...tracks.overlay.filter((t): t is VideoTrack => t.type === "video")].filter((t) => !t.hidden);
	const ends = video.flatMap((t) => t.elements.filter((e) => !("hidden" in e && e.hidden)).map((e) => e.startTime + e.duration));
	const total = Math.max(0, ...ends);
	const from = range?.start ?? 0;
	const to = range?.end ?? total;
	const at = new Set<number>();
	for (const track of video) {
		const pieces = track.elements.filter((e) => !("hidden" in e && e.hidden)).sort((a, b) => a.startTime - b.startTime);
		pieces.forEach((e, i) => {
			const next = pieces[i + 1];
			const prev = pieces[i - 1];
			if (!(prev && continues(prev, e))) at.add(e.startTime);
			if (!(next && continues(e, next))) at.add(e.startTime + e.duration);
		});
	}
	return [...at]
		.filter((t) => t > from && t < to)
		.map((t) => (t - from) / ticksPerSecond)
		.sort((a, b) => a - b);
}
