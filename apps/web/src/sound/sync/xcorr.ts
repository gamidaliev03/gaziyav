// Sync by waveform, the arithmetic: where one recording of an event lies against another, from the sound itself.
//
// Two steps, as an ear would: first roughly, on the loudness outline of the whole of both recordings (five
// milliseconds a point: an hour is a short list), then exactly, on the samples themselves in a dozen short windows
// along the stretch they share. Each window gives the lag to a fraction of a sample; the lags along the stretch, as
// a straight line, give the offset and the drift — how much one recorder's clock runs against the other's.
//
// `lag` everywhere: time in A minus time in B of the same sound, seconds. Pure (the FFT is hear/dsp's).
import { fft } from "@/hear/dsp";

export const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * Cross-correlation of two real signals by FFT, for every lag k in −(N/2) … N/2 − 1 (r[(k + N) % N] is the sum of
 * a[n + k] · b[n]). `whiten` between 0 and 1 flattens the spectrum (1 = phase only): a sharper, narrower peak for
 * sounds whose tone differs between two microphones.
 */
export function correlate(a: ArrayLike<number>, b: ArrayLike<number>, whiten = 0): Float64Array {
	const n = nextPow2(a.length + b.length);
	const ar = new Float64Array(n);
	const ai = new Float64Array(n);
	const br = new Float64Array(n);
	const bi = new Float64Array(n);
	for (let i = 0; i < a.length; i++) ar[i] = a[i];
	for (let i = 0; i < b.length; i++) br[i] = b[i];
	fft(ar, ai);
	fft(br, bi);
	// A · conj(B), then back (the inverse transform as the forward one of the conjugate)
	let top = 0;
	for (let i = 0; i < n; i++) {
		const re = ar[i] * br[i] + ai[i] * bi[i];
		const im = ai[i] * br[i] - ar[i] * bi[i];
		ar[i] = re;
		ai[i] = -im;
		const m = Math.hypot(re, im);
		if (m > top) top = m;
	}
	if (whiten > 0 && top > 0) {
		const floor = top * 1e-6;
		for (let i = 0; i < n; i++) {
			const m = Math.hypot(ar[i], ai[i]);
			const w = (m + floor) ** -whiten;
			ar[i] *= w;
			ai[i] *= w;
		}
	}
	fft(ar, ai);
	for (let i = 0; i < n; i++) ar[i] /= n;
	return ar;
}

/** The outline a recording is found by: the change of its level from one point to the next, in dB. */
export function outline(energy: ArrayLike<number>): Float32Array {
	const out = new Float32Array(energy.length);
	let last = 10 * Math.log10(energy[0] + 1e-9);
	for (let i = 1; i < energy.length; i++) {
		const now = 10 * Math.log10(energy[i] + 1e-9);
		out[i] = now - last;
		last = now;
	}
	return out;
}

/** Under this the rough search found nothing the two recordings share. */
export const MATCH_SCORE = 12;
/** A window's peak must stand this far over the next best for the window to count. */
export const SHARP_ENOUGH = 1.4;

export interface CoarseLag {
	/** Seconds: time in A minus time in B of the same sound. */
	lag: number;
	/**
	 * How far the best match stands above the others (its height over the spread of all lags). Two recordings of one
	 * event give 20 and far more; two unrelated sounds 6 to 9 (the best of thousands of chance lags): see MATCH_SCORE.
	 */
	score: number;
	/** Seconds of sound the two share at that lag. */
	overlap: number;
}

/**
 * The rough lag from the two outlines (points `hop` seconds apart). Only lags that leave `minOverlap` seconds in
 * common count. Each lag's sum is weighed by how much the two share there, so a short overlap is not out-voted by a
 * long one.
 */
export function coarseLag(a: Float32Array, b: Float32Array, hop: number, minOverlap = 2): CoarseLag | null {
	if (a.length < 8 || b.length < 8) return null;
	const r = correlate(a, b);
	const n = r.length;
	const least = Math.max(4, Math.round(minOverlap / hop));
	let best = Number.NEGATIVE_INFINITY;
	let bestK = 0;
	let sum = 0;
	let sumSq = 0;
	let count = 0;
	for (let k = -(b.length - 1); k <= a.length - 1; k++) {
		const shared = Math.min(a.length, b.length + k) - Math.max(0, k);
		if (shared < least) continue;
		const value = r[(k + n) % n] / Math.sqrt(shared);
		sum += value;
		sumSq += value * value;
		count++;
		if (value > best) {
			best = value;
			bestK = k;
		}
	}
	if (count < 3) return null;
	const mean = sum / count;
	const spread = Math.sqrt(Math.max(1e-12, sumSq / count - mean * mean));
	const shared = Math.min(a.length, b.length + bestK) - Math.max(0, bestK);
	return { lag: bestK * hop, score: (best - mean) / spread, overlap: shared * hop };
}

