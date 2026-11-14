// The song's score from its four stems — plain signal processing, pure (mono Float32 at SCORE_RATE in, a SongScore
// out). Measured on a separated drum stem the beat is far cleaner than on the mix (assist/beats.ts heard the mix):
//  · each stem: 10 ms frames of level → where it plays (over its own floor, hysteresis, short gaps bridged);
//  · drums: three bands (low = kick, mid = snare, high = hats/cymbals) → hits; their onset curve → the local tempo
//    (autocorrelation in 6 s windows), a beat tracker (dynamic programming, Ellis 2007) per tempo stretch, the beats
//    pulled to the onset peaks, the downbeat from where the snare lands (2 and 4) and where the parts come in;
//  · vocals: phrases (pauses ≥ 0.6 s split them); «other»: note and strum attacks;
//  · sections from the bars' pattern of parts and energy; a name only where repetition and contrast support it.
import { fft } from "./dsp";
import { type NetBeats, referee } from "./net-grid";
import { PARTS, type Hit, type PartName, type PartScore, type Phrase, type Section, type SongScore, type Span } from "./score-types";

/** A score the beat network was asked about (net-grid.ts): a score made without it is redone once the network is here. */
export const NET_SCORE_VERSION = 2.1;
export const SCORE_VERSION = 2; // 1 → 2 at the night merge: timing and words logic changed after v1 caches were written
/** Analysis rate of the stems (12 kHz of sound: enough for the hats). */
export const SCORE_RATE = 24000;
/** Frame hop: 10 ms. */
export const FPS = 100;
const HOP = SCORE_RATE / FPS;
const WIN = 1024;
/**
 * The analysis window (1024 samples, centred) sees an attack before it happens: the half-rise of a band's level comes
 * 15 ms early and the onset curve's peak 8 ms early (measured on clicks at known times: kicks, snares and hats alike,
 * spread ≤ 1.3 ms). The times are moved by that much.
 */
const LEAD = 0.015;
const BEAT_LEAD = 0.008;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const db = (p: number) => 10 * Math.log10(p + 1e-12);

export function percentile(values: ArrayLike<number>, p: number): number {
	if (!values.length) return 0;
	const a = Float64Array.from(values as ArrayLike<number>).sort();
	return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
}

/** Level (dB of the mean power) over a centred window of `ms` around every 10 ms frame. */
export function levelFrames(x: Float32Array, ms = 20): Float32Array {
	const n = Math.max(1, Math.ceil(x.length / HOP));
	const half = Math.round((SCORE_RATE * ms) / 2000);
	// running sum of squares
	const cum = new Float64Array(x.length + 1);
	for (let i = 0; i < x.length; i++) cum[i + 1] = cum[i] + x[i] * x[i];
	const out = new Float32Array(n);
	for (let f = 0; f < n; f++) {
		const c = f * HOP;
		const a = Math.max(0, c - half);
		const b = Math.min(x.length, c + half);
		out[f] = b > a ? db((cum[b] - cum[a]) / (b - a)) : -120;
	}
	return out;
}

/** Mean of dB frames as power, over [a, b) frames. */
function meanDb(l: Float32Array, a: number, b: number): number {
	let s = 0;
	let k = 0;
	for (let f = Math.max(0, a); f < Math.min(l.length, b); f++) {
		s += 10 ** (l[f] / 10);
		k++;
	}
	return k ? db(s / k) : -120;
}

export interface Activity {
	active: Span[];
	peakDb: number;
	floorDb: number;
}

/**
 * Where a stem plays: frames over its «on» level start a stretch, under «off» (6 dB lower) end it; gaps shorter than
 * `bridge` seconds are bridged, stretches shorter than `min` dropped. «on» sits halfway between the stem's floor
 * (its 10th percentile: leakage of the other parts) and its level (95th percentile), at most 24 dB under that level.
 */
export function activityOf(level: Float32Array, { bridge = 0.4, min = 0.2, silentDb = -58 }: { bridge?: number; min?: number; silentDb?: number } = {}): Activity {
	const peak = percentile(level, 0.95);
	const floor = Math.max(-100, percentile(level, 0.1));
	if (peak < silentDb) return { active: [], peakDb: Math.round(peak), floorDb: Math.round(floor) };
	const on = Math.max(floor + 0.5 * (peak - floor), peak - 24, silentDb);
	const off = on - 6;
	const raw: Span[] = [];
	let start = -1;
	for (let f = 0; f < level.length; f++) {
		if (start < 0 && level[f] >= on) start = f;
		else if (start >= 0 && level[f] < off) {
			raw.push([start / FPS, f / FPS]);
			start = -1;
		}
	}
	if (start >= 0) raw.push([start / FPS, level.length / FPS]);
	const merged: Span[] = [];
	for (const s of raw) {
		const last = merged[merged.length - 1];
		if (last && s[0] - last[1] < bridge) last[1] = s[1];
		else merged.push([s[0], s[1]]);
	}
	return { active: merged.filter((s) => s[1] - s[0] >= min).map(([a, b]) => [r3(a), r3(b)] as Span), peakDb: Math.round(peak), floorDb: Math.round(floor) };
}

