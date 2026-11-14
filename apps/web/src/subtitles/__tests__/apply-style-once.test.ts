import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let core: typeof import("@/core");
let apply: typeof import("@/subtitles/apply-style");
let insert: typeof import("@/subtitles/insert");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	apply = await import("@/subtitles/apply-style");
	insert = await import("@/subtitles/insert");
});

function setup() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "c1", name: "C1", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	insert.insertCaptionChunksAsTextTrack({
		editor,
		style: "clean" as never,
		captions: [
			{ text: "Привет это тест", startTime: 0.5, duration: 1.5 },
			{ text: "субтитров и стилей", startTime: 2.2, duration: 1.8 },
		] as never,
	});
	return editor;
}

test("a style's double-click (two clicks while its font loads) restyles the captions in one ⌘Z step; clicking it again adds none", async () => {
	const editor = setup();
	const tracks = () => JSON.stringify(editor.scenes.getActiveScene().tracks);
	const before = tracks();
	const depth = editor.command.depth();
	await Promise.all([apply.applyCaptionStyle({ editor, styleId: "karaoke", scope: "all" }), apply.applyCaptionStyle({ editor, styleId: "karaoke", scope: "all" })]);
	expect(tracks()).not.toBe(before);
	expect(editor.command.depth()).toBe(depth + 1);
	expect(await apply.applyCaptionStyle({ editor, styleId: "karaoke", scope: "all" })).toBeGreaterThan(0);
	expect(editor.command.depth()).toBe(depth + 1);
	editor.command.undo();
	expect(tracks()).toBe(before);
});
