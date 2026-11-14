/**
 * How many frames an export writes for a timeline of `durationTicks`.
 *
 * Frames are written at 0, 1, 2 … ticksPerFrame; the last one starts before the timeline ends even when the
 * duration is not a whole number of frames (a 10 s clip at 29.97 is 299.7 frames, not 299). Flooring the ratio
 * dropped that partial last frame — and with it the last 10–30 ms of picture at every NTSC rate.
 */
export function exportedFrameCount({
	durationTicks,
	ticksPerFrame,
}: {
	durationTicks: number;
	ticksPerFrame: number;
}): number {
	if (!(durationTicks > 0) || !(ticksPerFrame > 0)) return 0;
	return Math.ceil(durationTicks / ticksPerFrame);
}

/**
 * Where frame `index` of an export starts and how long it lasts, in ticks: every frame is one whole frame of the file,
 * the last too. The file's track counts time in frames of its own rate (mediabunny's timescale is the rate), so a part
 * of a frame cannot be written: at 60 a half last frame (137 frames of 24) came out as a sample of no length and the
 * frame was gone from the file (exp, 14.11). The sound still ends where the timeline ends (the edit list,
 * export/mp4-edit-list.ts) — within one frame of the picture.
 */
export function exportedFrameSpan({
	index,
	durationTicks,
	ticksPerFrame,
}: {
	index: number;
	durationTicks: number;
	ticksPerFrame: number;
}): { start: number; length: number } {
	const start = index * ticksPerFrame;
	return { start, length: start < durationTicks ? ticksPerFrame : 0 };
}

// ── exp (14.11): the frame arithmetic of a file at another rate than the timeline's, in exact rationals ─────────────

/** A frame rate as an exact fraction (23.976 → 24000/1001, 29.97 → 30000/1001, 59.94 → 60000/1001, 25 → 25/1). */
export interface ExactRate {
	numerator: number;
	denominator: number;
}

const NTSC: ReadonlyArray<[number, number]> = [[24_000, 1_001], [30_000, 1_001], [48_000, 1_001], [60_000, 1_001], [120_000, 1_001]];

/** The exact rate a number names: an NTSC rate (± 0.01) is its fraction, anything else a whole number of frames a second. */
export function exactRate(fps: number | ExactRate): ExactRate {
	if (typeof fps !== "number") return fps;
	const ntsc = NTSC.find(([n, d]) => Math.abs(fps - n / d) < 0.01);
	if (ntsc) return { numerator: ntsc[0], denominator: ntsc[1] };
	return { numerator: Math.max(1, Math.round(fps)), denominator: 1 };
}

/** The rate as a number for an API that wants one: always the fraction's own value (59.94005994…, never 59.94). */
export const rateValue = (rate: ExactRate) => rate.numerator / rate.denominator;

/**
 * Frames a file at `rate` holds for `durationTicks` of timeline: every frame that starts before the timeline ends
 * (ceil), computed on integers — ticks × numerator ÷ (ticks a second × denominator) — never a float duration × fps.
 */
export function framesAt({ durationTicks, rate, ticksPerSecond }: { durationTicks: number; rate: ExactRate; ticksPerSecond: number }): number {
	if (!(durationTicks > 0)) return 0;
	// (both products are integers far below 2^53 — ten hours at 60000/1001 is 2.6e14 — so the quotient of two exact
	// integers is rounded once and its ceiling is exact)
	return Math.ceil((Math.round(durationTicks) * rate.numerator) / (ticksPerSecond * rate.denominator));
}

/** How long the cover shows at the start of a file: a tenth of a second in whole frames of the file's rate, at least one. */
export const COVER_SECONDS = 0.1;
export function coverFrames(rate: ExactRate): number {
	return Math.max(1, Math.round((COVER_SECONDS * rate.numerator) / rate.denominator));
}
/** The cover's length in seconds at `rate` (exactly its frames: 6 at 60 → 0.1 s, 6 at 59.94 → 0.1001 s). */
export const coverSeconds = (rate: ExactRate) => (coverFrames(rate) * rate.denominator) / rate.numerator;

/**
 * The cover in a file drawn at `drawRate` that becomes a file at another rate (a master for frame interpolation): it
 * lasts `seconds` there exactly. Whole frames when `seconds` is a whole number of `drawRate` frames; else one frame that
 * lasts the whole of it (3 frames at 30 for 0.1 s, one 0.1 s frame at 24 or 25), so the timeline starts exactly where
 * the cover of the final file ends.
 */
export function coverDrawing(seconds: number, drawRate: ExactRate): { frames: number; frameSeconds: number } {
	const whole = Math.max(1, Math.round((seconds * drawRate.numerator) / drawRate.denominator));
	const wholeSeconds = (whole * drawRate.denominator) / drawRate.numerator;
	if (Math.abs(wholeSeconds - seconds) < 1e-6) return { frames: whole, frameSeconds: drawRate.denominator / drawRate.numerator };
	return { frames: 1, frameSeconds: seconds };
}