/** Band powers per frame (Hann window of 1024 samples centred on each frame): [low, mid, high, all] as dB. */
export function bandFrames(x: Float32Array, bands: Array<[number, number]>): Float32Array[] {
	const n = Math.max(1, Math.ceil(x.length / HOP));
	const out = bands.map(() => new Float32Array(n));
	const re = new Float64Array(WIN);
	const im = new Float64Array(WIN);
	const hann = new Float64Array(WIN);
	for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));
	const bins = bands.map(([lo, hi]) => [Math.max(1, Math.round((lo * WIN) / SCORE_RATE)), Math.min(WIN / 2, Math.round((hi * WIN) / SCORE_RATE))]);
	for (let f = 0; f < n; f++) {
		const c = f * HOP - WIN / 2;
		let any = false;
		for (let i = 0; i < WIN; i++) {
			const v = x[c + i] ?? 0;
			re[i] = v * hann[i];
			im[i] = 0;
			if (v !== 0) any = true;
		}
		if (!any) {
			for (const o of out) o[f] = -120;
			continue;
		}
		fft(re, im);
		bins.forEach(([a, b], k) => {
			let s = 0;
			for (let i = a; i < b; i++) s += re[i] * re[i] + im[i] * im[i];
			out[k][f] = db(s / WIN);
		});
	}
	return out;
}

/** Positive rise of a dB curve over the frame 2 back (an attack), 0 under `gate` dB. */
function riseOf(l: Float32Array, gate: number): Float32Array {
	const o = new Float32Array(l.length);
	for (let f = 2; f < l.length; f++) o[f] = l[f] >= gate ? Math.max(0, l[f] - Math.max(l[f - 1], l[f - 2] - 3) ) + 0.5 * Math.max(0, l[f - 1] - l[f - 2]) : 0;
	return o;
}

/** Peaks of an onset curve: over `min`, the highest within ±`gap` frames. */
function peaksOf(o: Float32Array, min: number, gap: number): number[] {
	const out: number[] = [];
	for (let f = 1; f < o.length - 1; f++) {
		if (o[f] < min || o[f] < o[f - 1] || o[f] < o[f + 1]) continue;
		let top = true;
		for (let g = Math.max(0, f - gap); g <= Math.min(o.length - 1, f + gap); g++) if (o[g] > o[f] || (o[g] === o[f] && g < f)) top = false;
		if (top) out.push(f);
	}
	return out;
}

/** The time of the attack at frame f: where the band's level crosses halfway up its rise (sub-frame). */
function attackTime(l: Float32Array, f: number): number {
	const lo = Math.min(l[f - 2] ?? l[f], l[f - 1] ?? l[f]);
	let top = l[f];
	for (let g = f; g < Math.min(l.length, f + 3); g++) top = Math.max(top, l[g]);
	const mid = lo + 0.5 * (top - lo);
	for (let g = Math.max(1, f - 2); g <= f + 2 && g < l.length; g++) {
		if (l[g] >= mid) {
			const a = l[g - 1];
			const t = l[g] > a ? (mid - a) / (l[g] - a) : 1;
			return (g - 1 + Math.max(0, Math.min(1, t))) / FPS;
		}
	}
	return f / FPS;
}

export interface DrumHits {
	hits: Hit[];
	/** Onset strength per frame for the beat tracker (kick + snare + half the hats, each scaled to its own range). */
	onset: Float32Array;
}

/** The drum stem's hits by band: kick (40–150 Hz), snare (150–2500 Hz, not at a kick alone), hats (6–11 kHz). */
export function drumHits(x: Float32Array, active: Span[]): DrumHits {
	const [low, mid, high] = bandFrames(x, [
		[40, 150],
		[180, 2500],
		[6000, 11000],
	]);
	const n = low.length;
	const inside = new Uint8Array(n);
	for (const [a, b] of active) for (let f = Math.floor(a * FPS); f < Math.min(n, Math.ceil(b * FPS)); f++) inside[f] = 1;
	const band = (l: Float32Array) => {
		const top = percentile(l, 0.97);
		const o = riseOf(l, top - 30);
		return { l, top, o, scale: Math.max(3, percentile(Float32Array.from(o).filter((v) => v > 0), 0.9)) };
	};
	const K = band(low);
	const S = band(mid);
	const H = band(high);
	const onset = new Float32Array(n);
	for (let f = 0; f < n; f++) onset[f] = inside[f] ? Math.min(2, K.o[f] / K.scale) + Math.min(2, S.o[f] / S.scale) + 0.5 * Math.min(2, H.o[f] / H.scale) : 0;
	const hits: Hit[] = [];
	const take = (B: ReturnType<typeof band>, kind: Hit[1], gap: number, near: number) => {
		const out: Array<[number, number, number]> = [];
		for (const f of peaksOf(B.o, B.scale * 0.35, gap)) {
			if (!inside[f]) continue;
			let top = B.l[f];
			for (let g = f; g < Math.min(n, f + 4); g++) top = Math.max(top, B.l[g]);
			if (top < B.top - near) continue;
			out.push([f, attackTime(B.l, f) + LEAD, Math.min(1, B.o[f] / (2 * B.scale))]);
		}
		return out;
	};
	const kicks = take(K, "k", 8, 12);
	const snares = take(S, "s", 8, 12);
	const hats = take(H, "h", 5, 18);
	const nearAny = (list: Array<[number, number, number]>, f: number, w: number) => list.some(([g]) => Math.abs(g - f) <= w);
	// A kick's thump reaches the mid band: a «snare» at a kick counts when the mid band stands out over the low band
	// by 4 dB more than at the quieter quarter of the kicks (the kicks alone).
	const peakIn = (l: Float32Array, f: number) => Math.max(l[f] ?? -120, l[f + 1] ?? -120, l[f + 2] ?? -120, l[f + 3] ?? -120);
	const ratio = (f: number) => peakIn(mid, f) - peakIn(low, f);
	const kickRatio = kicks.length ? percentile(kicks.map(([f]) => ratio(f)), 0.25) : -Infinity;
	for (const s of snares) {
		const k = kicks.find(([g]) => Math.abs(g - s[0]) <= 2);
		if (!k || ratio(k[0]) >= kickRatio + 4) hits.push([r3(s[1]), "s", r3(s[2])]);
	}
	for (const k of kicks) hits.push([r3(k[1]), "k", r3(k[2])]);
	// A snare's noise reaches the hats' band: a hat at a snare is the snare.
	for (const h of hats) if (!nearAny(snares, h[0], 2)) hits.push([r3(h[1]), "h", r3(h[2])]);
	hits.sort((a, b) => a[0] - b[0]);
	return { hits, onset };
}

