// Claude's ears, the signal side: what a sound editor hears in a waveform, as numbers. Pure functions over mono
// Float32 samples (any rate) and per-channel blocks (loudness), shared by the tools in the window and the unit tests.
// Frames are 10 ms: level (RMS dB) for every frame, pitch / voicing / spectrum every other frame (20 ms).

export const HOP = 0.01;
/** The rate the map is computed at: up to 16 kHz of sound, so sibilance (5–9 kHz) is heard too. */
export const ANALYSIS_RATE = 32000;
/** Level of digital silence in frame dB (−100 = exact zeros). */
export const SILENT_DB = -85;

export const toDb = (power: number) => 10 * Math.log10(power + 1e-10);

/** In-place radix-2 FFT; re/im of a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			let t = re[i];
			re[i] = re[j];
			re[j] = t;
			t = im[i];
			im[i] = im[j];
			im[j] = t;
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		const wr = Math.cos(ang);
		const wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const a = i + k;
				const b = a + len / 2;
				const xr = re[b] * cr - im[b] * ci;
				const xi = re[b] * ci + im[b] * cr;
				re[b] = re[a] - xr;
				im[b] = im[a] - xi;
				re[a] += xr;
				im[a] += xi;
				const nr = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = nr;
			}
		}
	}
}

export interface Frames {
	/** Caller's seconds at the start of frame 0. */
	t0: number;
	n: number;
	/** RMS level of each 10 ms, dB (−100 = digital silence). */
	db: Float32Array;
	/** Periodicity 0…1 (normalized autocorrelation peak for 70–400 Hz): voiced speech and tones high, breath and hiss low. */
	voicing: Float32Array;
	/** Pitch, Hz, where voicing > 0.5; else 0. */
	f0: Float32Array;
	/** Spectral flatness 150 Hz–6 kHz (0 tonal … 1 white noise). */
	flat: Float32Array;
	/** Spectral centroid, Hz. */
	centroid: Float32Array;
	/** Level below 200 Hz, dB (kick drums, rumble). */
	low: Float32Array;
	/** Band levels, dB: 150–300 Hz (mud), 1–4 kHz (presence), 5–9 kHz (sibilance; −100 below a 20 kHz rate). */
	mud: Float32Array;
	pres: Float32Array;
	sib: Float32Array;
}

export const frameAt = (frames: Frames, t: number) => Math.floor((t - frames.t0) / HOP + 1e-9);
export const frameTime = (frames: Frames, f: number) => frames.t0 + f * HOP;

