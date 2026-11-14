// Beat tracking: a TS port of Kadr's Assist.detectBeats (log-energy onsets → tempo by autocorrelation
// with a 120 BPM prior and an octave check → the beat grid's phase). Pure: mono samples in, beat times out.

export interface BeatAnalysis {
	/** Seconds from the start of the analysed audio. */
	beats: number[];
	bpm: number;
}

/** Kadr's hop: 512 samples at 22 050 Hz (≈ 23 ms); other rates keep the same hop length in time. */
export function hopFor(sampleRate: number): number {
	return Math.max(64, Math.round((sampleRate * 512) / 22050));
}

/** Log energy per hop of mono samples, streamed chunk by chunk (bounded memory). */
export class EnvelopeBuilder {
	readonly env: number[] = [];
	private acc = 0;
	private n = 0;
	constructor(readonly hop: number) {}
	push(samples: Float32Array) {
		for (let i = 0; i < samples.length; i++) {
			const v = samples[i];
			this.acc += v * v;
			if (++this.n === this.hop) {
				this.env.push(Math.log(1 + 1000 * this.acc));
				this.acc = 0;
				this.n = 0;
			}
		}
	}
}

export function detectBeatsFromEnvelope(env: number[], fps: number): BeatAnalysis {
	if (env.length <= 16) return { beats: [], bpm: 0 };
	// Onset strength = positive change of log energy, lightly smoothed so periods between hops still correlate.
	const raw = new Float64Array(env.length);
	for (let i = 1; i < env.length; i++) raw[i] = Math.max(0, env[i] - env[i - 1]);
	const onset = Float64Array.from(raw);
	for (let i = 1; i < raw.length - 1; i++) onset[i] = 0.25 * raw[i - 1] + 0.5 * raw[i] + 0.25 * raw[i + 1];
	const ac = (lag: number) => {
		if (lag <= 0 || lag >= onset.length) return 0;
		let s = 0;
		for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
		return s / (onset.length - lag);
	};
	// Tempo by autocorrelation in 60…200 BPM, weighted by a log-normal prior around 120 BPM.
	const minLag = Math.floor((fps * 60) / 200);
	const maxLag = Math.floor((fps * 60) / 60);
	let bestLag = minLag;
	let bestScore = -1;
	for (let lag = minLag; lag <= Math.max(minLag, Math.min(maxLag, onset.length - 1)); lag++) {
		const bpm = (60 * fps) / lag;
		const s = ac(lag) * Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.1) ** 2);
		if (s > bestScore) {
			bestScore = s;
			bestLag = lag;
		}
	}
	// Octave check: prefer the faster tempo when its periodicity is nearly as strong.
	while (Math.floor(bestLag / 2) >= minLag) {
		const half = Math.floor(bestLag / 2);
		if (Math.max(ac(half), ac(half + 1)) <= 0.5 * ac(bestLag)) break;
		bestLag = ac(half + 1) > ac(half) ? half + 1 : half;
	}
	// Refine the period with parabolic interpolation.
	const y0 = ac(bestLag - 1);
	const y1 = ac(bestLag);
	const y2 = ac(bestLag + 1);
	const denom = y0 - 2 * y1 + y2;
	const period = bestLag + (Math.abs(denom) > 1e-12 ? (0.5 * (y0 - y2)) / denom : 0);
	if (!(period > 0)) return { beats: [], bpm: 0 };
	// Phase: the offset whose beat grid collects the most onset energy.
	let bestPhase = 0;
	let bestSum = -1;
	for (let phase = 0; phase < Math.max(1, Math.floor(period)); phase++) {
		let s = 0;
		for (let t = phase; Math.floor(t) < onset.length; t += period) s += onset[Math.floor(t)];
		if (s > bestSum) {
			bestSum = s;
			bestPhase = phase;
		}
	}
	// Kadr laid a rigid grid from the phase; a 0.3 % tempo error then drifts by a whole beat over a song. Here each
	// beat is pulled to the strongest onset near where the grid expects it, and the grid continues from there.
	let mean = 0;
	for (let i = 0; i < onset.length; i++) mean += onset[i];
	mean /= onset.length;
	const reach = Math.max(1, Math.round(period * 0.15));
	const beats: number[] = [];
	for (let t = bestPhase; t < onset.length; ) {
		const lo = Math.max(1, Math.floor(t - reach));
		const hi = Math.min(onset.length - 2, Math.ceil(t + reach));
		let best = -1;
		let bestValue = 0;
		for (let i = lo; i <= hi; i++) {
			// Prefer peaks close to the expected time.
			const v = onset[i] * Math.exp(-0.5 * ((i - t) / reach) ** 2);
			if (v > bestValue) {
				bestValue = v;
				best = i;
			}
		}
		let at = t;
		if (best >= 0 && onset[best] > mean) {
			const a = onset[best - 1];
			const b = onset[best];
			const c = onset[best + 1];
			const d = a - 2 * b + c;
			at = best + (Math.abs(d) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0);
		}
		beats.push(at / fps);
		t = at + period;
	}
	return { beats, bpm: (60 * fps) / period };
}

/** Convenience for whole buffers (tests). */
export function detectBeats(samples: Float32Array, sampleRate: number): BeatAnalysis {
	const hop = hopFor(sampleRate);
	const b = new EnvelopeBuilder(hop);
	b.push(samples);
	return detectBeatsFromEnvelope(b.env, sampleRate / hop);
}
