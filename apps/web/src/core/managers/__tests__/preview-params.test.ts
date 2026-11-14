import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

let core: typeof import("@/core");
let scenes: typeof import("@/timeline/scenes");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenes = await import("@/timeline/scenes");
	const storage = await import("@/services/storage/service");
	(storage.storageService as unknown as Record<string, unknown>).saveProject = async () => {};
});

// The volume line previews `params: { volume }` only: the clip's other params (fades, position, scale, effects) must
// come through the preview and its commit untouched.
test("a previewed param keeps the element's other params, in the preview and after the commit", () => {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const main = scenes.buildDefaultScene({ name: "Main", isMain: true });
	const project = {
		metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) },
		scenes: [main],
		currentSceneId: main.id,
		settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000000" } },
		version: 1,
	} as unknown as TProject;
	editor.project.setActiveProject({ project });
	editor.scenes.setScenes({ scenes: project.scenes, activeSceneId: main.id });
	const tracks = editor.scenes.getActiveScene().tracks;
	const clip = { id: "a", type: "text", name: "a", startTime: 0, duration: 120000, trimStart: 0, trimEnd: 0, params: { content: "a", volume: 0, fadeIn: 1.5, "transform.scale": 2 } } as unknown as TimelineElement;
	editor.scenes.updateSceneTracks({ tracks: { ...tracks, main: { ...tracks.main, elements: [clip] } as SceneTracks["main"] } });
	editor.timeline.previewElements({ updates: [{ trackId: tracks.main.id, elementId: "a", updates: { params: { volume: -6 } } as Partial<TimelineElement> }] });
	expect(editor.timeline.getPreviewTracks()?.main.elements[0].params).toEqual({ content: "a", volume: -6, fadeIn: 1.5, "transform.scale": 2 });
	editor.timeline.commitPreview();
	expect(editor.scenes.getActiveScene().tracks.main.elements[0].params).toEqual({ content: "a", volume: -6, fadeIn: 1.5, "transform.scale": 2 });
});