/** Features of 10 ms frames of mono samples (`rate` ≥ 8 kHz; the map uses 16 kHz). */
export function analyseFrames(samples: Float32Array, rate: number, t0 = 0): Frames {
	const hop = Math.round(rate * HOP);
	const n = Math.floor(samples.length / hop);
	const db = new Float32Array(n);
	for (let f = 0; f < n; f++) {
		let sum = 0;
		const base = f * hop;
		for (let i = 0; i < hop; i++) sum += samples[base + i] * samples[base + i];
		db[f] = toDb(sum / hop);
	}
	const voicing = new Float32Array(n);
	const f0 = new Float32Array(n);
	const flat = new Float32Array(n);
	const centroid = new Float32Array(n);
	const low = new Float32Array(n).fill(-100);
	const mud = new Float32Array(n).fill(-100);
	const pres = new Float32Array(n).fill(-100);
	const sib = new Float32Array(n).fill(-100);
	// Spectrum: a 512-point FFT (32 ms at 16 kHz) centred on the frame, every other frame.
	const size = rate >= 32000 ? 1024 : 512;
	const re = new Float64Array(size);
	const im = new Float64Array(size);
	const hann = new Float64Array(size);
	for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
	const bin = rate / size;
	const kLo = Math.max(1, Math.round(150 / bin));
	const kHi = Math.min(size / 2 - 1, Math.round(6000 / bin));
	const kLow = Math.max(1, Math.round(200 / bin));
	const band = (lo: number, hi: number): [number, number] => [Math.max(1, Math.round(lo / bin)), Math.min(size / 2 - 1, Math.round(hi / bin))];
	const [m0, m1] = band(150, 300);
	const [p0b, p1b] = band(1000, 4000);
	const [s0b, s1b] = rate >= 20000 ? band(5000, 9000) : [1, 0];
	// Power of a full-scale sine in one bin of this window, to read band sums as dB of the signal.
	const norm = (size * size * 0.375) / 2;
	// Pitch at ~8 kHz (decimated by `dec`): normalized cross-correlation of a 20 ms window over 70–400 Hz lags.
	const dec = Math.max(1, Math.round(rate / 8000));
	const prate = rate / dec;
	const W = Math.round(prate * 0.02);
	const minLag = Math.floor(prate / 400);
	const maxLag = Math.ceil(prate / 70);
	const seg = new Float64Array(W + maxLag + 1);
	for (let f = 0; f < n; f += 2) {
		const centre = f * hop + hop;
		// spectrum
		const s0 = centre - size / 2;
		for (let i = 0; i < size; i++) {
			const j = s0 + i;
			re[i] = j >= 0 && j < samples.length ? samples[j] * hann[i] : 0;
			im[i] = 0;
		}
		fft(re, im);
		let logSum = 0;
		let linSum = 0;
		let cNum = 0;
		let cDen = 0;
		let lowSum = 0;
		let mudSum = 0;
		let presSum = 0;
		let sibSum = 0;
		for (let k = 1; k < size / 2; k++) {
			const p = re[k] * re[k] + im[k] * im[k];
			if (k >= kLo && k <= kHi) {
				logSum += Math.log(p + 1e-12);
				linSum += p + 1e-12;
			}
			cNum += k * bin * p;
			cDen += p;
			if (k <= kLow) lowSum += p;
			if (k >= m0 && k <= m1) mudSum += p;
			if (k >= p0b && k <= p1b) presSum += p;
			if (k >= s0b && k <= s1b) sibSum += p;
		}
		const count = kHi - kLo + 1;
		const fl = linSum > 0 ? Math.exp(logSum / count) / (linSum / count) : 1;
		const ce = cDen > 0 ? cNum / cDen : 0;
		const lo = toDb(lowSum / norm);
		const bm = toDb(mudSum / norm);
		const bp = toDb(presSum / norm);
		const bs = s1b >= s0b ? toDb(sibSum / norm) : -100;
		// pitch
		const p0 = Math.floor((f * hop) / dec);
		for (let i = 0; i < seg.length; i++) {
			const j = (p0 + i) * dec;
			let v = 0;
			if (j + dec <= samples.length) {
				for (let d = 0; d < dec; d++) v += samples[j + d];
				v /= dec;
			}
			seg[i] = v;
		}
		let e0 = 0;
		for (let i = 0; i < W; i++) e0 += seg[i] * seg[i];
		let best = 0;
		let bestLag = 0;
		const r = new Float64Array(maxLag + 2);
		if (e0 > 1e-9) {
			let eL = 0;
			for (let i = minLag; i < minLag + W; i++) eL += seg[i] * seg[i];
			for (let lag = minLag; lag <= maxLag; lag++) {
				let c = 0;
				for (let i = 0; i < W; i++) c += seg[i] * seg[i + lag];
				const v = eL > 1e-12 ? c / Math.sqrt(e0 * eL) : 0;
				r[lag] = v;
				if (v > best) best = v;
				eL += seg[lag + W] * seg[lag + W] - seg[lag] * seg[lag];
			}
			// The first lag that is nearly as good as the best: the true period, not a multiple of it (octave errors).
			for (let lag = minLag + 1; lag < maxLag; lag++) {
				if (r[lag] >= 0.9 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
					bestLag = lag;
					break;
				}
			}
		}
		let pitch = 0;
		if (bestLag && best > 0.5) {
			const a = r[bestLag - 1];
			const b = r[bestLag];
			const c = r[bestLag + 1];
			const den = a - 2 * b + c;
			const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
			pitch = prate / (bestLag + Math.max(-0.5, Math.min(0.5, shift)));
		}
		for (const g of [f, f + 1]) {
			if (g >= n) continue;
			voicing[g] = Math.max(0, best);
			f0[g] = pitch;
			flat[g] = fl;
			centroid[g] = ce;
			low[g] = lo;
			mud[g] = bm;
			pres[g] = bp;
			sib[g] = bs;
		}
	}
	return { t0, n, db, voicing, f0, flat, centroid, low, mud, pres, sib };
}