/** Onset strength of a tonal stem (bass, other): its full-band rise, scaled. */
export function tonalOnsets(x: Float32Array): { onset: Float32Array; attacks: number[] } {
	const [all] = bandFrames(x, [[60, 6000]]);
	const top = percentile(all, 0.97);
	const o = riseOf(all, top - 30);
	const scale = Math.max(3, percentile(Float32Array.from(o).filter((v) => v > 0), 0.9));
	const onset = o.map((v) => Math.min(2, v / scale));
	const attacks = peaksOf(o, scale * 0.5, 8).filter((f) => all[f + 2] >= top - 20).map((f) => r3(attackTime(all, f) + LEAD));
	return { onset, attacks };
}

// ───────────────────────── tempo and beats ─────────────────────────

/** The beat period (frames) of an onset stretch: autocorrelation 60–220 BPM, a prior around 120, an octave check. */
export function periodOf(o: ArrayLike<number>, a: number, b: number): { period: number; strength: number } {
	const minLag = Math.floor((FPS * 60) / 220);
	const maxLag = Math.ceil((FPS * 60) / 60);
	let mean = 0;
	for (let i = a; i < b; i++) mean += o[i];
	mean /= Math.max(1, b - a);
	const ac = (lag: number) => {
		let s = 0;
		for (let i = a + lag; i < b; i++) s += (o[i] - mean) * (o[i - lag] - mean);
		return s / Math.max(1, b - a - lag);
	};
	const acs = new Float64Array(maxLag + 2);
	for (let lag = minLag - 1; lag <= maxLag + 1; lag++) acs[lag] = ac(lag);
	let best = minLag;
	let bestScore = -Infinity;
	for (let lag = minLag; lag <= maxLag; lag++) {
		const bpm = (60 * FPS) / lag;
		const s = acs[lag] * Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.2) ** 2);
		if (acs[lag] >= acs[lag - 1] && acs[lag] >= acs[lag + 1] && s > bestScore) {
			bestScore = s;
			best = lag;
		}
	}
	// the faster octave when its periodicity is nearly as strong (a grid of half notes is still a grid)
	while (Math.round(best / 2) >= minLag) {
		const h = Math.round(best / 2);
		const peak = Math.max(acs[h - 1], acs[h], acs[h + 1]);
		if (peak <= 0.6 * acs[best]) break;
		best = acs[h - 1] > acs[h] && acs[h - 1] > acs[h + 1] ? h - 1 : acs[h + 1] > acs[h] ? h + 1 : h;
	}
	// a triplet reading (two beats heard as three, 100 ↔ 150 BPM): the faster when it is nearly as strong
	const t = Math.round((best * 2) / 3);
	if (t >= minLag) {
		const peak = Math.max(acs[t - 1], acs[t], acs[t + 1]);
		if (peak >= 0.75 * acs[best]) best = acs[t - 1] > acs[t] && acs[t - 1] > acs[t + 1] ? t - 1 : acs[t + 1] > acs[t] ? t + 1 : t;
	}
	const y0 = acs[best - 1];
	const y1 = acs[best];
	const y2 = acs[best + 1];
	const d = y0 - 2 * y1 + y2;
	const period = best + (Math.abs(d) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : 0);
	return { period, strength: y1 / Math.max(1e-9, acs[0] || 1) };
}

/** The autocorrelation of [a, b) at `lag` frames (mean removed), and the best within ±3 % of it. */
function acNear(o: ArrayLike<number>, a: number, b: number, lag: number): { value: number; lag: number } {
	let mean = 0;
	for (let i = a; i < b; i++) mean += o[i];
	mean /= Math.max(1, b - a);
	const at = (l: number) => {
		let s = 0;
		for (let i = a + l; i < b; i++) s += (o[i] - mean) * (o[i - l] - mean);
		return s / Math.max(1, b - a - l);
	};
	let best = { value: -Infinity, lag };
	for (let l = Math.floor(lag * 0.97); l <= Math.ceil(lag * 1.03); l++) {
		const v = at(l);
		if (v > best.value) best = { value: v, lag: l };
	}
	return best;
}

/** Ellis' dynamic-programming beat tracker over frames [a, b) with a beat period `p` (frames). */
export function trackBeats(o: ArrayLike<number>, a: number, b: number, p: number, tightness = 120): number[] {
	const n = b - a;
	if (n < p * 2) return [];
	let sd = 0;
	let m = 0;
	for (let i = a; i < b; i++) m += o[i];
	m /= n;
	for (let i = a; i < b; i++) sd += (o[i] - m) ** 2;
	sd = Math.sqrt(sd / n) || 1;
	const score = new Float64Array(n);
	const from = new Int32Array(n).fill(-1);
	for (let t = 0; t < n; t++) {
		const local = o[a + t] / sd;
		let best = 0;
		let arg = -1;
		for (let tau = Math.max(0, Math.round(t - 2 * p)); tau <= t - Math.round(p / 2); tau++) {
			const v = score[tau] - tightness * Math.log((t - tau) / p) ** 2;
			if (v > best || arg < 0) {
				best = v;
				arg = tau;
			}
		}
		score[t] = local + (arg >= 0 ? Math.max(0, best) : 0);
		from[t] = arg >= 0 && best > 0 ? arg : -1;
	}
	// the end: the best score in the last period
	let end = n - 1;
	for (let t = Math.max(0, Math.round(n - p)); t < n; t++) if (score[t] > score[end]) end = t;
	const out: number[] = [];
	for (let t = end; t >= 0; t = from[t]) {
		out.push(a + t);
		if (from[t] < 0) break;
	}
	return out.reverse();
}

