// Frames kept for playing backwards (J, ← held): a decoder only runs forwards, so each step back used to seek to the
// key frame before it and decode up to it again — a whole group of pictures per frame shown. J on a 4K HEVC editing
// copy showed 3 real frames a second, the rest the last frame held (pro-heavy, 09.11). One step back now decodes the
// group once, from its key frame up to the frame on screen, keeps those frames drawn, and the next steps take them
// from here. Pure helpers: VideoCache (service.ts) owns the canvases.

/** A step back of at most this many frames (J at ×8) and this long fills the store; a jump further is a plain seek. */
export const REVERSE_STEP_MAX_FRAMES = 9;
export const REVERSE_STEP_MAX_S = 1;

/** Frames the store keeps: what fits in `budgetBytes` at this size, never fewer than 4 or more than 120. */
export function backCapacity({ width, height, budgetBytes }: { width: number; height: number; budgetBytes: number }): number {
	const bytes = Math.max(1, width * height * 4);
	return Math.max(4, Math.min(120, Math.floor(budgetBytes / bytes)));
}

/** The frame on screen at `time` among frames in time order: the last one starting at or before it, inside the span. */
export function findBackFrame<T extends { timestamp: number; duration: number }>(frames: readonly T[], time: number, eps: number): T | null {
	if (!frames.length) return null;
	const last = frames[frames.length - 1];
	if (time < frames[0].timestamp - eps || time >= last.timestamp + last.duration - eps) return null;
	let lo = 0;
	let hi = frames.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (frames[mid].timestamp <= time + eps) lo = mid;
		else hi = mid - 1;
	}
	return frames[lo].timestamp <= time + eps ? frames[lo] : null;
}

/**
 * A request just behind the frame on screen (J, a frame step back): worth keeping the group it falls in. A cut that
 * jumps back further in the same source is a plain seek (drawing a whole group there would only slow playback).
 */
export function isReverseStep({ shown, frameDuration, time, eps }: { shown: number | null; frameDuration: number; time: number; eps: number }): boolean {
	if (shown === null || !(time < shown - eps)) return false;
	const step = frameDuration > 0 ? REVERSE_STEP_MAX_FRAMES * frameDuration : REVERSE_STEP_MAX_S;
	return shown - time <= Math.min(step, REVERSE_STEP_MAX_S) + eps;
}
