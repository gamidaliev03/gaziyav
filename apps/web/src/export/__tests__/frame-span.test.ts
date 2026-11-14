import { expect, test } from "bun:test";
import { exportedFrameCount, exportedFrameSpan } from "@/export/frame-count";

test("every frame of the file is a whole frame, the last too; the picture ends within one frame after the timeline", () => {
	// 10 s at 29.97 (TICKS_PER_SECOND-free: 1000 ticks a second, a frame of 33 ticks)
	const durationTicks = 10_000;
	const ticksPerFrame = 33;
	const count = exportedFrameCount({ durationTicks, ticksPerFrame });
	expect(count).toBe(304);
	const last = exportedFrameSpan({ index: count - 1, durationTicks, ticksPerFrame });
	expect(last.start).toBeLessThan(durationTicks);
	expect(last.length).toBe(ticksPerFrame);
	expect(last.start + last.length - durationTicks).toBeLessThan(ticksPerFrame);
	expect(exportedFrameSpan({ index: 0, durationTicks, ticksPerFrame })).toEqual({ start: 0, length: 33 });
	expect(exportedFrameSpan({ index: count, durationTicks, ticksPerFrame }).length).toBe(0);
});
