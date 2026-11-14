import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// K3: copy keyframes and paste them at the playhead with the same intervals, through the shared clipboard. The paste
// used the playhead as clip time: on a clip further along the timeline every key landed on its last frame.
let core: typeof import("@/core");
let elements: typeof import("@/timeline/element-utils");
let wasm: typeof import("@/wasm");
let query: typeof import("@/animation/keyframe-query");
let scope: typeof import("@/actions/keyframe-scope");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	query = await import("@/animation/keyframe-query");
	scope = await import("@/actions/keyframe-scope");
});

const T = () => wasm.TICKS_PER_SECOND;
const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * T()) });

/** A 4 s clip starting at 2 s on the timeline: opacity keys at 0.5 / 1.5 s, a rotation key at 1 s (clip time). */
function setup() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "k3", name: "K3", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	const mainId = editor.scenes.getActiveScene().tracks.main.id;
	// A 0–2 s, then B 2–6 s on the main track: B is the clip further along the timeline.
	for (const [name, start, length] of [["A", 0, 2], ["B", 2, 4]] as const) {
		const built = elements.buildElementFromMedia({ mediaId: `m-${name}`, mediaType: "video", name, duration: sec(length), startTime: sec(start) });
		editor.timeline.insertElement({ element: { ...built, sourceDuration: sec(10), trimEnd: sec(10 - length) } as never, placement: { mode: "explicit", trackId: mainId } as never });
	}
	const located = () => {
		const element = editor.scenes.getActiveScene().tracks.main.elements.find((e) => e.name === "B");
		if (!element) throw new Error("no clip");
		return { trackId: mainId, element };
	};
	const { trackId, element } = located();
	expect(element.startTime).toBe(sec(2));
	editor.timeline.upsertKeyframes({
		keyframes: [
			{ trackId, elementId: element.id, propertyPath: "opacity", time: sec(0.5), value: 1 },
			{ trackId, elementId: element.id, propertyPath: "opacity", time: sec(1.5), value: 0.2 },
			{ trackId, elementId: element.id, propertyPath: "transform.rotate", time: sec(1), value: 45 },
		],
	});
	const keys = (path: string) =>
		query
			.getElementKeyframes({ animations: located().element.animations })
			.filter((k) => k.propertyPath === path)
			.map((k) => [Math.round((k.time / T()) * 100) / 100, Math.round(Number(k.value) * 100) / 100]);
	const selectAllKeys = () => {
		const { element: el } = located();
		editor.selection.setSelectedElements({ elements: [{ trackId, elementId: el.id }] });
		editor.selection.setSelectedKeyframes({
			keyframes: query.getElementKeyframes({ animations: el.animations }).map((k) => ({ trackId, elementId: el.id, propertyPath: k.propertyPath, keyframeId: k.id })),
		});
	};
	return { editor, keys, selectAllKeys };
}

describe("copy / paste keyframes", () => {
	test("pasted at the playhead on a clip further along the timeline, with the copied intervals and values; one ⌘Z", () => {
		const { editor, keys, selectAllKeys } = setup();
		selectAllKeys();
		expect(editor.clipboard.copy()).toBe(true);
		editor.playback.seek({ time: sec(4) });
		expect(editor.clipboard.paste()).toBe(true);
		// Playhead 4 s = clip time 2 s: the first key (0.5 s) lands there, the others keep their distance.
		expect(keys("opacity")).toEqual([[0.5, 1], [1.5, 0.2], [2, 1], [3, 0.2]]);
		expect(keys("transform.rotate")).toEqual([[1, 45], [2.5, 45]]);
		editor.command.undo();
		expect(keys("opacity")).toEqual([[0.5, 1], [1.5, 0.2]]);
	});

	test("keys that would fall past the clip's end are left out instead of piling up on its last frame", () => {
		const { editor, keys, selectAllKeys } = setup();
		selectAllKeys();
		editor.clipboard.copy();
		editor.playback.seek({ time: sec(5.5) });
		editor.clipboard.paste();
		expect(keys("opacity")).toEqual([[0.5, 1], [1.5, 0.2], [3.5, 1]]);
		expect(keys("transform.rotate")).toEqual([[1, 45], [4, 45]]);
	});

	test("with no clip selected the keys go back into the clip they came from", () => {
		const { editor, keys, selectAllKeys } = setup();
		selectAllKeys();
		editor.clipboard.copy();
		editor.selection.clearSelection?.();
		editor.selection.setSelectedElements({ elements: [] });
		editor.playback.seek({ time: sec(5) });
		expect(editor.clipboard.paste()).toBe(true);
		expect(keys("opacity")).toEqual([[0.5, 1], [1.5, 0.2], [3, 1], [4, 0.2]]);
	});

	test("⌘X with keys selected cuts the keys, not the clip", () => {
		const { editor, keys, selectAllKeys } = setup();
		selectAllKeys();
		expect(scope.cutSelectedKeyframes(editor)).toBe(true);
		expect(keys("opacity")).toEqual([]);
		expect(editor.scenes.getActiveScene().tracks.main.elements.map((e) => e.name)).toEqual(["A", "B"]);
		// Pasted back at 2.5 s (clip time 0.5 s, the first key's place) the keys are where they were.
		editor.playback.seek({ time: sec(2.5) });
		editor.clipboard.paste();
		expect(keys("opacity")).toEqual([[0.5, 1], [1.5, 0.2]]);
	});
});
