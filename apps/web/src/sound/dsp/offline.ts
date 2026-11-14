// The core (dsp/core.ts) run over whole buffers on the page: the measure of a mix, and the master's gain and limiter
// applied to the export's buffer. Long buffers are worked a second of sound at a time and the page gets the thread
// back between pieces, so a measure of an hour never freezes the editor and can be cancelled.
import { soundCore } from "./core";

/** The page's own instance of the arithmetic the worklet runs. */
export const core = soundCore();

export const toDb = (linear: number) => (linear > 0 ? 20 * Math.log10(linear) : Number.NEGATIVE_INFINITY);
export const fromDb = (db: number) => 10 ** (db / 20);

/** The limiter's shape: 5 ms to reach a peak's gain, 60 ms to let go of a stray peak (slower where it works for long). */
export const LIMITER_LOOKAHEAD_MS = 5;
export const LIMITER_RELEASE_MS = 60;

export interface ProgrammeLoudness {
	/** Integrated (programme) loudness, LUFS; −Infinity for silence. */
	integrated: number;
	/** The loudest 3 s and the loudest 400 ms, LUFS. */
	shortTermMax: number;
	momentaryMax: number;
	/** Loudness range, LU. */
	range: number;
	/** True peak (4× interpolation) and the highest sample, dB. */
	truePeakDb: number;
	samplePeakDb: number;
	seconds: number;
}

/** The numbers of a run of 100 ms blocks (the live meter and the offline measure both end here). */
export function summarise(energies: ArrayLike<number>, count: number, truePeak: number, samplePeak: number): ProgrammeLoudness {
	let shortTermMax = Number.NEGATIVE_INFINITY;
	let momentaryMax = Number.NEGATIVE_INFINITY;
	let three = 0;
	let four = 0;
	for (let j = 0; j < count; j++) {
		three += energies[j];
		four += energies[j];
		if (j >= 30) three -= energies[j - 30];
		if (j >= 4) four -= energies[j - 4];
		if (j >= 29 && three / 30 > shortTermMax) shortTermMax = three / 30;
		if (j >= 3 && four / 4 > momentaryMax) momentaryMax = four / 4;
	}
	return {
		integrated: core.integrated(energies, count),
		shortTermMax: shortTermMax > 0 ? core.lufs(shortTermMax) : Number.NEGATIVE_INFINITY,
		momentaryMax: momentaryMax > 0 ? core.lufs(momentaryMax) : Number.NEGATIVE_INFINITY,
		range: core.range(energies, count),
		truePeakDb: toDb(truePeak),
		samplePeakDb: toDb(samplePeak),
		seconds: count / 10,
	};
}

export class MeasureCancelled extends Error {
	constructor() {
		super("Cancelled.");
		this.name = "MeasureCancelled";
	}
}

/** Hands the thread back when this piece of work has held it for a frame. */
function pacer(signal?: AbortSignal) {
	let since = typeof performance !== "undefined" ? performance.now() : 0;
	return async () => {
		if (signal?.aborted) throw new MeasureCancelled();
		const now = typeof performance !== "undefined" ? performance.now() : 0;
		if (now - since < 12) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		since = typeof performance !== "undefined" ? performance.now() : 0;
		if (signal?.aborted) throw new MeasureCancelled();
	};
}

export interface MeasureOptions {
	channels: Float32Array[];
	sampleRate: number;
	/** A gain put on the sound before it is measured (the master's fader), dB. */
	gainDb?: number;
	/** With a ceiling the sound also goes through the limiter first (what the master would let out). */
	limiterCeilingDb?: number | null;
	signal?: AbortSignal;
	onProgress?: (share: number) => void;
}

export interface MeasureResult extends ProgrammeLoudness {
	/** The limiter's deepest reduction (dB ≤ 0) and the share of the sound it took down by more than 1 dB; 0 and 0 without one. */
	limiterDb: number;
	limiterShare: number;
}

/**
 * Loudness and true peak of a whole buffer as the master would let it out: × gain, then the limiter when a ceiling is
 * given. The buffer itself is not changed, and only a second of it is copied at a time.
 */
