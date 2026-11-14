// Multi-timeline (sequences) bugs of the 05.11 sweep: ⌘Z rewrote the timeline on screen with another one's clips,
// every timeline shared one playhead, a deleted «Timeline 03» made the next «+» a second «Timeline 04», a deleted
// compound clip (or a deleted timeline holding one) turned its inner timeline into a tab, an empty rename left a blank tab.
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";
import type { SceneTracks, TScene, TimelineElement } from "@/timeline/types";

let core: typeof import("@/core");
let scenes: typeof import("@/timeline/scenes");
let timelines: typeof import("./timelines-helper");
let snapshot: typeof import("@/commands/timeline/tracks-snapshot");
let TICKS = 0;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenes = await import("@/timeline/scenes");
	timelines = await import("./timelines-helper");
	snapshot = await import("@/commands/timeline/tracks-snapshot");
	TICKS = (await import("@/wasm")).TICKS_PER_SECOND;
	const storage = await import("@/services/storage/service");
	(storage.storageService as unknown as Record<string, unknown>).saveProject = async () => {};
});

const clip = (id: string, seconds: number, extra: Record<string, unknown> = {}) =>
	({ id, type: "video", mediaId: "m", name: id, startTime: 0, duration: seconds * TICKS, trimStart: 0, trimEnd: 0, params: {}, ...extra }) as unknown as TimelineElement;

function withMain(tracks: SceneTracks, elements: TimelineElement[]): SceneTracks {
	return { ...tracks, main: { ...tracks.main, elements: elements as never } };
}

function open() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const main = scenes.buildDefaultScene({ name: "Main scene", isMain: true });
	const project = {
		metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) },
		scenes: [main],
		currentSceneId: main.id,
		settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
		version: 1,
	} as unknown as TProject;
	editor.project.setActiveProject({ project });
	editor.scenes.setScenes({ scenes: project.scenes, activeSceneId: main.id });
	return { editor, main };
}

/** Puts clips on the open timeline as one undo step. */
function place(editor: ReturnType<typeof open>["editor"], elements: TimelineElement[]) {
	const before = editor.scenes.getActiveScene().tracks;
	editor.command.execute({ command: new snapshot.TracksSnapshotCommand({ before, after: withMain(before, elements) }) });
}

const sceneById = (editor: ReturnType<typeof open>["editor"], id: string) => editor.scenes.getScenes().find((s) => s.id === id) as TScene;
const mainIds = (scene: TScene) => scene.tracks.main.elements.map((e) => e.id);

describe("⌘Z / ⇧⌘Z belong to the timeline the step was made on", () => {
	test("⌘Z on another timeline opens the edited one and undoes there; ⇧⌘Z redoes there", async () => {
		const { editor, main } = open();
		await timelines.addTimeline();
		const second = editor.scenes.getActiveScene().id;
		place(editor, [clip("b1", 4)]);
		await editor.scenes.switchToScene({ sceneId: main.id });
		place(editor, [clip("a1", 6)]);
		await editor.scenes.switchToScene({ sceneId: second });

		editor.command.undo();
		expect(editor.scenes.getActiveScene().id).toBe(main.id);
		expect(editor.project.getActive().currentSceneId).toBe(main.id);
		expect(mainIds(sceneById(editor, main.id))).toEqual([]);
		expect(mainIds(sceneById(editor, second))).toEqual(["b1"]);

		await editor.scenes.switchToScene({ sceneId: second });
		editor.command.redo();
		expect(editor.scenes.getActiveScene().id).toBe(main.id);
		expect(mainIds(sceneById(editor, main.id))).toEqual(["a1"]);
		expect(mainIds(sceneById(editor, second))).toEqual(["b1"]);

		// two more ⌘Z: a1 goes on the main timeline, then b1 on the second one (opened for it)
		editor.command.undo();
		editor.command.undo();
		expect(editor.scenes.getActiveScene().id).toBe(second);
		expect(mainIds(sceneById(editor, second))).toEqual([]);
		expect(mainIds(sceneById(editor, main.id))).toEqual([]);
	});
});

