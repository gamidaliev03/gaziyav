import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "./wasm-setup";

// ⌘C / ⌘V never lays a clip over another on one track (the user, 03.11: «один клип сквозь другого»; release-1065 saw a
// video and a photo overlap after a paste): with the magnet the main-track copy goes in at a cut, the rest move on;
// without it, or on an overlay track, a busy place sends the copy to a free track. ⌘Z gives the timeline back.
type Core = typeof import("@/core");
type Elements = typeof import("@/timeline/element-utils");
type Cmds = typeof import("@/commands/timeline");
type Wasm = typeof import("@/wasm");
type Invariants = typeof import("@/timeline/invariants");

let core: Core;
let elements: Elements;
let cmds: Cmds;
let wasm: Wasm;
let invariants: Invariants;

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	cmds = await import("@/commands/timeline");
	wasm = await import("@/wasm");
	invariants = await import("@/timeline/invariants");
	(await import("@/effects/definitions")).registerDefaultEffects();
});

function setupEditor({ magnet }: { magnet: boolean }) {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "paste-project", name: "Paste", createdAt: new Date(0), updatedAt: new Date(0) },
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
	editor.command.isRippleEnabled = magnet;
	return editor;
}

const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });
const tracksOf = (editor: ReturnType<typeof setupEditor>) => editor.scenes.getActiveScene().tracks;
const allTracks = (editor: ReturnType<typeof setupEditor>) => {
	const tracks = tracksOf(editor);
	return [...tracks.overlay, tracks.main, ...tracks.audio];
};

function place(
	editor: ReturnType<typeof setupEditor>,
	{ type, name, start, length, overlay = false }: { type: "video" | "image"; name: string; start: number; length: number; overlay?: boolean },
) {
	const element = elements.buildElementFromMedia({ mediaId: `media-${name}`, mediaType: type, name, duration: sec(length), startTime: sec(start) });
	editor.timeline.insertElement({
		element,
		placement: overlay ? { mode: "auto", trackType: "video", newTrack: true } : { mode: "explicit", trackId: tracksOf(editor).main.id },
	});
	for (const track of allTracks(editor)) {
		const found = track.elements.find((candidate) => candidate.name === name);
		if (found) return { trackId: track.id, trackType: track.type, element: found };
	}
	throw new Error(`${name} was not placed`);
}

/** An effect layer added the way the panel adds one: on a free effect track (a new one above when none). */
function placeEffect(editor: ReturnType<typeof setupEditor>, { name, start, length }: { name: string; start: number; length: number }) {
	const element = { ...elements.buildEffectElement({ effectType: "studio.zoomPunch", startTime: sec(start), duration: sec(length) }), name };
	editor.timeline.insertElement({ element, placement: { mode: "auto", trackType: "effect" } });
	const tracks = tracksOf(editor).overlay;
	for (let index = 0; index < tracks.length; index++) {
		const found = tracks[index].elements.find((candidate) => candidate.name === name);
		if (found) return { trackId: tracks[index].id, trackType: tracks[index].type, element: found };
	}
	throw new Error(`${name} was not placed`);
}

const rowOf = (editor: ReturnType<typeof setupEditor>, name: string) =>
	tracksOf(editor).overlay.findIndex((track) => (track.elements as Array<{ name: string }>).some((element) => element.name === name));

const copyOf = (...placed: Array<ReturnType<typeof place>>) =>
	placed.map(({ trackId, trackType, element }) => {
		const { id: _id, ...rest } = element;
		return { trackId, trackType, element: rest };
	});

function paste(editor: ReturnType<typeof setupEditor>, items: ReturnType<typeof copyOf>, at: number) {
	editor.command.execute({ command: new cmds.PasteCommand({ time: sec(at), clipboardItems: items as never }) });
}

const overlaps = (editor: ReturnType<typeof setupEditor>) =>
	invariants
		.checkTimelineInvariants({ tracks: tracksOf(editor), magnet: editor.command.isRippleEnabled, selection: { selectedElements: [], selectedKeyframes: [] } })
		.filter((violation) => violation.rule === "no-overlap" || violation.rule === "main-no-gap")
		.map((violation) => violation.detail);

const names = (track: { elements: Array<{ name: string; startTime: number }> }) =>
	track.elements
		.slice()
		.sort((a, b) => a.startTime - b.startTime)
		.map((element) => `${element.name}@${element.startTime / wasm.TICKS_PER_SECOND}`);

