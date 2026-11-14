import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { DragLanding, SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";

// Selections dragged by mouse (testers 05.11): two photos or two captions of one track went to new tracks one each
// (each counted the other as in the way); a photo with a sound showed a new-track line and didn't move; a main clip
// dragged with a photo showed its ghost at 9 s and stayed at 8 s (the magnet); a ⌥ copy's ghost sat on its own row over
// the original while the copy landed on a new track. The real controller is driven here with mouse events and the
// drop is committed by the editor, so the ghost (landing, line) is checked against where the clips really are.
type Controller = typeof import("@/timeline/controllers/element-interaction-controller");
let controllerModule: Controller;
let core: typeof import("@/core");
let wasm: typeof import("@/wasm");
let layout: typeof import("@/timeline/components/track-layout");
let altDrag: typeof import("@/actions/alt-drag-duplicate");
let invariants: typeof import("@/timeline/invariants");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	wasm = await import("@/wasm");
	layout = await import("@/timeline/components/track-layout");
	altDrag = await import("@/actions/alt-drag-duplicate");
	invariants = await import("@/timeline/invariants");
	controllerModule = await import("@/timeline/controllers/element-interaction-controller");
	// The controller listens on the document for the drag's mouse events; set after the imports (a library that finds a
	// document at load time wants a real one) and taken away after these tests.
	globals.document = new EventTarget();
});
const globals = globalThis as { document?: unknown };
const hadDocument = "document" in globalThis;
afterAll(() => {
	if (!hadDocument) delete globals.document;
});

const PX_PER_S = 50;
const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });
const s = (t: number) => Math.round((t / wasm.TICKS_PER_SECOND) * 100) / 100;

function element(id: string, type: "image" | "video" | "text" | "audio", start: number, length: number): TimelineElement {
	const base = { id, name: id, startTime: sec(start), duration: sec(length), trimStart: 0, trimEnd: 0 };
	if (type === "text") return { ...base, type, params: {} } as unknown as TimelineElement;
	if (type === "audio") return { ...base, type, sourceType: "upload", mediaId: `m-${id}`, volume: 1, params: {} } as unknown as TimelineElement;
	return { ...base, type, mediaId: `m-${id}`, params: {}, ...(type === "video" ? { sourceDuration: sec(60) } : {}) } as unknown as TimelineElement;
}
function track(id: string, type: TimelineTrack["type"], elements: TimelineElement[]): TimelineTrack {
	return { id, name: id, type, muted: false, hidden: false, elements } as unknown as TimelineTrack;
}

/** O0: photos p1 @1 and p2 @7 (5 s); T0: captions m0 @1.5, m1 @3.5, m2 @8, m3 @10 (1.5 s); main: c1 @0, c2 @8 (8 s);
 * A0: a tone @0 (10 s). */
function scene(): SceneTracks {
	return {
		overlay: [
			track("O0", "video", [element("p1", "image", 1, 5), element("p2", "image", 7, 5)]),
			track("T0", "text", [element("m0", "text", 1.5, 1.5), element("m1", "text", 3.5, 1.5), element("m2", "text", 8, 1.5), element("m3", "text", 10, 1.5)]),
		],
		main: track("main", "video", [element("c1", "video", 0, 8), element("c2", "video", 8, 8)]),
		audio: [track("A0", "audio", [element("tone", "audio", 0, 10)])],
	} as unknown as SceneTracks;
}

function setupEditor(tracks: SceneTracks, magnet: boolean) {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const made = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "group-drag", name: "Group drag", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [made],
			currentSceneId: made.id,
			settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [made], activeSceneId: made.id });
	editor.timeline.updateTracks(tracks);
	editor.command.isRippleEnabled = magnet;
	return editor;
}

const display = (tracks: SceneTracks) => [...tracks.overlay, tracks.main, ...tracks.audio];
const rect = (top: number, height: number) => ({ left: 0, top, right: 4000, bottom: top + height, width: 4000, height, x: 0, y: top }) as DOMRect;

