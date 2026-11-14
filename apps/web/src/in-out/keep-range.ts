import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import type { MediaTime } from "@/wasm";
import type { InOutRange } from "./store";

function mapTracks(
	tracks: SceneTracks,
	map: (elements: TimelineElement[]) => TimelineElement[],
): SceneTracks {
	const apply = <TTrack extends TimelineTrack>(track: TTrack): TTrack =>
		// Element types are preserved by `map` (filter + time shift only).
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
		({ ...track, elements: map(track.elements) }) as TTrack;
	return {
		overlay: tracks.overlay.map(apply),
		main: apply(tracks.main),
		audio: tracks.audio.map(apply),
	};
}

/**
 * Keeps the clips that lie inside [start, end] and moves them so the range starts at 0.
 * Clips must already be cut at both range edges.
 */
export function keepRange({
	tracks,
	range,
}: {
	tracks: SceneTracks;
	range: InOutRange;
}): SceneTracks {
	return mapTracks(tracks, (elements) =>
		elements
			.filter(
				(element) =>
					element.startTime >= range.start &&
					element.startTime + element.duration <= range.end,
			)
			.map((element) => ({
				...element,
				startTime: (element.startTime - range.start) as MediaTime,
			})),
	);
}


/**
 * ; Lift / ' Extract: remove what lies inside [start, end] on every track (clips must
 * already be cut at both edges). Extract also pulls everything after `end` left.
 */
export function removeRange({
	tracks,
	range,
	closeGap,
}: {
	tracks: SceneTracks;
	range: InOutRange;
	closeGap: boolean;
}): SceneTracks {
	const length = range.end - range.start;
	return mapTracks(tracks, (elements) =>
		elements
			.filter(
				(element) =>
					!(element.startTime >= range.start && element.startTime + element.duration <= range.end),
			)
			.map((element) =>
				closeGap && element.startTime >= range.end
					? { ...element, startTime: (element.startTime - length) as MediaTime }
					: element,
			),
	);
}
