import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaAsset } from "@/media/types";
import { stillDuration } from "@/timeline/creation";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { cutToVideoEnd, SONG_SECONDS } from "@/library/client";
import type { CreateTimelineElement, SceneTracks } from "@/timeline";
import { type MediaTime, mediaTime, mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";
import { floatToFrameRate } from "@/fps/utils";

/**
 * Source In/Out marks per media item (pro-editor style): I / O in the source preview mark a
 * range of the clip; double-click, Insert or drag then put only that range on the timeline.
 * Remembered per media item (seconds in the source file). The stored Out is the edge after the Out frame (the frame on
 * screen when O is pressed belongs to the range, as in Premiere / Final Cut): the monitor adds that frame on O.
 */
export interface SourceMarks {
	in?: number;
	out?: number;
}

interface SourceMarksState {
	marks: Record<string, SourceMarks>;
	setIn: (args: { id: string; seconds: number }) => void;
	setOut: (args: { id: string; seconds: number }) => void;
	clearIn: (args: { id: string }) => void;
	clearOut: (args: { id: string }) => void;
	clear: (args: { id: string }) => void;
}

const MIN_RANGE = 0.001; // a range of one frame is a range (Out is inclusive)

export const useSourceMarks = create<SourceMarksState>()(
	persist(
		(set) => ({
			marks: {},
			setIn: ({ id, seconds }) =>
				set((state) => {
					const prev = state.marks[id] ?? {};
					const out = prev.out !== undefined && prev.out <= seconds + MIN_RANGE ? undefined : prev.out;
					return { marks: { ...state.marks, [id]: { in: Math.max(0, seconds), out } } };
				}),
			setOut: ({ id, seconds }) =>
				set((state) => {
					const prev = state.marks[id] ?? {};
					const inPoint = prev.in !== undefined && prev.in >= seconds - MIN_RANGE ? undefined : prev.in;
					return { marks: { ...state.marks, [id]: { in: inPoint, out: Math.max(0, seconds) } } };
				}),
			clearIn: ({ id }) => set((state) => ({ marks: { ...state.marks, [id]: { out: state.marks[id]?.out } } })),
			clearOut: ({ id }) => set((state) => ({ marks: { ...state.marks, [id]: { in: state.marks[id]?.in } } })),
			clear: ({ id }) =>
				set((state) => {
					const { [id]: _removed, ...rest } = state.marks;
					return { marks: rest };
				}),
		}),
		{ name: "studio-source-marks", version: 1 },
	),
);

/** The marked range of a media item in seconds, or null when nothing (useful) is marked. */
export function markedRange({
	asset,
	marks,
}: {
	asset: Pick<MediaAsset, "id" | "type" | "duration">;
	marks?: SourceMarks;
}): { start: number; end: number } | null {
	if (asset.type === "image" || !asset.duration) return null;
	const m = marks ?? useSourceMarks.getState().marks[asset.id];
	if (!m || (m.in === undefined && m.out === undefined)) return null;
	const start = Math.min(Math.max(0, m.in ?? 0), asset.duration);
	const end = Math.min(asset.duration, Math.max(start, m.out ?? asset.duration));
	if (end - start < MIN_RANGE || (start <= 0.001 && end >= asset.duration - 0.001)) return null;
	return { start, end };
}

/** A timeline element for the media item: only its marked range when one is set, else the whole clip. */
export function buildSourceRangeElement({
	asset,
	startTime,
}: {
	asset: MediaAsset;
	startTime: MediaTime;
}): CreateTimelineElement {
	const full = asset.duration != null ? mediaTimeFromSeconds({ seconds: asset.duration }) : stillDuration();
	const element = buildElementFromMedia({
		mediaId: asset.id,
		mediaType: asset.type,
		name: asset.name,
		duration: full,
		startTime,
	});
	const range = markedRange({ asset });
	if (!range || asset.duration == null || !("trimStart" in element)) return element;
	// On the file's own frames: I and O read the player's time, a hair off a frame — at 29.97 an In a tick before frame
	// 12 showed frame 11 first. The frame on screen when the key was pressed (pro-core, 09.11).
	const onFrame = sourceFrameTicks(asset);
	const startTicks = onFrame(range.start);
	const endTicks = Math.max(startTicks + 1, onFrame(range.end));
	const trimStart = mediaTime({ ticks: startTicks });
	const duration = mediaTime({ ticks: endTicks - startTicks });
	const trimEnd = mediaTime({ ticks: Math.max(0, full - endTicks) });
	return { ...element, duration, trimStart, trimEnd, sourceDuration: full } as CreateTimelineElement;
}

/**
 * Seconds of a file → ticks at the start of the file's frame they fall in (a video with a known rate), else as they are.
 * The player's time lands a few microseconds short of a frame it was stepped to (it keeps whole microseconds, and each
 * step adds to the last reading): a time within 1 % of a frame from the next one is that next frame.
 */
export function sourceFrameTicks(asset: Pick<MediaAsset, "type" | "fps">): (seconds: number) => number {
	const fps = asset.type === "video" && asset.fps && asset.fps > 0 ? floatToFrameRate(asset.fps) : null;
	if (!fps) return (seconds) => mediaTimeFromSeconds({ seconds });
	return (seconds) => {
		const frame = Math.floor((Math.max(0, seconds) * fps.numerator) / fps.denominator + 0.01);
		return Math.round((frame * fps.denominator * TICKS_PER_SECOND) / fps.numerator);
	};
}

/**
 * A media item as it lands on the timeline (drop, «+», drop on the player): the marked range, or the whole item — but an
 * imported song is cut to the end of the video like library music (a 3-minute track made a 15 s video 3 minutes long).
 */
export function buildLandingElement({
	asset,
	startTime,
	tracks,
}: {
	asset: MediaAsset;
	startTime: MediaTime;
	tracks: SceneTracks | undefined;
}): CreateTimelineElement {
	const element = buildSourceRangeElement({ asset, startTime });
	if (element.type !== "audio" || markedRange({ asset }) || (asset.duration ?? 0) < SONG_SECONDS) return element;
	return cutToVideoEnd(element, tracks);
}