export function percentile(values: ArrayLike<number>, p: number): number {
	if (values.length === 0) return -100;
	const sorted = Float64Array.from(values as ArrayLike<number>).sort();
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

export const median = (values: number[]) => (values.length ? percentile(values, 0.5) : 0);

export interface Levels {
	/** Room tone / noise floor of the sound (dB, 10th percentile of non-silent frames). */
	floor: number;
	/** Loud speech or music (95th percentile). */
	loud: number;
	/** Above this a frame is "sound" (speech, music), not room tone. */
	active: number;
}

export function levelsOf(frames: Frames, from = 0, to = frames.n): Levels {
	const vals: number[] = [];
	for (let f = Math.max(0, from); f < Math.min(frames.n, to); f++) if (frames.db[f] > SILENT_DB) vals.push(frames.db[f]);
	if (!vals.length) return { floor: -100, loud: -100, active: -60 };
	const floor = percentile(vals, 0.1);
	const loud = percentile(vals, 0.95);
	return { floor, loud, active: Math.max(floor + 10, loud - 32) };
}

export interface Click {
	/** Caller's seconds. */
	at: number;
	/** How far the transient stands above the local sound, dB. */
	over: number;
	/** Size of the jump (linear, 0…2). */
	size: number;
}

/**
 * Clicks and pops: a jump the second difference (a high-pass that leaves tones and voices small) shows far above the
 * sound around it (±15 ms, the ±1.5 ms around the jump left out), short and sudden. Speech plosives, hiss and drum hits
 * are noise-like over many samples, so they do not stand out from their own surroundings.
 */
export function findClicks(x: Float32Array, rate: number, t0 = 0, { ratio = 10, minSize = 0.008 }: { ratio?: number; minSize?: number } = {}): Click[] {
	const n = x.length;
	if (n < 8) return [];
	const d2 = new Float64Array(n);
	for (let i = 1; i < n - 1; i++) d2[i] = x[i + 1] - 2 * x[i] + x[i - 1];
	const cum = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + d2[i] * d2[i];
	const W = Math.round(rate * 0.015);
	const G = Math.max(2, Math.round(rate * 0.0015));
	const out: Click[] = [];
	let last = -Infinity;
	for (let i = 2; i < n - 2; i++) {
		const v = Math.abs(d2[i]);
		if (v < minSize) continue;
		const a0 = Math.max(0, i - W);
		const a1 = Math.max(0, i - G);
		const b0 = Math.min(n, i + G + 1);
		const b1 = Math.min(n, i + W + 1);
		if (a1 - a0 < W / 3 && b1 - b0 < W / 3) continue;
		// Against each side on its own: a word's onset after silence stands out from the silence, not from itself.
		const before = a1 > a0 ? Math.sqrt((cum[a1] - cum[a0]) / (a1 - a0)) : 0;
		const after = b1 > b0 ? Math.sqrt((cum[b1] - cum[b0]) / (b1 - b0)) : 0;
		const local = Math.max(before, after) + 1e-6;
		if (v < ratio * local) continue;
		const at = t0 + i / rate;
		const over = 20 * Math.log10(v / local);
		const prev = out[out.length - 1];
		if (prev && at - last < 0.004) {
			if (over > prev.over) Object.assign(prev, { at, over, size: v });
			last = at;
			continue;
		}
		out.push({ at, over, size: v });
		last = at;
	}
	return out;
}

export interface Span {
	start: number;
	end: number;
}

/** Holes of digital silence (exact or near zeros, ≥ `minMs`) with sound on both sides: what a gap between clips sounds like. */
export function findHoles(x: Float32Array, rate: number, t0 = 0, minMs = 5): Span[] {
	const out: Span[] = [];
	const zero = 3e-5;
	const min = Math.round((rate * minMs) / 1000);
	const ctx = Math.round(rate * 0.03);
	const rms = (a: number, b: number) => {
		a = Math.max(0, a);
		b = Math.min(x.length, b);
		if (b <= a) return 0;
		let s = 0;
		for (let i = a; i < b; i++) s += x[i] * x[i];
		return Math.sqrt(s / (b - a));
	};
	let i = 0;
	while (i < x.length) {
		if (Math.abs(x[i]) >= zero) {
			i++;
			continue;
		}
		let j = i;
		while (j < x.length && Math.abs(x[j]) < zero) j++;
		if (j - i >= min && i > 0 && j < x.length && rms(i - ctx, i) > 3e-4 && rms(j, j + ctx) > 3e-4) {
			// A hole cuts the sound off: right at its edge the sound is as loud as around it. A voice that fades into
			// silence (a synthetic voice's pause) is quiet at the edge and is no hole.
			const edge = Math.round(rate * 0.003);
			const abrupt = (a: number, b: number, around: number) => {
				const e = rms(a, b);
				return e > 1.8e-4 && e >= around * 0.5;
			};
			if (abrupt(i - edge, i, rms(i - ctx, i)) || abrupt(j, j + edge, rms(j, j + ctx))) out.push({ start: t0 + i / rate, end: t0 + j / rate });
		}
		i = j;
	}
	return out;
}

/** Runs of ≥ 3 samples at full scale: clipping (one channel, its own rate). */
export function clipRuns(x: Float32Array, rate: number, t0 = 0): number[] {
	const out: number[] = [];
	let run = 0;
	let lastAt = -1;
	for (let i = 0; i < x.length; i++) {
		if (Math.abs(x[i]) >= 0.999) {
			run++;
			if (run === 3) {
				const at = t0 + i / rate;
				if (at - lastAt > 0.05) out.push(at);
				lastAt = at;
			}
		} else run = 0;
	}
	return out;
}

// ───────────────────────── loudness (ITU-R BS.1770, same filters as sounds/mix/loudness.ts) ─────────────────────────

interface Biquad {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
}

function kWeighting(rate: number): [Biquad, Biquad] {
	let f0 = 1681.974450955533;
	const G = 3.999843853973347;
	let Q = 0.7071752369554196;
	let K = Math.tan((Math.PI * f0) / rate);
	const Vh = 10 ** (G / 20);
	const Vb = Vh ** 0.4996667741545416;
	let a0 = 1 + K / Q + K * K;
	const shelf = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
	f0 = 38.13547087602444;
	Q = 0.5003270373238773;
	K = Math.tan((Math.PI * f0) / rate);
	a0 = 1 + K / Q + K * K;
	return [shelf, { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 }];
}

/**
 * Streams channels in, K-weighted mean square per 100 ms block out (summed over channels, BS.1770). Short-term
 * loudness is 30 blocks, the gated integrated value uses 400 ms blocks — both from these.
 */
export class LoudnessMeter {
	readonly blocks: number[] = [];
	private readonly filters: [Biquad, Biquad];
	private readonly state: Float64Array[] = [];
	private readonly blockLen: number;
	private acc = 0;
	private count = 0;
	peak = 0;
	clips: number[] = [];
	constructor(readonly rate: number) {
		this.filters = kWeighting(rate);
		this.blockLen = Math.round(rate * 0.1);
	}

	/** `channels` of equal length; `t0` = caller's seconds of their first sample (for clipping times). */
	push(channels: Float32Array[], t0 = 0) {
		const len = channels[0]?.length ?? 0;
		while (this.state.length < channels.length) this.state.push(new Float64Array(8));
		for (const data of channels) {
			for (const at of clipRuns(data, this.rate, t0)) if (!this.clips.length || at - this.clips[this.clips.length - 1] > 0.05) this.clips.push(at);
		}
		const [s, h] = this.filters;
		for (let i = 0; i < len; i++) {
			let sum = 0;
			for (let c = 0; c < channels.length; c++) {
				const x = channels[c][i];
				const ax = Math.abs(x);
				if (ax > this.peak) this.peak = ax;
				const st = this.state[c];
				// Direct form I, two stages.
				const y1 = s.b0 * x + s.b1 * st[0] + s.b2 * st[1] - s.a1 * st[2] - s.a2 * st[3];
				st[1] = st[0];
				st[0] = x;
				st[3] = st[2];
				st[2] = y1;
				const y2 = h.b0 * y1 + h.b1 * st[4] + h.b2 * st[5] - h.a1 * st[6] - h.a2 * st[7];
				st[5] = st[4];
				st[4] = y1;
				st[7] = st[6];
				st[6] = y2;
				sum += y2 * y2;
			}
			this.acc += sum;
			if (++this.count === this.blockLen) {
				this.blocks.push(this.acc / this.blockLen);
				this.acc = 0;
				this.count = 0;
			}
		}
	}
}

const lufsOf = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare + 1e-12);

