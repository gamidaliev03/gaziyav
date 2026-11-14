// tlfix B: the connector's `place` (agent tool add_media) let «talk interview.mp4» take 2 s from sourceFrom 1 s of a
// 2 s file — the clip's source was the length asked for, not the file (INVARIANT source-bounds, connect run 13.11).
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let core: typeof import("@/core");
let tools: typeof import("@/agent/tools");
let inv: typeof import("@/timeline/invariants");
let TICKS = 0;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	tools = await import("@/agent/tools");
	inv = await import("@/timeline/invariants");
	TICKS = (await import("@/wasm")).TICKS_PER_SECOND;
	const storage = await import("@/services/storage/service");
	(storage.storageService as unknown as Record<string, unknown>).saveProject = async () => {};
});

function setup() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	(editor.media as unknown as { getAssets: () => unknown[] }).getAssets = () => [{ id: "387a3e57", type: "video", name: "talk interview.mp4", duration: 2 }];
	return editor;
}

describe("place / add_media stays inside the file", () => {
	for (const [args, from, length] of [
		[{ sourceFrom: 1, duration: 2 }, 1, 1],
		[{ sourceFrom: 5, duration: 2 }, 2 - 1 / 30, 1 / 30],
		[{ duration: 4 }, 0, 2],
		[{ sourceFrom: 0.5 }, 0.5, 1.5],
	] as const) {
		test(`${JSON.stringify(args)} of a 2 s file: from ${from.toFixed(3)} s, ${length.toFixed(3)} s long, the source the whole file`, async () => {
			const editor = setup();
			const out = await tools.runTool("add_media", JSON.stringify({ media: "387a3e57", start: 12, ...args }), new AbortController().signal);
			expect(out.ok).toBe(true);
			const tracks = editor.scenes.getActiveScene().tracks;
			const all = [...tracks.overlay, tracks.main].flatMap((t) => t.elements as readonly import("@/timeline").TimelineElement[]);
			const clip = all[0] as import("@/timeline").VideoElement;
			expect(Number(clip.sourceDuration)).toBe(2 * TICKS);
			expect(Math.abs(clip.trimStart - from * TICKS)).toBeLessThanOrEqual(1);
			expect(Math.abs(clip.duration - length * TICKS)).toBeLessThanOrEqual(1);
			expect(Number(clip.trimStart + clip.duration + clip.trimEnd)).toBe(2 * TICKS);
			expect(inv.checkTimelineInvariants({ tracks: editor.scenes.getActiveScene().tracks, magnet: false }).map((v) => v.rule)).toEqual([]);
		});
	}
});
