import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { soundCore } from "../dsp/core";
import { applyMasterInPlace, core, measureProgramme, toDb } from "../dsp/offline";
import { LIMITER_PROCESSOR, METER_PROCESSOR, workletSource } from "../dsp/worklet";

const RATE = 48000;
// a minute of sound is measured in a second on a quiet Mac; the Mac is not always quiet
setDefaultTimeout(120000);

function sine(db: number, seconds: number, hz = 1000, rate = RATE, phase = 0): Float32Array {
	const a = 10 ** (db / 20);
	const x = new Float32Array(Math.round(seconds * rate));
	for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * hz * i) / rate + phase);
	return x;
}
const join = (...parts: Float32Array[]) => {
	const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};
const stereo = (x: Float32Array) => [x, x.slice(0)];
/** 20 ms in and out: a tone that starts or stops dead has a real peak above its crest (the edge rings between samples). */
function faded(x: Float32Array, rate = RATE): Float32Array {
	const n = Math.round(rate * 0.02);
	for (let i = 0; i < n; i++) {
		const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
		x[i] *= g;
		x[x.length - 1 - i] *= g;
	}
	return x;
}
/** Deterministic noise in −1 … 1. */
function noise(seconds: number, seed = 7, rate = RATE): Float32Array {
	let s = seed >>> 0;
	const x = new Float32Array(Math.round(seconds * rate));
	for (let i = 0; i < x.length; i++) {
		s = (s * 1664525 + 1013904223) >>> 0;
		x[i] = s / 2 ** 31 - 1;
	}
	return x;
}
const measure = (channels: Float32Array[], rate = RATE) => measureProgramme({ channels, sampleRate: rate });

describe("K-weighting", () => {
	test("at 48 kHz it is the filter of ITU-R BS.1770", () => {
		const k = core.kWeighting(48000);
		const want = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585, 1, -2, 1, -1.99004745483398, 0.99007225036621];
		for (let i = 0; i < 10; i++) expect(Math.abs(k[i] - want[i])).toBeLessThan(1e-6);
	});
});

describe("programme loudness (EBU Tech 3341 signals)", () => {
	test("1: a stereo 1 kHz sine at −23 dBFS reads −23.0 LUFS, at 48 and 44.1 kHz", async () => {
		expect(Math.abs((await measure(stereo(sine(-23, 20)))).integrated + 23)).toBeLessThan(0.05);
		expect(Math.abs((await measure(stereo(sine(-23, 20, 1000, 44100)), 44100)).integrated + 23)).toBeLessThan(0.05);
	});
	test("2: at −33 dBFS it reads −33.0", async () => {
		expect(Math.abs((await measure(stereo(sine(-33, 20)))).integrated + 33)).toBeLessThan(0.05);
	});
	test("3: the relative gate drops the quiet ends (−36 · −23 · −36 → −23.0)", async () => {
		const x = join(sine(-36, 10), sine(-23, 60), sine(-36, 10));
		expect(Math.abs((await measure(stereo(x))).integrated + 23)).toBeLessThan(0.1);
	});
	test("4: the absolute gate drops what is under −70 (−72 · −36 · −23 · −36 · −72 → −23.0)", async () => {
		const x = join(sine(-72, 10), sine(-36, 10), sine(-23, 60), sine(-36, 10), sine(-72, 10));
		expect(Math.abs((await measure(stereo(x))).integrated + 23)).toBeLessThan(0.1);
	});
	test("5: −26 · −20 · −26 → −23.0", async () => {
		const x = join(sine(-26, 20), sine(-20, 20.1), sine(-26, 20));
		expect(Math.abs((await measure(stereo(x))).integrated + 23)).toBeLessThan(0.1);
	});
	test("momentary and short-term maxima of a steady tone equal its loudness", async () => {
		const r = await measure(stereo(sine(-23, 10)));
		expect(Math.abs(r.momentaryMax + 23)).toBeLessThan(0.05);
		expect(Math.abs(r.shortTermMax + 23)).toBeLessThan(0.05);
	});
	test("loudness range: a tone at −20 then at −30 has a range of 10 LU (Tech 3342, signal 1)", async () => {
		const x = join(sine(-20, 20), sine(-30, 20));
		expect(Math.abs((await measure(stereo(x))).range - 10)).toBeLessThan(1);
	});
	test("silence reads −∞ and no peak", async () => {
		const r = await measure(stereo(new Float32Array(RATE * 2)));
		expect(r.integrated).toBe(Number.NEGATIVE_INFINITY);
		expect(r.truePeakDb).toBe(Number.NEGATIVE_INFINITY);
	});
});

