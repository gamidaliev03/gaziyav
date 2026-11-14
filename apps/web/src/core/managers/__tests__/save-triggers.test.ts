import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";
import type { SerializedProject } from "@/services/storage/types";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

// perf, 13.11 — what makes the project be written, counted. rc39, 20-minute talk (test/perf-counts.mjs): a 2-second
// drag of a clip wrote the whole unchanged project (724 KB) to IndexedDB 4 times before the drop, a 4.5-second one 4
// times + 3 disk copies; one scroll, one zoom, one play of the timeline 1 write + 1 disk copy each (the view state).

let core: typeof import("@/core");
let scenes: typeof import("@/timeline/scenes");
let SaveManager: typeof import("@/core/managers/save-manager").SaveManager;
const writes: SerializedProject[] = [];
let current: { stop(): void } | null = null;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenes = await import("@/timeline/scenes");
	SaveManager = (await import("@/core/managers/save-manager")).SaveManager;
	const storage = await import("@/services/storage/service");
	const service = storage.storageService as unknown as Record<string, unknown>;
	service.saveProject = async () => {};
	service.saveSerializedProject = async ({ serialized }: { serialized: SerializedProject }) => {
		writes.push(serialized);
	};
	const recovery = await import("@/services/storage/recovery");
	(recovery.projectBackups as unknown as Record<string, unknown>).add = async () => {};
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clip = (id: string, start: number, extra: Record<string, unknown> = {}) =>
	({ id, type: "text", name: id, startTime: start, duration: 120000, trimStart: 0, trimEnd: 0, params: { content: "Text", fontSize: 5 }, ...extra }) as unknown as TimelineElement;

function open({ debounceMs = 20 }: { debounceMs?: number } = {}) {
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
	// as after loadProject: a project still opening is never saved
	(editor.project as unknown as { isLoading: boolean }).isLoading = false;
	editor.scenes.setScenes({ scenes: project.scenes, activeSceneId: main.id });
	const tracks = editor.scenes.getActiveScene().tracks;
	const filled: SceneTracks = { ...tracks, main: { ...tracks.main, elements: [clip("a", 0), clip("b", 120000)] } as SceneTracks["main"] };
	editor.scenes.updateSceneTracks({ tracks: filled });
	// short delays, the app's rules: 20 ms after an edit, a view change alone after 120 ms
	current?.stop();
	const save = new SaveManager({ editor, debounceMs, maxWaitMs: Math.max(200, debounceMs * 4), viewSaveMs: 120 });
	current = save;
	(editor as unknown as { save: unknown }).save = save;
	save.start();
	writes.length = 0;
	return { editor, trackId: tracks.main.id };
}
const first = (s: SerializedProject) => s.scenes[0].tracks.main.elements[0] as unknown as { startTime: number; params: { content: string } };

test("a 40-step drag writes nothing while the hand is down; the drop writes once", async () => {
	const { editor, trackId } = open();
	for (let i = 1; i <= 40; i++) {
		editor.timeline.previewElements({ updates: [{ trackId, elementId: "a", updates: { startTime: (i * 3000) as never } }] });
		await sleep(i % 10 === 0 ? 60 : 2);
	}
	await sleep(80);
	expect(writes.length).toBe(0);
	editor.timeline.commitPreview();
	await sleep(80);
	expect(writes.length).toBe(1);
	expect(first(writes[0]).startTime).toBe(120000);
});

test("a drag given up (Esc) writes nothing", async () => {
	const { editor, trackId } = open();
	editor.timeline.previewElements({ updates: [{ trackId, elementId: "a", updates: { startTime: 9000 as never } }] });
	await sleep(60);
	editor.timeline.discardPreview();
	await sleep(80);
	expect(writes.length).toBe(0);
});

test("a slider over a title's whole params (its words unchanged) writes nothing until it is let go", async () => {
	const { editor, trackId } = open();
	for (let size = 6; size <= 12; size++) {
		editor.timeline.previewElements({ updates: [{ trackId, elementId: "a", updates: { params: { content: "Text", fontSize: size } } }] });
		await sleep(30);
	}
	await sleep(60);
	expect(writes.length).toBe(0);
});

