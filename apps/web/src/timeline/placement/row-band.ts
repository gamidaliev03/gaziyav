// The main row's band in the tracks area (content px, the rows' own maths: getTrackAtY): from the middle of the gap
// above it to the middle of the gap below it. A picture dropped anywhere in it goes into the row (rule A).
import type { SceneTracks, TrackType } from "@/timeline";
import { TIMELINE_TRACK_GAP_PX } from "@/timeline/components/layout";
import { getTrackHeight } from "@/timeline/components/track-layout";

export function mainRowBand(
	tracks: Pick<SceneTracks, "overlay" | "main">,
	heightOf: (type: TrackType) => number = (type) => getTrackHeight({ type }),
	gap: number = TIMELINE_TRACK_GAP_PX,
): { top: number; bottom: number; middle: number } {
	let top = 0;
	for (const track of tracks.overlay) top += heightOf(track.type) + gap;
	const height = heightOf(tracks.main.type);
	return { top: top - (tracks.overlay.length > 0 ? gap / 2 : 0), bottom: top + height + gap / 2, middle: top + height / 2 };
}
