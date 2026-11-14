import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

// Seeing what you cut (two-up.ts): which two frames the player shows for each trim — the clip, the file and the frame
// of the file — on the tracks as the trim leaves them.
let twoUp: typeof import("../two-up");
let core: typeof import("../core");

beforeAll(async () => {
	await installOpenCutWasm();
	twoUp = await import("../two-up");
	core = await import("../core");
}, 120_000);

const F = 4800;
const fps = { numerator: 25, denominator: 1 };
const clip = (id: string, start: number, length: number, trim: number, type = "video"): TimelineElement =>
	({ id, name: id, type, ...(type === "text" ? {} : { mediaId: `m-${id}`, sourceDuration: 400 * F }), startTime: start * F, duration: length * F, trimStart: trim * F, trimEnd: type === "text" ? 0 : (400 - trim - length) * F, params: {} }) as unknown as TimelineElement;
const scene = (main: TimelineElement[], overlay: TimelineElement[] = []): SceneTracks =>
	({ overlay: [{ id: "o", name: "O", type: "video", elements: overlay, muted: false, hidden: false }], main: { id: "main", name: "Main", type: "video", elements: main, muted: false, hidden: false }, audio: [] }) as unknown as SceneTracks;
/** «clip@frame of its file» for each pane. */
const panes = (view: ReturnType<typeof twoUp.twoUpOf>) => (view ? [view.left, view.right].map((pane) => (pane ? `${pane.elementId}@${pane.kind === "video" ? pane.sourceTicks / F : pane.kind}` : null)) : null);
const film = () => scene([clip("a", 0, 100, 10), clip("b", 100, 100, 50), clip("c", 200, 100, 20)]);

describe("the two frames of a trim", () => {
	test("a roll: the last frame going out and the first coming in, as the cut stands now", () => {
		const tracks = film();
		const target = { kind: "roll", trackId: "main", leftId: "a", rightId: "b" } as const;
		// a shows its file's frames 10…109: the last is 109; b starts on its frame 50
		expect(panes(twoUp.twoUpOf({ tracks, target, frame: F }))).toEqual(["a@109", "b@50"]);
		const rolled = core.planTrim({ tracks, target, fps })?.apply(12 * F).tracks as SceneTracks;
		expect(panes(twoUp.twoUpOf({ tracks: rolled, target, frame: F }))).toEqual(["a@121", "b@62"]);
		const view = twoUp.twoUpOf({ tracks: rolled, target, frame: F });
		expect([view?.leftLabel, view?.rightLabel, view?.left?.mediaId, view?.left?.sourceSeconds]).toEqual(["Outgoing", "Incoming", "m-a", 121 / 25]);
	});

	test("an edge: the trimmed clip's frame and its neighbour's on the other side of the cut", () => {
		const tracks = film();
		const tail = { kind: "ripple", trackId: "main", elementId: "a", side: "right" } as const;
		const shorter = core.planTrim({ tracks, target: tail, fps })?.apply(-30 * F).tracks as SceneTracks;
		expect(panes(twoUp.twoUpOf({ tracks: shorter, target: { kind: "edge", trackId: "main", elementId: "a", side: "right", closes: true }, frame: F }))).toEqual(["a@79", "b@50"]);
		const head = { kind: "ripple", trackId: "main", elementId: "b", side: "left" } as const;
		const cut = core.planTrim({ tracks, target: head, fps })?.apply(20 * F).tracks as SceneTracks;
		expect(panes(twoUp.twoUpOf({ tracks: cut, target: { kind: "edge", trackId: "main", elementId: "b", side: "left", closes: true }, frame: F }))).toEqual(["a@109", "b@70"]);
		// the last clip's tail has nothing coming in; a gap after a clip is nothing coming in unless the trim closes it
		expect(panes(twoUp.twoUpOf({ tracks, target: { kind: "edge", trackId: "main", elementId: "c", side: "right", closes: true }, frame: F }))).toEqual(["c@119", null]);
		const gap = scene([], [clip("p", 0, 40, 5), clip("q", 60, 40, 0)]);
		expect(panes(twoUp.twoUpOf({ tracks: gap, target: { kind: "edge", trackId: "o", elementId: "p", side: "right", closes: false }, frame: F }))).toEqual(["p@44", null]);
		expect(panes(twoUp.twoUpOf({ tracks: gap, target: { kind: "edge", trackId: "o", elementId: "p", side: "right", closes: true }, frame: F }))).toEqual(["p@44", "q@0"]);
	});

	test("a slip: the clip's own new first and last frames; a slide: the neighbours' frames at its two cuts", () => {
		const tracks = film();
		const slip = { kind: "slip", trackId: "main", elementId: "b" } as const;
		const slipped = core.planTrim({ tracks, target: slip, fps })?.apply(17 * F).tracks as SceneTracks;
		const view = twoUp.twoUpOf({ tracks: slipped, target: slip, frame: F });
		expect([panes(view), view?.leftLabel, view?.rightLabel]).toEqual([["b@33", "b@132"], "First frame", "Last frame"]);
		const slide = { kind: "slide", trackId: "main", elementId: "b" } as const;
		const slid = core.planTrim({ tracks, target: slide, fps })?.apply(-15 * F).tracks as SceneTracks;
		// a is 85 long now (frames 10…94), c starts 15 frames earlier in its file
		expect(panes(twoUp.twoUpOf({ tracks: slid, target: slide, frame: F }))).toEqual(["a@94", "c@5"]);
	});

	test("a clip at 2× shows the file's frame it really ends on; titles alone show nothing", () => {
		const fast = { ...clip("b", 100, 100, 50), trimEnd: (400 - 50 - 200) * F, retime: { rate: 2 } } as unknown as TimelineElement;
		const tracks = scene([clip("a", 0, 100, 10), fast, clip("c", 200, 100, 20)]);
		// b's last frame is 99 frames in at 2×: 198 file frames after its first
		expect(panes(twoUp.twoUpOf({ tracks, target: { kind: "roll", trackId: "main", leftId: "b", rightId: "c" }, frame: F }))).toEqual(["b@248", "c@20"]);
		const titles = scene([], [clip("x", 0, 40, 0, "text"), clip("y", 40, 40, 0, "text")]);
		expect(twoUp.twoUpOf({ tracks: titles, target: { kind: "roll", trackId: "o", leftId: "x", rightId: "y" }, frame: F })).toBeNull();
		// a title beside a picture: the picture's pane shows, the title's names it
		const mixed = scene([], [clip("x", 0, 40, 0, "text"), clip("p", 40, 40, 7)]);
		expect(panes(twoUp.twoUpOf({ tracks: mixed, target: { kind: "roll", trackId: "o", leftId: "x", rightId: "p" }, frame: F }))).toEqual(["x@none", "p@7"]);
	});
});