/** A beat pulled to the onset peak within ±3 frames (parabolic, sub-frame). */
function refine(o: ArrayLike<number>, f: number): number {
	let best = f;
	for (let g = Math.max(1, f - 3); g <= Math.min(o.length - 2, f + 3); g++) if (o[g] > o[best]) best = g;
	const y0 = o[best - 1] ?? 0;
	const y1 = o[best];
	const y2 = o[best + 1] ?? 0;
	const d = y0 - 2 * y1 + y2;
	return best + (Math.abs(d) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : 0);
}

/** Least-squares slope of times over their index: the period of a run of beats. */
function slope(t: number[]): number {
	const n = t.length;
	if (n < 2) return 0;
	const mx = (n - 1) / 2;
	const my = t.reduce((s, v) => s + v, 0) / n;
	let num = 0;
	let den = 0;
	t.forEach((v, i) => {
		num += (i - mx) * (v - my);
		den += (i - mx) ** 2;
	});
	return num / den;
}

export interface Grid {
	tempo: Array<{ start: number; end: number; bpm: number }>;
	beats: number[];
	/** Index into beats of each tempo stretch's first beat. */
	firsts: number[];
}

/**
 * Tempo stretches and beats over the frames where the beat is heard (`spans`): the local period in 6 s windows every
 * second; a new stretch where it moves by more than 4 % for at least 3 windows; beats tracked per stretch; the change
 * placed where the beats' own spacing changes.
 */
export function beatGrid(o: Float32Array, spans: Span[]): Grid {
	const tempo: Grid["tempo"] = [];
	const beats: number[] = [];
	const firsts: number[] = [];
	for (const [s0, s1] of spans) {
		const a = Math.floor(s0 * FPS);
		const b = Math.min(o.length, Math.ceil(s1 * FPS));
		if (b - a < 4 * FPS) continue;
		const W = 6 * FPS;
		const local: Array<{ c: number; p: number }> = [];
		// the song's own tempo over the whole stretch; a window keeps it while it still beats there (a fill or a
		// half-time bar reads as another tempo on its own, not a change of the song's)
		const whole = periodOf(o, a, b).period;
		for (let w = a; w + Math.min(W, b - a) <= b; w += FPS) {
			const w1 = w + Math.min(W, b - a);
			const own = periodOf(o, w, w1);
			let p = own.period;
			if (Math.abs(p / whole - 1) > 0.03) {
				const mine = acNear(o, w, w1, Math.round(p));
				const song = acNear(o, w, w1, Math.round(whole));
				if (song.value >= 0.6 * mine.value) p = song.lag;
			}
			local.push({ c: w + Math.min(W, b - a) / 2, p });
			if (b - a < W) break;
		}
		// median of 3 against single wobbly windows
		const med = local.map((x, i) => {
			const ps = local.slice(Math.max(0, i - 1), i + 2).map((y) => y.p).sort((m, n) => m - n);
			return { c: x.c, p: ps[Math.floor(ps.length / 2)] };
		});
		// runs of the same tempo (within 4 %), at least 3 windows long
		const runs: Array<{ from: number; to: number; p: number }> = [];
		for (const x of med) {
			const last = runs[runs.length - 1];
			if (last && Math.abs(x.p / last.p - 1) < 0.04) {
				last.to = x.c;
				last.p = (last.p * 3 + x.p) / 4;
			} else runs.push({ from: x.c, to: x.c, p: x.p });
		}
		const kept = runs.filter((r) => (r.to - r.from) / FPS >= 4 || runs.length === 1);
		const stretches = kept.length ? kept : runs.slice(0, 1);
		// boundaries halfway between runs, then tracked; the boundary refined by the beats' spacing afterwards
		const bounds: Array<[number, number, number]> = stretches.map((r, i) => [i === 0 ? a : Math.round((stretches[i - 1].to + r.from) / 2), i === stretches.length - 1 ? b : Math.round((r.to + stretches[i + 1].from) / 2), r.p]);
		// merge neighbours that ended up at the same tempo
		const merged: Array<[number, number, number]> = [];
		for (const x of bounds) {
			const last = merged[merged.length - 1];
			if (last && Math.abs(x[2] / last[2] - 1) < 0.04) last[1] = x[1];
			else merged.push([...x]);
		}
		// track the whole span once per tempo and keep each tempo's beats inside its own stretch, refining the switch
		const tracks = merged.map(([x0, x1, p]) => {
			const pad = Math.round(4 * p);
			const lo = Math.max(a, x0 - pad);
			const hi = Math.min(b, x1 + pad);
			return { x0, x1, p, beats: trackBeats(o, lo, hi, periodOf(o, Math.max(a, x0), Math.min(b, x1)).period || p).map((f) => refine(o, f)) };
		});
		for (let i = 0; i + 1 < tracks.length; i++) {
			// the switch: the point where the next tempo's beats fit better than this one's (the spacing changes)
			const A = tracks[i];
			const B = tracks[i + 1];
			let best = A.x1;
			let bestErr = Infinity;
			for (const cut of B.beats.filter((f) => f > A.x0 + 2 * A.p && f < B.x1 - 2 * B.p)) {
				const before = A.beats.filter((f) => f < cut - A.p * 0.25);
				const after = B.beats.filter((f) => f >= cut - 1e-6);
				if (before.length < 2 || after.length < 2) continue;
				const lastA = before[before.length - 1];
				const gapErr = Math.abs(cut - lastA - A.p) / A.p;
				// spacing error of the beats near the cut against each tempo
				const near = (list: number[], p: number) => list.slice(-4).reduce((s, f, k, arr) => (k ? s + Math.abs(f - arr[k - 1] - p) : s), 0);
				const err = near(before, A.p) + near(after.slice(0, 4), B.p) + gapErr * 4;
				if (err < bestErr) {
					bestErr = err;
					best = cut;
				}
			}
			A.x1 = best;
			B.x0 = best;
		}
		for (const t of tracks) {
			const mine = t.beats.filter((f) => f >= t.x0 - 0.3 * t.p && f < t.x1 - 0.3 * t.p && f >= a && f < b);
			if (mine.length < 4) continue;
			const times = mine.map((f) => f / FPS + BEAT_LEAD);
			// drop a beat that doubles another (closer than half a period)
			const clean = times.filter((v, i) => i === 0 || v - times[i - 1] > (0.5 * t.p) / FPS);
			const period = slope(clean);
			firsts.push(beats.length);
			beats.push(...clean.map(r3));
			tempo.push({ start: r3(clean[0]), end: r3(Math.min(t.x1 / FPS, clean[clean.length - 1] + period)), bpm: Math.round((60 / period) * 10) / 10 });
		}
	}
	// neighbours at the same tempo (within 2 %) that touch are one stretch
	for (let i = tempo.length - 1; i > 0; i--) {
		const x = tempo[i - 1];
		const y = tempo[i];
		if (Math.abs(y.bpm / x.bpm - 1) < 0.02 && y.start - x.end < 1) {
			const n0 = firsts[i - 1];
			const n1 = i + 1 < firsts.length ? firsts[i + 1] : beats.length;
			const run = beats.slice(n0, n1);
			x.end = y.end;
			x.bpm = Math.round((60 / slope(run)) * 10) / 10;
			tempo.splice(i, 1);
			firsts.splice(i, 1);
		}
	}
	return { tempo, beats, firsts };
}

