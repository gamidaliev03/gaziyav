// The measuring and limiting arithmetic of the sound department, as ONE self-contained function.
//
// It runs as it is on the page (the export's mix, «Bring to target», the whole-timeline measure) and, turned into
// text with toString(), inside the audio worklet (the live meter and the player's limiter): the same arithmetic in
// both places, so the number the player shows and the file the export writes cannot drift apart.
//
// RULES for this file (the worklet gets the function's text, nothing else):
//   · nothing outside the function's own body may be referenced — no imports, no module constants, only globals
//     every JS realm has (Math, Float32Array, Float64Array, Int32Array);
//   · plain functions and loops only: no classes, no spread, no destructuring, nothing a compiler would turn into a
//     call to a helper that lives outside.
//
// What it implements: ITU-R BS.1770-4 K-weighting and gating, EBU R 128 momentary / short-term / integrated loudness,
// EBU Tech 3342 loudness range, true peak by 4× interpolation, and a look-ahead true-peak limiter.

export interface MeterBlock {
	/** Σ over channels of the K-weighted mean square of this 100 ms. */
	energy: number;
	/** Highest true peak (linear) seen in it. */
	truePeak: number;
	/** Highest sample (linear). */
	samplePeak: number;
}

export interface SoundMeter {
	/** Samples in a 100 ms block at this rate. */
	hop: number;
	/** Feeds frames [from, to) of each channel; `onBlock` is called for every finished 100 ms. */
	push(inputs: ArrayLike<Float32Array>, from: number, to: number, onBlock: (energy: number, truePeak: number, samplePeak: number) => void): void;
	/** The peaks of what is left after the last whole block (the tail's inter-sample peaks included). */
	finish(): { truePeak: number; samplePeak: number };
	reset(): void;
}

export interface SoundLimiter {
	/** Output is the input delayed by this many samples. */
	latency: number;
	/** Limits frames [from, to) of `inputs` into `outputs` starting at `outFrom` (in place is fine). */
	process(inputs: ArrayLike<Float32Array>, outputs: ArrayLike<Float32Array>, from: number, to: number, outFrom: number): void;
	/** The deepest gain reduction so far (linear, 1 = never worked) and how many samples were taken down by more than 1 dB. */
	stats(): { minGain: number; reduced: number; total: number };
	reset(): void;
}

export interface SoundCore {
	kWeighting(rate: number): Float64Array;
	interpolator(phases: number, taps: number): Float64Array[];
	lufs(meanSquare: number): number;
	makeMeter(rate: number, channels: number): SoundMeter;
	makeLimiter(rate: number, channels: number, ceilingDb: number, lookaheadMs: number, releaseMs: number): SoundLimiter;
	/** Mean of the last `length` blocks ending at `at` (inclusive) as LUFS; −Infinity until that many exist. */
	windowLufs(energies: ArrayLike<number>, at: number, length: number): number;
	/** Gated programme loudness of `count` 100 ms energies (LUFS; −Infinity when nothing passes the gates). */
	integrated(energies: ArrayLike<number>, count: number): number;
	/** Loudness range (LU) of `count` 100 ms energies; 0 when too short. */
	range(energies: ArrayLike<number>, count: number): number;
}

