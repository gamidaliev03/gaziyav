import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// K4: the new keyframe commands have keys in every preset and in saved keymaps — ⌥⌫ every key of the parameter,
// ⌥⇧⌫ every key of the clip, ⌥⇧R reset Transform — and each is one ⌘Z.
let core: typeof import("@/core");
let elements: typeof import("@/timeline/element-utils");
let wasm: typeof import("@/wasm");
let query: typeof import("@/animation/keyframe-query");
let scope: typeof import("@/actions/keyframe-scope");
let reset: typeof import("@/components/editor/panels/properties/hooks/reset-params");
let migrations: typeof import("@/actions/keybindings/migrations");
let presets: typeof import("@/actions/keybindings/presets");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	query = await import("@/animation/keyframe-query");
	scope = await import("@/actions/keyframe-scope");
	reset = await import("@/components/editor/panels/properties/hooks/reset-params");
	migrations = await import("@/actions/keybindings/migrations");
	presets = await import("@/actions/keybindings/presets");
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
			metadata: { id: "k4", name: "K4", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	const built = elements.buildElementFromMedia({ mediaId: "m", mediaType: "video", name: "A", duration: sec(4), startTime: sec(0) });
	const trackId = editor.scenes.getActiveScene().tracks.main.id;
	editor.timeline.insertElement({
		element: { ...built, sourceDuration: sec(10), trimEnd: sec(6), params: { ...built.params, "transform.positionX": 80 } } as never,
		placement: { mode: "explicit", trackId } as never,
	});
	const element = () => editor.scenes.getActiveScene().tracks.main.elements[0];
	const elementId = element().id;
	editor.timeline.upsertKeyframes({
		keyframes: [
			{ trackId, elementId, propertyPath: "opacity", time: sec(0), value: 1 },
			{ trackId, elementId, propertyPath: "opacity", time: sec(2), value: 0 },
			{ trackId, elementId, propertyPath: "transform.rotate", time: sec(1), value: 30 },
		],
	});
	const keys = () => query.getElementKeyframes({ animations: element().animations });
	const selectKey = (path: string) => {
		const kf = keys().find((k) => k.propertyPath === path);
		editor.selection.setSelectedKeyframes({ keyframes: kf ? [{ trackId, elementId, propertyPath: path, keyframeId: kf.id }] : [] });
	};
	return { editor, trackId, element, keys, selectKey };
}

describe("keys for the new keyframe commands", () => {
	test("every preset has ⌥⌫, ⌥⇧⌫, ⌥⇧R; a saved keymap gets them, a key the user took stays theirs", () => {
		for (const id of presets.KEYMAP_PRESET_IDS) {
			const bindings = presets.getPresetBindings({ preset: id });
			expect(bindings.get("alt+backspace")).toBe("delete-keyframes-parameter");
			expect(bindings.get("alt+shift+backspace")).toBe("delete-keyframes-clip");
			expect(bindings.get("alt+shift+r")).toBe("reset-transform");
		}
		const saved = { keybindings: { "alt+shift+r": "toggle-snapping", f9: "keyframe-ease" }, isCustomized: true, preset: "kadr" };
		const next = migrations.runMigrations({ state: saved, fromVersion: 10 }) as { keybindings: Record<string, string> };
		expect(next.keybindings["alt+backspace"]).toBe("delete-keyframes-parameter");
		expect(next.keybindings["alt+shift+backspace"]).toBe("delete-keyframes-clip");
		expect(next.keybindings["alt+shift+r"]).toBe("toggle-snapping");
		expect(migrations.CURRENT_VERSION).toBeGreaterThanOrEqual(11);
	});

	test("⌥⌫ removes every key of the selected key's parameter, one ⌘Z", () => {
		const { editor, keys, selectKey } = setup();
		selectKey("opacity");
		expect(scope.deleteKeyframesInScope(editor, "parameter")).toBe(2);
		expect(keys().map((k) => k.propertyPath)).toEqual(["transform.rotate"]);
		editor.command.undo();
		expect(keys()).toHaveLength(3);
	});

	test("⌥⇧⌫ removes every key of the selected clip even with no key selected; nothing selected → nothing", () => {
		const { editor, trackId, element, keys } = setup();
		editor.selection.setSelectedElements({ elements: [] }); // the insert selected the new clip
		expect(scope.deleteKeyframesInScope(editor, "clip")).toBe(0);
		editor.selection.setSelectedElements({ elements: [{ trackId, elementId: element().id }] });
		expect(scope.deleteKeyframesInScope(editor, "clip")).toBe(3);
		expect(keys()).toHaveLength(0);
		editor.command.undo();
		expect(keys()).toHaveLength(3);
	});

	test("⌥⇧R puts Transform back with its keys gone and leaves opacity alone, one ⌘Z", () => {
		const { editor, trackId, element, keys } = setup();
		expect(reset.resetTransform({ editor, clips: [{ trackId, element: element() }] })).toBe(1);
		expect(element().params["transform.positionX"]).toBe(0);
		expect(keys().map((k) => k.propertyPath)).toEqual(["opacity", "opacity"]);
		editor.command.undo();
		expect(element().params["transform.positionX"]).toBe(80);
		expect(keys()).toHaveLength(3);
	});
});