/**
 * Bar 1 of each tempo stretch: of the four phases, the one where the snare lands on beats 2 and 4, the kick and the
 * cymbals on 1, and the parts come in (a stretch of any stem starting on a downbeat). 4/4 assumed.
 */
export function downbeats(grid: Grid, hits: Hit[], starts: number[]): { bars: number[]; confidence: number } {
	const bars: number[] = [];
	let sure = 1;
	grid.firsts.forEach((first, k) => {
		const last = k + 1 < grid.firsts.length ? grid.firsts[k + 1] : grid.beats.length;
		const b = grid.beats.slice(first, last);
		if (!b.length) return;
		const period = b.length > 1 ? (b[b.length - 1] - b[0]) / (b.length - 1) : 0.5;
		const w = Math.min(0.07, period * 0.2);
		const at = (t: number, kind: Hit[1]) => hits.reduce((m, h) => (h[1] === kind && Math.abs(h[0] - t) <= w ? Math.max(m, h[2]) : m), 0);
		const cameIn = (t: number) => starts.filter((s) => Math.abs(s - t) <= Math.max(0.1, w)).length;
		const K = b.map((t) => at(t, "k"));
		const S = b.map((t) => at(t, "s"));
		const H = b.map((t) => at(t, "h"));
		const C = b.map((t, i) => cameIn(t) + (i === 0 ? 1 : 0));
		const scores = [0, 1, 2, 3].map((phi) => {
			let s = 0;
			b.forEach((_, i) => {
				const pos = (((i - phi) % 4) + 4) % 4;
				if (pos === 0) s += K[i] + 0.5 * H[i] + 1.5 * C[i] - S[i];
				else if (pos === 1 || pos === 3) s += S[i] - 0.3 * K[i];
				else s += 0.3 * K[i] - 0.3 * S[i];
			});
			return s;
		});
		const order = [0, 1, 2, 3].sort((x, y) => scores[y] - scores[x]);
		const phi = order[0];
		sure = Math.min(sure, Math.max(0, Math.min(1, (scores[order[0]] - scores[order[1]]) / Math.max(1, Math.abs(scores[order[0]])))));
		for (let i = phi; i < b.length; i += 4) bars.push(b[i]);
		// a bar that starts before the stretch's first beat (it begins on beat 2–4): its downbeat by the grid
		if (phi > 0) bars.push(r3(b[0] - (4 - phi) * period));
	});
	return { bars: bars.sort((x, y) => x - y), confidence: Math.round(sure * 100) / 100 };
}

/** The bar grid over the whole song: the downbeats found, the grid continued before the first and after the last. */
export function fullBars(bars: number[], duration: number, fallback = 2): number[] {
	if (bars.length < 2) {
		const out: number[] = [];
		for (let t = 0; t < duration - 0.5; t += fallback) out.push(r3(t));
		return out;
	}
	const first = bars[1] - bars[0];
	const last = bars[bars.length - 1] - bars[bars.length - 2];
	const before: number[] = [];
	for (let t = bars[0] - first; t > -first * 0.5 && t > -0.25; t -= first) before.unshift(r3(Math.max(0, t)));
	const after: number[] = [];
	for (let t = bars[bars.length - 1] + last; t < duration - last * 0.5; t += last) after.push(r3(t));
	return [...before.filter((t, i, a) => i === 0 || t > a[i - 1]), ...bars, ...after].map((t) => Math.max(0, t)).filter((t, i, a) => i === 0 || t > a[i - 1] + 0.05);
}