export interface Loudness {
	/** Integrated (gated) loudness of the range, LUFS. */
	integrated: number;
	/** Short-term (3 s) loudness every second: [seconds from the range start, LUFS]. */
	shortTerm: Array<[number, number]>;
	peakDb: number;
	clips: number[];
}

export function loudnessOf(meter: LoudnessMeter, t0 = 0): Loudness {
	const b = meter.blocks;
	const shortTerm: Array<[number, number]> = [];
	for (let end = Math.min(30, b.length); end <= b.length; end += 10) {
		const from = Math.max(0, end - 30);
		let s = 0;
		for (let i = from; i < end; i++) s += b[i];
		shortTerm.push([t0 + (from + end) * 0.05, lufsOf(s / (end - from))]);
		if (end === b.length) break;
		if (end + 10 > b.length && end < b.length) end = b.length - 10;
	}
	const gates: number[] = [];
	for (let j = 0; j + 4 <= b.length; j++) gates.push((b[j] + b[j + 1] + b[j + 2] + b[j + 3]) / 4);
	const abs = gates.filter((e) => lufsOf(e) > -70);
	let integrated = -70;
	if (abs.length) {
		const rel = lufsOf(abs.reduce((a, e) => a + e, 0) / abs.length) - 10;
		const g = abs.filter((e) => lufsOf(e) > rel);
		if (g.length) integrated = lufsOf(g.reduce((a, e) => a + e, 0) / g.length);
	}
	return { integrated, shortTerm, peakDb: 20 * Math.log10(meter.peak + 1e-9), clips: meter.clips };
}