export async function measureProgramme({ channels, sampleRate, gainDb = 0, limiterCeilingDb = null, signal, onProgress }: MeasureOptions): Promise<MeasureResult> {
	const length = channels[0]?.length ?? 0;
	const count = Math.max(1, channels.length);
	const meter = core.makeMeter(sampleRate, count);
	const limiter = limiterCeilingDb === null ? null : core.makeLimiter(sampleRate, count, limiterCeilingDb, LIMITER_LOOKAHEAD_MS, LIMITER_RELEASE_MS);
	const energies: number[] = [];
	let truePeak = 0;
	let samplePeak = 0;
	const onBlock = (energy: number, tp: number, sp: number) => {
		energies.push(energy);
		if (tp > truePeak) truePeak = tp;
		if (sp > samplePeak) samplePeak = sp;
	};
	const gain = fromDb(gainDb);
	const plain = gain === 1 && !limiter;
	const step = meter.hop * 10;
	const work = plain ? [] : channels.map(() => new Float32Array(step));
	const pace = pacer(signal);
	for (let start = 0; start < length; start += step) {
		const end = Math.min(length, start + step);
		if (plain) {
			meter.push(channels, start, end, onBlock);
		} else {
			const n = end - start;
			for (let c = 0; c < count; c++) {
				const source = channels[c];
				const target = work[c];
				for (let i = 0; i < n; i++) target[i] = source[start + i] * gain;
			}
			if (limiter) limiter.process(work, work, 0, n, 0);
			meter.push(work, 0, n, onBlock);
		}
		onProgress?.(end / Math.max(1, length));
		await pace();
	}
	if (limiter) {
		// what is still inside the limiter's delay
		const tail = channels.map(() => new Float32Array(limiter.latency));
		limiter.process(tail, tail, 0, limiter.latency, 0);
		meter.push(tail, 0, limiter.latency, onBlock);
	}
	const rest = meter.finish();
	if (rest.truePeak > truePeak) truePeak = rest.truePeak;
	if (rest.samplePeak > samplePeak) samplePeak = rest.samplePeak;
	const stats = limiter?.stats();
	return {
		...summarise(energies, energies.length, truePeak, samplePeak),
		// a buffer shorter than the limiter's own blocks still has its length
		seconds: length / sampleRate,
		limiterDb: stats ? toDb(stats.minGain) : 0,
		limiterShare: stats && stats.total > 0 ? stats.reduced / stats.total : 0,
	};
}

/**
 * The master on a buffer, in place: × gain, then the true-peak limiter when a ceiling is given — the very limiter
 * the player runs. The limiter's delay is taken out again: sample n of the result is sample n of the source.
 */
export async function applyMasterInPlace({
	channels,
	sampleRate,
	gainDb = 0,
	limiterCeilingDb = null,
	signal,
}: {
	channels: Float32Array[];
	sampleRate: number;
	gainDb?: number;
	limiterCeilingDb?: number | null;
	signal?: AbortSignal;
}): Promise<{ limiterDb: number; limiterShare: number }> {
	const length = channels[0]?.length ?? 0;
	const gain = fromDb(gainDb);
	if (length === 0 || (gain === 1 && limiterCeilingDb === null)) return { limiterDb: 0, limiterShare: 0 };
	const pace = pacer(signal);
	const step = Math.round(sampleRate);
	if (limiterCeilingDb === null) {
		for (let start = 0; start < length; start += step) {
			const end = Math.min(length, start + step);
			for (const data of channels) for (let i = start; i < end; i++) data[i] *= gain;
			await pace();
		}
		return { limiterDb: 0, limiterShare: 0 };
	}
	const limiter = core.makeLimiter(sampleRate, channels.length, limiterCeilingDb, LIMITER_LOOKAHEAD_MS, LIMITER_RELEASE_MS);
	const delay = limiter.latency;
	const work = channels.map(() => new Float32Array(step));
	const out = channels.map(() => new Float32Array(step));
	// the limiter gives sample n at step n + delay: each piece lands `delay` earlier than it was read
	const land = (n: number, at: number) => {
		const from = Math.max(0, delay - at);
		for (let c = 0; c < channels.length; c++) {
			const data = channels[c];
			const made = out[c];
			for (let i = from; i < n; i++) {
				const index = at + i - delay;
				if (index < length) data[index] = made[i];
			}
		}
	};
	for (let start = 0; start < length; start += step) {
		const n = Math.min(length, start + step) - start;
		for (let c = 0; c < channels.length; c++) {
			const source = channels[c];
			const target = work[c];
			for (let i = 0; i < n; i++) target[i] = source[start + i] * gain;
		}
		limiter.process(work, out, 0, n, 0);
		land(n, start);
		await pace();
	}
	for (const piece of work) piece.fill(0);
	for (let done = 0; done < delay; done += step) {
		const n = Math.min(delay - done, step);
		limiter.process(work, out, 0, n, 0);
		land(n, length + done);
	}
	const stats = limiter.stats();
	return { limiterDb: toDb(stats.minGain), limiterShare: stats.total > 0 ? stats.reduced / stats.total : 0 };
}

