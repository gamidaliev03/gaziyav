// Where the frames of a filmstrip go and which source times they show. Pure: no DOM, no decoding.
import { curveKey, getSourceSpanAtClipTime } from "@/retime";
import type { RetimeConfig } from "@/timeline";

/**
 * Frame spacing in source seconds, a power of two between these: each zoom level's times are a subset of
 * the next finer level's, so zooming in or out finds most frames already in the cache.
 */
export const FILMSTRIP_MIN_STEP_S = 1 / 32;
export const FILMSTRIP_MAX_STEP_S = 64;
/** Frames at least this far apart come from key frames: one packet each, a screen of 4K tiles in ~0.1 s. */
export const KEY_FRAME_STEP_S = 1;

export type FilmstripTile = {
	/** The tile's slot in clip px (the bitmap is cropped or repeated to fill it). */
	left: number;
	right: number;
	/** Source time of the frame. */
	time: number;
	/** Its place on the grid (before the trim point for the tile cut by the left edge) and the grid step; step 0 = no stand-ins. */
	gridTime: number;
	step: number;
};

export type FilmstripLayout = {
	tiles: FilmstripTile[];
	/** Fetched first, as key frames: fills the view fast. Centre of the view first. */
	keyTimes: number[];
	/** Fetched after, exact frames that replace the key-frame stand-ins. Centre first. */
	exactTimes: number[];
	/** Identity of the request: the view needs new frames only when it changes. */
	requestKey: string;
};

export function layoutFilmstrip({
	fromPx,
	toPx,
	centrePx,
	clipWidthPx,
	pixelsPerSecond,
	tileWidthPx,
	trimStartSec,
	clipDurationSec,
	retime,
	mediaDurationSec,
}: {
	/** Part of the clip to cover, in clip px. */
	fromPx: number;
	toPx: number;
	/** Where the user looks (the middle of the visible part): fetched first. */
	centrePx: number;
	clipWidthPx: number;
	pixelsPerSecond: number;
	tileWidthPx: number;
	trimStartSec: number;
	clipDurationSec: number;
	retime?: RetimeConfig;
	mediaDurationSec?: number;
}): FilmstripLayout {
	const from = Math.max(0, fromPx);
	const to = Math.min(clipWidthPx, toPx);
	if (!(pixelsPerSecond > 0) || !(tileWidthPx > 0) || to <= from) {
		return { tiles: [], keyTimes: [], exactTimes: [], requestKey: "" };
	}
	const lastFrame = mediaDurationSec && mediaDurationSec > 0 ? mediaDurationSec - 0.001 : Number.POSITIVE_INFINITY;
	const clampTime = (time: number) => Math.max(0, Math.min(lastFrame, time));

	if (retime?.mode === "curve" && retime.curve) {
		return layoutOnClipGrid({ from, to, centrePx, pixelsPerSecond, tileWidthPx, trimStartSec, clipDurationSec, retime, clampTime });
	}

	// Constant speed: the grid is anchored in source time, so frames stay on the picture they show when the
	// left edge is trimmed (CapCut), and pieces cut from one file share their frames.
	const rate = retime?.rate && retime.rate > 0 ? retime.rate : 1;
	const sourcePerPx = rate / pixelsPerSecond;
	const step = quantiseStep(tileWidthPx * sourcePerPx);
	const sourceAt = (x: number) => trimStartSec + x * sourcePerPx;
	const xAt = (source: number) => (source - trimStartSec) / sourcePerPx;
	const centreSource = sourceAt(centrePx);
	const byCentre = (a: number, b: number) => Math.abs(a - centreSource) - Math.abs(b - centreSource);

	const tiles: FilmstripTile[] = [];
	const gridTimes: number[] = [];
	let leadTime: number | null = null;
	const firstK = Math.floor(sourceAt(from) / step + 1e-9);
	const lastK = Math.ceil(sourceAt(to) / step - 1e-9) - 1;
	for (let k = firstK; k <= lastK; k++) {
		const gridTime = k * step;
		const left = Math.max(0, xAt(gridTime));
		const right = Math.min(clipWidthPx, xAt(gridTime + step));
		if (right <= left) continue;
		// The tile cut by the clip's left edge shows the clip's first frame, not one from before the trim.
		const isLead = gridTime < trimStartSec - 1e-6;
		const time = clampTime(isLead ? trimStartSec : gridTime);
		if (isLead) leadTime = time;
		else gridTimes.push(time);
		tiles.push({ left, right, time, gridTime: clampTime(gridTime), step });
	}

	let keyTimes: number[];
	let exactTimes: number[];
	if (step >= KEY_FRAME_STEP_S) {
		keyTimes = gridTimes;
		exactTimes = [];
	} else {
		// 4K: a screen of exact frames takes ~1.7 s, so key frames on a 1 s grid fill it first (~0.1 s).
		const keys = new Set<number>();
		const firstKey = Math.floor(sourceAt(from) / KEY_FRAME_STEP_S);
		const lastKey = Math.ceil(sourceAt(to) / KEY_FRAME_STEP_S) - 1;
		for (let k = firstKey; k <= lastKey; k++) keys.add(clampTime(k * KEY_FRAME_STEP_S));
		keyTimes = [...keys];
		exactTimes = gridTimes;
	}
	keyTimes.sort(byCentre);
	exactTimes.sort(byCentre);
	// A single time is always decoded exactly, so the clip's first frame goes with the exact ones.
	if (leadTime !== null) exactTimes.unshift(leadTime);
	// The speed and trim are part of the identity: two trims can share the same grid indices but show different
	// frames, and the cache would have kept the old pictures.
	return {
		tiles,
		keyTimes,
		exactTimes,
		requestKey: `${step}|${firstK}|${lastK}|${leadTime ?? ""}|${rate}|${trimStartSec}`,
	};
}

