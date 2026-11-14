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

const el = (id: string, start: number) =>
	({ id, type: "text", name: id, startTime: start, duration: 120000, trimStart: 0, trimEnd: 0, params: { content: id } }) as unknown as TimelineElement;

// Review of st45: the preview cache was rebuilt only by previewElements / updateTracks, so tracks changed by another
// path showed stale under an active preview.
test("a preview in progress is shown over what is committed now, whatever path changed it", () => {
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
	const withA: SceneTracks = { ...tracks, main: { ...tracks.main, elements: [el("a", 0)] } as SceneTracks["main"] };
	editor.scenes.updateSceneTracks({ tracks: withA });
	editor.timeline.previewElements({ updates: [{ trackId: tracks.main.id, elementId: "a", updates: { name: "previewed" } }] });
	expect(editor.timeline.getPreviewTracks()?.main.elements[0].name).toBe("previewed");
	// another path writes the scene directly: the preview follows it
	editor.scenes.updateSceneTracks({ tracks: { ...withA, main: { ...withA.main, elements: [el("a", 0), el("b", 240000)] } as SceneTracks["main"] } });
	const shown = editor.timeline.getPreviewTracks()?.main.elements.map((e) => `${e.id}:${e.name}`);
	expect(shown).toEqual(["a:previewed", "b:b"]);
});
