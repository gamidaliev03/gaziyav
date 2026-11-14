import { describe, expect, test } from "bun:test";
import { onSampleGrid } from "../player";

// The player's clips start on the context's sample grid (sound/player.ts): read at whole samples, as the export reads them.
describe("onSampleGrid", () => {
	const rate = 48000;
	test("a start between two samples moves to the nearest one, by at most half a sample", () => {
		for (const when of [0.1234567, 12.00001, 3601.333333, 0.5 / rate + 7]) {
			const snapped = onSampleGrid(when, rate);
			expect(Math.abs(snapped * rate - Math.round(snapped * rate))).toBeLessThan(1e-6);
			expect(Math.abs(snapped - when)).toBeLessThanOrEqual(0.5 / rate + 1e-12);
		}
	});
	test("with an offset into the buffer, start minus offset is on the grid (whole samples are read)", () => {
		for (const [when, offset] of [[5.123456789, 0.25], [100.00002, 1.7777777], [0.75, 0.0000101]]) {
			const snapped = onSampleGrid(when, rate, offset);
			const frames = (snapped - offset) * rate;
			expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-6);
			expect(Math.abs(snapped - when)).toBeLessThanOrEqual(0.5 / rate + 1e-12);
		}
	});
	test("a start already on the grid stays where it is", () => {
		expect(onSampleGrid(48123 / rate, rate)).toBe(48123 / rate);
	});
});
