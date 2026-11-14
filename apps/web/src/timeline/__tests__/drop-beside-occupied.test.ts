import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "@/timeline";

// A layer dragged onto a row that holds something there goes to a new track beside that row (CapCut's «multi-storey»),
// not back to its own track that happens to be free (st45 / exam 03.11: it stayed put, only its time changed).
let computeDropTarget: typeof import("@/timeline/components/drop-target").computeDropTarget;
let getTrackHeight: typeof import("@/timeline/components/track-layout").getTrackHeight;
beforeAll(async () => {
	await installOpenCutWasm();
	({ computeDropTarget } = await import("@/timeline/components/drop-target"));
	({ getTrackHeight } = await import("@/timeline/components/track-layout"));
});

const effect = (id: string) => ({ id, type: "effect", name: id, effectType: "x", startTime: 120000, duration: 360000, trimStart: 0, trimEnd: 0, params: {} });
const tracks = (): SceneTracks =>
	({
		overlay: [
			{ id: "upper", name: "Effects", type: "effect", muted: false, hidden: false, elements: [effect("glitch")] },
			{ id: "lower", name: "Effects", type: "effect", muted: false, hidden: false, elements: [effect("zoom")] },
		],
		main: { id: "main", name: "Main", type: "video", muted: false, hidden: false, elements: [] },
		audio: [],
	}) as unknown as SceneTracks;

test("the lower layer dragged over the upper one's row lands on a new track, not on its own", () => {
	const target = computeDropTarget({
		elementType: "effect",
		mouseX: 60, // 1.2 s at 50 px/s: over «glitch»
		mouseY: getTrackHeight({ type: "effect" }) / 2, // the upper row
		tracks: tracks(),
		playheadTime: 0,
		isExternalDrop: false,
		elementDuration: 360000,
		pixelsPerSecond: 50,
		zoomLevel: 1,
		excludeElementId: "zoom",
	} as Parameters<typeof computeDropTarget>[0]);
	expect(target.isNewTrack).toBe(true);
	expect(target.trackIndex).toBeLessThanOrEqual(1);
});

test("a free spot on the hovered row is still taken as it is", () => {
	const target = computeDropTarget({
		elementType: "effect",
		mouseX: 400, // 8 s: nothing there
		mouseY: getTrackHeight({ type: "effect" }) / 2,
		tracks: tracks(),
		playheadTime: 0,
		isExternalDrop: false,
		elementDuration: 360000,
		pixelsPerSecond: 50,
		zoomLevel: 1,
		excludeElementId: "zoom",
	} as Parameters<typeof computeDropTarget>[0]);
	expect(target.isNewTrack).toBe(false);
	expect(target.trackIndex).toBe(0);
});
