import { beforeAll, describe, expect, test } from "bun:test";
import type { MouseEvent as ReactMouseEvent } from "react";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "@/timeline";
import type { MediaTime } from "@/wasm";

// Dragging the playhead snapped to clip edges and markers even with snapping turned off (S).
let controllers: typeof import("@/timeline/controllers/playhead-controller");
let pointerSeek: typeof import("@/timeline/pointer-seek");

beforeAll(async () => {
	await installOpenCutWasm();
	controllers = await import("@/timeline/controllers/playhead-controller");
	pointerSeek = await import("@/timeline/pointer-seek");
});

const TICKS_PER_SECOND = 120_000;
const t = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND) as MediaTime;
// zoom 1 = 50 px per second; the ruler starts at x = 0
const xOf = (seconds: number) => seconds * 50;

function tracksWithClipEndingAt10s(): SceneTracks {
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

const pointerFlags: boolean[] = [];

function dragPlayheadTo({ seconds, snapping }: { seconds: number; snapping: boolean }): number {
	const seeks: number[] = [];
	const controller = new controllers.PlayheadController({
		configRef: {
			current: {
				zoomLevel: 1,
				duration: t(20),
				getActiveProjectFps: () => ({ numerator: 30, denominator: 1 }),
				isSnappingEnabled: () => snapping,
				isShiftHeld: () => false,
				getIsPlaying: () => false,
				getRulerEl: () =>
					({ getBoundingClientRect: () => ({ left: 0 }) }) as HTMLDivElement,
				getRulerScrollEl: () => null,
				getTracksScrollEl: () => null,
				getPlayheadEl: () => null,
				getSceneTracks: tracksWithClipEndingAt10s,
				getSceneBookmarks: () => [],
				seek: (time) => {
					seeks.push(time);
					pointerFlags.push(pointerSeek.isPointerSeek());
				},
				setScrubbing: () => {},
				setTimelineViewState: () => {},
			},
		},
	});
	// The controller listens on window for the rest of the drag; bun has no DOM. A stand-in only
	// for this call, so no other test sees a fake window.
	const global = globalThis as unknown as { window?: unknown };
	const hadWindow = "window" in global;
	if (!hadWindow) global.window = { addEventListener() {}, removeEventListener() {} };
	try {
		controller.onPlayheadMouseDown({
			clientX: xOf(seconds),
			preventDefault() {},
			stopPropagation() {},
		} as unknown as ReactMouseEvent);
		controller.destroy();
	} finally {
		if (!hadWindow) delete global.window;
	}
	return seeks[seeks.length - 1];
}

describe("dragging the playhead near a clip edge (10 s)", () => {
	test("snaps to the edge while snapping is on", () => {
		expect(dragPlayheadTo({ seconds: 9.93, snapping: true })).toBe(t(10));
	});

	test("stays where it was dropped (on a frame) with snapping off", () => {
		// 9.93 s rounds to frame 298 = 9.9333 s
		expect(dragPlayheadTo({ seconds: 9.93, snapping: false })).toBe(298 * 4000);
	});
});

// A seek from the mouse must not recentre the view ("keep the playhead in view" is for keyboard seeks): a scrub
// released near an edge made the timeline jump half a screen.
test("playhead drags seek as pointer seeks", () => {
	pointerFlags.length = 0;
	dragPlayheadTo({ seconds: 3, snapping: false });
	expect(pointerFlags.length).toBeGreaterThan(0);
	expect(pointerFlags.every(Boolean)).toBe(true);
	expect(pointerSeek.isPointerSeek()).toBe(false);
});