describe("true peak", () => {
	test("a quarter-rate sine caught between its crests reads its real peak, 3 dB over its samples", async () => {
		// EBU Tech 3341 signal 15: fs/4, 45° — every sample is at 0.707 of the crest
		const x = faded(sine(-6, 2, RATE / 4, RATE, Math.PI / 4));
		const r = await measure(stereo(x));
		expect(Math.abs(r.samplePeakDb + 9.03)).toBeLessThan(0.05);
		expect(Math.abs(r.truePeakDb + 6)).toBeLessThan(0.02);
	});
	test("a 1 kHz tone reads its own peak", async () => {
		const r = await measure(stereo(sine(-12, 1)));
		expect(Math.abs(r.truePeakDb + 12)).toBeLessThan(0.02);
	});
	test("high tones read their crest within 0.2 dB up to 18 kHz, whatever their phase", async () => {
		for (const [hz, phase] of [[10000, 0.3], [15000, 0], [15000, 1], [18000, 0.2]]) {
			const r = await measure(stereo(faded(sine(-10, 1, hz, RATE, phase))));
			expect(Math.abs(r.truePeakDb + 10)).toBeLessThan(0.2);
		}
	});
	test("a tone that starts dead reads higher than its crest: the edge is a real peak between samples", async () => {
		const r = await measure(stereo(sine(-10, 1, 15000)));
		expect(r.truePeakDb).toBeGreaterThan(-9.9);
	});
	test("the interpolation passes a constant unchanged and has three phases of 24 taps", () => {
		const phases = core.interpolator(4, 24);
		expect(phases.length).toBe(3);
		for (const h of phases) expect(Math.abs(h.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
	});
});

describe("the limiter", () => {
	test("what is under the ceiling passes untouched, only later", () => {
		const limiter = core.makeLimiter(RATE, 2, -1, 5, 60);
		const x = sine(-6, 0.5, 440);
		const out = [new Float32Array(x.length), new Float32Array(x.length)];
		limiter.process([x, x], out, 0, x.length, 0);
		for (let i = limiter.latency; i < x.length; i++) expect(out[0][i]).toBe(x[i - limiter.latency]);
		expect(limiter.stats().minGain).toBe(1);
	});

	test("loud noise and tones come out under −1 dBTP, whatever the rate", async () => {
		for (const rate of [44100, 48000]) {
			for (const source of [noise(3, 3, rate), sine(4, 3, 997, rate), sine(2, 3, rate / 4, rate, Math.PI / 4)]) {
				const channels = stereo(source.slice(0));
				await applyMasterInPlace({ channels, sampleRate: rate, limiterCeilingDb: -1 });
				const r = await measure(channels, rate);
				expect(r.truePeakDb).toBeLessThanOrEqual(-1);
				expect(r.truePeakDb).toBeGreaterThan(-1.6);
			}
		}
	});

	test("in place the result stays in time with the source", async () => {
		// a click, 0.2 s of quiet, a loud burst: the click must stay where it was
		const x = new Float32Array(RATE);
		x[4800] = 0.5;
		for (let i = 24000; i < 36000; i++) x[i] = 1.4 * Math.sin((2 * Math.PI * 300 * i) / RATE);
		const channels = stereo(x);
		await applyMasterInPlace({ channels, sampleRate: RATE, limiterCeilingDb: -1 });
		let at = 0;
		for (let i = 0; i < 9600; i++) if (Math.abs(channels[0][i]) > Math.abs(channels[0][at])) at = i;
		expect(at).toBe(4800);
		expect(channels[0][4800]).toBeCloseTo(0.5, 5);
	});

	test("it never jumps: the gain it applies moves less than 0.2 dB from one sample to the next", () => {
		const limiter = core.makeLimiter(RATE, 1, -1, 5, 60);
		// a steady 100 Hz tone that steps from −20 dBFS to +6 dBFS and back
		const n = RATE * 2;
		const x = new Float32Array(n);
		for (let i = 0; i < n; i++) x[i] = (i > RATE * 0.5 && i < RATE ? 2 : 0.1) * Math.sin((2 * Math.PI * 100 * i) / RATE);
		const out = [new Float32Array(n)];
		limiter.process([x], out, 0, n, 0);
		let worst = 0;
		let last = 1;
		let lastAt = -2;
		let lowest = 1;
		for (let i = limiter.latency; i < n; i++) {
			const source = x[i - limiter.latency];
			// near a zero crossing the ratio is all rounding
			if (Math.abs(source) < 0.05) continue;
			const g = out[0][i] / source;
			if (lastAt === i - 1) worst = Math.max(worst, Math.abs(toDb(g) - toDb(last)));
			last = g;
			lastAt = i;
			lowest = Math.min(lowest, g);
		}
		expect(worst).toBeLessThan(0.2);
		// it did work: 6 dB over full scale needs about 7 dB taken off
		expect(toDb(lowest)).toBeLessThan(-6.5);
		// and after the loud part it lets go: one second later the gain is back within 0.5 dB
		let late = 0;
		for (let i = n - 600; i < n; i++) if (Math.abs(x[i - limiter.latency]) > 0.09) late = out[0][i] / x[i - limiter.latency];
		expect(Math.abs(toDb(Math.abs(late)))).toBeLessThan(0.5);
	});

	test("a stray peak costs a moment, steady loud sound gets one steady gain", () => {
		// (a) one click 6 dB over the ceiling in a quiet tone: 150 ms later the gain is within 0.7 dB, a second later it is back
		const limiter = core.makeLimiter(RATE, 1, -1, 5, 60);
		const n = RATE;
		const click = new Float32Array(n);
		for (let i = 0; i < n; i++) click[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / RATE);
		click[12000] = 1.8;
		const a = [new Float32Array(n)];
		limiter.process([click], a, 0, n, 0);
		// the gain at a crest of the tone, `after` seconds past the click
		const gainAfter = (after: number) => {
			let g = 1;
			const from = 12000 + limiter.latency + Math.round(RATE * after);
			for (let i = from; i < from + 120; i++) if (Math.abs(click[i - limiter.latency]) > 0.19) g = a[0][i] / click[i - limiter.latency];
			return toDb(Math.abs(g));
		};
		expect(limiter.stats().minGain).toBeLessThan(0.55);
		expect(Math.abs(gainAfter(0.15))).toBeLessThan(0.7);
		expect(Math.abs(gainAfter(0.9))).toBeLessThan(0.15);

		// (b) a 60 Hz tone 6 dB over the ceiling: after it settles, the gain moves less than 1 dB within a cycle
		const steady = core.makeLimiter(RATE, 1, -1, 5, 60);
		const tone = new Float32Array(RATE * 3);
		for (let i = 0; i < tone.length; i++) tone[i] = 1.78 * Math.sin((2 * Math.PI * 60 * i) / RATE);
		const b = [new Float32Array(tone.length)];
		steady.process([tone], b, 0, tone.length, 0);
		let lo = 10;
		let hi = 0;
		for (let i = RATE * 2; i < tone.length; i++) {
			const source = tone[i - steady.latency];
			if (Math.abs(source) < 0.5) continue;
			const g = b[0][i] / source;
			lo = Math.min(lo, g);
			hi = Math.max(hi, g);
		}
		expect(toDb(hi) - toDb(lo)).toBeLessThan(1);
	});

	test("measuring through the master (gain and limiter) equals measuring the limited buffer", async () => {
		const x = noise(4, 11);
		for (let i = 0; i < x.length; i++) x[i] *= 0.2;
		const dry = stereo(x);
		const through = await measureProgramme({ channels: dry, sampleRate: RATE, gainDb: 12, limiterCeilingDb: -1 });
		const wet = stereo(x.slice(0));
		await applyMasterInPlace({ channels: wet, sampleRate: RATE, gainDb: 12, limiterCeilingDb: -1 });
		const direct = await measure(wet);
		expect(Math.abs(through.integrated - direct.integrated)).toBeLessThan(0.02);
		expect(Math.abs(through.truePeakDb - direct.truePeakDb)).toBeLessThan(0.05);
		expect(through.limiterDb).toBeLessThan(-1);
		expect(dry[0][1000]).toBe(x[1000]);
	});
});

describe("the worklet's text", () => {
	test("is self-contained: it runs in a bare scope and measures what the page measures", async () => {
		const registered = new Map<string, new (options?: unknown) => { port: { onmessage: ((e: { data: unknown }) => void) | null; posted: unknown[] }; process: (i: Float32Array[][], o: Float32Array[][]) => boolean }>();
		class FakeProcessor {
			port = {
				onmessage: null as ((e: { data: unknown }) => void) | null,
				posted: [] as unknown[],
				postMessage(message: unknown) {
					this.posted.push(message);
				},
			};
		}
		// only what a worklet scope has
		new Function("sampleRate", "registerProcessor", "AudioWorkletProcessor", workletSource())(RATE, (name: string, ctor: never) => registered.set(name, ctor), FakeProcessor);
		expect([...registered.keys()].sort()).toEqual([LIMITER_PROCESSOR, METER_PROCESSOR].sort());

		const x = join(sine(-23, 2), noise(2, 5).map((v) => v * 0.3));
		const Meter = registered.get(METER_PROCESSOR)!;
		const meter = new Meter();
		for (let i = 0; i + 128 <= x.length; i += 128) meter.process([[x.subarray(i, i + 128), x.subarray(i, i + 128)]], []);
		const energies: number[] = [];
		let truePeak = 0;
		for (const message of meter.port.posted as Array<{ blocks: Float64Array }>) {
			for (let i = 0; i < message.blocks.length; i += 3) {
				energies.push(message.blocks[i]);
				truePeak = Math.max(truePeak, message.blocks[i + 1]);
			}
		}
		const live = core.integrated(energies, energies.length);
		const offline = await measure(stereo(x.subarray(0, energies.length * 4800)));
		expect(energies.length).toBe(Math.floor(x.length / 4800));
		expect(Math.abs(live - offline.integrated)).toBeLessThan(1e-9);
		expect(Math.abs(toDb(truePeak) - offline.truePeakDb)).toBeLessThan(0.01);

		// the limiter's processor: the same samples as the page's limiter
		const Limiter = registered.get(LIMITER_PROCESSOR)!;
		const node = new Limiter({ processorOptions: { ceilingDb: -1 } });
		const loud = noise(1, 9);
		const got = new Float32Array(loud.length);
		for (let i = 0; i + 128 <= loud.length; i += 128) {
			const out = [new Float32Array(128), new Float32Array(128)];
			node.process([[loud.subarray(i, i + 128), loud.subarray(i, i + 128)]], [out]);
			got.set(out[0], i);
		}
		const page = soundCore().makeLimiter(RATE, 2, -1, 5, 60);
		const want = [new Float32Array(loud.length), new Float32Array(loud.length)];
		page.process([loud, loud], want, 0, loud.length - (loud.length % 128), 0);
		for (let i = 0; i < loud.length - (loud.length % 128); i += 97) expect(got[i]).toBe(want[0][i]);
	});
});
