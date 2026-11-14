import { describe, expect, test } from "bun:test";
import { measureLoudness, normalizeLoudness } from "@/sounds/mix/loudness";

function sine(amplitude: number, seconds: number, sampleRate = 48000) {
	const x = new Float32Array(seconds * sampleRate);
	for (let i = 0; i < x.length; i++) x[i] = amplitude * Math.sin((2 * Math.PI * 997 * i) / sampleRate);
	return x;
}

describe("loudness", () => {
	test("stereo 997 Hz sine at −20 dBFS measures −20 LUFS", () => {
		const { lufs } = measureLoudness({ channels: [sine(0.1, 5), sine(0.1, 5)], sampleRate: 48000 });
		expect(Math.abs(lufs + 20)).toBeLessThan(0.15);
	});

	test("normalizes to −14 LUFS with peaks under −1 dBFS", async () => {
		const channels = [sine(0.02, 5, 44100), sine(0.02, 5, 44100)];
		const r = await normalizeLoudness({ channels, sampleRate: 44100 });
		expect(Math.abs(r.after.lufs + 14)).toBeLessThan(0.3);
		expect(r.after.peakDb).toBeLessThanOrEqual(-1.4);
	});
});
