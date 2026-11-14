import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { Bookmark, SceneTracks } from "@/timeline";
import type { MediaTime } from "@/wasm";

// Markers dragged onto another marker made two on one frame (drawn as one; M removed only one;
// same React key), and a drag that ended on its own frame still pushed an undo step.
let utils: typeof import("@/timeline/bookmarks/utils");
let drag: typeof import("@/timeline/bookmarks/hooks/use-bookmark-drag");

beforeAll(async () => {
	await installOpenCutWasm();
	utils = await import("@/timeline/bookmarks/utils");
	drag = await import("@/timeline/bookmarks/hooks/use-bookmark-drag");
});

const TICKS_PER_SECOND = 120_000;
const FRAME = TICKS_PER_SECOND / 30;
const FPS_30 = { numerator: 30, denominator: 1 };
const t = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND) as MediaTime;

function tracksWithClip(): SceneTracks {
	const clip = {
		id: "clip",
		type: "video",
		name: "clip",
		startTime: t(0),
		duration: t(10),
		trimStart: t(0),
		trimEnd: t(0),
		mediaId: "media",
		params: {},
	};
	return {
		overlay: [],
		main: { id: "main", type: "video", name: "Main", elements: [clip] },
		audio: [],
	} as unknown as SceneTracks;
}

describe("moving a marker", () => {
	test("onto a free frame keeps the others and the order", () => {
		const bookmarks: Bookmark[] = [{ time: t(3) }, { time: t(6) }, { time: t(9) }];
		const moved = utils.moveBookmarkInArray({ bookmarks, fromTime: t(9), toTime: t(1) });
		expect(moved.map((b) => b.time)).toEqual([t(1), t(3), t(6)]);
	});

	test("onto another marker leaves one marker on that frame, dragged one first", () => {
		const bookmarks: Bookmark[] = [
			{ time: t(3), note: "intro", color: "#ff0000" },
			{ time: t(6), note: "drop", duration: t(1) },
		];
		const moved = utils.moveBookmarkInArray({ bookmarks, fromTime: t(6), toTime: t(3) });
		expect(moved).toHaveLength(1);
		expect(moved[0]).toEqual({
			time: t(3),
			note: "drop · intro",
			color: "#ff0000",
			duration: t(1),
		});
	});

	test("the dragged marker's own colour wins over the one it lands on", () => {
		const bookmarks: Bookmark[] = [
			{ time: t(3), color: "#ff0000" },
			{ time: t(6), color: "#00ff00" },
		];
		const [merged] = utils.moveBookmarkInArray({ bookmarks, fromTime: t(6), toTime: t(3) });
		expect(merged.color).toBe("#00ff00");
		expect(merged.note).toBeUndefined();
	});
});

describe("dropping a dragged marker", () => {
	test("on its own frame is no move (no undo step)", () => {
		expect(utils.resolveBookmarkDrop({ fromTime: t(5), toTime: t(5), fps: FPS_30 })).toBeNull();
		// less than half a frame away rounds back onto the same frame
		const nearby = (t(5) + Math.round(FRAME / 3)) as MediaTime;
		expect(utils.resolveBookmarkDrop({ fromTime: t(5), toTime: nearby, fps: FPS_30 })).toBeNull();
	});

	test("elsewhere lands on a whole frame", () => {
		const target = (t(7) + FRAME / 4) as MediaTime; // 1000 ticks
		expect(utils.resolveBookmarkDrop({ fromTime: t(5), toTime: target, fps: FPS_30 })).toBe(t(7));
	});
});

describe("markers on one frame (older projects)", () => {
	test("M removes all of them, not just the first", () => {
		const bookmarks: Bookmark[] = [{ time: t(3) }, { time: t(3) }, { time: t(6) }];
		const toggled = utils.toggleBookmarkInArray({ bookmarks, frameTime: t(3) });
		expect(toggled.map((b) => b.time)).toEqual([t(6)]);
	});

	test("each gets its own React key", () => {
		const keys = utils.getBookmarkKeys({
			bookmarks: [{ time: t(3) }, { time: t(3) }, { time: t(6) }],
		});
		expect(new Set(keys).size).toBe(3);
		expect(keys[0]).toBe(`bookmark-${t(3)}`);
		expect(keys[2]).toBe(`bookmark-${t(6)}`);
	});
});

describe("what a dragged marker snaps to", () => {
	test("clip edges and the playhead, never other markers", () => {
		const points = drag.getBookmarkDragSnapPoints({
			tracks: tracksWithClip(),
			playheadTime: t(4),
		});
		expect(points.some((point) => point.type === "bookmark")).toBe(false);
		expect(points.map((point) => point.time).sort((a, b) => a - b)).toEqual([t(0), t(4), t(10)]);
	});
});