export function soundCore(): SoundCore {
	/** Blocks under this loudness never count (the absolute gate). */
	var ABSOLUTE_GATE_LUFS = -70;
	/** True peak: 4× interpolation, 24 taps a phase (flat to 19.7 kHz at 48 kHz, images 70 dB down). */
	var PHASES = 4;
	var TAPS = 24;

	function lufs(meanSquare: number): number {
		return meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : Number.NEGATIVE_INFINITY;
	}

	function energyOf(loudness: number): number {
		return Math.pow(10, (loudness + 0.691) / 10);
	}

	/** The two K-weighting biquads for a sample rate: b0 b1 b2 a1 a2 of the shelf, then of the high-pass. */
	function kWeighting(rate: number): Float64Array {
		var out = new Float64Array(10);
		// Stage 1: the head's high shelf (+4 dB above ~1.7 kHz).
		var f0 = 1681.974450955533;
		var G = 3.999843853973347;
		var Q = 0.7071752369554196;
		var K = Math.tan((Math.PI * f0) / rate);
		var Vh = Math.pow(10, G / 20);
		var Vb = Math.pow(Vh, 0.4996667741545416);
		var a0 = 1 + K / Q + K * K;
		out[0] = (Vh + (Vb * K) / Q + K * K) / a0;
		out[1] = (2 * (K * K - Vh)) / a0;
		out[2] = (Vh - (Vb * K) / Q + K * K) / a0;
		out[3] = (2 * (K * K - 1)) / a0;
		out[4] = (1 - K / Q + K * K) / a0;
		// Stage 2: the RLB high-pass (~38 Hz).
		f0 = 38.13547087602444;
		Q = 0.5003270373238773;
		K = Math.tan((Math.PI * f0) / rate);
		a0 = 1 + K / Q + K * K;
		out[5] = 1;
		out[6] = -2;
		out[7] = 1;
		out[8] = (2 * (K * K - 1)) / a0;
		out[9] = (1 - K / Q + K * K) / a0;
		return out;
	}

	function besselI0(x: number): number {
		var sum = 1;
		var term = 1;
		var q = (x * x) / 4;
		for (var k = 1; k < 80; k++) {
			term *= q / (k * k);
			sum += term;
			if (term < sum * 1e-17) break;
		}
		return sum;
	}

	/**
	 * The interpolation filter in phases 1 … P−1 (phase 0 is the sample itself): a Kaiser-windowed sinc, `taps` a phase,
	 * stored OLDEST sample first, each phase scaled to pass a constant unchanged. Phase p gives the signal p/P of a
	 * sample after the sample taps/2 back from the newest one.
	 */
	function interpolator(phases: number, taps: number): Float64Array[] {
		var centre = (phases * taps) / 2;
		var beta = 6.76;
		var norm = besselI0(beta);
		var out: Float64Array[] = [];
		for (var p = 1; p < phases; p++) {
			var h = new Float64Array(taps);
			var sum = 0;
			for (var i = 0; i < taps; i++) {
				// i counts from the newest sample; stored reversed (oldest first)
				var k = phases * i + p;
				var t = (k - centre) / phases;
				var sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
				var r = (k - centre) / centre;
				var w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / norm;
				h[taps - 1 - i] = sinc * w;
				sum += sinc * w;
			}
			for (var j = 0; j < taps; j++) h[j] /= sum;
			out.push(h);
		}
		return out;
	}

	function makeMeter(rate: number, channels: number): SoundMeter {
		var k = kWeighting(rate);
		var b10 = k[0], b11 = k[1], b12 = k[2], a11 = k[3], a12 = k[4];
		var b20 = k[5], b21 = k[6], b22 = k[7], a21 = k[8], a22 = k[9];
		var hop = Math.round(rate * 0.1);
		var filters = interpolator(PHASES, TAPS);
		var half = TAPS / 2;
		// per channel: the two biquads' states (transposed direct form II), and the last TAPS samples twice over
		var state = new Float64Array(channels * 4);
		var rings: Float32Array[] = [];
		for (var c = 0; c < channels; c++) rings.push(new Float32Array(TAPS * 2));
		var write = 0;
		var filled = 0;
		var energy = 0;
		var truePeak = 0;
		var samplePeak = 0;

		function segment(channel: number, data: Float32Array, from: number, to: number, at: number): void {
			var s = channel * 4;
			var s1 = state[s], s2 = state[s + 1], s3 = state[s + 2], s4 = state[s + 3];
			var ring = rings[channel];
			var w = at;
			var sum = 0;
			var tp = truePeak;
			var sp = samplePeak;
			for (var i = from; i < to; i++) {
				var x = data[i];
				// K-weighting
				var y = b10 * x + s1;
				s1 = b11 * x - a11 * y + s2;
				s2 = b12 * x - a12 * y;
				var z = b20 * y + s3;
				s3 = b21 * y - a21 * z + s4;
				s4 = b22 * y - a22 * z;
				sum += z * z;
				// sample peak
				var ax = x < 0 ? -x : x;
				if (ax > sp) sp = ax;
				if (ax > tp) tp = ax;
				// true peak: the three points between the two samples in the middle of the window
				ring[w] = x;
				ring[w + TAPS] = x;
				w++;
				if (w === TAPS) w = 0;
				var a = ring[w + half - 1];
				var b = ring[w + half];
				if (a < 0) a = -a;
				if (b < 0) b = -b;
				// Band-limited sound never rises far above both neighbours: points that cannot beat the peak are skipped.
				if ((a > b ? a : b) >= tp * 0.4) {
					for (var p = 0; p < PHASES - 1; p++) {
						var h = filters[p];
						var v = 0;
						for (var j = 0; j < TAPS; j++) v += ring[w + j] * h[j];
						if (v < 0) v = -v;
						if (v > tp) tp = v;
					}
				}
			}
			state[s] = s1;
			state[s + 1] = s2;
			state[s + 2] = s3;
			state[s + 3] = s4;
			energy += sum;
			truePeak = tp;
			samplePeak = sp;
		}

		function push(inputs: ArrayLike<Float32Array>, from: number, to: number, onBlock: (energy: number, truePeak: number, samplePeak: number) => void): void {
			var i = from;
			while (i < to) {
				var n = to - i < hop - filled ? to - i : hop - filled;
				for (var c = 0; c < channels; c++) segment(c, inputs[c < inputs.length ? c : inputs.length - 1], i, i + n, write);
				write = (write + n) % TAPS;
				filled += n;
				i += n;
				if (filled === hop) {
					onBlock(energy / hop, truePeak, samplePeak);
					filled = 0;
					energy = 0;
					truePeak = 0;
					samplePeak = 0;
				}
			}
		}

		function finish(): { truePeak: number; samplePeak: number } {
			// the last half-window of samples has not been in the middle yet: silence pushes it through
			var zeros = new Float32Array(half);
			var keepEnergy = energy;
			var keepFilled = filled;
			var saved = state.slice(0);
			for (var c = 0; c < channels; c++) segment(c, zeros, 0, half, write);
			write = (write + half) % TAPS;
			energy = keepEnergy;
			filled = keepFilled;
			state.set(saved);
			return { truePeak: truePeak, samplePeak: samplePeak };
		}

		function reset(): void {
			for (var i = 0; i < state.length; i++) state[i] = 0;
			for (var c = 0; c < channels; c++) rings[c].fill(0);
			write = 0;
			filled = 0;
			energy = 0;
			truePeak = 0;
			samplePeak = 0;
		}

		return { hop: hop, push: push, finish: finish, reset: reset };
	}

	function windowLufs(energies: ArrayLike<number>, at: number, length: number): number {
		if (at + 1 < length) return Number.NEGATIVE_INFINITY;
		var sum = 0;
		for (var j = at - length + 1; j <= at; j++) sum += energies[j];
		return lufs(sum / length);
	}

	function integrated(energies: ArrayLike<number>, count: number): number {
		var gate = energyOf(ABSOLUTE_GATE_LUFS);
		var sum = 0;
		var n = 0;
		var j: number;
		var block: number;
		// gating blocks: 400 ms, a new one every 100 ms
		for (j = 3; j < count; j++) {
			block = (energies[j - 3] + energies[j - 2] + energies[j - 1] + energies[j]) / 4;
			if (block > gate) {
				sum += block;
				n++;
			}
		}
		if (n === 0) return Number.NEGATIVE_INFINITY;
		// the relative gate: 10 LU under the level of what passed the absolute one
		var relative = (sum / n) * 0.1;
		var sum2 = 0;
		var n2 = 0;
		for (j = 3; j < count; j++) {
			block = (energies[j - 3] + energies[j - 2] + energies[j - 1] + energies[j]) / 4;
			if (block > gate && block > relative) {
				sum2 += block;
				n2++;
			}
		}
		return n2 > 0 ? lufs(sum2 / n2) : Number.NEGATIVE_INFINITY;
	}

	function range(energies: ArrayLike<number>, count: number): number {
		// short-term loudness (3 s) every 100 ms, gated at −70 LUFS and at 20 LU under their own mean
		var gate = energyOf(ABSOLUTE_GATE_LUFS);
		var values: number[] = [];
		var window = 0;
		for (var j = 0; j < count; j++) {
			window += energies[j];
			if (j >= 30) window -= energies[j - 30];
			if (j >= 29 && window / 30 > gate) values.push(window / 30);
		}
		if (values.length < 2) return 0;
		var sum = 0;
		for (var i = 0; i < values.length; i++) sum += values[i];
		var relative = (sum / values.length) * 0.01;
		var kept: number[] = [];
		for (var m = 0; m < values.length; m++) if (values[m] > relative) kept.push(values[m]);
		if (kept.length < 2) return 0;
		kept.sort(function (a, b) {
			return a - b;
		});
		var low = kept[Math.round((kept.length - 1) * 0.1)];
		var high = kept[Math.round((kept.length - 1) * 0.95)];
		return lufs(high) - lufs(low);
	}

	/**
	 * A look-ahead true-peak limiter, all channels by one gain. The gain a peak needs is known `lookahead` early, so it
	 * is reached by a straight ramp before the peak (never a jump) and held across it. It lets go in two ways at once:
	 * quickly after a stray peak (`releaseMs`: the ear does not notice a dip that short behind a transient), and
	 * slowly from wherever it has been working for a while — the average depth of the last half second is held, so
	 * dense loud sound gets one steady gain instead of a gain that breathes with every beat. It works only on what is
	 * over the ceiling: under it the sound passes untouched (delayed by `latency`).
	 */
	function makeLimiter(rate: number, channels: number, ceilingDb: number, lookaheadMs: number, releaseMs: number): SoundLimiter {
		var filters = interpolator(PHASES, TAPS);
		var half = TAPS / 2;
		// a tenth of a dB inside the ceiling: the gain moves a little between the samples a peak is made of
		var ceiling = Math.pow(10, (ceilingDb - 0.1) / 20);
		var la = Math.max(1, Math.round((rate * lookaheadMs) / 1000));
		var latency = la + half;
		var release = 1 - Math.exp(-1 / ((rate * releaseMs) / 1000));
		// the slow side: the mean depth over ~0.4 s, of which this share is held
		var slow = 1 - Math.exp(-1 / (rate * 0.4));
		var HELD = 0.8;
		var rings: Float32Array[] = [];
		var lines: Float32Array[] = [];
		for (var c = 0; c < channels; c++) {
			rings.push(new Float32Array(TAPS * 2));
			lines.push(new Float32Array(latency));
		}
		var write = 0; // in the interpolation rings
		var at = 0; // in the delay lines
		// the gain each sample needs, the last la + 1 of them
		var needs = new Float32Array(la + 1);
		var needAt = 0;
		// sliding minimum of the needs over 2·la + 1 samples (a monotonic queue in a ring)
		var cap = 2 * la + 2;
		var queueIndex = new Float64Array(cap);
		var queueValue = new Float32Array(cap);
		var head = 0;
		var size = 0;
		// mean of the last la minima: the ramp
		var box = new Float32Array(la);
		var boxAt = 0;
		var boxSum = 0;
		var count = 0;
		var gain = 1;
		var fast = 1;
		var depth = 0;
		var minGain = 1;
		var reduced = 0;
		var total = 0;

		function clear(): void {
			for (var c = 0; c < channels; c++) {
				rings[c].fill(0);
				lines[c].fill(0);
			}
			needs.fill(1);
			box.fill(1);
			boxSum = la;
			write = 0;
			at = 0;
			needAt = 0;
			boxAt = 0;
			head = 0;
			size = 0;
			count = 0;
			gain = 1;
			fast = 1;
			depth = 0;
			minGain = 1;
			reduced = 0;
			total = 0;
		}
		clear();

		function process(inputs: ArrayLike<Float32Array>, outputs: ArrayLike<Float32Array>, from: number, to: number, outFrom: number): void {
			var last = inputs.length - 1;
			for (var i = from; i < to; i++) {
				// 1. the true peak around the sample that is now in the middle of the window
				var peak = 0;
				var c: number;
				var w = write + 1;
				if (w === TAPS) w = 0;
				for (c = 0; c < channels; c++) {
					var x = inputs[c < last ? c : last][i];
					var ring = rings[c];
					ring[write] = x;
					ring[write + TAPS] = x;
					var a = ring[w + half - 1];
					var b = ring[w + half];
					if (a < 0) a = -a;
					if (b < 0) b = -b;
					if (a > peak) peak = a;
					if ((a > b ? a : b) >= ceiling * 0.4) {
						for (var p = 0; p < PHASES - 1; p++) {
							var h = filters[p];
							var v = 0;
							for (var j = 0; j < TAPS; j++) v += ring[w + j] * h[j];
							if (v < 0) v = -v;
							if (v > peak) peak = v;
						}
					}
				}
				write = w;
				var need = peak > ceiling ? ceiling / peak : 1;

				// 2. the lowest need of the last 2·la + 1 samples
				while (size > 0 && queueValue[(head + size - 1) % cap] >= need) size--;
				var slot = (head + size) % cap;
				queueIndex[slot] = count;
				queueValue[slot] = need;
				size++;
				while (queueIndex[head] < count - 2 * la) {
					head = (head + 1) % cap;
					size--;
				}
				var minimum = queueValue[head];

				// 3. its mean over la samples: a straight ramp down to the peak's gain, reached at the peak
				boxSum += minimum - box[boxAt];
				box[boxAt] = minimum;
				boxAt++;
				if (boxAt === la) boxAt = 0;
				var envelope = boxSum / la;

				// 4. the sample leaving the delay line and the gain it needs itself
				needs[needAt] = need;
				needAt++;
				if (needAt > la) needAt = 0;
				var own = needs[needAt];
				var target = envelope < own ? envelope : own;
				if (target > 1) target = 1;
				// down at once (the ramp is already in `target`), up quickly…
				fast = target < fast ? target : fast + (target - fast) * release;
				// …but not above what it has been holding on average
				depth += (1 - fast - depth) * slow;
				var floor = 1 - HELD * depth;
				gain = fast < floor ? fast : floor;
				if (gain < minGain) minGain = gain;
				if (gain < 0.8913) reduced++;
				total++;
				count++;

				var o = outFrom + (i - from);
				for (c = 0; c < channels; c++) {
					var line = lines[c];
					var input = inputs[c < last ? c : last][i];
					var delayed = line[at];
					line[at] = input;
					if (c < outputs.length) outputs[c][o] = delayed * gain;
				}
				at++;
				if (at === latency) at = 0;
			}
		}

		function stats(): { minGain: number; reduced: number; total: number } {
			return { minGain: minGain, reduced: reduced, total: total };
		}

		return { latency: latency, process: process, stats: stats, reset: clear };
	}

	return {
		kWeighting: kWeighting,
		interpolator: interpolator,
		lufs: lufs,
		makeMeter: makeMeter,
		makeLimiter: makeLimiter,
		windowLufs: windowLufs,
		integrated: integrated,
		range: range,
	};
}
