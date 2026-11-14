import { describe, expect, test } from "bun:test";
import {
	METER_PEAK_HOLD_MS,
	amplitudeToDb,
	createMeterState,
	formatMeterDb,
	isMeterAtRest,
	meterFraction,
	resetMeterClip,
	samplePeak,
	stepMeter,
} from "../level-meter";

const db = (value: number) => 10 ** (value / 20);

function sine(amplitude: number, length = 2048, sampleRate = 48000, hz = 1000) {
	const out = new Float32Array(length);
	for (let i = 0; i < length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
	return out;
}

describe("level meter", () => {
	test("a −6 dBFS sine reads −6 dBFS (sample peak)", () => {
		const peak = samplePeak(sine(db(-6)));
		expect(Math.abs(amplitudeToDb(peak) + 6)).toBeLessThan(0.05);
		expect(formatMeterDb(peak)).toBe("−6.0");
	});

	test("scale: floor at 0, 0 dBFS at the top, monotonic, overs clamp", () => {
		expect(meterFraction(-60)).toBe(0);
		expect(meterFraction(Number.NEGATIVE_INFINITY)).toBe(0);
		expect(meterFraction(0)).toBeCloseTo(1, 6);
		expect(meterFraction(3)).toBe(1);
		let last = -1;
		for (let value = -59; value <= 0; value += 0.5) {
			const f = meterFraction(value);
			expect(f).toBeGreaterThan(last);
			last = f;
		}
	});

	test("fast attack, ~300 ms release", () => {
		const state = createMeterState();
		stepMeter({ state, peaks: [db(-6), db(-6)], now: 0, dtMs: 16 });
		expect(amplitudeToDb(state.channels[0].level)).toBeCloseTo(-6, 3);
		let now = 0;
		for (let i = 0; i < 18; i++) {
			now += 16.67;
			stepMeter({ state, peaks: [0, 0], now, dtMs: 16.67 });
		}
		// 300 ms of silence: down by one time constant (≈ 8.7 dB), not instantly.
		expect(amplitudeToDb(state.channels[0].level)).toBeCloseTo(-6 - 8.69, 0);
	});

	test("peak hold stays 1.5 s, then falls; at rest after silence", () => {
		const state = createMeterState();
		stepMeter({ state, peaks: [db(-3), db(-12)], now: 0, dtMs: 16 });
		let now = 0;
		while (now < METER_PEAK_HOLD_MS - 50) {
			now += 16;
			stepMeter({ state, peaks: [0, 0], now, dtMs: 16 });
		}
		expect(amplitudeToDb(state.channels[0].hold)).toBeCloseTo(-3, 3);
		now += 100;
		stepMeter({ state, peaks: [0, 0], now, dtMs: 16 });
		expect(amplitudeToDb(state.channels[0].hold)).toBeLessThan(-20);
		for (let i = 0; i < 400; i++) {
			now += 16;
			stepMeter({ state, peaks: [0, 0], now, dtMs: 16 });
		}
		expect(isMeterAtRest(state)).toBe(true);
		expect(formatMeterDb(state.channels[0].hold)).toBe("");
	});

	test("clip light above −0.1 dBFS latches until reset", () => {
		const state = createMeterState();
		stepMeter({ state, peaks: [db(-0.2), db(-0.2)], now: 0, dtMs: 16 });
		expect(state.clipped).toBe(false);
		stepMeter({ state, peaks: [db(2), db(-1)], now: 16, dtMs: 16 });
		expect(state.clipped).toBe(true);
		expect(formatMeterDb(state.maxSinceReset)).toBe("+2.0");
		stepMeter({ state, peaks: [0, 0], now: 5000, dtMs: 16 });
		expect(state.clipped).toBe(true);
		resetMeterClip(state);
		expect(state.clipped).toBe(false);
	});
});