/** Pitch difference in semitones. */
export const semitones = (a: number, b: number) => (a > 0 && b > 0 ? 12 * Math.log2(a / b) : 0);

// ───────────────────────── slow spectra: hum and key ─────────────────────────

/** One look every half second through a long window (8192 samples at 32 kHz ≈ 4 Hz bins): hum lines and the key. */
export interface SlowFrame {
	/** Caller's seconds at the window's centre. */
	t: number;
	db: number;
	/** Pitch-class energy C…B, normalized to sum 1 (zeros when silent). */
	chroma: number[];
	/** Power spectrum 0…`LOW_HZ` (for hum). */
	low: Float32Array;
}

export const SLOW_EVERY = 0.5;
export const LOW_HZ = 400;

export function slowFrame(samples: Float32Array, rate: number, centre: number, t: number): SlowFrame {
	const size = rate >= 32000 ? 8192 : 4096;
	const re = new Float64Array(size);
	const im = new Float64Array(size);
	let ms = 0;
	for (let i = 0; i < size; i++) {
		const j = centre - size / 2 + i;
		const v = j >= 0 && j < samples.length ? samples[j] : 0;
		ms += v * v;
		re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
	}
	fft(re, im);
	const bin = rate / size;
	const chroma = new Array(12).fill(0);
	const kLow = Math.min(size / 2, Math.ceil(LOW_HZ / bin));
	const low = new Float32Array(kLow);
	for (let k = 1; k < size / 2; k++) {
		const p = re[k] * re[k] + im[k] * im[k];
		if (k < kLow) low[k] = p;
		const f = k * bin;
		if (f < 65 || f > 2100) continue;
		const pc = (((Math.round(12 * Math.log2(f / 440)) + 69) % 12) + 12) % 12;
		chroma[pc] += Math.sqrt(p);
	}
	const sum = chroma.reduce((a, b) => a + b, 0);
	return { t, db: toDb(ms / size), chroma: sum > 0 ? chroma.map((c) => c / sum) : chroma, low };
}

