import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "@/timeline";

// CapCut beat marks (⌘J): clips snap to them like to clip edges.
let getElementEdgeSnapPoints: typeof import("@/timeline/element-snap-source").getElementEdgeSnapPoints;
beforeAll(async () => {
	await installOpenCutWasm();
	({ getElementEdgeSnapPoints } = await import("@/timeline/element-snap-source"));
});

test("beat marks inside the clip are snap points at their timeline time; marks outside it are not", () => {
	const tracks = {
		overlay: [],
		main: { id: "main", name: "Main", type: "video", muted: false, hidden: false, elements: [] },
		audio: [
			{
				id: "a1",
				name: "Audio",
				type: "audio",
				muted: false,
				elements: [{ id: "m", name: "music", type: "audio", startTime: 240000, duration: 480000, trimStart: 0, trimEnd: 0, params: {}, beats: [60000, 120000, 999999] }],
			},
		],
	} as unknown as SceneTracks;
	const beats = getElementEdgeSnapPoints({ tracks }).filter((point) => point.type === "beat").map((point) => Number(point.time));
	expect(beats).toEqual([300000, 360000]);
});