describe("each timeline keeps its own playhead", () => {
	test("back on a timeline, the playhead is where it was left; a new one starts at 0", async () => {
		const { editor, main } = open();
		place(editor, [clip("a1", 10)]);
		editor.playback.seek({ time: (2 * TICKS) as never });
		await timelines.addTimeline();
		const second = editor.scenes.getActiveScene().id;
		expect(Number(editor.playback.getCurrentTime())).toBe(0);
		place(editor, [clip("b1", 10)]);
		editor.playback.seek({ time: (7 * TICKS) as never });
		await editor.scenes.switchToScene({ sceneId: main.id });
		expect(Number(editor.playback.getCurrentTime())).toBe(2 * TICKS);
		await editor.scenes.switchToScene({ sceneId: second });
		expect(Number(editor.playback.getCurrentTime())).toBe(7 * TICKS);
	});
});

describe("timeline names", () => {
	test("«+» after a deleted timeline: the next number, never a name twice", async () => {
		const { editor } = open();
		await timelines.addTimeline();
		await timelines.addTimeline();
		await timelines.addTimeline();
		const third = editor.scenes.getScenes().find((s) => s.name === "Timeline 03") as TScene;
		await editor.scenes.deleteScene({ sceneId: third.id });
		await timelines.addTimeline();
		const names = timelines.topLevelTimelines(editor.scenes.getScenes()).map(timelines.timelineTabName);
		expect(names).toEqual(["Timeline 01", "Timeline 02", "Timeline 04", "Timeline 05"]);
	});

	test("rename: trimmed, an empty name keeps the old one, a long one is cut, Cyrillic as typed", async () => {
		const { editor } = open();
		await timelines.addTimeline();
		const id = editor.scenes.getActiveScene().id;
		await editor.scenes.renameScene({ sceneId: id, name: "   " });
		expect(sceneById(editor, id).name).toBe("Timeline 02");
		await editor.scenes.renameScene({ sceneId: id, name: "  Интро   ролика " });
		expect(sceneById(editor, id).name).toBe("Интро ролика");
		await editor.scenes.renameScene({ sceneId: id, name: "Я".repeat(500) });
		expect(sceneById(editor, id).name).toBe("Я".repeat(80));
		editor.command.undo();
		expect(sceneById(editor, id).name).toBe("Интро ролика");
	});

	test("the main timeline shows its own name once renamed", () => {
		expect(timelines.timelineTabName({ name: "Main scene", isMain: true })).toBe("Timeline 01");
		expect(timelines.timelineTabName({ name: "Intro", isMain: true })).toBe("Intro");
	});
});

describe("deleting a timeline", () => {
	test("the open one: the main one opens (the project's open timeline too); ⌘Z brings it back open", async () => {
		const { editor, main } = open();
		await timelines.addTimeline();
		const second = editor.scenes.getActiveScene().id;
		await editor.scenes.deleteScene({ sceneId: second });
		expect(editor.scenes.getActiveScene().id).toBe(main.id);
		expect(editor.project.getActive().currentSceneId).toBe(main.id);
		editor.command.undo();
		expect(editor.scenes.getActiveScene().id).toBe(second);
		expect(editor.project.getActive().currentSceneId).toBe(second);
	});
});