test("typed words are still in the saves as they are typed (crash safety), and gone again after Esc", async () => {
	const { editor, trackId } = open();
	editor.timeline.previewElements({ updates: [{ trackId, elementId: "a", updates: { params: { content: "Сцена 1", fontSize: 5 } } }] });
	await sleep(60);
	expect(writes.length).toBe(1);
	expect(first(writes[0]).params.content).toBe("Сцена 1");
	editor.timeline.discardPreview();
	await sleep(60);
	expect(writes.length).toBe(2);
	expect(first(writes[1]).params.content).toBe("Text");
});

test("30 zoom / scroll / playhead steps write nothing on their own; the view goes with the next save or a flush", async () => {
	const { editor } = open();
	for (let i = 1; i <= 30; i++) {
		editor.project.setTimelineViewState({ viewState: { zoomLevel: 1 + i / 10, scrollLeft: i * 40, playheadTime: (i * 1000) as never } });
		await sleep(1);
	}
	await sleep(60);
	expect(writes.length).toBe(0);
	expect(editor.save.hasViewPending()).toBe(true);
	await editor.save.flush();
	expect(writes.length).toBe(1);
	expect(writes[0].timelineViewState?.scrollLeft).toBe(1200);
	expect(editor.save.hasViewPending()).toBe(false);
});

test("a view change with no edit after it is written once, after the view delay", async () => {
	const { editor } = open();
	for (let i = 1; i <= 10; i++) editor.project.setTimelineViewState({ viewState: { zoomLevel: 2, scrollLeft: i * 10, playheadTime: 0 as never } });
	await sleep(60);
	expect(writes.length).toBe(0);
	await sleep(160);
	expect(writes.length).toBe(1);
	expect(writes[0].timelineViewState?.scrollLeft).toBe(100);
});

test("an edit writes once, with the view as it is", async () => {
	const { editor, trackId } = open();
	editor.project.setTimelineViewState({ viewState: { zoomLevel: 3, scrollLeft: 77, playheadTime: 0 as never } });
	const t = editor.scenes.getActiveScene().tracks;
	editor.timeline.updateTracks({ ...t, main: { ...t.main, elements: [clip("a", 0), clip("b", 240000)] } as SceneTracks["main"] });
	await sleep(80);
	expect(writes.length).toBe(1);
	expect(writes[0].timelineViewState?.scrollLeft).toBe(77);
	await sleep(160);
	// the view was written with the edit: no second write for it
	expect(writes.length).toBe(1);
	void trackId;
});

// rfix-A (13.11) with perf's rule: a gesture writes nothing while it lasts, and the drop / paste / split that ADDS a clip
// is written the moment it is committed — not after the debounce (a kill inside that quarter second lost the clip).
test("a gesture that ends by adding a clip writes nothing while it lasts and at once when it ends", async () => {
	const { editor, trackId } = open({ debounceMs: 300 });
	// the editor has seen the project's clips once (as after it opens): an edit, written after its debounce
	const t0 = editor.scenes.getActiveScene().tracks;
	editor.timeline.updateTracks({ ...t0, main: { ...t0.main, elements: [clip("a", 0), clip("b", 130000)] } as SceneTracks["main"] });
	await sleep(340);
	writes.length = 0;
	for (let i = 1; i <= 10; i++) {
		editor.timeline.previewElements({ updates: [{ trackId, elementId: "a", updates: { startTime: (i * 3000) as never } }] });
		await sleep(5);
	}
	await sleep(40);
	expect(writes.length).toBe(0);
	const t = editor.scenes.getActiveScene().tracks;
	editor.timeline.updateTracks({ ...t, main: { ...t.main, elements: [clip("a", 0), clip("b", 120000), clip("c", 240000)] } as SceneTracks["main"] });
	await sleep(40);
	expect(writes.length).toBe(1);
	expect(writes[0].scenes[0].tracks.main.elements.length).toBe(3);
});

test("a drop that only moves a clip keeps the debounce (one write after it)", async () => {
	const { editor, trackId } = open({ debounceMs: 300 });
	editor.timeline.previewElements({ updates: [{ trackId, elementId: "a", updates: { startTime: 9000 as never } }] });
	await sleep(20);
	editor.timeline.commitPreview();
	await sleep(40);
	expect(writes.length).toBe(0);
	await sleep(330);
	expect(writes.length).toBe(1);
});
