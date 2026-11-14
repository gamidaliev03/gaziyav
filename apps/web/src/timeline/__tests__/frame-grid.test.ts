import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TimelineElement } from "@/timeline/types";

// pro-core 09.11: a clip as long as its file ended between frames (a 23.976 file 6.0 s in its container is 143.86
// frames), and so did the start of the clip put after it.
let grid: typeof import("@/timeline/frame-grid");
beforeAll(async () => {
	await installOpenCutWasm();
	grid = await import("@/timeline/frame-grid");
});

const NTSC24 = { numerator: 24_000, denominator: 1001 };
const F25 = { numerator: 25, denominator: 1 };
const clip = (over: Partial<Record<string, unknown>>) =>
	({ id: "c", type: "video", mediaId: "m", name: "c", startTime: 0, duration: 720_000, trimStart: 0, trimEnd: 0, sourceDuration: 720_000, ...over }) as unknown as TimelineElement;

describe("endOnFrame", () => {
	test("a file longer than its whole frames ends on its last whole frame, never past the file", () => {
		const out = grid.endOnFrame(clip({}), NTSC24) as TimelineElement & { trimEnd: number };
		expect(out.duration as number).toBe(143 * 5005);
		expect(out.trimEnd as number).toBe(720_000 - 143 * 5005);
		expect((out.duration as number) + (out.trimEnd as number)).toBe(720_000);
	});

	test("a sound ends on the nearest frame its file still has", () => {
		// 5.0416 s with 1 s more of the file after it: 126.04 frames → 126 at 25
		const out = grid.endOnFrame(clip({ type: "audio", duration: 604_993, trimEnd: 120_000, sourceDuration: 724_993 }), F25) as TimelineElement & { trimEnd: number };
		expect(out.duration as number).toBe(126 * 4800);
		expect(out.trimEnd as number).toBe(120_000 + (604_993 - 126 * 4800));
		// 120.9 frames at 23.976 with nothing after: rounding up would pass the file's end, so 120
		const tail = grid.endOnFrame(clip({ type: "audio", duration: 604_993, trimEnd: 0, sourceDuration: 604_993 }), NTSC24);
		expect(tail.duration as number).toBe(120 * 5005);
	});

	test("a slowed clip is measured in clip time against what its file has left", () => {
		// 0.7×: 6 s of file → 8.5714 s = 214.29 frames at 25 → 214, the file's tail grows by 0.29 frame × 0.7
		const out = grid.endOnFrame(clip({ duration: 1_028_571, retime: { rate: 0.7 } }), F25) as TimelineElement & { trimEnd: number };
		expect(out.duration as number).toBe(214 * 4800);
		expect(out.trimEnd as number).toBe(Math.round((1_028_571 - 214 * 4800) * 0.7));
	});

	test("pictures end on the nearest frame (5 s at 23.976 is 120 frames); titles and captions keep their times", () => {
		const out = grid.endOnFrame(clip({ type: "image", duration: 600_000, trimStart: undefined, trimEnd: undefined }), NTSC24);
		expect(out.duration as number).toBe(120 * 5005);
		const title = clip({ type: "text", duration: 600_000, trimStart: undefined, trimEnd: undefined });
		expect(grid.endOnFrame(title, NTSC24)).toBe(title);
	});

	test("left as it is: on the grid already, a start between frames, under a frame, a speed ramp", () => {
		const on = clip({ duration: 143 * 5005 });
		expect(grid.endOnFrame(on, NTSC24)).toBe(on);
		const offStart = clip({ startTime: 1234 });
		expect(grid.endOnFrame(offStart, NTSC24)).toBe(offStart);
		const tiny = clip({ duration: 2000, sourceDuration: 2000 });
		expect(grid.endOnFrame(tiny, NTSC24)).toBe(tiny);
		const ramp = clip({ duration: 700_001, retime: { rate: 1.2, mode: "curve" } });
		expect(grid.endOnFrame(ramp, NTSC24)).toBe(ramp);
	});

	test("isOnFrame at NTSC and whole rates", () => {
		expect(grid.isOnFrame(5005, NTSC24)).toBe(true);
		expect(grid.isOnFrame(5000, NTSC24)).toBe(false);
		expect(grid.isOnFrame(4800 * 7, F25)).toBe(true);
		expect(grid.isOnFrame(720_000, NTSC24)).toBe(false);
	});
});
