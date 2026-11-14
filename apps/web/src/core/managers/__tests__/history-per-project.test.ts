import { DEFAULT_CANVAS_SIZE } from "@/canvas/sizes";
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";

let core: typeof import("@/core");
let storage: typeof import("@/services/storage/service");
let scenes: typeof import("@/timeline/scenes");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	storage = await import("@/services/storage/service");
	scenes = await import("@/timeline/scenes");
	// No IndexedDB here: saving succeeds, loading returns project B.
	const service = storage.storageService as unknown as Record<string, unknown>;
	service.saveProject = async () => {};
	service.loadProject = async () => ({ project: project("b", { width: 1080, height: 1920 }) });
});

function project(id: string, canvasSize: { width: number; height: number }): TProject {
	const scene = scenes.buildDefaultScene({ name: "Main", isMain: true });
	return {
		metadata: { id, name: id, createdAt: new Date(0), updatedAt: new Date(0) },
		scenes: [scene],
		currentSceneId: scene.id,
		settings: { fps: { numerator: 30, denominator: 1 }, canvasSize, background: { type: "color", color: "#000000" } },
		version: 1,
	} as unknown as TProject;
}

/** Project A with one format change undone: Redo is available. */
async function editedProjectA() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const a = project("a", { width: 1080, height: 1920 });
	editor.project.setActiveProject({ project: a });
	editor.scenes.setScenes({ scenes: a.scenes, activeSceneId: a.currentSceneId });
	await editor.project.updateSettings({ settings: { canvasSize: { width: 1080, height: 1080 } } });
	editor.command.undo();
	expect(editor.command.canRedo()).toBe(true);
	return editor;
}

// ui9 hand-off: ⇧⌘Z in a new project B redid A's format change (B took A's format).
describe("undo history belongs to its project", () => {
	test("a new project starts with nothing to undo or redo", async () => {
		const editor = await editedProjectA();
		await editor.project.createNewProject({ name: "B" });
		expect(editor.command.canUndo()).toBe(false);
		expect(editor.command.canRedo()).toBe(false);
		editor.command.redo();
		expect(editor.project.getActive().settings.canvasSize).toEqual(DEFAULT_CANVAS_SIZE);
	});

	test("opening another project clears it", async () => {
		const editor = await editedProjectA();
		await editor.project.loadProject({ id: "b" }).catch(() => {});
		expect(editor.command.canUndo()).toBe(false);
		expect(editor.command.canRedo()).toBe(false);
	});

	test("closing the project clears it", async () => {
		const editor = await editedProjectA();
		editor.project.closeProject();
		expect(editor.command.canUndo()).toBe(false);
		expect(editor.command.canRedo()).toBe(false);
	});
});
