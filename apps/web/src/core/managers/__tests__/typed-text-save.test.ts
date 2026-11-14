import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";
import type { SerializedProject } from "@/services/storage/types";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

let core: typeof import("@/core");
let scenes: typeof import("@/timeline/scenes");
let saved: SerializedProject | null = null;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenes = await import("@/timeline/scenes");
	const storage = await import("@/services/storage/service");
	const service = storage.storageService as unknown as Record<string, unknown>;
	service.saveProject = async () => {};
	service.saveSerializedProject = async ({ serialized }: { serialized: SerializedProject }) => {
		saved = serialized;
	};
	// no IndexedDB here: the periodic version copy is not this test's business
	const recovery = await import("@/services/storage/recovery");
	(recovery.projectBackups as unknown as Record<string, unknown>).add = async () => {};
});

const title = (id: string, start: number) =>
	({ id, type: "text", name: id, startTime: start, duration: 120000, trimStart: 0, trimEnd: 0, params: { content: "Text", fontSize: 5 } }) as unknown as TimelineElement;

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
	editor.scenes.setScenes({ scenes: project.scenes, activeSceneId: main.id });
	const tracks = editor.scenes.getActiveScene().tracks;
	const withTitle: SceneTracks = { ...tracks, main: { ...tracks.main, elements: [title("a", 0)] } as SceneTracks["main"] };
	editor.scenes.updateSceneTracks({ tracks: withTitle });
	return { editor, trackId: tracks.main.id };
}
const savedTitle = () => (saved?.scenes[0].tracks.main.elements[0] ?? null) as (TimelineElement & { params: { content: string; fontSize: number } }) | null;

// pro-reliable 09.11: words typed into a title are a preview until the field is left; every save in between wrote the
// title as it was, so a crash or a quit two minutes into typing lost all of it.
test("a save made while a title is being typed holds the typed words (the step itself is still one ⌘Z)", async () => {
	const { editor, trackId } = open();
	editor.timeline.previewElements({ updates: [{ trackId, elementId: "a", updates: { params: { content: "Сцена 12 — финал", fontSize: 5 } } }] });
	await editor.project.saveCurrentProject();
	expect(savedTitle()?.params.content).toBe("Сцена 12 — финал");
	expect(savedTitle()?.params.fontSize).toBe(5);
	// what is committed is untouched until the field is left
	expect((editor.scenes.getActiveScene().tracks.main.elements[0] as unknown as { params: { content: string } }).params.content).toBe("Text");
});

test("a drag or a slider in progress is not saved: only a title's words are taken from a preview", async () => {
	const { editor, trackId } = open();
	editor.timeline.previewElements({ updates: [{ trackId, elementId: "a", updates: { startTime: 600000 as never, params: { content: "Text", fontSize: 9 } } }] });
	await editor.project.saveCurrentProject();
	expect(savedTitle()?.startTime as unknown as number).toBe(0);
	expect(savedTitle()?.params.fontSize).toBe(5);
	expect(savedTitle()?.params.content).toBe("Text");
});

test("offline clips: a clip whose media is not in the project, never a library sound, a hidden one only outside the export", async () => {
	const { offlineClips } = await import("@/relink/offline");
	const tracks = {
		main: { id: "m", type: "video", hidden: false, muted: false, elements: [{ id: "v1", type: "video", name: "A.mp4", mediaId: "a" }, { id: "v2", type: "video", name: "B.mp4", mediaId: "gone" }] },
		overlay: [{ id: "o", type: "video", hidden: true, muted: false, elements: [{ id: "v3", type: "video", name: "C.mp4", mediaId: "gone2" }] }],
		audio: [{ id: "s", type: "audio", muted: false, elements: [{ id: "l1", type: "audio", name: "song", sourceType: "library", sourceUrl: "/x.mp3" }, { id: "u1", type: "audio", name: "voice.wav", sourceType: "upload", mediaId: "gone3" }] }],
	} as unknown as SceneTracks;
	const assets = [{ id: "a" }] as never[];
	expect(offlineClips({ tracks, assets }).map((c) => c.elementId)).toEqual(["v2", "v3", "u1"]);
	expect(offlineClips({ tracks, assets, rendered: true }).map((c) => c.elementId)).toEqual(["v2", "u1"]);
});
