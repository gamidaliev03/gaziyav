import { describe, expect, test } from "bun:test";
import { KEY_FRAME_STEP_S, layoutFilmstrip, quantiseStep, tileFallbacks } from "../tiles";

const base = { centrePx: 500, clipWidthPx: 2000, tileWidthPx: 37, trimStartSec: 0, clipDurationSec: 20 };

describe("filmstrip layout", () => {
	test("spacing is a power of two not above one tile", () => {
		expect(quantiseStep(0.6)).toBe(0.5);
		expect(quantiseStep(1)).toBe(1);
		expect(quantiseStep(1000)).toBe(64);
		expect(quantiseStep(0.001)).toBe(1 / 32);
	});

	test("4K zoomed in: key frames on a 1 s grid first, then exact frames centre first", () => {
		// 100 px/s, 37 px tiles → 0.37 s ideal → 0.25 s grid.
		const layout = layoutFilmstrip({ ...base, fromPx: 0, toPx: 1000, pixelsPerSecond: 100 });
		expect(layout.tiles.length).toBe(40);
		expect(layout.tiles[1]).toMatchObject({ left: 25, right: 50, time: 0.25 });
		expect(layout.keyTimes.every((t) => Number.isInteger(t / KEY_FRAME_STEP_S))).toBe(true);
		expect(layout.keyTimes.length).toBe(10);
		expect(layout.exactTimes[0]).toBe(5);
		expect(layout.exactTimes.length).toBe(40);
		// The 0.25 s frame shows the 0 s key frame until it arrives.
		expect(tileFallbacks(layout.tiles[1])).toContain(0);
	});

	test("zoomed out: one pass of key frames, coarser times are a subset of finer ones", () => {
		const fine = layoutFilmstrip({ ...base, fromPx: 0, toPx: 2000, pixelsPerSecond: 20 });
		const coarse = layoutFilmstrip({ ...base, fromPx: 0, toPx: 1000, pixelsPerSecond: 10 });
		expect(fine.exactTimes).toEqual([]);
		expect(coarse.exactTimes).toEqual([]);
		const fineTimes = new Set(fine.tiles.map((t) => t.time));
		expect(coarse.tiles.every((t) => fineTimes.has(t.time))).toBe(true);
	});

	test("trimmed start: the grid stays on the source, the cut tile shows the clip's first frame exactly", () => {
		const layout = layoutFilmstrip({ ...base, trimStartSec: 3.3, fromPx: 0, toPx: 300, pixelsPerSecond: 100 });
		expect(layout.tiles[0]).toMatchObject({ left: 0, time: 3.3 });
		expect(layout.tiles[0].right).toBeCloseTo(20);
		expect(layout.tiles[1].time).toBe(3.5);
		expect(layout.exactTimes[0]).toBe(3.3);
		expect(tileFallbacks(layout.tiles[0])[0]).toBe(3.25);
	});

	test("double speed covers twice the source per pixel", () => {
		const layout = layoutFilmstrip({ ...base, retime: { rate: 2 }, fromPx: 0, toPx: 100, pixelsPerSecond: 100 });
		// 37 px × 2/100 s = 0.74 s → 0.5 s grid, 25 px apart.
		expect(layout.tiles[1]).toMatchObject({ left: 25, time: 0.5 });
	});

	test("editing a speed ramp's points changes the request key: the tiles' source times changed", () => {
		const ramp = (points: Array<{ x: number; y: number }>) => ({
			mode: "curve" as const,
			rate: 1,
			curve: { preset: "custom" as const, points },
		});
		const one = layoutFilmstrip({
			...base,
			retime: ramp([{ x: 0, y: 1 }, { x: 1, y: 1 }]),
			fromPx: 0,
			toPx: 1000,
			pixelsPerSecond: 100,
		});
		const two = layoutFilmstrip({
			...base,
			retime: ramp([{ x: 0, y: 2 }, { x: 0.5, y: 0.5 }, { x: 1, y: 2 }]),
			fromPx: 0,
			toPx: 1000,
			pixelsPerSecond: 100,
		});
		expect(two.requestKey).not.toBe(one.requestKey);
	});

	test("only the asked part, nothing past the media end", () => {
		const layout = layoutFilmstrip({ ...base, fromPx: 1500, toPx: 5000, pixelsPerSecond: 100, mediaDurationSec: 19 });
		expect(layout.tiles[0].left).toBe(1500);
		expect(layout.tiles[layout.tiles.length - 1].right).toBe(2000);
		expect(Math.max(...layout.tiles.map((t) => t.time))).toBeLessThan(19);
	});
});