// ───────────────────────── vocals, sections ─────────────────────────

/** Phrases on the vocal stem: its stretches split at pauses ≥ 0.6 s, with the words that fall in them. */
export function phrasesOf(active: Span[], words: Array<{ text: string; start: number; end: number }> = []): Phrase[] {
	return active
		.filter(([a, b]) => b - a >= 0.25)
		.map(([a, b]) => {
			const inside = words.filter((w) => (w.start + w.end) / 2 >= a - 0.3 && (w.start + w.end) / 2 <= b + 0.3);
			const text = inside.map((w) => w.text.trim()).join(" ").replace(/\s+([,.!?…])/g, "$1").trim();
			return { start: a, end: b, ...(text ? { text, words: inside.map((w) => [w.text.trim(), r3(w.start), r3(w.end)] as [string, number, number]) } : {}) };
		});
}

const SHARE = 0.5;
const share = (spans: Span[], a: number, b: number) => spans.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0) / Math.max(0.01, b - a);

/** Sections: runs of bars with the same parts sounding (and no jump in level); the same pattern again = the same letter. */
export function sectionsOf(bars: number[], duration: number, parts: Record<PartName, { active: Span[]; bars?: number[] }>, mixBars: number[]): Section[] {
	if (!bars.length) return [];
	const edges = [...bars, duration];
	const rows = bars.map((t, i) => ({ t, e: edges[i + 1], on: PARTS.map((p) => share(parts[p].active, t, edges[i + 1])), db: mixBars[i] ?? -120 }));
	// a voice sings in a bar when it is heard in a quarter of it (phrases breathe); the band when it plays half of it
	const pattern = (r: (typeof rows)[number]) => r.on.map((v, j) => (v >= (PARTS[j] === "vocals" ? 0.25 : SHARE) ? 1 : 0)).join("");
	// runs of the same pattern
	const runs: Array<{ i0: number; i1: number; pat: string }> = [];
	rows.forEach((r, i) => {
		const pat = pattern(r);
		const last = runs[runs.length - 1];
		if (last && last.pat === pat && Math.abs(r.db - rows[last.i1].db) < 6) last.i1 = i;
		else runs.push({ i0: i, i1: i, pat });
	});
	// a run of one bar between two longer runs joins the neighbour it is closest to (a fill, a pickup)
	for (let k = 0; k < runs.length; k++) {
		const r = runs[k];
		if (r.i1 - r.i0 >= 1 || runs.length < 2) continue;
		const prev = runs[k - 1];
		const next = runs[k + 1];
		const dist = (x?: (typeof runs)[number]) => (x ? [...x.pat].reduce((s, c, j) => s + Math.abs(Number(c) - rows[r.i0].on[j]), 0) : Infinity);
		const into = dist(prev) <= dist(next) ? prev : next;
		if (!into) continue;
		into.i0 = Math.min(into.i0, r.i0);
		into.i1 = Math.max(into.i1, r.i1);
		runs.splice(k, 1);
		k--;
	}
	// a voice coming in for a bar or three between the same band (a line, a shout) doesn't start a section: only the
	// band's pattern (drums, bass, other) of a short run decides, the voice is counted over the whole section below
	const band = (pat: string) => pat.slice(1);
	for (const r of runs) if (r.i1 - r.i0 < 3) r.pat = `?${band(r.pat)}`;
	const segs: typeof runs = [];
	for (const r of runs) {
		const last = segs[segs.length - 1];
		if (last && band(last.pat) === band(r.pat) && (last.pat[0] === r.pat[0] || last.pat[0] === "?" || r.pat[0] === "?")) {
			last.i1 = r.i1;
			if (last.pat[0] === "?") last.pat = r.pat;
		} else segs.push({ ...r });
	}
	// a long stretch with the same parts can still change: the chorus louder, the guitars up. Split where the parts'
	// levels over the next 4 bars differ from the 4 before by 8 dB in sum (the largest change, on a 4-bar line).
	// a part counts with its level only in the bars it plays (its leakage elsewhere is noise); the voice not at all
	// (a line sung or not is the pattern's business, not a change of level)
	const lv = (p: PartName, i: number) => (p === "vocals" || (rows[i]?.on[PARTS.indexOf(p)] ?? 0) < SHARE ? -60 : Math.max(-60, parts[p].bars?.[i] ?? -60));
	const change = (i: number) => PARTS.reduce((sum, p) => {
		const m = (x: number, y: number) => {
			let t = 0;
			for (let k = x; k < y; k++) t += lv(p, k);
			return t / (y - x);
		};
		return sum + Math.abs(m(i, i + 4) - m(i - 4, i));
	}, 0);
	for (let k = 0; k < segs.length; k++) {
		const g = segs[k];
		if (g.i1 - g.i0 + 1 < 8) continue;
		let best = -1;
		let bestV = 8;
		for (let i = g.i0 + 4; i <= g.i1 - 3; i++) {
			const v = change(i) + ((i - g.i0) % 4 === 0 ? 1 : 0);
			if (v > bestV) {
				bestV = v;
				best = i;
			}
		}
		if (best < 0) continue;
		segs.splice(k + 1, 0, { i0: best, i1: g.i1, pat: g.pat });
		g.i1 = best - 1;
		k--;
	}
	// each section's voice over all its bars
	for (const g of segs) {
		const a = rows[g.i0].t;
		const e = rows[g.i1].e;
		g.pat = `${share(parts.vocals.active, a, e) >= 0.25 ? 1 : 0}${band(g.pat)}`;
	}
	const meanDbOf = (s: (typeof segs)[number]) => db(rows.slice(s.i0, s.i1 + 1).reduce((x, r) => x + 10 ** (r.db / 10), 0) / (s.i1 - s.i0 + 1));
	// letters: the same parts, a similar level of each part (6 dB in sum) and length (within 2×) = the same part of the
	// song; neighbours that end up with the same letter are one section
	const profile = (g: (typeof segs)[number]) => PARTS.map((p) => {
		let t = 0;
		for (let k = g.i0; k <= g.i1; k++) t += lv(p, k);
		return t / (g.i1 - g.i0 + 1);
	});
	const letters: Array<{ pat: string; prof: number[]; len: number; letter: string }> = [];
	const lettered = segs.map((g) => {
		const prof = profile(g);
		const len = g.i1 - g.i0 + 1;
		let found = letters.find((l) => l.pat === g.pat && l.prof.reduce((x, v, j) => x + Math.abs(v - prof[j]), 0) < 6 && len <= 2 * l.len && l.len <= 2 * len);
		if (!found) {
			found = { pat: g.pat, prof, len, letter: "" };
			letters.push(found);
		}
		return { ...g, ref: found };
	});
	const joined: typeof lettered = [];
	for (const g of lettered) {
		const last = joined[joined.length - 1];
		if (last && last.ref === g.ref) last.i1 = g.i1;
		else joined.push({ ...g });
	}
	let next = 0;
	for (const g of joined) if (!g.ref.letter) g.ref.letter = String.fromCharCode(65 + next++);
	const out: Section[] = joined.map((g) => {
		const level = meanDbOf(g);
		return {
			start: rows[g.i0].t,
			end: r3(rows[g.i1].e),
			bar0: g.i0 + 1,
			bar1: g.i1 + 1,
			letter: g.ref.letter,
			name: null,
			confidence: 0,
			parts: PARTS.filter((_, j) => g.pat[j] === "1"),
			db: Math.round(level * 10) / 10,
		};
	});
	nameSections(out);
	return out;
}