export interface Hum {
	/** 50 or 60 Hz (mains). */
	freq: number;
	/** Strongest line above its neighbours, dB. */
	over: number;
	/** Harmonics heard (multiples of `freq`). */
	harmonics: number;
}

/** Mains hum: lines at 50 or 60 Hz and their multiples, standing out of the room tone (the quietest third of the sound). */
export function findHum(slow: SlowFrame[], rate: number): Hum | null {
	const sound = slow.filter((s) => s.db > SILENT_DB);
	if (sound.length < 3) return null;
	// The room tone: windows within 6 dB of the quietest tenth (a hum is there all the time, a voice is not).
	const floor = percentile(sound.map((s) => s.db), 0.1);
	const pick = sound.filter((s) => s.db <= floor + 6);
	if (pick.length < 3) return null;
	const size = rate >= 32000 ? 8192 : 4096;
	const bin = rate / size;
	const n = pick[0].low.length;
	const lineIn = (spec: ArrayLike<number>, hz: number) => {
		const k = Math.round(hz / bin);
		if (k < 2 || k + 6 >= n) return 0;
		let peak = 0;
		for (let j = k - 1; j <= k + 1; j++) peak = Math.max(peak, spec[j]);
		const around: number[] = [];
		for (let j = k - Math.round(16 / bin); j <= k + Math.round(16 / bin); j++) if (Math.abs(j - k) > Math.round(4 / bin) && j > 0 && j < n) around.push(spec[j]);
		const base = percentile(around, 0.5);
		return 10 * Math.log10((peak + 1e-20) / (base + 1e-20));
	};
	const avg = new Float64Array(n);
	for (const s of pick) for (let k = 0; k < n; k++) avg[k] += s.low[k] / pick.length;
	let best: Hum | null = null;
	for (const freq of [50, 60]) {
		const lines = [1, 2, 3, 4, 5, 6].filter((h) => freq * h < LOW_HZ - 20).map((h) => lineIn(avg, freq * h));
		const strong = lines.filter((d) => d >= 8).length;
		const over = Math.max(...lines);
		// Steady: the base line stands out in most room-tone windows on its own, not only on average.
		const steady = pick.filter((s) => lineIn(s.low, freq) >= 6 || lineIn(s.low, freq * 2) >= 6).length / pick.length;
		// A strong base line, or a comb of harmonics (a room resonance makes one or two random peaks, not a comb).
		if ((lines[0] >= 15 || strong >= 3) && steady >= 0.6 && (!best || over > best.over)) best = { freq, over, harmonics: strong };
	}
	return best;
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function corr(a: number[], b: number[]): number {
	const ma = a.reduce((s, x) => s + x, 0) / a.length;
	const mb = b.reduce((s, x) => s + x, 0) / b.length;
	let n = 0;
	let da = 0;
	let db = 0;
	for (let i = 0; i < a.length; i++) {
		n += (a[i] - ma) * (b[i] - mb);
		da += (a[i] - ma) ** 2;
		db += (b[i] - mb) ** 2;
	}
	return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
}

/** Krumhansl–Schmuckler key of summed chroma: "A minor", with how sure (0…1). */
export function keyOf(chroma: number[]): { key: string; minor: boolean; confidence: number } | null {
	if (chroma.reduce((a, b) => a + b, 0) <= 0) return null;
	const scores: Array<{ key: string; minor: boolean; r: number }> = [];
	for (let k = 0; k < 12; k++) {
		const rot = (p: number[]) => p.map((_, i) => p[(i - k + 12) % 12]);
		scores.push({ key: `${NAMES[k]} major`, minor: false, r: corr(chroma, rot(MAJOR)) });
		scores.push({ key: `${NAMES[k]} minor`, minor: true, r: corr(chroma, rot(MINOR)) });
	}
	scores.sort((a, b) => b.r - a.r);
	return { key: scores[0].key, minor: scores[0].minor, confidence: Math.max(0, Math.min(1, (scores[0].r - scores[1].r) * 8 + scores[0].r * 0.3)) };
}
