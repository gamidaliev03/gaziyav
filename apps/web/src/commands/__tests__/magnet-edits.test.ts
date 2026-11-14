import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "./wasm-setup";

// The main-track magnet in real edits: redo repeats an edit the way it was made (even if the magnet was switched in
// between), and lengthening a main clip pushes the clips after it instead of stopping at the next one.
type Core = typeof import("@/core");
type Elements = typeof import("@/timeline/element-utils");
type Wasm = typeof import("@/wasm");
type Resize = typeof import("@/timeline/controllers/resize-controller");

let core: Core;
let elements: Elements;
let wasm: Wasm;
let resize: Resize;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	resize = await import("@/timeline/controllers/resize-controller");
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
			metadata: { id: "magnet-project", name: "Magnet", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width: 1080, height: 1920 },
				background: { type: "color", color: "#000000" },
			},
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	return editor;
}

const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });
const asSeconds = (t: number) => Math.round((t / wasm.TICKS_PER_SECOND) * 100) / 100;

/** Two video clips on the main track, 0–4 s and 4–8 s, each cut from a 10 s file. */
function twoClips(editor: ReturnType<typeof setupEditor>) {
	for (const [name, start] of [
		["A", 0],
		["B", 4],
	] as const) {
		const element = elements.buildElementFromMedia({ mediaId: `media-${name}`, mediaType: "video", name, duration: sec(4), startTime: sec(start) });
		editor.timeline.insertElement({ element: { ...element, sourceDuration: sec(10), trimEnd: sec(6) } as never, placement: { mode: "explicit", trackId: editor.scenes.getActiveScene().tracks.main.id } as never });
	}
	const main = () => editor.scenes.getActiveScene().tracks.main;
	return { main, spans: () => main().elements.map((e) => [e.name, asSeconds(e.startTime), asSeconds(e.startTime + e.duration)]) };
}