/** Speed ramp: the grid follows the clip's time (the picture under a tile depends on the ramp). */
function layoutOnClipGrid({
	from,
	to,
	centrePx,
	pixelsPerSecond,
	tileWidthPx,
	trimStartSec,
	clipDurationSec,
	retime,
	clampTime,
}: {
	from: number;
	to: number;
	centrePx: number;
	pixelsPerSecond: number;
	tileWidthPx: number;
	trimStartSec: number;
	clipDurationSec: number;
	retime: RetimeConfig;
	clampTime: (time: number) => number;
}): FilmstripLayout {
	const step = quantiseStep(tileWidthPx / pixelsPerSecond);
	const sourceAt = (clipTime: number) =>
		clampTime(trimStartSec + getSourceSpanAtClipTime({ clipTime, retime, duration: clipDurationSec }));
	const tiles: FilmstripTile[] = [];
	const firstK = Math.floor(from / pixelsPerSecond / step + 1e-9);
	const lastK = Math.ceil(to / pixelsPerSecond / step - 1e-9) - 1;
	for (let k = firstK; k <= lastK; k++) {
		tiles.push({ left: k * step * pixelsPerSecond, right: (k + 1) * step * pixelsPerSecond, time: sourceAt(k * step), gridTime: 0, step: 0 });
	}
	const centre = centrePx / pixelsPerSecond;
	const times = tiles
		.map((tile, i) => ({ time: tile.time, distance: Math.abs((firstK + i) * step - centre) }))
		.sort((a, b) => a.distance - b.distance)
		.map((entry) => entry.time);
	// The curve is part of the identity: editing its points changes every tile's source time while the grid
	// (step, firstK, lastK) stays the same.
	return {
		tiles,
		keyTimes: times,
		exactTimes: [],
		requestKey: `ramp|${step}|${firstK}|${lastK}|${trimStartSec}|${retime.curve ? curveKey(retime.curve) : ""}`,
	};
}

/** The largest power of two not above the ideal spacing (tiles get at most half narrower than a frame). */
export function quantiseStep(idealSec: number): number {
	if (!(idealSec > 0)) return FILMSTRIP_MAX_STEP_S;
	const step = 2 ** Math.floor(Math.log2(idealSec) + 1e-9);
	return Math.max(FILMSTRIP_MIN_STEP_S, Math.min(FILMSTRIP_MAX_STEP_S, step));
}

/**
 * Cached frames to show until the tile's own arrives, nearest first: the grid frame before the trim point (for the
 * tile cut by the left edge), then the same moment on coarser grids (earlier zoom levels, the key-frame pass).
 * Built only for tiles whose frame is missing: a zoom step lays out every tile on screen.
 */
export function tileFallbacks(tile: FilmstripTile): number[] {
	const times: number[] = tile.gridTime !== tile.time && tile.step > 0 ? [tile.gridTime] : [];
	if (tile.step <= 0) return times;
	for (let grid = tile.step * 2; grid <= FILMSTRIP_MAX_STEP_S; grid *= 2) {
		const coarse = Math.floor(tile.gridTime / grid + 1e-9) * grid;
		if (coarse !== tile.time && times[times.length - 1] !== coarse) times.push(coarse);
	}
	return times;
}
