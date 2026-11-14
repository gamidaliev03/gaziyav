import { describe, expect, test } from "bun:test";
import { autoColorParams, colorStats } from "../color-math";
import { detectBeats } from "../beats";
import { cleanCuts, parseScdet, thresholdFor } from "../server/scenes";

/** A kick every `period` s from `offset`, with quiet hi-hats in between and a little hum. */
function clickTrack(bpm: number, seconds: number, rate = 44100, offset = 0.25): Float32Array {
	const out = new Float32Array(Math.round(seconds * rate));
	const period = 60 / bpm;
	for (let i = 0; i < out.length; i++) {
		const t = i / rate;
		const k = (t - offset) % period;
		const h = (t - offset) % (period / 2);
		let v = 0.05 * Math.sin(2 * Math.PI * 330 * t);
		if (t >= offset && k < 0.3) v += 0.8 * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-25 * k);
		if (t >= offset) v += 0.12 * Math.sin(2 * Math.PI * 1200 * t) * Math.exp(-60 * h);
		out[i] = v;
	}
	return out;
}

describe("beats (Kadr detectBeats port)", () => {
	for (const bpm of [90, 120, 128]) {
		test(`${bpm} BPM`, () => {
			const r = detectBeats(clickTrack(bpm, 60), 44100);
			expect(Math.abs(r.bpm - bpm)).toBeLessThan(2);
			const period = 60 / bpm;
			// Beats land on the kicks (within one hop ≈ 23 ms).
			for (const b of [...r.beats.slice(0, 10), ...r.beats.slice(-10)]) {
				const off = (((b - 0.25) % period) + period) % period;
				expect(Math.min(off, period - off)).toBeLessThan(0.035);
			}
		});
	}
	test("silence → no beats", () => {
		expect(detectBeats(new Float32Array(44100 * 3), 44100).beats.length).toBeLessThanOrEqual(130);
	});
});

function frame(r: number, g: number, b: number, n = 64 * 64): Uint8Array {
	const px = new Uint8Array(n * 4);
	for (let i = 0; i < n; i++) {
		// a gentle gradient so percentiles spread
		const k = 0.75 + (0.5 * i) / n;
		px[i * 4] = Math.min(255, r * k);
		px[i * 4 + 1] = Math.min(255, g * k);
		px[i * 4 + 2] = Math.min(255, b * k);
		px[i * 4 + 3] = 255;
	}
	return px;
}

describe("auto color (Kadr autoColor port)", () => {
	test("neutral, well-exposed frame → almost nothing", () => {
		const p = autoColorParams(colorStats(frame(107, 107, 107)));
		expect(Math.abs(Number(p.exposure))).toBeLessThanOrEqual(0.3);
		expect(Math.abs(Number(p.temperature))).toBeLessThanOrEqual(1);
		expect(Math.abs(Number(p.tint))).toBeLessThanOrEqual(1);
	});
	test("dark blue cast → brighter and warmer", () => {
		const p = autoColorParams(colorStats(frame(60, 75, 140)));
		expect(Number(p.exposure)).toBeGreaterThan(0.3);
		expect(Number(p.temperature)).toBeGreaterThan(10);
	});
	test("green cast → tint towards magenta", () => {
		const p = autoColorParams(colorStats(frame(120, 175, 120)));
		expect(Number(p.tint)).toBeGreaterThan(10);
	});
	test("ranges stay inside the Color effect's sliders", () => {
		const p = autoColorParams(colorStats(frame(5, 5, 250)));
		expect(Number(p.exposure)).toBeLessThanOrEqual(1.5);
		expect(Math.abs(Number(p.temperature))).toBeLessThanOrEqual(60);
		expect(Math.abs(Number(p.tint))).toBeLessThanOrEqual(40);
		expect(Number(p.contrast)).toBeGreaterThanOrEqual(-15);
		expect(Number(p.contrast)).toBeLessThanOrEqual(25);
	});
});

describe("scenes (ffmpeg scdet)", () => {
	test("parses scdet lines", () => {
		const log = "[Parsed_scdet_1 @ 0x1] lavfi.scd.score: 28.728, lavfi.scd.time: 1.5\nfoo\n[Parsed_scdet_1 @ 0x1] lavfi.scd.score: 25.054, lavfi.scd.time: 4";
		expect(parseScdet(log)).toEqual([
			{ score: 28.728, time: 1.5 },
			{ score: 25.054, time: 4 },
		]);
	});
	test("drops cuts at the ends and keeps the stronger of two close ones", () => {
		const r = cleanCuts(
			[
				{ time: 0.1, score: 50 },
				{ time: 2, score: 20 },
				{ time: 2.3, score: 40 },
				{ time: 5, score: 30 },
				{ time: 5.9, score: 30 },
			],
			6,
		);
		expect(r.cuts).toEqual([2.3, 5]);
	});
	test("sensitivity → threshold", () => {
		expect(thresholdFor(0.5)).toBe(10);
		expect(thresholdFor(0)).toBe(14);
		expect(thresholdFor(1)).toBe(6);
	});
});
