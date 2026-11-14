// tlfix A (13.11): leaving a compound clip puts the parent timeline back exactly as it was — its playhead, zoom and
// scroll — by every way out (Back, Esc, the breadcrumb all call closeComposition), level by level for a compound
// inside a compound. View state only: no undo step, the project's tracks and saved view state untouched.
// closeComposition used to seek to the compound clip's start on purpose (one-timeline.mjs: {"t":148000} → {"t":0}).
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let core: typeof import("@/core");
let elements: typeof import("@/timeline/element-utils");
let wasm: typeof import("@/wasm");
let compound: typeof import("@/timeline/compound");
let comps: typeof import("@/montage/compositions");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	compound = await import("@/timeline/compound");
	comps = await import("@/montage/compositions");
	const storage = await import("@/services/storage/service");
	(storage.storageService as unknown as Record<string, unknown>).saveProject = async () => {};
});

const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });

function setup() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	for (const [name, start] of [["A", 0], ["B", 4], ["C", 8]] as const) {
		const element = elements.buildElementFromMedia({ mediaId: `m-${name}`, mediaType: "video", name, duration: sec(4), startTime: sec(start) });
		editor.timeline.insertElement({ element: { ...element, sourceDuration: sec(10), trimEnd: sec(6) } as never, placement: { mode: "explicit", trackId: editor.scenes.getActiveScene().tracks.main.id } as never });
	}
	return { editor, mainId: scene.id };
}

type Editor = ReturnType<typeof setup>["editor"];
const mainTrack = (editor: Editor) => editor.scenes.getActiveScene().tracks.main;
/** ⌥G on the clip named `name` of the open timeline; returns the compound clip. */
function compoundOf(editor: Editor, name: string) {
	const el = mainTrack(editor).elements.find((e) => e.name === name)!;
	editor.selection.setSelectedElements({ elements: [{ trackId: mainTrack(editor).id, elementId: el.id }] });
	expect(compound.createCompoundClip(editor)).toBe(true);
	return mainTrack(editor).elements.find((e) => (e.params as Record<string, unknown>)?.compound === true && e.startTime === el.startTime)!;
}
const now = (editor: Editor): number => editor.playback.getCurrentTime();
const tracksJson = (editor: Editor) => JSON.stringify(editor.scenes.getScenes().map((s) => s.tracks));

describe("leaving a compound clip restores the parent's view", () => {
	test("playhead, zoom and scroll as they were; no undo step, no change to the project", async () => {
		const { editor, mainId } = setup();
		const clip = compoundOf(editor, "B"); // compound at 4 s
		editor.playback.seek({ time: sec(10) });
		// the timeline writes its zoom and scroll here as it leaves a timeline (timeline/components/index.tsx)
		editor.scenes.rememberView(mainId, { zoom: 3.5, scrollLeft: 412 });
		const depth = editor.command.depth();
		const tracks = tracksJson(editor);
		const saved = JSON.stringify(editor.project.getTimelineViewState());

		expect(comps.insideCompound(editor)).toBe(false); // Esc on the main timeline only deselects
		await comps.openComposition(clip);
		expect(editor.scenes.getActiveScene().id).toBe((clip.params as { sceneId: string }).sceneId);
		expect(comps.insideCompound(editor)).toBe(true); // Esc with nothing selected leads out (use-editor-actions)
		expect(now(editor)).toBe(0); // a compound opens at its start
		editor.playback.seek({ time: sec(1) });
		await comps.closeComposition(editor);

		expect(editor.scenes.getActiveScene().id).toBe(mainId);
		expect(now(editor)).toBe(sec(10)); // was the compound's start (4 s)
		expect(editor.scenes.viewOf(mainId)).toEqual({ zoom: 3.5, scrollLeft: 412 });
		expect(editor.command.depth()).toBe(depth);
		expect(editor.command.canRedo()).toBe(false);
		expect(tracksJson(editor)).toBe(tracks);
		expect(JSON.stringify(editor.project.getTimelineViewState())).toBe(saved);
	});

	test("nested compounds restore level by level", async () => {
		const { editor, mainId } = setup();
		const outer = compoundOf(editor, "B");
		editor.playback.seek({ time: sec(9) });
		await comps.openComposition(outer);
		const outerScene = editor.scenes.getActiveScene().id;
		const inner = compoundOf(editor, "B"); // B inside the outer compound, at 0
		editor.playback.seek({ time: sec(2.5) });
		await comps.openComposition(inner);
		expect(editor.scenes.getActiveScene().id).not.toBe(outerScene);
		editor.playback.seek({ time: sec(0.5) });

		await comps.closeComposition(editor);
		expect(editor.scenes.getActiveScene().id).toBe(outerScene);
		expect(now(editor)).toBe(sec(2.5));
		await comps.closeComposition(editor);
		expect(editor.scenes.getActiveScene().id).toBe(mainId);
		expect(now(editor)).toBe(sec(9));
	});

	test("a parent never left in this session (opened inside the clip) gets the playhead on the compound clip", async () => {
		const { editor, mainId } = setup();
		const clip = compoundOf(editor, "C"); // at 8 s
		const sceneId = (clip.params as { sceneId: string }).sceneId;
		// as a project saved inside the compound opens: the scenes are set with the inner one active
		editor.scenes.setScenes({ scenes: editor.scenes.getScenes(), activeSceneId: sceneId });
		expect(editor.scenes.getActiveScene().id).toBe(sceneId);
		await comps.closeComposition(editor);
		expect(editor.scenes.getActiveScene().id).toBe(mainId);
		expect(now(editor)).toBe(sec(8));
	});
});
