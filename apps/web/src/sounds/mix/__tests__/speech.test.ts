import { describe, expect, test } from "bun:test";
import { detectSpeech } from "../speech-detect";

const SR = 48000;
const BUCKET = 128;
/** Peak summary: `level` in seconds-long segments [start, end, linear peak]. */
function summary(total: number, parts: Array<[number, number, number]>, floor = 0.001) {
	const n = Math.ceil((total * SR) / BUCKET);
	const amplitudes = new Float32Array(n).fill(floor);
	for (const [a, b, v] of parts) for (let i = Math.floor((a * SR) / BUCKET); i < Math.min(n, (b * SR) / BUCKET); i++) amplitudes[i] = v;
	return { sourceKey: "t", sampleRate: SR, totalSamples: total * SR, bucketSize: BUCKET, amplitudes };
}

describe("detectSpeech", () => {
	test("finds phrases and keeps the pause between them", () => {
		const r = detectSpeech(summary(12, [[1, 4, 0.3], [6.5, 10, 0.25]]));
		expect(r.length).toBe(2);
		expect(Math.abs(r[0].start - 1)).toBeLessThan(0.05);
		expect(r[0].end).toBeGreaterThan(4);
		expect(r[0].end).toBeLessThan(4.3);
		expect(Math.abs(r[1].start - 6.5)).toBeLessThan(0.05);
	});
	test("short gaps between words stay one phrase", () => {
		const r = detectSpeech(summary(5, [[0.5, 1.5, 0.3], [1.7, 3, 0.3]]));
		expect(r.length).toBe(1);
	});
	test("silence has no speech", () => {
		expect(detectSpeech(summary(5, [], 0.0001))).toEqual([]);
	});
});
