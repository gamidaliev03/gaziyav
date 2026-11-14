import type { TrackType } from "@/timeline";
import { type TrackHeightChoice, useTimelineStore } from "@/timeline/timeline-store";
import {
	KEYFRAME_LANE_HEIGHT_PX,
	TIMELINE_TRACK_GAP_PX,
	TIMELINE_TRACK_HEIGHTS_PX,
} from "./layout";

/** Video tracks by the main track's ⋯ → Track height (CapCut: Short / Default / Tall). */
const VIDEO_TRACK_HEIGHT_PX: Record<TrackHeightChoice, number> = { short: 48, default: 65, tall: 96 };

export function getTrackHeight({ type }: { type: TrackType }): number {
	if (type === "video") return VIDEO_TRACK_HEIGHT_PX[useTimelineStore.getState().trackHeight] ?? TIMELINE_TRACK_HEIGHTS_PX.video;
	return TIMELINE_TRACK_HEIGHTS_PX[type];
}

export function getExpandedTrackHeight({
	type,
	expandedLaneCount,
}: {
	type: TrackType;
	expandedLaneCount: number;
}): number {
	return (
		getTrackHeight({ type }) +
		expandedLaneCount * KEYFRAME_LANE_HEIGHT_PX
	);
}

export function getCumulativeHeightBefore({
	tracks,
	trackIndex,
	getExtraHeight,
}: {
	tracks: Array<{ type: TrackType }>;
	trackIndex: number;
	getExtraHeight?: (trackIndex: number) => number;
}): number {
	return tracks
		.slice(0, trackIndex)
		.reduce(
			(sum, track, i) =>
				sum +
				getTrackHeight({ type: track.type }) +
				(getExtraHeight?.(i) ?? 0) +
				TIMELINE_TRACK_GAP_PX,
			0,
		);
}

export function getTotalTracksHeight({
	tracks,
	getExtraHeight,
}: {
	tracks: Array<{ type: TrackType }>;
	getExtraHeight?: (trackIndex: number) => number;
}): number {
	const tracksHeight = tracks.reduce(
		(sum, track, i) =>
			sum + getTrackHeight({ type: track.type }) + (getExtraHeight?.(i) ?? 0),
		0,
	);
	const gapsHeight = Math.max(0, tracks.length - 1) * TIMELINE_TRACK_GAP_PX;
	return tracksHeight + gapsHeight;
}
