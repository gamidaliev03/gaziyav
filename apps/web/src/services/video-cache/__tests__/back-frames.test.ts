// pro-heavy 09.11: J showed 3 real frames a second on a 4K editing copy; the frames of a group are kept for the steps back.
import { describe, expect, test } from "bun:test";
import { backCapacity, findBackFrame, isReverseStep } from "../back-frames";

const EPS = 1e-4;
const at25 = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ timestamp: (from + i) / 25, duration: 1 / 25, i: from + i }));

describe("back frames", () => {
	test("the frame on screen at a time inside the kept span", () => {
		const frames = at25(100, 12);
		expect(findBackFrame(frames, 105 / 25, EPS)?.i).toBe(105);
		expect(findBackFrame(frames, 105 / 25 + 0.02, EPS)?.i).toBe(105);
		expect(findBackFrame(frames, 100 / 25, EPS)?.i).toBe(100);
		expect(findBackFrame(frames, 111 / 25 + 0.039, EPS)?.i).toBe(111);
		// float noise just under a frame's start still finds it
		expect(findBackFrame(frames, 105 / 25 - 5e-5, EPS)?.i).toBe(105);
	});

	test("outside the span: none (a seek decides)", () => {
		const frames = at25(100, 12);
		expect(findBackFrame(frames, 99 / 25, EPS)).toBeNull();
		expect(findBackFrame(frames, 112 / 25, EPS)).toBeNull();
		expect(findBackFrame([], 1, EPS)).toBeNull();
	});

	test("a variable frame rate gap shows the frame before it", () => {
		const frames = [
			{ timestamp: 1, duration: 1 / 30 },
			{ timestamp: 1.1, duration: 1 / 30 },
		];
		expect(findBackFrame(frames, 1.05, EPS)?.timestamp).toBe(1);
	});

	test("how many frames fit the memory budget", () => {
		expect(backCapacity({ width: 1920, height: 1080, budgetBytes: 192 << 20 })).toBe(24);
		expect(backCapacity({ width: 640, height: 360, budgetBytes: 192 << 20 })).toBe(120);
		expect(backCapacity({ width: 7680, height: 4320, budgetBytes: 64 << 20 })).toBe(4);
	});

	test("a step back is a request just behind the frame on screen (up to J ×8)", () => {
		const d = 1 / 25;
		expect(isReverseStep({ shown: 10, frameDuration: d, time: 10 - d, eps: EPS })).toBe(true);
		expect(isReverseStep({ shown: 10, frameDuration: d, time: 10 - 8 * d, eps: EPS })).toBe(true);
		expect(isReverseStep({ shown: 10, frameDuration: d, time: 10, eps: EPS })).toBe(false);
		expect(isReverseStep({ shown: 10, frameDuration: d, time: 10.04, eps: EPS })).toBe(false);
		// a cut that goes back 0.6 s in the same source: a plain seek
		expect(isReverseStep({ shown: 10, frameDuration: d, time: 9.4, eps: EPS })).toBe(false);
		expect(isReverseStep({ shown: 10, frameDuration: d, time: 7, eps: EPS })).toBe(false);
		expect(isReverseStep({ shown: null, frameDuration: d, time: 7, eps: EPS })).toBe(false);
	});
});