/** Names only where the song's shape says so; otherwise «part A». */
function nameSections(s: Section[]) {
	if (!s.length) return;
	const sung = (x: Section) => x.parts.includes("vocals");
	const firstSung = s.findIndex(sung);
	if (firstSung < 0) return;
	const lastSung = s.length - 1 - [...s].reverse().findIndex(sung);
	const count = new Map<string, number>();
	for (const x of s) count.set(x.letter, (count.get(x.letter) ?? 0) + 1);
	if (firstSung > 0 && !sung(s[0]) && s[0].parts.length) Object.assign(s[0], { name: "intro", confidence: 0.7 });
	if (firstSung >= 0 && lastSung < s.length - 1 && !sung(s[s.length - 1]) && s[s.length - 1].parts.length) Object.assign(s[s.length - 1], { name: "outro", confidence: 0.7 });
	// the sung letters that come back: the loudest is the chorus, the other the verse — when they differ by 1.5 dB
	const repeated = [...new Set(s.filter((x) => sung(x) && (count.get(x.letter) ?? 0) >= 2).map((x) => x.letter))];
	const level = (l: string) => {
		const xs = s.filter((x) => x.letter === l);
		return xs.reduce((a, x) => a + x.db, 0) / xs.length;
	};
	if (repeated.length >= 2) {
		const byLevel = repeated.sort((a, b) => level(b) - level(a));
		if (level(byLevel[0]) - level(byLevel[1]) >= 1.5) {
			for (const x of s) if (x.letter === byLevel[0] && !x.name) Object.assign(x, { name: "chorus", confidence: 0.6 });
			for (const x of s) if (x.letter === byLevel[1] && !x.name) Object.assign(x, { name: "verse", confidence: 0.5 });
		}
	}
	// once only, sung, between two choruses: a bridge
	s.forEach((x, i) => {
		if (x.name || !sung(x) || count.get(x.letter) !== 1) return;
		const before = s.slice(0, i).some((y) => y.name === "chorus");
		const after = s.slice(i + 1).some((y) => y.name === "chorus");
		if (before && after) Object.assign(x, { name: "bridge", confidence: 0.4 });
	});
	// no voice in the middle of the song, the band playing: instrumental
	s.forEach((x, i) => {
		if (x.name || sung(x) || !x.parts.length || i < firstSung || i > lastSung) return;
		Object.assign(x, { name: "instrumental", confidence: 0.6 });
	});
}

/** Every part silent ≥ 0.5 s. */
export function silencesOf(parts: Record<PartName, { active: Span[] }>, duration: number): Span[] {
	const all = PARTS.flatMap((p) => parts[p].active).sort((a, b) => a[0] - b[0]);
	const out: Span[] = [];
	let t = 0;
	for (const [a, b] of all) {
		if (a - t >= 0.5) out.push([r3(t), r3(a)]);
		t = Math.max(t, b);
	}
	if (duration - t >= 0.5) out.push([r3(t), r3(duration)]);
	return out;
}

/** The drums stop (≥ one bar, `bar` s) while another part plays. */
export function breaksOf(parts: Record<PartName, { active: Span[] }>, bar: number): Span[] {
	const d = parts.drums.active;
	if (!d.length) return [];
	const others = PARTS.filter((p) => p !== "drums").flatMap((p) => parts[p].active);
	const out: Span[] = [];
	const gaps: Span[] = d.slice(1).map((s, i) => [d[i][1], s[0]]);
	const end = Math.max(...others.map((s) => s[1]), d[d.length - 1][1]);
	if (end - d[d.length - 1][1] >= bar) gaps.push([d[d.length - 1][1], end]);
	for (const [a, b] of gaps) if (b - a >= bar * 0.95 && share(others, a, b) > 0.5) out.push([r3(a), r3(b)]);
	return out;
}

