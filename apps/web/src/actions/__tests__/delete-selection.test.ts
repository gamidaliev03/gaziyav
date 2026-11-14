import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// Regression for the release-gate data-loss report: ⌫ removed all 296 clips.
// Delete must act on the selection the editor has *now*, never on an older copy.
let core: typeof import("@/core");
let del: typeof import("@/actions/delete-selection");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	del = await import("@/actions/delete-selection");
});

async function build296() {
	const { EditorCore } = core;
	const { buildDefaultScene } = await import("@/timeline/scenes");
	const { buildElementFromMedia } = await import("@/timeline/element-utils");
	const { mediaTime, TICKS_PER_SECOND } = await import("@/wasm");
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width: 1080, height: 1920 },
			},
			version: 31,
		} as never,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	const d = 8 * TICKS_PER_SECOND;
	for (let i = 0; i < 74; i++) {
		editor.timeline.insertElement({
			element: buildElementFromMedia({
				mediaId: "m",
				mediaType: "video",
				name: "clip.mp4",
				duration: mediaTime({ ticks: d }),
				startTime: mediaTime({ ticks: i * d }),
			}),
			placement: { mode: "auto" },
		});
	}
	const main = () => editor.scenes.getActiveScene().tracks.main;
	for (const e of main().elements.slice()) {
		for (let k = 1; k < 4; k++) {
			const at = e.startTime + Math.round((e.duration * k) / 4);
			const cur = main().elements.find(
				(x) => x.startTime < at && x.startTime + x.duration > at,
			);
			if (cur) {
				editor.timeline.splitElements({
					elements: [{ trackId: main().id, elementId: cur.id }],
					splitTime: mediaTime({ ticks: at }),
				});
			}
		}
	}
	return { editor, main };
}

describe("⌫ deletes only the live selection", () => {
	test("select all, then click one clip: ⌫ removes exactly that clip (plain and ripple)", async () => {
		for (const ripple of [false, true]) {
			const { editor, main } = await build296();
			expect(main().elements.length).toBe(296);
			const all = main().elements.map((e) => ({ trackId: main().id, elementId: e.id }));
			// A stale handler would still hold this list.
			editor.selection.setSelectedElements({ elements: all });
			// The user clicks one clip.
			editor.selection.setSelectedElements({ elements: [all[5]] });
			expect(del.deleteLiveSelection({ editor, ripple })).toBe(1);
			expect(main().elements.length).toBe(295);
			editor.command.undo();
			expect(main().elements.length).toBe(296);
			editor.command.redo();
			expect(main().elements.length).toBe(295);
		}
	});

	test("nothing selected: ⌫ removes nothing", async () => {
		const { editor, main } = await build296();
		editor.selection.clearSelection();
		expect(del.deleteLiveSelection({ editor })).toBe(0);
		expect(main().elements.length).toBe(296);
	});

	test("the selection is copied, so a caller mutating its array can't widen a delete", async () => {
		const { editor, main } = await build296();
		const one = [{ trackId: main().id, elementId: main().elements[0].id }];
		editor.selection.setSelectedElements({ elements: one });
		const snapshot = del.liveSelectedElements(editor);
		one.push(
			...main().elements.slice(1).map((e) => ({ trackId: main().id, elementId: e.id })),
		);
		expect(snapshot.length).toBe(1);
	});
});
