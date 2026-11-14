import { describe, expect, test } from "bun:test";
import { matchLut } from "../video-ai";

// Color match: the LUT gives each channel the reference's distribution (histogram matching), mixed in at Strength.
const flat = () => new Array(256).fill(1);
const lutOf = (text: string) =>
	text
		.trim()
		.split("\n")
		.slice(1)
		.map((line) => line.split(" ").map(Number));

describe("Color match LUT", () => {
	test("the same distribution changes nothing", () => {
		const lut = lutOf(matchLut([flat(), flat(), flat()], [flat(), flat(), flat()], 1));
		expect(lut).toHaveLength(256);
		for (const [v, row] of lut.entries()) for (const x of row) expect(Math.abs(x - v / 255)).toBeLessThan(1.5 / 255);
	});
	test("a dark clip matched to a bright reference gets brighter, per channel, and Strength scales it", () => {
		const dark = new Array(256).fill(0).map((_, v) => (v < 128 ? 2 : 0));
		const bright = new Array(256).fill(0).map((_, v) => (v >= 128 ? 2 : 0));
		const full = lutOf(matchLut([dark, flat(), flat()], [bright, flat(), flat()], 1));
		const half = lutOf(matchLut([dark, flat(), flat()], [bright, flat(), flat()], 0.5));
		expect(full[64][0]).toBeGreaterThan(0.6); // red: level 64 → about 192
		expect(Math.abs(full[64][1] - 64 / 255)).toBeLessThan(1.5 / 255); // green unchanged
		expect(half[64][0]).toBeGreaterThan(64 / 255);
		expect(half[64][0]).toBeLessThan(full[64][0]);
		expect(full.every((row, v) => v === 0 || row[0] >= full[v - 1][0])).toBe(true); // never inverts
	});
});
