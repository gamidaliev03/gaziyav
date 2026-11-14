import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// ⌘C on a transition, several clips selected, ⌘V: the transition lands at every selected clip's cut (where it meets
// the next one), clamped to the two clips, in one ⌘Z; the single selected cut / single clip paste keeps working.
type Core = typeof import("@/core");
type Elements = typeof import("@/timeline/element-utils");
type Wasm = typeof import("@/wasm");
type Paste = typeof import("../paste-transition");
type Clipboard = typeof import("@/clipboard");

let core: Core;
let elements: Elements;
let wasm: Wasm;
let paste: Paste;
let clipboard: Clipboard;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	paste = await import("../paste-transition");
	clipboard = await import("@/clipboard");
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
			metadata: { id: "paste-transition", name: "Paste transition", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	editor.command.isRippleEnabled = true;
	return editor;
}

const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });
const tracksOf = (editor: ReturnType<typeof setupEditor>) => editor.scenes.getActiveScene().tracks;

/** Clips back to back on the main track: their ids by name. */
function lay(editor: ReturnType<typeof setupEditor>, lengths: Record<string, number>) {
	let start = 0;
	for (const [name, length] of Object.entries(lengths)) {
		const element = elements.buildElementFromMedia({ mediaId: `media-${name}`, mediaType: "video", name, duration: sec(length), startTime: sec(start) });
		editor.timeline.insertElement({ element, placement: { mode: "explicit", trackId: tracksOf(editor).main.id } });
		start += length;
	}
	const ids: Record<string, string> = {};
	for (const element of tracksOf(editor).main.elements) ids[element.name] = element.id;
	return ids;
}

const transitionsOf = (editor: ReturnType<typeof setupEditor>) => {
	const tracks = tracksOf(editor);
	const nameOf = new Map(tracks.main.elements.map((e) => [e.id, e.name]));
	return ((tracks.main as { transitions?: Array<{ fromElementId: string; toElementId: string; type: string; duration: number; params: unknown }> }).transitions ?? [])
		.map((t) => ({ cut: `${nameOf.get(t.fromElementId)}|${nameOf.get(t.toElementId)}`, type: t.type, seconds: t.duration / wasm.TICKS_PER_SECOND, params: t.params }))
		.sort((a, b) => a.cut.localeCompare(b.cut));
};

const copied = () => ({ type: "gl.transition.fade", duration: sec(0.8), params: { strength: 0.5 } });

describe("⌘V of a copied transition onto several clips", () => {
	test("every selected clip's cut gets it, one ⌘Z takes all of them back", () => {
		const editor = setupEditor();
		const ids = lay(editor, { A: 3, B: 3, C: 3, D: 3 });
		const before = JSON.stringify(tracksOf(editor));
		const command = paste.buildTransitionPasteCommand({ tracks: tracksOf(editor), transition: copied(), selectedElementIds: [ids.A, ids.B, ids.C], selectedCut: null });
		expect(command).not.toBeNull();
		editor.command.execute({ command: command as NonNullable<typeof command> });
		expect(transitionsOf(editor).map((t) => t.cut)).toEqual(["A|B", "B|C", "C|D"]);
		expect(transitionsOf(editor).every((t) => t.type === "gl.transition.fade" && t.seconds === 0.8)).toBe(true);
		editor.command.undo();
		expect(JSON.stringify(tracksOf(editor))).toBe(before);
	});

	test("through the clipboard: ⌘C on the cut, select clips, ⌘V", () => {
		const editor = setupEditor();
		const ids = lay(editor, { A: 3, B: 3, C: 3, D: 3 });
		// the first transition, put on A|B as the Transitions panel does
		const first = paste.buildTransitionPasteCommand({ tracks: tracksOf(editor), transition: copied(), selectedElementIds: [ids.A], selectedCut: null });
		editor.command.execute({ command: first as NonNullable<typeof first> });
		const { useSelectedCut } = require("@/transitions/commands") as typeof import("@/transitions/commands");
		editor.selection.clearSelection();
		useSelectedCut.getState().setCut({ trackId: tracksOf(editor).main.id, fromElementId: ids.A, toElementId: ids.B });
		expect(editor.clipboard.copy()).toBe(true);
		expect(editor.clipboard.getEntry()?.type).toBe("transition");
		editor.selection.setSelectedElements({ elements: [ids.B, ids.C].map((elementId) => ({ trackId: tracksOf(editor).main.id, elementId })) });
		expect(editor.clipboard.paste()).toBe(true);
		expect(transitionsOf(editor).map((t) => t.cut)).toEqual(["A|B", "B|C", "C|D"]);
		editor.command.undo();
		expect(transitionsOf(editor).map((t) => t.cut)).toEqual(["A|B"]);
		expect(clipboard.clipboardHandlers.transition.type).toBe("transition");
	});

	test("a copy never runs past short clips: clamped per cut; the last clip takes the cut before it", () => {
		const editor = setupEditor();
		const ids = lay(editor, { A: 3, B: 0.5, C: 3 });
		const tracks = tracksOf(editor);
		const cuts = paste.transitionPasteCuts({ tracks, selectedElementIds: [ids.B, ids.C], selectedCut: null });
		// B → its cut with C; C has nothing after it → where B meets it: the same cut, once
		expect(cuts.map((c) => `${c.fromElementId === ids.B ? "B" : "?"}|${c.toElementId === ids.C ? "C" : "?"}`)).toEqual(["B|C"]);
		const after = paste.pasteTransitionAtCuts({ tracks, transition: { ...copied(), duration: sec(2) }, cuts });
		const [t] = (after.main as { transitions?: Array<{ duration: number }> }).transitions ?? [];
		expect(t.duration / wasm.TICKS_PER_SECOND).toBeCloseTo(0.5, 5);
	});

	test("single clip and single selected cut still work; an existing transition there is replaced, not doubled", () => {
		const editor = setupEditor();
		const ids = lay(editor, { A: 3, B: 3 });
		const main = tracksOf(editor).main.id;
		const one = paste.buildTransitionPasteCommand({ tracks: tracksOf(editor), transition: copied(), selectedElementIds: [ids.A], selectedCut: null });
		editor.command.execute({ command: one as NonNullable<typeof one> });
		const again = paste.buildTransitionPasteCommand({
			tracks: tracksOf(editor),
			transition: { type: "gl.transition.wipeleft", duration: sec(0.5), params: {} },
			selectedElementIds: [],
			selectedCut: { trackId: main, fromElementId: ids.A, toElementId: ids.B },
		});
		editor.command.execute({ command: again as NonNullable<typeof again> });
		expect(transitionsOf(editor).map((t) => `${t.cut}:${t.type}`)).toEqual(["A|B:gl.transition.wipeleft"]);
		expect(paste.buildTransitionPasteCommand({ tracks: tracksOf(editor), transition: copied(), selectedElementIds: [], selectedCut: null })).toBeNull();
	});
});
