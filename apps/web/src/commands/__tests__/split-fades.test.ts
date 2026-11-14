import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "./wasm-setup";

// claude-hear 09.11: ⌘B gave both halves the clip's fade in and fade out (and its In / Out animation): a clip with a
// fade-out dipped to silence at the cut and its second half faded in again. CapCut keeps the fade in on the first half
// and the fade out on the second.
type Core = typeof import("@/core");
type Cmds = typeof import("@/commands/timeline");
let core: Core;
let cmds: Cmds;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	cmds = await import("@/commands/timeline");
});

function editorWith(params: Record<string, unknown>) {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "split-fades", name: "Split", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 25, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	const clip = { id: "c", type: "video", name: "c", mediaId: "m", startTime: 0, duration: 240_000, trimStart: 0, trimEnd: 0, sourceDuration: 240_000, params };
	editor.scenes.setScenes({ scenes: [{ ...scene, tracks: { ...scene.tracks, main: { ...scene.tracks.main, elements: [clip] } } } as typeof scene], activeSceneId: scene.id });
	return editor;
}

describe("⌘B keeps each edge's fade on its own half (pro-core)", () => {
	test("the fade in and the In animation stay on the first half, the fade out and the Out one on the second", () => {
		const editor = editorWith({ fadeIn: 0.5, fadeOut: 1, "anim.in": "fade", "anim.inDuration": 0.5, "anim.out": "zoom", "anim.outDuration": 1, volume: 0.8 });
		const main = editor.scenes.getActiveScene().tracks.main;
		new cmds.SplitElementsCommand({ elements: [{ trackId: main.id, elementId: "c" }], splitTime: 120_000 as never }).execute();
		const [left, right] = [...editor.scenes.getActiveScene().tracks.main.elements].sort((a, b) => a.startTime - b.startTime);
		const pl = left.params as Record<string, unknown>;
		const pr = right.params as Record<string, unknown>;
		expect([pl.fadeIn, pl.fadeOut, pl["anim.in"], pl["anim.out"]]).toEqual([0.5, 0, "fade", "none"]);
		expect([pr.fadeIn, pr.fadeOut, pr["anim.in"], pr["anim.out"]]).toEqual([0, 1, "none", "zoom"]);
		// everything else stays the clip's
		expect([pl.volume, pr.volume]).toEqual([0.8, 0.8]);
	});

	test("a clip without fades splits with its params as they were", () => {
		const editor = editorWith({ volume: 0.5 });
		const main = editor.scenes.getActiveScene().tracks.main;
		new cmds.SplitElementsCommand({ elements: [{ trackId: main.id, elementId: "c" }], splitTime: 120_000 as never }).execute();
		const halves = editor.scenes.getActiveScene().tracks.main.elements;
		expect(halves.map((e) => e.params)).toEqual([{ volume: 0.5 }, { volume: 0.5 }]);
	});
});
