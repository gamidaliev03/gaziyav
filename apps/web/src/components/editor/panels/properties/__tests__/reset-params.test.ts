import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// K2: the ↺ of a parameter removes its keyframes and puts the default back; the ↺ of the Transform section does it for
// position, scale and rotation; one ⌘Z undoes either. It used to add a key with the default value instead.
let core: typeof import("@/core");
let elements: typeof import("@/timeline/element-utils");
let wasm: typeof import("@/wasm");
let registry: typeof import("@/params/registry");
let reset: typeof import("@/components/editor/panels/properties/hooks/reset-params");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	registry = await import("@/params/registry");
	reset = await import("@/components/editor/panels/properties/hooks/reset-params");
});

const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });
const TRANSFORM = ["transform.positionX", "transform.positionY", "transform.scaleX", "transform.scaleY", "transform.rotate"];

/** A clip moved, scaled and rotated, with rotation and opacity keys. */
function setup() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "k2", name: "K2", createdAt: new Date(0), updatedAt: new Date(0) },
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
		element: { ...built, sourceDuration: sec(10), trimEnd: sec(6), params: { ...built.params, "transform.positionX": 120, "transform.scaleX": 1.5, "transform.scaleY": 1.5 } } as never,
		placement: { mode: "explicit", trackId } as never,
	});
	const elementId = editor.scenes.getActiveScene().tracks.main.elements[0].id;
	editor.timeline.upsertKeyframes({
		keyframes: [
			{ trackId, elementId, propertyPath: "transform.rotate", time: sec(0), value: 0 },
			{ trackId, elementId, propertyPath: "transform.rotate", time: sec(2), value: 90 },
			{ trackId, elementId, propertyPath: "opacity", time: sec(1), value: 0.5 },
		],
	});
	const element = () => editor.scenes.getActiveScene().tracks.main.elements[0];
	const param = (key: string) => {
		const found = registry.getElementParams({ element: element() }).find((p) => p.key === key);
		if (!found) throw new Error(key);
		return found;
	};
	const value = (key: string) => registry.readElementParamValue({ element: element(), param: param(key) });
	return { editor, trackId, element, param, value };
}

describe("↺ reset", () => {
	test("a parameter: its keys go, its default comes back, the other parameters keep theirs — one ⌘Z", () => {
		const { editor, trackId, element, param, value } = setup();
		const rotate = param("transform.rotate");
		reset.resetParams({ editor, trackId, element: element(), entries: [{ param: rotate, value: rotate.default }] });
		expect(element().animations?.["transform.rotate"]).toBeUndefined();
		expect(value("transform.rotate")).toBe(rotate.default);
		expect(element().animations?.opacity).toBeDefined();
		expect(value("transform.positionX")).toBe(120);
		editor.command.undo();
		expect(element().animations?.["transform.rotate"]).toBeDefined();
	});

	test("the Transform section: position, scale and rotation to defaults with their keys — opacity untouched, one ⌘Z", () => {
		const { editor, trackId, element, param, value } = setup();
		const entries = TRANSFORM.map((key) => ({ param: param(key), value: param(key).default }));
		reset.resetParams({ editor, trackId, element: element(), entries });
		for (const key of TRANSFORM) expect(value(key)).toBe(param(key).default);
		expect(Object.keys(element().animations ?? {})).toEqual(["opacity"]);
		editor.command.undo();
		expect(value("transform.positionX")).toBe(120);
		expect(value("transform.scaleX")).toBe(1.5);
		expect(element().animations?.["transform.rotate"]).toBeDefined();
	});

	test("the last animated parameter reset leaves no empty animations behind", () => {
		const { element } = setup();
		expect(reset.removeAnimationPaths({ animations: element().animations, paths: ["transform.rotate", "opacity"] })).toBeUndefined();
	});
});