describe("⌘V never lays a clip over another", () => {
	test("magnet: a main-track copy goes in at the nearest cut, the clips after it move on", () => {
		const editor = setupEditor({ magnet: true });
		const video = place(editor, { type: "video", name: "V", start: 0, length: 5 });
		place(editor, { type: "image", name: "P", start: 5, length: 3 });
		const before = JSON.stringify(tracksOf(editor));
		paste(editor, copyOf(video), 4);
		expect(overlaps(editor)).toEqual([]);
		expect(names(tracksOf(editor).main)).toEqual(["V@0", "V@5", "P@10"]);
		editor.command.undo();
		expect(JSON.stringify(tracksOf(editor))).toBe(before);
	});

	test("no magnet: a copy pasted over a main-track clip goes to a free track", () => {
		const editor = setupEditor({ magnet: false });
		const video = place(editor, { type: "video", name: "V", start: 0, length: 5 });
		place(editor, { type: "image", name: "P", start: 5, length: 3 });
		paste(editor, copyOf(video), 2);
		expect(overlaps(editor)).toEqual([]);
		const all = allTracks(editor).flatMap((track) => track.elements as Array<{ name: string }>);
		expect(all.filter((element) => element.name === "V")).toHaveLength(2);
	});

	test("⌘V of clips copied from the main track and a layer: each keeps its kind of track and its offset", () => {
		const editor = setupEditor({ magnet: true });
		const video = place(editor, { type: "video", name: "V", start: 0, length: 10 });
		const photo = place(editor, { type: "image", name: "P", start: 2, length: 4, overlay: true });
		editor.command.execute({
			command: new cmds.PasteCommand({ time: sec(10), clipboardItems: copyOf(video, photo) as never, targetTrackId: video.trackId, mode: "insert" }),
		});
		expect(overlaps(editor)).toEqual([]);
		expect(names(tracksOf(editor).main)).toEqual(["V@0", "V@10"]);
		const layers = tracksOf(editor).overlay.flatMap((track) => names(track as never));
		expect(layers.sort()).toEqual(["P@12", "P@2"]);
	});

	test("⌘V (insert) off the main track never pushes what is there: a busy spot sends the copy to a free track", () => {
		const editor = setupEditor({ magnet: true });
		place(editor, { type: "video", name: "V", start: 0, length: 20 });
		const photo = place(editor, { type: "image", name: "P", start: 0, length: 4, overlay: true });
		const q = elements.buildElementFromMedia({ mediaId: "media-Q", mediaType: "image", name: "Q", duration: sec(4), startTime: sec(6) });
		editor.timeline.insertElement({ element: q, placement: { mode: "explicit", trackId: photo.trackId } });
		const insert = (at: number) =>
			editor.command.execute({ command: new cmds.PasteCommand({ time: sec(at), clipboardItems: copyOf(photo) as never, targetTrackId: photo.trackId, mode: "insert" }) });
		const own = () => names(tracksOf(editor).overlay.find((track) => track.id === photo.trackId) as never);
		insert(4.5);
		expect(overlaps(editor)).toEqual([]);
		expect(own()).toEqual(["P@0", "Q@6"]);
		insert(11);
		expect(own()).toEqual(["P@0", "Q@6", "P@11"]);
	});

	for (const magnet of [true, false]) {
		test(`${magnet ? "magnet" : "no magnet"}: a photo pasted on its own busy overlay track moves to a free one`, () => {
			const editor = setupEditor({ magnet });
			place(editor, { type: "video", name: "V", start: 0, length: 8 });
			const photo = place(editor, { type: "image", name: "P", start: 0, length: 4, overlay: true });
			place(editor, { type: "video", name: "W", start: 4, length: 4, overlay: true });
			const before = JSON.stringify(tracksOf(editor));
			paste(editor, copyOf(photo), 1);
			expect(overlaps(editor)).toEqual([]);
			editor.command.undo();
			expect(JSON.stringify(tracksOf(editor))).toBe(before);
		});

		test(`${magnet ? "magnet" : "no magnet"}: a video and a photo copied together land without covering anything`, () => {
			const editor = setupEditor({ magnet });
			const video = place(editor, { type: "video", name: "V", start: 0, length: 5 });
			place(editor, { type: "video", name: "X", start: 5, length: 5 });
			const photo = place(editor, { type: "image", name: "P", start: 1, length: 3, overlay: true });
			for (const at of [0, 2, 4.5, 7]) paste(editor, copyOf(video, photo), at);
			expect(overlaps(editor)).toEqual([]);
		});

		// release-1065 / the lead's T14 (03.11): ⌘C/⌘V of two zoomPunch layers left two layers at 0 on one track
		test(`${magnet ? "magnet" : "no magnet"}: effect layers pasted over their own go to free tracks above them, never below`, () => {
			const editor = setupEditor({ magnet });
			place(editor, { type: "video", name: "V", start: 0, length: 10 });
			const first = placeEffect(editor, { name: "E1", start: 0, length: 5 });
			const second = placeEffect(editor, { name: "E2", start: 0, length: 5 });
			expect(rowOf(editor, "E2")).toBeLessThan(rowOf(editor, "E1"));
			const before = JSON.stringify(tracksOf(editor));
			paste(editor, copyOf(first, second), 0);
			expect(overlaps(editor)).toEqual([]);
			// each copy above its original (an effect layer only acts on what is below it: below, it would cover less)
			const rows = tracksOf(editor).overlay.map((track) => track.elements as Array<{ id: string; name: string }>);
			for (const original of [first, second]) {
				const own = rows.findIndex((list) => list.some((element) => element.id === original.element.id));
				const copy = rows.findIndex((list) => list.some((element) => element.name === original.element.name && element.id !== original.element.id));
				expect(copy).toBeGreaterThanOrEqual(0);
				expect(copy).toBeLessThan(own);
			}
			editor.command.undo();
			expect(JSON.stringify(tracksOf(editor))).toBe(before);
		});
	}
});
