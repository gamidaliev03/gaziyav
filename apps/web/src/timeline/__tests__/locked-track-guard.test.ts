// tlc2, register A1: a locked track takes no edit by ANY path — the history refuses a step that changes it.
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let core: typeof import("@/core");
let elements: typeof import("@/timeline/element-utils");
let wasm: typeof import("@/wasm");
let lock: typeof import("@/timeline/track-lock");
let edits: typeof import("@/actions/timeline-edits");
let tracksEdit: typeof import("@/actions/tracks-edit-command");
let split: typeof import("@/commands/timeline/element/split-elements");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	lock = await import("@/timeline/track-lock");
	edits = await import("@/actions/timeline-edits");
	tracksEdit = await import("@/actions/tracks-edit-command");
	split = await import("@/commands/timeline/element/split-elements");
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
			metadata: { id: "lk", name: "lk", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	editor.command.isRippleEnabled = false;
	for (const [start, name] of [[0, "a"], [4, "b"]] as const) {
		const element = elements.buildElementFromMedia({ mediaId: `m-${name}`, mediaType: "video", name, duration: sec(4), startTime: sec(start) });
		editor.timeline.insertElement({
			element: { ...element, sourceDuration: sec(10), trimStart: sec(0), trimEnd: sec(6) } as never,
			placement: { mode: "explicit", trackId: editor.scenes.getActiveScene().tracks.main.id } as never,
		});
	}
	return editor;
}

describe("a locked track takes no edit", () => {
	test("lockedTracksChanged: nothing locked → nothing; a locked track's clip moved → its id; the same values rebuilt → nothing", () => {
		const editor = setup();
		const before = editor.scenes.getActiveScene().tracks;
		expect(lock.lockedTracksChanged(before, before)).toEqual([]);
		const locked = { ...before, main: { ...before.main, locked: true } };
		const moved = { ...locked, main: { ...locked.main, elements: locked.main.elements.map((e, i) => (i === 1 ? { ...e, startTime: e.startTime + 1 } : e)) } };
		expect(lock.lockedTracksChanged(locked as never, moved as never)).toEqual([before.main.id]);
		const rebuilt = { ...locked, main: { ...locked.main, elements: locked.main.elements.map((e) => ({ ...e })) } };
		expect(lock.lockedTracksChanged(locked as never, rebuilt as never)).toEqual([]);
	});
	test("split, a tracks edit (nudge) and a trim on the locked main track are refused: the same tracks, no step", () => {
		const editor = setup();
		const mainId = editor.scenes.getActiveScene().tracks.main.id;
		lock.toggleTrackLock(editor, mainId);
		const depth = editor.command.depth();
		const state = JSON.stringify(editor.scenes.getActiveScene().tracks);
		const [a, b] = editor.scenes.getActiveScene().tracks.main.elements;
		// Q / W / ⌘B's command, whatever the caller filtered
		editor.command.execute({ command: new split.SplitElementsCommand({ elements: [{ trackId: mainId, elementId: a.id }], splitTime: sec(2), retainSide: "right" } as never) });
		// a tracks edit (nudge, paste, the connector's plans)
		const tracks = editor.scenes.getActiveScene().tracks;
		const after = edits.nudgeElements({ tracks, elements: [{ trackId: mainId, elementId: b.id }], delta: sec(1) });
		if (after) editor.command.execute({ command: new tracksEdit.TracksEditCommand({ before: tracks, after, selection: [] }) });
		// a trim by the inspector / the keys
		editor.timeline.updateElements({ updates: [{ trackId: mainId, elementId: b.id, patch: { duration: sec(1) } as never }] });
		expect(JSON.stringify(editor.scenes.getActiveScene().tracks)).toBe(state);
		expect(editor.command.depth()).toBe(depth);
	});
	test("unlocked again, the same edit goes through as one step", () => {
		const editor = setup();
		const mainId = editor.scenes.getActiveScene().tracks.main.id;
		lock.toggleTrackLock(editor, mainId);
		lock.toggleTrackLock(editor, mainId);
		const depth = editor.command.depth();
		const b = editor.scenes.getActiveScene().tracks.main.elements[1];
		editor.timeline.updateElements({ updates: [{ trackId: mainId, elementId: b.id, patch: { duration: sec(1) } as never }] });
		expect(editor.scenes.getActiveScene().tracks.main.elements[1].duration).toBe(sec(1));
		expect(editor.command.depth()).toBe(depth + 1);
	});
});
