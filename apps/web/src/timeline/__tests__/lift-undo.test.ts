// undofix (14.11): Lift (;) over the magnetic main row — the shape of pro-core section I — then ⌘Z / ⇧⌘Z. A film in the
// main row (two clips), a layer above it, a sound below it (plain, or a song fitted to the film: place rule D), markers,
// the magnet on, In–Out 2–4 s: Lift leaves a gap clip of the range's length (tlmove rule 3), nothing after it moves;
// ⌘Z gives back the tracks, the markers, the fitted set and the magnet exactly; ⇧⌘Z makes the lift again exactly.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let core: typeof import("@/core");
let elements: typeof import("@/timeline/element-utils");
let wasm: typeof import("@/wasm");
let inv: typeof import("@/timeline/invariants");
let gaps: typeof import("@/timeline/gaps");
let fit: typeof import("@/timeline/placement/fit-film");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	inv = await import("@/timeline/invariants");
	gaps = await import("@/timeline/gaps");
	fit = await import("@/timeline/placement/fit-film");
	const storage = await import("@/services/storage/service");
	(storage.storageService as unknown as Record<string, unknown>).saveProject = async () => {};
});

const FPS = { numerator: 25, denominator: 1 };
const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });

const scope = globalThis as typeof globalThis & { __gaziyavInvariants?: boolean; __gaziyavInvariantViolations?: unknown[] };
// the audit stays a test-run switch of this file: the other files of the same bun run never see it on
afterAll(() => {
	delete scope.__gaziyavInvariants;
	delete scope.__gaziyavInvariantViolations;
});
const auditFound = async () => {
	await new Promise((resolve) => setTimeout(resolve, 30));
	return scope.__gaziyavInvariantViolations ?? [];
};

function setup() {
	const { EditorCore } = core;
	EditorCore.reset();
	// the product's own audit (core/managers/timeline-audit.ts): undo-exact / redo-exact and every invariant, as in test runs
	scope.__gaziyavInvariants = true;
	scope.__gaziyavInvariantViolations = [];
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "lu", name: "lu", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: FPS, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	(editor.media as unknown as { getAssets: () => unknown[] }).getAssets = () => [];
	return editor;
}
type Editor = ReturnType<typeof setup>;

function put(editor: Editor, kind: "video" | "image" | "audio", trackId: string | null, start: number, length: number, source: number, params?: Record<string, unknown>) {
	const element = elements.buildElementFromMedia({ mediaId: `m-${kind}`, mediaType: kind, name: kind, duration: sec(length), startTime: sec(start) });
	editor.timeline.insertElement({
		element: { ...element, sourceDuration: sec(source), trimStart: 0, trimEnd: sec(source - length), ...(params ? { params: { ...(element as { params?: object }).params, ...params } } : {}) } as never,
		placement: (trackId ? { mode: "explicit", trackId } : { mode: "auto", trackType: kind === "audio" ? "audio" : "video", newTrack: true }) as never,
	});
}

/** The section-I timeline: film 0–2 s + 2–8 s (frames 0–50, 50–200), a picture above at 1–3 s, a sound below from 2 s. */
function build(editor: Editor, fitted: boolean) {
	const main = editor.scenes.getActiveScene().tracks.main.id;
	put(editor, "video", main, 0, 2, 6);
	put(editor, "video", main, 2, 6, 6);
	put(editor, "image", null, 1, 2, 2);
	// a fitted song ends where the film ends (library/client.ts cutToVideoEnd); a plain one is the file's length
	put(editor, "audio", null, fitted ? 0 : 2, fitted ? 8 : 3.04, 20, fitted ? { fitFilm: true, fadeOut: 1 } : undefined);
	const { ToggleBookmarkCommand } = require("@/commands/scene/toggle-bookmark") as typeof import("@/commands/scene/toggle-bookmark");
	for (const at of [1, 3, 6]) editor.command.execute({ command: new ToggleBookmarkCommand(sec(at)) });
	editor.command.isRippleEnabled = true;
}

