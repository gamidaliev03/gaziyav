import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SelectedKeyframeRef } from "@/animation/types";

// K1: ⌘A on keys (the parameter's, then the clip's), ⌫ on the selection, and the ◆ menu «Delete / Delete All on This
// Parameter / Delete All on Clip» — each one ⌘Z.
type Core = typeof import("@/core");
let core: Core;
let elements: typeof import("@/timeline/element-utils");
let wasm: typeof import("@/wasm");
let scope: typeof import("@/actions/keyframe-scope");
let query: typeof import("@/animation/keyframe-query");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	scope = await import("@/actions/keyframe-scope");
	query = await import("@/animation/keyframe-query");
});

const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });

/** One 4 s video clip with opacity keys at 0 / 1 / 2 s and rotation keys at 0.5 / 1.5 s. */
function setup() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "k1", name: "K1", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	const element = elements.buildElementFromMedia({ mediaId: "m", mediaType: "video", name: "A", duration: sec(4), startTime: sec(0) });
	const trackId = editor.scenes.getActiveScene().tracks.main.id;
	editor.timeline.insertElement({ element: { ...element, sourceDuration: sec(10), trimEnd: sec(6) } as never, placement: { mode: "explicit", trackId } as never });
	const elementId = editor.scenes.getActiveScene().tracks.main.elements[0].id;
	editor.timeline.upsertKeyframes({
		keyframes: [
			...[0, 1, 2].map((s, i) => ({ trackId, elementId, propertyPath: "opacity", time: sec(s), value: i / 2 })),
			...[0.5, 1.5].map((s, i) => ({ trackId, elementId, propertyPath: "transform.rotate", time: sec(s), value: i * 90 })),
		],
	});
	const clip = () => {
		const el = editor.scenes.getActiveScene().tracks.main.elements[0];
		return { trackId, element: el };
	};
	const keys = () => query.getElementKeyframes({ animations: clip().element.animations });
	const ref = (propertyPath: string, index: number): SelectedKeyframeRef => {
		const kf = keys().filter((k) => k.propertyPath === propertyPath)[index];
		return { trackId, elementId, propertyPath, keyframeId: kf.id };
	};
	const count = (path?: string) => keys().filter((k) => !path || k.propertyPath === path).length;
	return { editor, clip, ref, count };
}

describe("⌘A on keyframes", () => {
	test("first the keys of the parameter, then — again — every key of the clip; no keys selected → clips", () => {
		const { clip, ref } = setup();
		const step1 = scope.selectAllKeyframesStep({ clips: [clip()], selected: [ref("opacity", 1)] });
		expect(step1?.map((k) => k.propertyPath)).toEqual(["opacity", "opacity", "opacity"]);
		const step2 = scope.selectAllKeyframesStep({ clips: [clip()], selected: step1 ?? [] });
		expect(step2).toHaveLength(5);
		expect(scope.selectAllKeyframesStep({ clips: [clip()], selected: [] })).toBeNull();
	});
});

describe("deleting keyframes", () => {
	test("⌫ / «Delete» removes just the selected keys, one ⌘Z brings them back", () => {
		const { editor, clip, ref, count } = setup();
		const keys = scope.keyframesInScope({ clips: [clip()], refs: [ref("opacity", 0), ref("transform.rotate", 1)], scope: "keys" });
		editor.timeline.removeKeyframes({ keyframes: keys });
		expect([count("opacity"), count("transform.rotate")]).toEqual([2, 1]);
		editor.command.undo();
		expect(count()).toBe(5);
	});

	test("«Delete All on This Parameter» clears that parameter only, in one ⌘Z", () => {
		const { editor, clip, ref, count } = setup();
		editor.timeline.removeKeyframes({ keyframes: scope.keyframesInScope({ clips: [clip()], refs: [ref("opacity", 2)], scope: "parameter" }) });
		expect([count("opacity"), count("transform.rotate")]).toEqual([0, 2]);
		editor.command.undo();
		expect([count("opacity"), count("transform.rotate")]).toEqual([3, 2]);
	});

	test("«Delete All on Clip» clears every key of the clip, in one ⌘Z", () => {
		const { editor, clip, ref, count } = setup();
		editor.timeline.removeKeyframes({ keyframes: scope.keyframesInScope({ clips: [clip()], refs: [ref("transform.rotate", 0)], scope: "clip" }) });
		expect(count()).toBe(0);
		editor.command.undo();
		expect(count()).toBe(5);
		editor.command.redo();
		expect(count()).toBe(0);
	});
});
