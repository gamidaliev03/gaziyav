import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

// perfb (14.11): the header's save mark polled getIsDirty() every 300 ms for the editor's whole life; it now hears
// SaveManager.subscribeDirty — told once when an edit starts waiting and once when it is on disk, nothing in between.
let core: typeof import("@/core");
let scenes: typeof import("@/timeline/scenes");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenes = await import("@/timeline/scenes");
	const storage = await import("@/services/storage/service");
	const service = storage.storageService as unknown as Record<string, unknown>;
	service.saveProject = async () => {};
	service.saveSerializedProject = async () => {};
	const recovery = await import("@/services/storage/recovery");
	(recovery.projectBackups as unknown as Record<string, unknown>).add = async () => {};
});

const clip = (id: string, start: number) =>
	({ id, type: "text", name: id, startTime: start, duration: 120000, trimStart: 0, trimEnd: 0, params: { content: id, fontSize: 5 } }) as unknown as TimelineElement;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the dirty event: once on the first edit, once when it is saved — five edits in a row add nothing", async () => {
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
	(editor.project as unknown as { isLoading: boolean }).isLoading = false;
	editor.scenes.setScenes({ scenes: project.scenes, activeSceneId: main.id });
	const put = (elements: TimelineElement[]) => {
		const tracks = editor.scenes.getActiveScene().tracks;
		editor.scenes.updateSceneTracks({ tracks: { ...tracks, main: { ...tracks.main, elements } as SceneTracks["main"] } });
	};
	put([clip("a", 0)]);
	editor.save.start();
	await editor.save.flush();
	const seen: boolean[] = [];
	const off = editor.save.subscribeDirty(() => seen.push(editor.save.getIsDirty()));
	for (let i = 1; i <= 5; i++) put([{ ...clip("a", 0), startTime: i * 1000 } as TimelineElement]);
	expect(seen).toEqual([true]);
	for (let i = 0; i < 40 && editor.save.getIsDirty(); i++) await wait(100);
	expect(editor.save.getIsDirty()).toBe(false);
	expect(seen).toEqual([true, false]);
	off();
	put([{ ...clip("a", 0), startTime: 9000 } as TimelineElement]);
	expect(seen).toEqual([true, false]);
	await editor.save.flush();
});