/** Press `anchor` at half a second into it, drag `by` seconds along its row (or onto `row`), release. */
function drag({
	tracks,
	selected,
	anchor,
	by,
	copy = false,
	magnet = true,
	altAfterMove,
}: {
	tracks: SceneTracks;
	selected: string[];
	anchor: string;
	by: number;
	copy?: boolean;
	magnet?: boolean;
	/** ⌥ pressed after the pointer stopped (no move after it). */
	altAfterMove?: boolean;
}) {
	const editor = setupEditor(tracks, magnet);
	const rows = display(tracks);
	const rowTop = (index: number) => layout.getCumulativeHeightBefore({ tracks: rows, trackIndex: index });
	const refOf = (id: string) => {
		const owner = rows.find((t) => t.elements.some((e) => e.id === id));
		if (!owner) throw new Error(id);
		return { trackId: owner.id, elementId: id };
	};
	const anchorRef = refOf(anchor);
	const anchorTrackIndex = rows.findIndex((t) => t.id === anchorRef.trackId);
	const anchorElement = rows[anchorTrackIndex].elements.find((e) => e.id === anchor) as TimelineElement;
	const scroll = { getBoundingClientRect: () => rect(0, 2000), scrollLeft: 0, scrollTop: 0 } as unknown as HTMLDivElement;
	let isCopy = copy;
	const view = () => controller.view;
	const deps = {
		viewport: { getZoomLevel: () => 1, getTracksScrollEl: () => scroll, getTracksContainerEl: () => scroll, getHeaderEl: () => null },
		input: { isShiftHeld: () => false },
		scene: { getTracks: () => editor.scenes.getActiveScene().tracks, getActiveFps: () => ({ numerator: 30, denominator: 1 }) },
		selection: {
			getSelected: () => selected.map(refOf),
			isSelected: (ref: { elementId: string }) => selected.includes(ref.elementId),
			groupOf: (ref: { trackId: string; elementId: string }) => [ref],
			select: () => {},
			handleClick: () => {},
			clearKeyframeSelection: () => {},
		},
		playback: { getCurrentTime: () => sec(0) },
		timeline: { moveElements: (args: Parameters<typeof altDrag.moveOrDuplicateOnAltDrag>[0]) => altDrag.moveOrDuplicateOnAltDrag({ ...args, editor, duplicate: isCopy }) },
		snap: { isEnabled: () => false },
		magnet: {
			getTrackId: () => (editor.command.isRippleEnabled ? editor.scenes.getActiveScene().tracks.main.id : null),
			getTrackRowRect: () => {
				const index = tracks.overlay.length;
				return rect(rowTop(index), layout.getTrackHeight({ type: "video" }));
			},
			isCopy: () => isCopy,
			preview: () => {},
			discardPreview: () => {},
			commit: () => {
				throw new Error("not a main-track reorder");
			},
		},
	};
	const controller = new controllerModule.ElementInteractionController({ depsRef: { current: deps as never } });
	const y = rowTop(anchorTrackIndex) + layout.getTrackHeight({ type: rows[anchorTrackIndex].type }) / 2;
	const x = (s(anchorElement.startTime) + 0.5) * PX_PER_S;
	const mouse = (type: string, clientX: number) => document.dispatchEvent(Object.assign(new Event(type), { clientX, clientY: y }));
	controller.onElementMouseDown({
		event: { button: 0, clientX: x, clientY: y, stopPropagation: () => {}, currentTarget: scroll } as never,
		element: anchorElement,
		track: rows[anchorTrackIndex],
	});
	mouse("mousemove", x + by * PX_PER_S);
	if (altAfterMove !== undefined) {
		isCopy = altAfterMove;
		document.dispatchEvent(new Event("keydown"));
	}
	const shown = view();
	if (shown.kind !== "dragging") throw new Error("no drag");
	const landing = shown.landing;
	const line = shown.dropTarget?.isNewTrack ? shown.dropTarget.trackIndex : null;
	mouse("mouseup", x + by * PX_PER_S);
	return { before: tracks, after: editor.scenes.getActiveScene().tracks, landing, line, copy: isCopy };
}

