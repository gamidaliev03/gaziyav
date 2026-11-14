import { describe, expect, test } from "bun:test";
import { gridWindow } from "../windowed-grid";

// 879 animated stickers, 5 columns of 76 px tiles, rows of 105 px, a 600 px panel
const base = {
	count: 879,
	cols: 5,
	rowHeight: 105,
	gridTop: 40,
	viewHeight: 600,
	overscan: 480,
};

describe("windowed material grid", () => {
	test("at the top: the first screens only, the rest is bottom padding", () => {
		const w = gridWindow({ ...base, scrollTop: 0 });
		expect(w.from).toBe(0);
		// rows 0..10 (600 + 480 - 40 = 1040 px → row 9 at 945 px, row 10 at 1050 px starts past it) — never half the list
		expect(w.to).toBeLessThan(879 / 2);
		expect(w.to % 5).toBe(0);
		expect(w.padTop).toBe(0);
		expect(w.padTop + w.padBottom + (w.to / 5) * 105).toBe(
			Math.ceil(879 / 5) * 105,
		);
	});
	test("scrolled to the middle: a screen above and below, paddings stand in for the rest", () => {
		const w = gridWindow({ ...base, scrollTop: 8000 });
		expect(w.from).toBeGreaterThan(0);
		expect(w.to).toBeLessThan(879);
		expect(w.padTop).toBe((w.from / 5) * 105);
		expect(w.padTop + w.padBottom + ((w.to - w.from) / 5) * 105).toBe(
			Math.ceil(879 / 5) * 105,
		);
	});
	test("scrolled past the end: the last rows, no bottom padding", () => {
		const w = gridWindow({ ...base, scrollTop: 100000 });
		expect(w.to).toBe(879);
		expect(w.padBottom).toBe(0);
		expect(w.from).toBeLessThan(879);
	});
	test("a short list or an unmeasured grid is rendered whole", () => {
		expect(gridWindow({ ...base, count: 12, scrollTop: 0 })).toEqual({
			from: 0,
			to: 12,
			padTop: 0,
			padBottom: 0,
		});
		expect(gridWindow({ ...base, count: 0, scrollTop: 0 })).toEqual({
			from: 0,
			to: 0,
			padTop: 0,
			padBottom: 0,
		});
		expect(gridWindow({ ...base, rowHeight: 0, scrollTop: 0 })).toEqual({
			from: 0,
			to: 879,
			padTop: 0,
			padBottom: 0,
		});
	});
});