const key = (editor: Editor) => inv.timelineStateKey(editor.scenes.getActiveScene());
const fittedSet = (editor: Editor) => JSON.stringify([...fit.snapshotFitted(editor.scenes.getActiveScene().tracks)]);
const view = (editor: Editor) => {
	const t = editor.scenes.getActiveScene().tracks;
	return [t.main, ...t.overlay, ...t.audio].map((track) => track.elements.map((e) => `${e.startTime / sec(0.04)}+${e.duration / sec(0.04)}${gaps.isGapClip(e) ? "g" : ""}`).join(",")).join(" | ");
};

for (const fitted of [false, true]) {
	describe(`Lift 2–4 s over the magnetic row, ${fitted ? "a song fitted to the film" : "a plain sound"} below`, () => {
		test("leaves a gap clip of the range's length; ⌘Z gives everything back; ⇧⌘Z makes it again — exactly", async () => {
			const editor = setup();
			build(editor, fitted);
			const k0 = key(editor);
			const f0 = fittedSet(editor);
			const d0 = editor.command.depth();
			const v0 = view(editor);
			gaps.liftOrExtractRange({ editor, range: { start: sec(2), end: sec(4) }, closeGap: false });
			const v1 = view(editor);
			// one step; the gap clip stands where the range was and nothing after it moved (tlmove rule 3)
			expect(editor.command.depth()).toBe(d0 + 1);
			expect(v1.split(" | ")[0]).toBe("0+50,50+50g,100+100");
			expect(v1.split(" | ")[1]).toBe("25+25");
			expect(editor.command.isRippleEnabled).toBe(true);
			const k1 = key(editor);
			const f1 = fittedSet(editor);
			editor.command.undo();
			expect(view(editor)).toBe(v0);
			expect(key(editor)).toBe(k0);
			expect(fittedSet(editor)).toBe(f0);
			expect(editor.command.isRippleEnabled).toBe(true);
			editor.command.redo();
			expect(key(editor)).toBe(k1);
			expect(fittedSet(editor)).toBe(f1);
			editor.command.undo();
			expect(key(editor)).toBe(k0);
			expect(await auditFound()).toEqual([]);
		});

		test("pro-core's own order: Lift with the magnet on, P, Lift, ⌘Z, Extract, ⌘Z, ⌘Z — back to the start", async () => {
			const editor = setup();
			build(editor, fitted);
			const k0 = key(editor);
			const f0 = fittedSet(editor);
			const range = { start: sec(2), end: sec(4) };
			gaps.liftOrExtractRange({ editor, range, closeGap: false });
			const k1 = key(editor);
			editor.command.isRippleEnabled = false; // P: the magnet button is no step (O1)
			gaps.liftOrExtractRange({ editor, range, closeGap: false });
			editor.command.undo();
			expect(key(editor)).toBe(k1);
			expect(editor.command.isRippleEnabled).toBe(false);
			gaps.liftOrExtractRange({ editor, range, closeGap: true });
			editor.command.undo();
			expect(key(editor)).toBe(k1);
			editor.command.undo();
			expect(key(editor)).toBe(k0);
			expect(fittedSet(editor)).toBe(f0);
			expect(editor.command.isRippleEnabled).toBe(true);
			expect(await auditFound()).toEqual([]);
		});
	});
}

describe("a song fitted to the film on a locked track (found by the engine fuzz with fitted songs, undofix 14.11)", () => {
	test("a step that shortens the film leaves it as it is; ⌘Z gives the start back", async () => {
		const editor = setup();
		build(editor, true);
		const { toggleTrackLock } = require("@/timeline/track-lock") as typeof import("@/timeline/track-lock");
		const t0 = editor.scenes.getActiveScene().tracks;
		toggleTrackLock(editor as never, t0.audio[0].id);
		const k0 = key(editor);
		const song = () => JSON.stringify(editor.scenes.getActiveScene().tracks.audio[0].elements);
		const s0 = song();
		const main = editor.scenes.getActiveScene().tracks.main;
		editor.timeline.deleteElements({ elements: [{ trackId: main.id, elementId: main.elements[1].id }] });
		expect(editor.scenes.getActiveScene().tracks.main.elements.length).toBe(1);
		expect(song()).toBe(s0);
		editor.command.undo();
		expect(key(editor)).toBe(k0);
		expect(await auditFound()).toEqual([]);
	});
});