/**
 * The loudness of a buffer as a run of 100 ms blocks (Σ channels of the K-weighted mean square), with the highest
 * true peak: what any stretch's loudness is then read from without going through the samples again.
 */
export async function energiesOf({ channels, sampleRate, signal, onProgress }: { channels: Float32Array[]; sampleRate: number; signal?: AbortSignal; onProgress?: (share: number) => void }): Promise<{ energies: Float64Array; truePeak: number; samplePeak: number }> {
	const length = channels[0]?.length ?? 0;
	const meter = core.makeMeter(sampleRate, Math.max(1, channels.length));
	const out = new Float64Array(Math.floor(length / meter.hop));
	let n = 0;
	let truePeak = 0;
	let samplePeak = 0;
	const onBlock = (energy: number, tp: number, sp: number) => {
		out[n++] = energy;
		if (tp > truePeak) truePeak = tp;
		if (sp > samplePeak) samplePeak = sp;
	};
	const pace = pacer(signal);
	const step = meter.hop * 10;
	for (let start = 0; start < length; start += step) {
		const end = Math.min(length, start + step);
		meter.push(channels, start, end, onBlock);
		onProgress?.(end / Math.max(1, length));
		await pace();
	}
	const rest = meter.finish();
	if (rest.truePeak > truePeak) truePeak = rest.truePeak;
	if (rest.samplePeak > samplePeak) samplePeak = rest.samplePeak;
	return { energies: out.subarray(0, n), truePeak, samplePeak };
}

/** Integrated loudness, the loudest 400 ms and the seconds of sound of blocks [from, to) of a run. */
export function stretchLoudness(energies: Float64Array, from: number, to: number): { loudness: number; momentary: number; seconds: number } {
	const a = Math.max(0, Math.min(energies.length, Math.floor(from)));
	const b = Math.max(a, Math.min(energies.length, Math.ceil(to)));
	const part = energies.subarray(a, b);
	let momentary = Number.NEGATIVE_INFINITY;
	let heard = 0;
	const gate = 10 ** ((-70 + 0.691) / 10);
	for (let j = 0; j < part.length; j++) {
		if (part[j] > gate) heard++;
		if (j >= 3) {
			const m = (part[j - 3] + part[j - 2] + part[j - 1] + part[j]) / 4;
			if (m > momentary) momentary = m;
		}
	}
	let loudness = core.integrated(part, part.length);
	// shorter than one gating block (a click, a short effect): its plain level
	if (!Number.isFinite(loudness) && part.length > 0) {
		let sum = 0;
		for (let j = 0; j < part.length; j++) sum += part[j];
		loudness = core.lufs(sum / part.length);
		momentary = Math.max(momentary, sum / part.length);
	}
	return { loudness, momentary: momentary > 0 ? core.lufs(momentary) : Number.NEGATIVE_INFINITY, seconds: heard / 10 };
}
