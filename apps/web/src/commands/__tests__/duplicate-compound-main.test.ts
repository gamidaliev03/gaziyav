import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "./wasm-setup";

// Final check 04.11 (findings 1 and 2): Duplicate of a main-track clip follows it on the main track and the clips
// after it move on (it went to a new top track over the original); a compound clip made of main-track clips takes
// their place on the main track (it went to a layer and left a hole on the main track).
type Core = typeof import("@/core");
type Elements = typeof import("@/timeline/element-utils");
type Wasm = typeof import("@/wasm");
type Compound = typeof import("@/timeline/compound");

let core: Core;
let elements: Elements;
let wasm: Wasm;
let compound: Compound;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	compound = await import("@/timeline/compound");
});

function setupEditor() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "dup-project", name: "Dup", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	return editor;
}

const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });
const asSeconds = (t: number) => Math.round((t / wasm.TICKS_PER_SECOND) * 100) / 100;

/** Two video clips on the main track, A 0–4 s and B 4–8 s. */
function twoClips(editor: ReturnType<typeof setupEditor>) {
	for (const [name, start] of [
		["A", 0],
		["B", 4],
	] as const) {
		const element = elements.buildElementFromMedia({ mediaId: `media-${name}`, mediaType: "video", name, duration: sec(4), startTime: sec(start) });
		editor.timeline.insertElement({ element: { ...element, sourceDuration: sec(10), trimEnd: sec(6) } as never, placement: { mode: "explicit", trackId: editor.scenes.getActiveScene().tracks.main.id } as never });
	}
}
const main = (editor: ReturnType<typeof setupEditor>) => editor.scenes.getActiveScene().tracks.main;
const mainLayout = (editor: ReturnType<typeof setupEditor>) => [...main(editor).elements].sort((a, b) => a.startTime - b.startTime).map((e) => [e.name, asSeconds(e.startTime), asSeconds(e.duration)]);

describe("Duplicate", () => {
	test("a main-track clip's copy follows it on the main track and the clips after move on (⌘Z puts it back)", () => {
		const editor = setupEditor();
		twoClips(editor);
		const a = main(editor).elements.find((e) => e.name === "A")!;
		editor.timeline.duplicateElements({ elements: [{ trackId: main(editor).id, elementId: a.id }] });
		expect(mainLayout(editor)).toEqual([
			["A", 0, 4],
			["A (copy)", 4, 4],
			["B", 8, 4],
		]);
		expect(editor.scenes.getActiveScene().tracks.overlay.length).toBe(0);
		editor.command.undo();
		expect(mainLayout(editor)).toEqual([
			["A", 0, 4],
			["B", 4, 4],
		]);
	});

	test("a layer's copy follows it on its own track when that spot is free, else it goes to a new track", () => {
		const editor = setupEditor();
		twoClips(editor);
		const text = { type: "text", name: "T", startTime: sec(1), duration: sec(2), trimStart: 0, trimEnd: 0, params: { content: "t" } };
		editor.timeline.insertElement({ element: text as never, placement: { mode: "auto" } });
		const track = editor.scenes.getActiveScene().tracks.overlay.find((t) => t.type === "text")!;
		const t = track.elements[0];
		editor.timeline.duplicateElements({ elements: [{ trackId: track.id, elementId: t.id }] });
		let overlay = editor.scenes.getActiveScene().tracks.overlay;
		expect(overlay.length).toBe(1);
		expect(overlay[0].elements.map((e) => [e.name, asSeconds(e.startTime)])).toEqual([
			["T", 1],
			["T (copy)", 3],
		]);
		// the spot after the original is taken now: the next copy goes to a new track
		editor.timeline.duplicateElements({ elements: [{ trackId: track.id, elementId: t.id }] });
		overlay = editor.scenes.getActiveScene().tracks.overlay;
		expect(overlay.length).toBe(2);
		expect(overlay.flatMap((tr) => tr.elements as import("@/timeline").TimelineElement[]).filter((e) => e.name === "T (copy)").length).toBe(2);
	});
});

describe("Compound clip", () => {
	test("made of main-track clips it takes their place on the main track: no hole, nothing else moves", () => {
		const editor = setupEditor();
		twoClips(editor);
		const a = main(editor).elements.find((e) => e.name === "A")!;
		editor.selection.setSelectedElements({ elements: [{ trackId: main(editor).id, elementId: a.id }] });
		expect(compound.createCompoundClip(editor)).toBe(true);
		const layout = mainLayout(editor);
		expect(layout).toEqual([
			["Compound clip 1", 0, 4],
			["B", 4, 4],
		]);
		expect(editor.scenes.getActiveScene().tracks.overlay.length).toBe(0);
		expect(editor.selection.getSelectedElements()[0]?.trackId).toBe(main(editor).id);
		// the inner timeline holds A at 0
		const inner = editor.scenes.getScenes().find((s) => s.name === "Compound clip 1")!;
		expect(inner.tracks.main.elements.map((e) => [e.name, asSeconds(e.startTime)])).toEqual([["A", 0]]);
		editor.command.undo();
		expect(mainLayout(editor)).toEqual([
			["A", 0, 4],
			["B", 4, 4],
		]);
	});

	test("a layer reaching past the picked main clip pushes the clips after it on by the overflow", () => {
		const editor = setupEditor();
		twoClips(editor);
		const text = { type: "text", name: "T", startTime: sec(2), duration: sec(4), trimStart: 0, trimEnd: 0, params: { content: "t" } };
		editor.timeline.insertElement({ element: text as never, placement: { mode: "auto" } });
		const a = main(editor).elements.find((e) => e.name === "A")!;
		const track = editor.scenes.getActiveScene().tracks.overlay.find((t) => t.type === "text")!;
		editor.selection.setSelectedElements({ elements: [{ trackId: main(editor).id, elementId: a.id }, { trackId: track.id, elementId: track.elements[0].id }] });
		expect(compound.createCompoundClip(editor)).toBe(true);
		expect(mainLayout(editor)).toEqual([
			["Compound clip 1", 0, 6],
			["B", 6, 4],
		]);
		expect(editor.scenes.getActiveScene().tracks.overlay.length).toBe(0);
	});

	test("picked layers only still go to a layer track above them", () => {
		const editor = setupEditor();
		twoClips(editor);
		const text = { type: "text", name: "T", startTime: sec(1), duration: sec(2), trimStart: 0, trimEnd: 0, params: { content: "t" } };
		editor.timeline.insertElement({ element: text as never, placement: { mode: "auto" } });
		const track = editor.scenes.getActiveScene().tracks.overlay.find((t) => t.type === "text")!;
		editor.selection.setSelectedElements({ elements: [{ trackId: track.id, elementId: track.elements[0].id }] });
		expect(compound.createCompoundClip(editor)).toBe(true);
		expect(mainLayout(editor)).toEqual([
			["A", 0, 4],
			["B", 4, 4],
		]);
		const overlay = editor.scenes.getActiveScene().tracks.overlay;
		expect(overlay.length).toBe(1);
		expect(overlay[0].elements.map((e) => [e.name, asSeconds(e.startTime), asSeconds(e.duration)])).toEqual([["Compound clip 1", 1, 2]]);
	});
});