/** Where a landing spot really is after the drop: [row (an existing track's id, or `new@<line>`), start s]. */
function landed({ before, after, copy }: { before: SceneTracks; after: SceneTracks; copy: boolean }, elementId: string): [string, number] {
	const oldIds = new Set(display(before).map((t) => t.id));
	const oldElementIds = new Set(display(before).flatMap((t) => t.elements.map((e) => e.id)));
	const rows = display(after);
	for (const [index, row] of rows.entries()) {
		// a ⌥ copy: the new clip with the original's name
		const hit = row.elements.find((e) => (copy ? !oldElementIds.has(e.id) && e.name === elementId : e.id === elementId));
		if (!hit) continue;
		const where = oldIds.has(row.id) ? row.id : `new@${rows.slice(0, index).filter((t) => oldIds.has(t.id)).length}`;
		return [where, s(hit.startTime)];
	}
	throw new Error(`${elementId} not found`);
}
const shownAt = (spot: DragLanding): [string, number] => [spot.newTrackAt === undefined ? spot.trackId : `new@${spot.newTrackAt}`, s(spot.startTime)];

function expectGhostIsResult(result: ReturnType<typeof drag>, expected: Record<string, [string, number]>) {
	const shown = Object.fromEntries(result.landing.map((spot) => [spot.elementId, shownAt(spot)]));
	expect(shown).toEqual(expected);
	const real = Object.fromEntries(Object.keys(expected).map((id) => [id, landed(result, id)]));
	expect(real).toEqual(expected);
	const overlaps = invariants.checkTimelineInvariants({ tracks: result.after, magnet: false }).filter((v) => v.rule === "no-overlap");
	expect(overlaps).toEqual([]);
}

describe("a selection dragged by mouse lands where its ghost is", () => {
	test("two photos of one track, +1.5 s: both stay on it together, no new-track line", () => {
		const result = drag({ tracks: scene(), selected: ["p1", "p2"], anchor: "p1", by: 1.5 });
		expectGhostIsResult(result, { p1: ["O0", 2.5], p2: ["O0", 8.5] });
		expect(result.line).toBeNull();
	});

	test("two captions of one track, +1 s along it: both stay on it (one new track each before)", () => {
		const result = drag({ tracks: scene(), selected: ["m0", "m1"], anchor: "m0", by: 1 });
		expectGhostIsResult(result, { m0: ["T0", 2.5], m1: ["T0", 4.5] });
		expect(result.line).toBeNull();
	});

	for (const anchor of ["tone", "p2"]) {
		test(`a photo and a sound, +1.5 s (pressed on ${anchor}): each moves on its own track`, () => {
			const result = drag({ tracks: scene(), selected: ["p2", "tone"], anchor, by: 1.5 });
			expectGhostIsResult(result, { p2: ["O0", 8.5], tone: ["A0", 1.5] });
			expect(result.line).toBeNull();
		});
	}

	test("a photo that would overlap the other photo, with a sound: the photo opens a new track above its row, shown", () => {
		const result = drag({ tracks: scene(), selected: ["p1", "tone"], anchor: "tone", by: 1.5 });
		expectGhostIsResult(result, { p1: ["new@0", 2.5], tone: ["A0", 1.5] });
		expect(result.line).toBe(0);
	});

	test("a photo and main clip 2, +1 s, magnet on: the ghost shows the main clip back at its cut, where it stays", () => {
		const result = drag({ tracks: scene(), selected: ["p1", "c2"], anchor: "p1", by: 1 });
		expectGhostIsResult(result, { p1: ["O0", 2], c2: ["main", 8] });
	});

	test("the same with the magnet off: the main clip moves as shown", () => {
		const result = drag({ tracks: scene(), selected: ["p1", "c2"], anchor: "p1", by: 1, magnet: false });
		expectGhostIsResult(result, { p1: ["O0", 2], c2: ["main", 9] });
	});

	test("⌥-drag of a photo +3 s over its original: the ghost is on the new track the copy goes to", () => {
		const result = drag({ tracks: scene(), selected: ["p2"], anchor: "p2", by: 3, copy: true });
		const [spot] = result.landing;
		expect(spot.newTrackAt).toBeDefined();
		expect(result.line).toBe(spot.newTrackAt ?? -1);
		expectGhostIsResult(result, { p2: [`new@${spot.newTrackAt}`, 10] });
		expect(landed({ ...result, copy: false }, "p2")).toEqual(["O0", 7]);
	});

	test("the same drag without ⌥ moves the photo on its row", () => {
		const result = drag({ tracks: scene(), selected: ["p2"], anchor: "p2", by: 3 });
		expectGhostIsResult(result, { p2: ["O0", 10] });
		expect(result.line).toBeNull();
	});

	test("⌥ pressed while the pointer stands still re-plans the ghost, and the drop follows it", () => {
		const result = drag({ tracks: scene(), selected: ["p2"], anchor: "p2", by: 3, altAfterMove: true });
		const [spot] = result.landing;
		expect(spot.newTrackAt).toBeDefined();
		expectGhostIsResult(result, { p2: [`new@${spot.newTrackAt}`, 10] });
	});
});

