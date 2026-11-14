import { describe, expect, test } from "bun:test";
import { exportedFrameCount } from "../frame-count";

describe("export frame count", () => {
	test("the last, partial frame of an NTSC timeline is exported", () => {
		// 10 s at 29.97: 300 frames, though the timeline is 299.7 frames long (4004 ticks a frame).
		expect(exportedFrameCount({ durationTicks: 1_200_000, ticksPerFrame: 4004 })).toBe(300);
		// 10 s at 23.976: 239.76 → 240.
		expect(exportedFrameCount({ durationTicks: 1_200_000, ticksPerFrame: 5005 })).toBe(240);
	});

	test("a whole number of frames is unchanged, an empty timeline writes none", () => {
		expect(exportedFrameCount({ durationTicks: 1_200_000, ticksPerFrame: 4000 })).toBe(300);
		expect(exportedFrameCount({ durationTicks: 0, ticksPerFrame: 4000 })).toBe(0);
		expect(exportedFrameCount({ durationTicks: 1, ticksPerFrame: 4000 })).toBe(1);
	});
});