export interface FineLag {
	/** Samples (a fraction too): where B's window lies against A's, added to the lag the windows were cut by. */
	samples: number;
	/** The peak against the next best elsewhere: 1 = no better than chance, 2 and up = a clear match. */
	sharpness: number;
	/** The two are the same sound upside down (a microphone wired the other way): found all the same. */
	inverted: boolean;
}

/**
 * The exact lag of two windows of samples at one rate. `b` was cut `reach` samples wider on both sides than `a`: the
 * answer lies within ±reach. The peak's place between two samples is read from its two neighbours.
 */
export function fineLag(a: Float32Array, b: Float32Array, reach: number): FineLag | null {
	if (a.length < 64 || b.length < a.length) return null;
	// speech and music carry most of their power low down: the difference of neighbours evens the spectrum
	const pre = (x: Float32Array) => {
		const out = new Float32Array(x.length);
		for (let i = 1; i < x.length; i++) out[i] = x[i] - 0.95 * x[i - 1];
		return out;
	};
	// r[k] = Σ b[n + k] · a[n]: a's first sample lies k samples into b
	const r = correlate(pre(b), pre(a), 0.6);
	// the highest peak either way up: a sound recorded with its polarity turned is the same sound
	let best = 0;
	let at = reach;
	for (let k = 0; k <= 2 * reach && k < r.length; k++) {
		const size = r[k] < 0 ? -r[k] : r[k];
		if (size > best) {
			best = size;
			at = k;
		}
	}
	const sign = r[at] < 0 ? -1 : 1;
	// the next best peak away from this one (a few samples off is the same peak)
	let other = 0;
	for (let k = 0; k <= 2 * reach && k < r.length; k++) {
		const size = r[k] < 0 ? -r[k] : r[k];
		if (Math.abs(k - at) > 8 && size > other) other = size;
	}
	let fraction = 0;
	if (at > 0 && at < 2 * reach) {
		const l = sign * r[at - 1];
		const m = sign * r[at];
		const h = sign * r[at + 1];
		const bend = l - 2 * m + h;
		if (bend < 0) fraction = Math.max(-0.5, Math.min(0.5, (0.5 * (l - h)) / bend));
	}
	// a's first sample lies `at` samples into b, and b was cut `reach` early: B is `reach − at` later than A said
	return { samples: reach - (at + fraction), sharpness: other > 0 ? best / other : 99, inverted: sign < 0 };
}

export interface DriftFit {
	/** The lag at time `at` (seconds), seconds. */
	lag: number;
	at: number;
	/** How fast the lag grows: seconds per second (1e-4 = 0.01 %: one recorder's clock runs that much against the other's). */
	drift: number;
	/** The windows the line was drawn through, and the largest distance of one of them from it, seconds. */
	used: number;
	residual: number;
}

const median = (values: number[]) => {
	const sorted = [...values].sort((x, y) => x - y);
	return sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : 0;
};

/**
 * A straight line through the windows' lags: the slope is the median of the slopes between pairs of windows (one
 * or two wrong windows do not turn it), the level the median of what is left. Windows further than `tolerance` from
 * the line are left out of the count. `at`: the time the line's lag is given for.
 */
export function fitDrift(points: ReadonlyArray<{ t: number; lag: number }>, at: number, tolerance = 0.002): DriftFit | null {
	if (points.length === 0) return null;
	if (points.length === 1) return { lag: points[0].lag, at, drift: 0, used: 1, residual: 0 };
	const slopes: number[] = [];
	const span = Math.max(...points.map((p) => p.t)) - Math.min(...points.map((p) => p.t));
	for (let i = 0; i < points.length; i++) {
		for (let j = i + 1; j < points.length; j++) {
			// pairs far apart say the most about the slope
			if (Math.abs(points[j].t - points[i].t) >= span * 0.3) slopes.push((points[j].lag - points[i].lag) / (points[j].t - points[i].t));
		}
	}
	let drift = slopes.length ? median(slopes) : 0;
	let level = median(points.map((p) => p.lag - drift * (p.t - at)));
	const near = points.filter((p) => Math.abs(p.lag - (level + drift * (p.t - at))) <= tolerance);
	if (near.length >= 3) {
		// least squares through the windows that agree
		const mt = near.reduce((s, p) => s + p.t, 0) / near.length;
		const ml = near.reduce((s, p) => s + p.lag, 0) / near.length;
		let num = 0;
		let den = 0;
		for (const p of near) {
			num += (p.t - mt) * (p.lag - ml);
			den += (p.t - mt) ** 2;
		}
		if (den > 0) {
			drift = num / den;
			level = ml + drift * (at - mt);
		}
	}
	const kept = near.length ? near : [...points];
	const residual = Math.max(...kept.map((p) => Math.abs(p.lag - (level + drift * (p.t - at)))));
	return { lag: level, at, drift, used: kept.length, residual };
}
