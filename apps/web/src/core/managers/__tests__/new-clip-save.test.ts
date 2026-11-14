import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";
import type { SerializedProject } from "@/services/storage/types";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

// pro-reliable crash (13.11): a 1 GB file put on the timeline the moment its import showed, the app killed 200–270 ms
// later — the clip was gone after the restart (2/3 clips), because every change waited the 250 ms debounce. A new clip
// is now saved at once; other edits keep the debounce.
let core: typeof import("@/core");
let scenes: typeof import("@/timeline/scenes");
let saves: SerializedProject[] = [];

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenes = await import("@/timeline/scenes");
	const storage = await import("@/services/storage/service");
	const service = storage.storageService as unknown as Record<string, unknown>;
	service.saveProject = async () => {};
	service.saveSerializedProject = async ({ serialized }: { serialized: SerializedProject }) => {
		saves.push(serialized);
	};
	const recovery = await import("@/services/storage/recovery");
	(recovery.projectBackups as unknown as Record<string, unknown>).add = async () => {};
});

const clip = (id: string, start: number) =>
	({ id, type: "text", name: id, startTime: start, duration: 120000, trimStart: 0, trimEnd: 0, params: { content: id, fontSize: 5 } }) as unknown as TimelineElement;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function open() {
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
	// opened (ProjectManager.loadProject ends so): a save while «loading» is refused
	(editor.project as unknown as { isLoading: boolean }).isLoading = false;
	editor.scenes.setScenes({ scenes: project.scenes, activeSceneId: main.id });
	const put = (elements: TimelineElement[]) => {
		const tracks = editor.scenes.getActiveScene().tracks;
		editor.scenes.updateSceneTracks({ tracks: { ...tracks, main: { ...tracks.main, elements } as SceneTracks["main"] } });
	};
	put([clip("a", 0)]);
	editor.save.start();
	saves = [];
	return { editor, put };
}
const savedIds = () => (saves.at(-1)?.scenes[0].tracks.main.elements ?? []).map((e) => e.id);

test("a clip added to the timeline is on disk at once, not a debounce later", async () => {
	const { editor, put } = open();
	// a first change, so the save manager knows how many clips there are (a project just opened)
	put([clip("a", 10)]);
	await wait(400);
	expect(savedIds()).toEqual(["a"]);
	saves = [];
	put([clip("a", 10), clip("big", 200000)]);
	await wait(40);
	expect(saves.length).toBe(1);
	expect(savedIds()).toEqual(["a", "big"]);
	editor.save.stop();
});

test("a move of a clip (no new clip) still waits the debounce: one write for many changes", async () => {
	const { editor, put } = open();
	put([clip("a", 10)]);
	await wait(400);
	saves = [];
	for (const at of [20, 30, 40]) put([clip("a", at)]);
	await wait(40);
	expect(saves.length).toBe(0);
	await wait(400);
	expect(saves.length).toBe(1);
	expect(saves[0].scenes[0].tracks.main.elements[0].startTime).toBe(40 as never);
	editor.save.stop();
});
