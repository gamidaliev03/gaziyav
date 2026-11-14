import { describe, expect, test } from "bun:test";
import { createEngageTracker, createLimiter, createLimitTracker, crossesDetent, guideAppeared, MIN_GAP_MS, sliderDetents } from "../core";

describe("rate limit", () => {
	test("one tap per 80 ms at most", () => {
		const l = createLimiter();
		expect(l.allow(1000)).toBe(true);
		expect(l.allow(1000)).toBe(false);
		expect(l.allow(1000 + MIN_GAP_MS - 1)).toBe(false);
		expect(l.allow(1000 + MIN_GAP_MS)).toBe(true);
	});
	test("a burst of 100 calls in 50 ms gives one tap", () => {
		const l = createLimiter();
		let taps = 0;
		for (let i = 0; i < 100; i++) if (l.allow(i * 0.5)) taps++;
		expect(taps).toBe(1);
	});
});

describe("snap engages", () => {
	const same = (a: { time: number; type: string }, b: { time: number; type: string }) => a.time === b.time && a.type === b.type;
	test("a tap on engage, none while engaged (new objects every move), none on release, one on re-engage", () => {
		const t = createEngageTracker(same);
		const taps = [null, null, { time: 5, type: "element-start" }, { time: 5, type: "element-start" }, { time: 5, type: "element-start" }, null, null, { time: 5, type: "element-start" }].map((p) => t.update(p));
		expect(taps).toEqual([false, false, true, false, false, false, false, true]);
	});
	test("moving straight from one snap point to another is a new engagement", () => {
		const t = createEngageTracker(same);
		expect(t.update({ time: 1, type: "playhead" })).toBe(true);
		expect(t.update({ time: 2, type: "element-end" })).toBe(true);
	});
});

describe("limit reached", () => {
	test("one tap when the trim reaches its end, none while held there, one after leaving and coming back", () => {
		const t = createLimitTracker();
		expect([false, true, true, true, false, true].map((v) => t.update(v))).toEqual([false, true, false, false, false, true]);
	});
	test("release forgets it", () => {
		const t = createLimitTracker();
		t.update(true);
		t.release();
		expect(t.update(true)).toBe(true);
	});
});

describe("detents", () => {
	test("crossing or reaching 0 taps; leaving it does not", () => {
		const d = sliderDetents(-100, 100);
		expect(crossesDetent(-3, 2, d)).toBe(true);
		expect(crossesDetent(-3, 0, d)).toBe(true);
		expect(crossesDetent(0, 4, d)).toBe(false);
		expect(crossesDetent(4, 6, d)).toBe(false);
	});
	test("reaching an end (100 %) taps once", () => {
		const d = sliderDetents(0, 100);
		expect(crossesDetent(97, 100, d)).toBe(true);
		expect(crossesDetent(100, 100, d)).toBe(false);
		expect(crossesDetent(100, 99, d)).toBe(false);
	});
	test("the origin and extra detents (1×)", () => {
		expect(crossesDetent(0.9, 1.1, sliderDetents(0.1, 10).concat([1]))).toBe(true);
		expect(crossesDetent(40, 60, sliderDetents(0, 100, 50))).toBe(true);
	});
});

describe("guides", () => {
	test("a tap when a guide appears, none while it stays, one for another guide added", () => {
		const v = { type: "vertical", position: 960 };
		const h = { type: "horizontal", position: 540 };
		expect(guideAppeared([], [v])).toBe(true);
		expect(guideAppeared([v], [{ ...v }])).toBe(false);
		expect(guideAppeared([v], [v, h])).toBe(true);
		expect(guideAppeared([v, h], [h])).toBe(false);
		expect(guideAppeared([v], [])).toBe(false);
	});
});
