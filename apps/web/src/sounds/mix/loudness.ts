// Integrated loudness (ITU-R BS.1770-4 / EBU R128) and loudness normalization for the export mix.
// Pure TypeScript over Float32Array channels, so it runs in the browser (export) and in Node
// (library analysis) alike.
//
// Accuracy: the K-weighting filters are derived for the actual sample rate (same formulas as
// libebur128 / pyloudnorm), gating is the standard 400 ms / 75 % overlap with the −70 LUFS
// absolute and −10 LU relative gates, so the measurement matches ffmpeg's ebur128 within
// ~0.1 LU. Peaks are limited on sample values at −1.5 dBFS (0.5 dB below the −1 dBTP spec)
// to leave room for inter-sample peaks; the AAC/Opus encoder may move the final integrated
// value by a few tenths of a dB.

export const TARGET_LUFS = -14;
const SAMPLE_PEAK_CEILING_DB = -1.5;
const SILENCE_LUFS = -70;

interface Biquad {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
}

function kWeighting(sampleRate: number): [Biquad, Biquad] {
	// Stage 1: high shelf (+4 dB above ~1.7 kHz, models the head).
	let f0 = 1681.974450955533;
	const G = 3.999843853973347;
	let Q = 0.7071752369554196;
	let K = Math.tan((Math.PI * f0) / sampleRate);
	const Vh = 10 ** (G / 20);
	const Vb = Vh ** 0.4996667741545416;
	let a0 = 1 + K / Q + K * K;
	const shelf: Biquad = {
		b0: (Vh + (Vb * K) / Q + K * K) / a0,
		b1: (2 * (K * K - Vh)) / a0,
		b2: (Vh - (Vb * K) / Q + K * K) / a0,
		a1: (2 * (K * K - 1)) / a0,
		a2: (1 - K / Q + K * K) / a0,
	};
	// Stage 2: RLB high-pass (~38 Hz).
	f0 = 38.13547087602444;
	Q = 0.5003270373238773;
	K = Math.tan((Math.PI * f0) / sampleRate);
	a0 = 1 + K / Q + K * K;
	const highpass: Biquad = {
		b0: 1,
		b1: -2,
		b2: 1,
		a1: (2 * (K * K - 1)) / a0,
		a2: (1 - K / Q + K * K) / a0,
	};
	return [shelf, highpass];
}

export interface LoudnessResult {
	/** Integrated loudness, LUFS (−70 for silence). */
	lufs: number;
	/** Highest absolute sample value, dBFS. */
	peakDb: number;
}

const toDb = (linear: number) => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);
const energyToLufs = (energy: number) =>
	energy > 0 ? -0.691 + 10 * Math.log10(energy) : -Infinity;

/**
 * Steps of the measurement: one yield per ~2 s of audio so a long export can hand the
 * main thread back to the UI between slices (see {@link measureLoudnessAsync}).
 */
function* measureSteps(
	channels: Float32Array[],
	sampleRate: number,
): Generator<void, LoudnessResult, void> {
	const length = channels[0]?.length ?? 0;
	if (length === 0) return { lufs: SILENCE_LUFS, peakDb: -Infinity };

	const [s1, s2] = kWeighting(sampleRate);
	const hop = Math.round(sampleRate * 0.1); // 100 ms sub-blocks; a gating block = 4 of them
	const subCount = Math.ceil(length / hop);
	const sub = new Float64Array(subCount); // Σ channels of Σ y² per sub-block
	let peak = 0;
	let total = 0;
	const slice = sampleRate * 2;

	for (const data of channels) {
		let x1 = 0, x2 = 0, y1 = 0, y2 = 0; // stage 1 state
		let u1 = 0, u2 = 0, z1 = 0, z2 = 0; // stage 2 state
		for (let start = 0; start < length; start += slice) {
			const end = Math.min(length, start + slice);
			for (let i = start; i < end; i++) {
				const x = data[i];
				const ax = x < 0 ? -x : x;
				if (ax > peak) peak = ax;
				const y = s1.b0 * x + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
				x2 = x1; x1 = x; y2 = y1; y1 = y;
				const z = s2.b0 * y + s2.b1 * u1 + s2.b2 * u2 - s2.a1 * z1 - s2.a2 * z2;
				u2 = u1; u1 = y; z2 = z1; z1 = z;
				sub[(i / hop) | 0] += z * z;
				total += z * z;
			}
			yield;
		}
	}

	const blockLen = hop * 4;
	const blocks: number[] = [];
	for (let j = 0; j + 4 <= subCount; j++) {
		const e = (sub[j] + sub[j + 1] + sub[j + 2] + sub[j + 3]) / blockLen;
		blocks.push(e);
	}
	if (blocks.length === 0) {
		// Shorter than one gating block (a click, a pop): plain mean energy.
		const lufs = energyToLufs(total / length);
		return { lufs: Number.isFinite(lufs) ? Math.max(SILENCE_LUFS, lufs) : SILENCE_LUFS, peakDb: toDb(peak) };
	}
	const absGated = blocks.filter((e) => energyToLufs(e) > SILENCE_LUFS);
	if (absGated.length === 0) return { lufs: SILENCE_LUFS, peakDb: toDb(peak) };
	const relGate = energyToLufs(absGated.reduce((a, b) => a + b, 0) / absGated.length) - 10;
	const gated = absGated.filter((e) => energyToLufs(e) > relGate);
	const lufs = energyToLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
	return { lufs: Number.isFinite(lufs) ? lufs : SILENCE_LUFS, peakDb: toDb(peak) };
}