describe("duplicate timeline", () => {
	test("a copy of the clips right after it, opened; edits of the copy leave the original; ⌘Z removes it", async () => {
		const { editor, main } = open();
		place(editor, [clip("a1", 3)]);
		await timelines.addTimeline();
		await editor.scenes.switchToScene({ sceneId: main.id });
		await timelines.duplicateTimeline(main.id);
		const list = timelines.topLevelTimelines(editor.scenes.getScenes());
		expect(list.map(timelines.timelineTabName)).toEqual(["Timeline 01", "Timeline 01 copy", "Timeline 02"]);
		const copy = editor.scenes.getActiveScene();
		expect(copy.id).toBe(list[1].id);
		expect(copy.isMain).toBe(false);
		expect(copy.tracks.main.elements).toHaveLength(1);
		expect(copy.tracks.main.elements[0].id).not.toBe("a1");
		expect(copy.tracks.main.id).not.toBe(sceneById(editor, main.id).tracks.main.id);
		place(editor, []);
		expect(mainIds(sceneById(editor, main.id))).toEqual(["a1"]);
		editor.command.undo();
		editor.command.undo();
		expect(editor.scenes.getScenes().some((s) => s.id === copy.id)).toBe(false);
		expect(editor.scenes.getActiveScene().id).toBe(main.id);
	});

	test("copySceneAs: transitions follow the new clip ids, a compound clip still opens its inner timeline", () => {
		const source = scenes.buildDefaultScene({ name: "T", isMain: false });
		const a = clip("a", 2);
		const b = clip("b", 2, { startTime: 2 * TICKS });
		const comp = clip("c", 2, { type: "graphic", definitionId: "ai.Composition", params: { sceneId: "inner" } });
		source.tracks = {
			...source.tracks,
			main: { ...source.tracks.main, elements: [a, b] as never, transitions: [{ id: "t1", fromElementId: "a", toElementId: "b", duration: 1 }] } as never,
			overlay: [{ id: "o", name: "o", type: "graphic", elements: [comp], hidden: false } as never],
		};
		const copy = scenes.copySceneAs({ source, name: "T copy" });
		const [na, nb] = copy.tracks.main.elements.map((e) => e.id);
		const transition = (copy.tracks.main as unknown as { transitions: { id: string; fromElementId: string; toElementId: string }[] }).transitions[0];
		expect([transition.fromElementId, transition.toElementId]).toEqual([na, nb]);
		expect(transition.id).not.toBe("t1");
		expect(na).not.toBe("a");
		expect((copy.tracks.overlay[0].elements[0] as unknown as { params: { sceneId: string } }).params.sceneId).toBe("inner");
		expect(copy.name).toBe("T copy");
	});
});

describe("inner timelines of compound clips are never tabs", () => {
	const compound = (sceneId: string) => clip(`c-${sceneId}`, 2, { type: "graphic", definitionId: "ai.Composition", params: { sceneId } });

	test("a nested timeline whose clip was deleted is no tab", () => {
		const main = scenes.buildDefaultScene({ name: "Main scene", isMain: true });
		const inner = scenes.buildDefaultScene({ name: "Compound clip 1", isMain: false, nested: true });
		const other = scenes.buildDefaultScene({ name: "Timeline 02", isMain: false });
		expect(timelines.topLevelTimelines([main, inner, other]).map((s) => s.id)).toEqual([main.id, other.id]);
	});

	test("at load: referenced inner timelines are marked, orphaned nested ones dropped, the rest untouched", () => {
		const main = scenes.buildDefaultScene({ name: "Main scene", isMain: true });
		const legacyInner = scenes.buildDefaultScene({ name: "Compound clip 1", isMain: false });
		const orphan = scenes.buildDefaultScene({ name: "Compound clip 2", isMain: false, nested: true });
		const deep = scenes.buildDefaultScene({ name: "Compound clip 3", isMain: false, nested: true });
		orphan.tracks = withMain(orphan.tracks, [compound(deep.id)]);
		main.tracks = withMain(main.tracks, [compound(legacyInner.id)]);
		const settled = scenes.settleNestedScenes({ scenes: [main, legacyInner, orphan, deep] });
		expect(settled.map((s) => s.name)).toEqual(["Main scene", "Compound clip 1"]);
		expect(settled[1].nested).toBe(true);
		const clean = [main, { ...legacyInner, nested: true }];
		expect(scenes.settleNestedScenes({ scenes: clean })).toBe(clean);
	});
});