describe("magnet", () => {
	test("redo repeats the edit with the magnet it was made with", () => {
		const editor = setupEditor();
		const { main, spans } = twoClips(editor);
		expect(spans()).toEqual([
			["A", 0, 4],
			["B", 4, 8],
		]);
		editor.command.isRippleEnabled = true;
		const a = main().elements.find((e) => e.name === "A")!;
		editor.timeline.deleteElements({ elements: [{ trackId: main().id, elementId: a.id }] });
		expect(spans()).toEqual([["B", 0, 4]]);
		editor.command.undo();
		editor.command.isRippleEnabled = false;
		editor.command.redo();
		expect(spans()).toEqual([["B", 0, 4]]);
	});

	test("an edit that closes its own gap (Extract In–Out) isn't rippled again by the magnet", () => {
		const editor = setupEditor();
		// Three clips back to back, 0–3, 3–5, 5–7 s (the keyboard scenario's timeline).
		for (const [name, start, length] of [
			["A", 0, 3],
			["B", 3, 2],
			["C", 5, 2],
		] as const) {
			const element = elements.buildElementFromMedia({ mediaId: `media-${name}`, mediaType: "video", name, duration: sec(length), startTime: sec(start) });
			editor.timeline.insertElement({ element: { ...element, sourceDuration: sec(10), trimEnd: sec(10 - length) } as never, placement: { mode: "explicit", trackId: editor.scenes.getActiveScene().tracks.main.id } as never });
		}
		const main = () => editor.scenes.getActiveScene().tracks.main;
		const spans = () => main().elements.map((e) => [e.name, asSeconds(e.startTime), asSeconds(e.startTime + e.duration)]);
		editor.command.isRippleEnabled = true;
		const { TracksEditCommand } = require("@/actions/tracks-edit-command") as typeof import("@/actions/tracks-edit-command");
		const { removeRange } = require("@/in-out/keep-range") as typeof import("@/in-out/keep-range");
		const { splitActiveSceneAt } = require("@/in-out/slice") as typeof import("@/in-out/slice");
		// Extract 1–2 s, as the ' key does: cut there, remove the piece, close the gap.
		const range = { start: sec(1), end: sec(2) };
		const before = editor.scenes.getActiveScene().tracks;
		const cut = splitActiveSceneAt({ editor, times: [range.start, range.end] });
		const after = removeRange({ tracks: cut, range, closeGap: true });
		editor.command.execute({ command: new TracksEditCommand({ before, after, selection: [], noEngineRipple: true }) });
		const extracted = [
			["A", 0, 1],
			["A", 1, 2],
			["B", 2, 4],
			["C", 4, 6],
		];
		expect(spans()).toEqual(extracted);
		editor.command.undo();
		editor.command.redo();
		expect(spans()).toEqual(extracted);
	});

	for (const magnetAtEdit of [false, true]) {
		test(`ripple delete made with the magnet ${magnetAtEdit ? "on" : "off"} is redone the same after switching it`, () => {
			const editor = setupEditor();
			const { main, spans } = twoClips(editor);
			const { TracksEditCommand } = require("@/actions/tracks-edit-command") as typeof import("@/actions/tracks-edit-command");
			const { removeElements } = require("@/actions/timeline-edits") as typeof import("@/actions/timeline-edits");
			editor.command.isRippleEnabled = magnetAtEdit;
			const before = editor.scenes.getActiveScene().tracks;
			const a = main().elements.find((e) => e.name === "A")!;
			const after = removeElements({ tracks: before, elements: [{ trackId: main().id, elementId: a.id }] });
			editor.command.execute({ command: new TracksEditCommand({ before, after, ripple: true }) });
			const made = spans();
			editor.command.undo();
			editor.command.isRippleEnabled = !magnetAtEdit;
			editor.command.redo();
			expect(spans()).toEqual(made);
		});
	}

	test("lengthening a main clip with the magnet pushes the next clip", () => {
		const editor = setupEditor();
		const { main, spans } = twoClips(editor);
		editor.command.isRippleEnabled = true;
		const previews: unknown[] = [];
		const config = {
			zoomLevel: 1,
			snappingEnabled: false,
			isShiftHeld: () => false,
			getSceneTracks: () => editor.scenes.getActiveScene().tracks,
			getCurrentPlayheadTime: () => editor.playback.getCurrentTime(),
			getActiveProjectFps: () => ({ numerator: 30, denominator: 1 }),
			getRippleTrackId: () => main().id,
			selectedElements: [],
			discardPreview: () => {},
			previewElements: (updates: unknown[]) => previews.push(updates),
			commitElements: (updates: Array<{ trackId: string; elementId: string; patch: object }>) =>
				editor.timeline.updateElements({ updates: updates.map((u) => ({ trackId: u.trackId, elementId: u.elementId, patch: u.patch as never })) }),
		};
		// The controller listens on the document for the drag: a bare event target stands in for it here.
		const g = globalThis as unknown as { document?: EventTarget };
		const hadDocument = !!g.document;
		g.document ??= new EventTarget();
		const mouse = (type: string, clientX = 0) => g.document!.dispatchEvent(Object.assign(new Event(type), { clientX }));
		const controller = new resize.ResizeController({ configRef: { current: config as never } });
		const a = main().elements.find((e) => e.name === "A")!;
		const event = { clientX: 0, stopPropagation() {}, preventDefault() {} } as never;
		controller.onResizeStart({ event, element: a, track: main(), side: "right" });
		// 2 s to the right at zoom 1: BASE_TIMELINE_PIXELS_PER_SECOND px per second.
		const { BASE_TIMELINE_PIXELS_PER_SECOND } = require("@/timeline/scale") as typeof import("@/timeline/scale");
		mouse("mousemove", 2 * BASE_TIMELINE_PIXELS_PER_SECOND);
		mouse("mouseup");
		if (!hadDocument) delete g.document;
		expect(spans()).toEqual([
			["A", 0, 6],
			["B", 6, 10],
		]);
	});
});