export interface ScoreInput {
	key: string;
	duration: number;
	stems: Record<PartName, Float32Array>;
	words?: Array<{ text: string; start: number; end: number }>;
	language?: string;
	took?: SongScore["took"];
	engine?: string;
	/** The beat network's answer for the song: null = asked, no answer; undefined = not asked (the part isn't on this Mac). */
	net?: NetBeats | null;
}

/** Bridging per part: drums keep playing across a rest of a beat or two; a voice's phrase ends at a breath ≥ 0.6 s. */
const BRIDGE: Record<PartName, number> = { drums: 1.2, bass: 0.6, other: 0.6, vocals: 0.6 };

export function scoreSong(o: ScoreInput): SongScore {
	const levels = {} as Record<PartName, Float32Array>;
	const acts = {} as Record<PartName, Activity>;
	for (const p of PARTS) {
		levels[p] = levelFrames(o.stems[p], p === "drums" ? 60 : 40);
		acts[p] = activityOf(levels[p], { bridge: BRIDGE[p], min: p === "vocals" ? 0.25 : 0.3 });
	}
	const drums = drumHits(o.stems.drums, acts.drums.active);
	const other = tonalOnsets(o.stems.other);
	// the beat: on the drums where they play; a song without drums takes the bass's and the guitars' attacks
	let onset = drums.onset;
	let beatSpans = acts.drums.active.filter(([a, b]) => b - a >= 4);
	if (!beatSpans.length) {
		const bass = tonalOnsets(o.stems.bass);
		onset = bass.onset.map((v, i) => v + (other.onset[i] ?? 0));
		const spans = [...acts.bass.active, ...acts.other.active].sort((a, b) => a[0] - b[0]);
		beatSpans = spans.reduce<Span[]>((m, s) => {
			const last = m[m.length - 1];
			if (last && s[0] - last[1] < 1) last[1] = Math.max(last[1], s[1]);
			else m.push([s[0], s[1]]);
			return m;
		}, []).filter(([a, b]) => b - a >= 4);
	}
	// stretches closer than 2 s are one beat stretch (a fill, a stop)
	beatSpans = beatSpans.reduce<Span[]>((m, s) => {
		const last = m[m.length - 1];
		if (last && s[0] - last[1] < 2) last[1] = s[1];
		else m.push([s[0], s[1]]);
		return m;
	}, []);
	const grid = beatGrid(onset, beatSpans);
	const starts = PARTS.filter((p) => p !== "drums").flatMap((p) => acts[p].active.map((s) => s[0]));
	const db = downbeats(grid, drums.hits, starts);
	// The beat network's second opinion (net-grid.ts): nothing changes where it agrees with the grid above.
	const second = o.net ? referee(grid, o.net, drums.hits.map((h) => h[0])) : null;
	let net: { tempo: Grid["tempo"]; beats: number[]; bars: number[]; confidence: number; meter: 3 | 4 | null } | null = null;
	if (second && second.rule !== "dsp" && second.beats.length >= 8) {
		// its beats with bars placed by the rule above, when it gave no bars of its own
		const placed = second.bars ? null : downbeats({ tempo: second.tempo, beats: second.beats, firsts: second.tempo.map((t) => Math.max(0, second.beats.findIndex((b) => b >= t.start - 0.001))) }, drums.hits, starts);
		const found = second.bars ?? placed?.bars ?? [];
		if (found.length >= 2) net = { tempo: second.tempo, beats: second.beats, bars: found, confidence: placed ? placed.confidence : second.confidence, meter: second.meter };
	}
	const bars = fullBars(net?.bars ?? db.bars, o.duration);
	const edges = [...bars, o.duration];
	const mix = new Float32Array(levels.drums.length);
	for (let f = 0; f < mix.length; f++) mix[f] = db10(PARTS.reduce((s, p) => s + 10 ** ((levels[p][f] ?? -120) / 10), 0));
	const perBar = (l: Float32Array) => bars.map((t, i) => Math.round(meanDb(l, Math.floor(t * FPS), Math.ceil(edges[i + 1] * FPS))));
	const parts = {} as Record<PartName, PartScore>;
	for (const p of PARTS) parts[p] = { ...acts[p], bars: perBar(levels[p]) };
	const bar = bars.length > 1 ? (bars[bars.length - 1] - bars[0]) / (bars.length - 1) : 2;
	const phraseSpans = acts.vocals.active;
	return {
		v: o.net !== undefined ? NET_SCORE_VERSION : SCORE_VERSION,
		key: o.key,
		duration: r3(o.duration),
		engine: o.engine ?? "Demucs htdemucs",
		tempo: net?.tempo ?? grid.tempo,
		beats: net?.beats ?? grid.beats,
		bars,
		downbeatConfidence: net?.confidence ?? db.confidence,
		...(net?.meter === 3 ? { meter: 3 as const } : {}),
		...(o.net ? { refereed: true as const } : {}),
		parts,
		hits: drums.hits,
		attacks: acts.other.active.length ? other.attacks.filter((t) => share(acts.other.active, t, t + 0.05) > 0) : [],
		phrases: phrasesOf(phraseSpans, o.words),
		language: o.language ?? "",
		sections: sectionsOf(bars, o.duration, parts, perBar(mix)),
		silences: silencesOf(parts, o.duration),
		breaks: breaksOf(parts, bar),
		took: o.took ?? { separate: 0, analyse: 0, words: 0 },
	};
}

const db10 = (p: number) => 10 * Math.log10(p + 1e-12);
