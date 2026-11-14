import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "@/timeline";

// 🔒 A locked track takes no drops (CapCut): a clip dropped onto it opens a new track instead.
let computeDropTarget: typeof import("@/timeline/components/drop-target").computeDropTarget;
let getTrackHeight: typeof import("@/timeline/components/track-layout").getTrackHeight;
beforeAll(async () => {
	await installOpenCutWasm();
	({ computeDropTarget } = await import("@/timeline/components/drop-target"));
	({ getTrackHeight } = await import("@/timeline/components/track-layout"));
});

const tracks = (locked: boolean): SceneTracks =>
	({
		overlay: [],
		main: {
			id: "main",
			name: "Main",
			type: "video",
			muted: false,
			hidden: false,
			elements: [],
			...(locked ? { locked: true } : {}),
		},
		audio: [],
	}) as unknown as SceneTracks;

const dropOnMain = (locked: boolean) =>
	computeDropTarget({
		elementType: "video",
		mouseX: 400,
		mouseY: getTrackHeight({ type: "video" }) / 2,
		tracks: tracks(locked),
		playheadTime: 0,
		isExternalDrop: true,
		elementDuration: 240000,
		pixelsPerSecond: 50,
		zoomLevel: 1,
	} as Parameters<typeof computeDropTarget>[0]);

test("a clip dropped on an unlocked main track lands on it", () => {
	const target = dropOnMain(false);
	expect(target.isNewTrack).toBe(false);
	expect(target.trackIndex).toBe(0);
});

test("a clip dropped on a locked track opens a new track instead", () => {
	expect(dropOnMain(true).isNewTrack).toBe(true);
});