describe("resolveGroupMove: one track per track the clips came from", () => {
	let resolve: typeof import("@/timeline/group-move").resolveGroupMove;
	let build: typeof import("@/timeline/group-move").buildMoveGroup;
	beforeAll(async () => {
		({ resolveGroupMove: resolve, buildMoveGroup: build } = await import("@/timeline/group-move"));
	});
	const plan = (selected: [string, string][], anchorIndex: number, target: Parameters<typeof resolve>[0]["target"], by = 1) => {
		const tracks = scene();
		const refs = selected.map(([trackId, elementId]) => ({ trackId, elementId }));
		const group = build({ anchorRef: refs[anchorIndex], selectedElements: refs, tracks });
		if (!group) throw new Error("no group");
		const anchor = display(tracks).flatMap((t): TimelineElement[] => t.elements).find((e) => e.id === refs[anchorIndex].elementId) as TimelineElement;
		return resolve({ group, tracks, anchorStartTime: sec(s(anchor.startTime) + by), target, newTrackIds: ["n1", "n2", "n3"] });
	};

	test("two captions of one row onto a new track share it (they got one each)", () => {
		const result = plan([["T0", "m0"], ["T0", "m1"]], 0, { kind: "newTracks", anchorInsertIndex: 0 });
		expect(result?.createTracks).toEqual([{ id: "n1", type: "text", index: 0 }]);
		expect(result?.moves.map((m) => [m.elementId, m.targetTrackId, s(m.newStartTime)])).toEqual([["m0", "n1", 2.5], ["m1", "n1", 4.5]]);
	});

	test("a stack of two rows opens at the drop line, in its order", () => {
		const result = plan([["O0", "p1"], ["T0", "m0"]], 1, { kind: "newTracks", anchorInsertIndex: 2 });
		expect(result?.createTracks).toEqual([{ id: "n1", type: "video", index: 2 }, { id: "n2", type: "text", index: 3 }]);
	});

	test("a photo onto a new track with a sound: the sound moves in time on its own track (the plan was refused)", () => {
		const result = plan([["O0", "p1"], ["A0", "tone"]], 0, { kind: "newTracks", anchorInsertIndex: 0 });
		expect(result?.createTracks).toEqual([{ id: "n1", type: "video", index: 0 }]);
		expect(result?.moves.map((m) => [m.elementId, m.targetTrackId, s(m.newStartTime)])).toEqual([["p1", "n1", 2], ["tone", "A0", 1]]);
	});
});
