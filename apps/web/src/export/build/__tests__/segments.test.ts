import { describe, expect, test } from "bun:test";
import { cutFrames, frameAt, segmentRanges } from "../segments";

const TPF = 4000; // 30 fps at 120000 ticks a second
const el = (startSeconds: number, seconds: number) => ({ startTime: Math.round(startSeconds * 120000), duration: Math.round(seconds * 120000) });
const whole = (ranges: { start: number; frames: number }[], frameCount: number) => {
	let at = 0;
	for (const r of ranges) {
		expect(r.start).toBe(at);
		expect(r.frames).toBeGreaterThan(0);
		at += r.frames;
	}
	expect(at).toBe(frameCount);
};

describe("the stretches of an export", () => {
	test("a cut point is the first frame that shows what begins there", () => {
		expect(frameAt(0, TPF)).toBe(0);
		expect(frameAt(4000, TPF)).toBe(1);
		expect(frameAt(4001, TPF)).toBe(2);
		expect(cutFrames({ elements: [el(0, 10), el(10, 5), el(2.5, 3)], ticksPerFrame: TPF, frameCount: 450 })).toEqual([75, 165, 300]);
	});
	test("one long clip: a stretch every 5 s, every frame once", () => {
		const ranges = segmentRanges({ cuts: [], frameCount: 18000, fps: 30 });
		whole(ranges, 18000);
		expect(ranges.length).toBe(120);
		expect(ranges.every((r) => r.frames === 150)).toBe(true);
	});
	test("stretches begin at cut points; a long clip is divided from its own start", () => {
		const cuts = [100, 400, 430, 445, 1000];
		const ranges = segmentRanges({ cuts, frameCount: 1300, fps: 30 });
		whole(ranges, 1300);
		const starts = ranges.map((r) => r.start);
		// 0 → 100 (the cut), 100 → 250 → 400 (5 s, then the cut), 400 → 430 (1 s), 430 → 580 … (445 is too close to 430)
		expect(starts.slice(0, 6)).toEqual([0, 100, 250, 400, 430, 580]);
		expect(starts).toContain(1000);
		expect(starts).not.toContain(445);
	});
	test("an untouched part keeps its stretches when everything before it moves by whole frames", () => {
		const before = segmentRanges({ cuts: [300, 900, 2000], frameCount: 5000, fps: 30 });
		// 60 frames cut out of the first clip: every later cut point is 60 frames earlier
		const after = segmentRanges({ cuts: [240, 840, 1940], frameCount: 4940, fps: 30 });
		const tail = (ranges: typeof before, from: number) => ranges.filter((r) => r.start >= from).map((r) => [r.start - from, r.frames]);
		expect(tail(after, 240)).toEqual(tail(before, 300));
	});
	test("fast cutting: no stretch shorter than a second, except the film's own end", () => {
		const cuts = Array.from({ length: 200 }, (_, i) => (i + 1) * 6);
		const ranges = segmentRanges({ cuts, frameCount: 1210, fps: 30 });
		whole(ranges, 1210);
		expect(ranges.slice(0, -1).every((r) => r.frames >= 30 && r.frames <= 150)).toBe(true);
	});
	test("a short tail joins the last stretch; odd rates and tiny films work", () => {
		whole(segmentRanges({ cuts: [], frameCount: 1, fps: 30 }), 1);
		const short = segmentRanges({ cuts: [], frameCount: 160, fps: 30 });
		expect(short).toEqual([{ start: 0, frames: 160 }]);
		const ntsc = segmentRanges({ cuts: [450], frameCount: 1799, fps: 29.97 });
		whole(ntsc, 1799);
		expect(segmentRanges({ cuts: [], frameCount: 0, fps: 30 })).toEqual([]);
	});
});