/** Drags one edge of a main-track clip by `dxPx` pixels at zoom 1, through the real controller (the document stands in). */
function dragEdge(editor: ReturnType<typeof setupEditor>, name: string, side: "left" | "right", dxPx: number) {
	const main = () => editor.scenes.getActiveScene().tracks.main;
	const config = {
		zoomLevel: 1,
		snappingEnabled: false,
		isShiftHeld: () => false,
		getSceneTracks: () => editor.scenes.getActiveScene().tracks,
		getCurrentPlayheadTime: () => editor.playback.getCurrentTime(),
		getActiveProjectFps: () => ({ numerator: 30, denominator: 1 }),
		getRippleTrackId: () => (editor.command.isRippleEnabled ? main().id : null),
		selectedElements: [],
		discardPreview: () => {},
		previewElements: () => {},
		commitElements: (updates: Array<{ trackId: string; elementId: string; patch: object }>) =>
			editor.timeline.updateElements({ updates: updates.map((u) => ({ trackId: u.trackId, elementId: u.elementId, patch: u.patch as never })) }),
	};
	const g = globalThis as unknown as { document?: EventTarget };
	const hadDocument = !!g.document;
	g.document ??= new EventTarget();
	const mouse = (type: string, clientX = 0) => g.document!.dispatchEvent(Object.assign(new Event(type), { clientX }));
	const controller = new resize.ResizeController({ configRef: { current: config as never } });
	const clip = main().elements.find((e) => e.name === name)!;
	controller.onResizeStart({ event: { clientX: 0, stopPropagation() {}, preventDefault() {} } as never, element: clip, track: main(), side });
	mouse("mousemove", dxPx);
	mouse("mouseup");
	if (!hadDocument) delete g.document;
}

/** Main track: A 0–4 and B 4–8, each a 4 s piece of a 10 s file starting 2 s in (2 s of head and 4 s of tail cut off). */
function twoTrimmedClips(editor: ReturnType<typeof setupEditor>) {
	for (const [name, start] of [
		["A", 0],
		["B", 4],
	] as const) {
		const element = elements.buildElementFromMedia({ mediaId: `media-${name}`, mediaType: "video", name, duration: sec(4), startTime: sec(start) });
		editor.timeline.insertElement({ element: { ...element, sourceDuration: sec(10), trimStart: sec(2), trimEnd: sec(4) } as never, placement: { mode: "explicit", trackId: editor.scenes.getActiveScene().tracks.main.id } as never });
	}
	const main = () => editor.scenes.getActiveScene().tracks.main;
	return { main, spans: () => main().elements.map((e) => [e.name, asSeconds(e.startTime), asSeconds(e.startTime + e.duration), asSeconds(e.trimStart)]) };
}

describe("magnet: pulling a trimmed head out", () => {
	test("a main clip's head comes back to the right: its start stays, the clips after it are pushed", () => {
		const editor = setupEditor();
		const { spans } = twoTrimmedClips(editor);
		editor.command.isRippleEnabled = true;
		const { BASE_TIMELINE_PIXELS_PER_SECOND: pps } = require("@/timeline/scale") as typeof import("@/timeline/scale");
		// A's left edge, 1 s to the left (A starts at 0, so there is nothing to the left to stop at)
		dragEdge(editor, "A", "left", -1 * pps);
		expect(spans()).toEqual([
			["A", 0, 5, 1],
			["B", 5, 9, 2],
		]);
		// B's left edge (it touches A): 1 s to the left
		dragEdge(editor, "B", "left", -1 * pps);
		expect(spans()).toEqual([
			["A", 0, 5, 1],
			["B", 5, 10, 1],
		]);
	});

	test("never more than the 2 s that were cut off, and one ⌘Z gives it all back", () => {
		const editor = setupEditor();
		const { spans } = twoTrimmedClips(editor);
		editor.command.isRippleEnabled = true;
		const { BASE_TIMELINE_PIXELS_PER_SECOND: pps } = require("@/timeline/scale") as typeof import("@/timeline/scale");
		dragEdge(editor, "B", "left", -5 * pps);
		expect(spans()).toEqual([
			["A", 0, 4, 2],
			["B", 4, 10, 0],
		]);
		editor.command.undo();
		expect(spans()).toEqual([
			["A", 0, 4, 2],
			["B", 4, 8, 2],
		]);
	});

	test("with the magnet off the head still stops at the clip before it", () => {
		const editor = setupEditor();
		const { spans } = twoTrimmedClips(editor);
		editor.command.isRippleEnabled = false;
		const { BASE_TIMELINE_PIXELS_PER_SECOND: pps } = require("@/timeline/scale") as typeof import("@/timeline/scale");
		dragEdge(editor, "B", "left", -1 * pps);
		expect(spans()).toEqual([
			["A", 0, 4, 2],
			["B", 4, 8, 2],
		]);
	});
});
