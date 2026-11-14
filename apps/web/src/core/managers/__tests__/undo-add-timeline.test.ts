import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";

let core: typeof import("@/core");
let scenes: typeof import("@/timeline/scenes");
let timelines: typeof import("./timelines-helper");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenes = await import("@/timeline/scenes");
	timelines = await import("./timelines-helper");
	const storage = await import("@/services/storage/service");
	(storage.storageService as unknown as Record<string, unknown>).saveProject = async () => {};
});

// Release crawl r65-3: «Add timeline» then Undo left the editor with no active scene («No active scene.»).
test("Undo of Add timeline opens the timeline that was open before", async () => {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const main = scenes.buildDefaultScene({ name: "Main", isMain: true });
	const project = {
		metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) },
		scenes: [main],
		currentSceneId: main.id,
		settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
		version: 1,
	} as unknown as TProject;
	editor.project.setActiveProject({ project });
	editor.scenes.setScenes({ scenes: project.scenes, activeSceneId: main.id });

	await timelines.addTimeline();
	expect(editor.scenes.getScenes()).toHaveLength(2);
	expect(editor.scenes.getActiveScene().id).not.toBe(main.id);

	editor.command.undo();
	expect(editor.scenes.getScenes()).toHaveLength(1);
	expect(editor.scenes.getActiveSceneOrNull()?.id).toBe(main.id);
	expect(editor.project.getActive().currentSceneId).toBe(main.id);
});