function runSync<T>(steps: Generator<void, T, void>): T {
	for (;;) {
		const r = steps.next();
		if (r.done) return r.value;
	}
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function runAsync<T>(steps: Generator<void, T, void>): Promise<T> {
	for (;;) {
		const r = steps.next();
		if (r.done) return r.value;
		await yieldToUi();
	}
}

export function measureLoudness({
	channels,
	sampleRate,
}: {
	channels: Float32Array[];
	sampleRate: number;
}): LoudnessResult {
	return runSync(measureSteps(channels, sampleRate));
}

export function measureLoudnessAsync({
	channels,
	sampleRate,
}: {
	channels: Float32Array[];
	sampleRate: number;
}): Promise<LoudnessResult> {
	return runAsync(measureSteps(channels, sampleRate));
}

function applyGain(channels: Float32Array[], gain: number) {
	if (gain === 1) return;
	for (const data of channels) for (let i = 0; i < data.length; i++) data[i] *= gain;
}

/**
 * Look-ahead peak limiter (linked channels). The gain curve reaches the needed reduction
 * exactly at each over-ceiling sample (sliding minimum + box smoothing over the look-ahead),
 * then recovers with a one-pole release, so it never clips and never pumps abruptly.
 */
export function limitPeaks({
	channels,
	sampleRate,
	ceilingDb = SAMPLE_PEAK_CEILING_DB,
	lookaheadMs = 3,
	releaseMs = 80,
}: {
	channels: Float32Array[];
	sampleRate: number;
	ceilingDb?: number;
	lookaheadMs?: number;
	releaseMs?: number;
}): number {
	const length = channels[0]?.length ?? 0;
	const ceiling = 10 ** (ceilingDb / 20);
	const needAt = (i: number) => {
		let m = 0;
		for (const data of channels) {
			const a = data[i] < 0 ? -data[i] : data[i];
			if (a > m) m = a;
		}
		return m > ceiling ? ceiling / m : 1;
	};
	let overs = 0;
	for (let i = 0; i < length; i++) if (needAt(i) < 1) overs++;
	if (overs === 0) return 0;

	const la = Math.max(1, Math.round((lookaheadMs / 1000) * sampleRate));
	// Streaming: sliding minimum of the needed gain over [i − la, i + la] (monotonic deque in a
	// ring), then a box average over the last `la` minima — still ≤ the need at every peak.
	const cap = 2 * la + 2;
	const dqIndex = new Int32Array(cap);
	const dqValue = new Float32Array(cap);
	let head = 0;
	let size = 0;
	const box = new Float32Array(la);
	let acc = 0;
	let next = 0;
	const release = 1 - Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
	let g = 1;
	for (let i = 0; i < length; i++) {
		const hi = Math.min(length - 1, i + la);
		while (next <= hi) {
			const v = needAt(next);
			while (size > 0 && dqValue[(head + size - 1) % cap] >= v) size--;
			const slot = (head + size) % cap;
			dqIndex[slot] = next;
			dqValue[slot] = v;
			size++;
			next++;
		}
		while (size > 0 && dqIndex[head] < i - la) {
			head = (head + 1) % cap;
			size--;
		}
		const minimum = dqValue[head];
		const b = i % la;
		acc += minimum - (i >= la ? box[b] : 0);
		box[b] = minimum;
		const env = acc / Math.min(i + 1, la);
		const target = Math.min(env, needAt(i));
		g = target < g ? target : g + (target - g) * release;
		for (const data of channels) data[i] *= g;
	}
	// Safety net for rounding: nothing may exceed the ceiling.
	for (const data of channels) {
		for (let i = 0; i < length; i++) {
			if (data[i] > ceiling) data[i] = ceiling;
			else if (data[i] < -ceiling) data[i] = -ceiling;
		}
	}
	return overs;
}

export interface NormalizeResult {
	before: LoudnessResult;
	after: LoudnessResult;
	gainDb: number;
}

/**
 * Brings the mix to `targetLufs` (in place): gain → peak limiter → re-measure and trim
 * (the limiter lowers loudness slightly when it works hard). Silence is left alone; the gain
 * is capped at +30 dB (a phone voice-over at −40 LUFS still reaches −14) so a near-silent
 * mix is not blown up into noise; below −60 LUFS nothing is touched.
 */
export async function normalizeLoudness({
	channels,
	sampleRate,
	targetLufs = TARGET_LUFS,
	ceilingDb = SAMPLE_PEAK_CEILING_DB,
}: {
	channels: Float32Array[];
	sampleRate: number;
	targetLufs?: number;
	ceilingDb?: number;
}): Promise<NormalizeResult> {
	const before = await measureLoudnessAsync({ channels, sampleRate });
	if (before.lufs <= -60) return { before, after: before, gainDb: 0 };

	let current = before;
	let total = 0;
	for (let pass = 0; pass < 3; pass++) {
		const delta = Math.max(-40, Math.min(30 - total, targetLufs - current.lufs));
		if (Math.abs(delta) < 0.1) break;
		applyGain(channels, 10 ** (delta / 20));
		total += delta;
		limitPeaks({ channels, sampleRate, ceilingDb });
		await yieldToUi();
		current = await measureLoudnessAsync({ channels, sampleRate });
	}
	return { before, after: current, gainDb: total };
}
