import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { GroupResizeMember } from "@/timeline/group-resize";
import type { MediaTime } from "@/wasm";

// A clip whose source isn't a whole number of frames (7.188 s at 60 fps) ended between frames after every trim: the
// trim moved its edge by whole frames, so the edge stayed off the grid. The dragged edge lands on a frame now, and an
// edge snapped to another clip keeps that exact time.
let computeGroupResize: typeof import("@/timeline/group-resize").computeGroupResize;

beforeAll(async () => {
	await installOpenCutWasm();
	({ computeGroupResize } = await import("@/timeline/group-resize"));
});

const TICKS_PER_SECOND = 120_000;
const FPS = { numerator: 60, denominator: 1 };
const FRAME = TICKS_PER_SECOND / 60;
const t = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND) as MediaTime;

function member(overrides: Partial<GroupResizeMember> = {}): GroupResizeMember {
	return {
		trackId: "main",
		elementId: "a",
		startTime: t(0),
		duration: t(7.188),
		trimStart: t(0),
		trimEnd: t(0),
		sourceDuration: t(7.188),
		leftNeighborBound: null,
		rightNeighborBound: null,
		...overrides,
	};
}

describe("trim lands on the frame grid", () => {
	test("right edge of an off-grid clip lands on a frame", () => {
		const result = computeGroupResize({ members: [member()], side: "right", deltaTime: t(-1.43), fps: FPS });
		const patch = result.updates[0].patch;
		expect((patch.startTime + patch.duration) % FRAME).toBe(0);
		// trimStart + duration + trimEnd still equals the source
		expect(patch.trimStart + patch.duration + patch.trimEnd).toBe(t(7.188));
	});

	test("left edge of an off-grid clip lands on a frame", () => {
		const m = member({ startTime: t(7.188) });
		const result = computeGroupResize({ members: [m], side: "left", deltaTime: t(0.51), fps: FPS });
		const patch = result.updates[0].patch;
		expect(patch.startTime % FRAME).toBe(0);
		expect(patch.trimStart + patch.duration + patch.trimEnd).toBe(t(7.188));
	});

	test("an edge snapped to a clip keeps the exact time", () => {
		const m = member({ startTime: t(10), duration: t(2), sourceDuration: t(8), trimStart: t(3), trimEnd: t(3) });
		// snap the left edge onto a neighbour ending at 8.788 s (off-grid)
		const delta = (t(8.788) - m.startTime) as MediaTime;
		const result = computeGroupResize({ members: [m], side: "left", deltaTime: delta, fps: FPS, exact: true });
		expect(result.updates[0].patch.startTime).toBe(t(8.788));
	});

	test("never past the end of the source", () => {
		const m = member({ duration: t(5), trimEnd: t(2.188) });
		const result = computeGroupResize({ members: [m], side: "right", deltaTime: t(10), fps: FPS });
		const patch = result.updates[0].patch;
		expect(patch.duration).toBeLessThanOrEqual(t(7.188));
		expect(patch.trimEnd).toBeGreaterThanOrEqual(0);
	});
});
