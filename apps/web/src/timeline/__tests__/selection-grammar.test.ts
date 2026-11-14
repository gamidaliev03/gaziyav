// tlc2: one grammar for the hand — linked items, ⇧ / ⌘ click, select next / previous.
import { describe, expect, test } from "bun:test";
import type { ElementRef, SceneTracks } from "@/timeline/types";
import { linkedItemIds } from "../linked-items";
import { clickSelection, rangeSelection } from "../selection-click";
import { adjacentClip } from "../selection-step";

const ALL = new Set(["text", "sticker", "effect", "audio", "overlay"] as const);
const clip = (id: string, startTime: number, duration = 10, extra: object = {}) => ({ id, type: "video", name: id, startTime, duration, trimStart: 0, trimEnd: 0, ...extra });
const text = (id: string, startTime: number, duration = 3, extra: object = {}) => ({ id, type: "text", name: id, startTime, duration, ...extra });
const sound = (id: string, startTime: number, duration = 10, extra: object = {}) => ({ id, type: "audio", name: id, sourceType: "upload", startTime, duration, trimStart: 0, trimEnd: 0, ...extra });
const scene = (main: unknown[], overlay: unknown[] = [], audio: unknown[] = [], locked: { overlay?: boolean } = {}) =>
	({
		main: { id: "m", type: "video", elements: main },
		overlay: [{ id: "o", type: "text", elements: overlay, locked: !!locked.overlay }],
		audio: [{ id: "a", type: "audio", elements: audio }],
	}) as unknown as SceneTracks;
const ref = (trackId: string, elementId: string): ElementRef => ({ trackId, elementId });
const ids = (refs: readonly ElementRef[]) => refs.map((r) => r.elementId);
const sorted = (set: ReadonlySet<string>) => [...set].sort();

describe("linked items light up with the selected main clip", () => {
	const tracks = scene(
		[clip("A", 0, 10, { mediaId: "fa", isSourceAudioEnabled: false }), clip("B", 10, 10, { mediaId: "fb" })],
		[text("t1", 2), text("t2", 12), text("cap", 4, 1, { params: { "caption.style": "x", "caption.source": "A" } })],
		[sound("sA", 0, 10, { mediaId: "fa" }), sound("music", 0, 20, { sourceType: "library", mediaId: "lib" })],
	);
	test("A selected: its title, its caption, its detached sound and the music that starts on it — not B's title", () => {
		// (Linkage moves a sound that starts over the clip with it, a music bed too: the mark says what the move will do)
		expect(sorted(linkedItemIds({ tracks, selection: [ref("m", "A")], kinds: ALL }))).toEqual(["cap", "music", "sA", "t1"]);
	});
	test("B selected: B's title only", () => {
		expect(sorted(linkedItemIds({ tracks, selection: [ref("m", "B")], kinds: ALL }))).toEqual(["t2"]);
	});
	test("Linkage off: only the caption, which always follows its speech", () => {
		expect(sorted(linkedItemIds({ tracks, selection: [ref("m", "A")], kinds: new Set() }))).toEqual(["cap"]);
	});
	test("Linkage with titles left out: the title is not lit", () => {
		expect(sorted(linkedItemIds({ tracks, selection: [ref("m", "A")], kinds: new Set(["audio", "overlay"] as const) }))).toEqual(["cap", "music", "sA"]);
	});
	test("a clip on another track selected, or nothing: nothing lit", () => {
		expect(linkedItemIds({ tracks, selection: [ref("o", "t1")], kinds: ALL }).size).toBe(0);
		expect(linkedItemIds({ tracks, selection: [], kinds: ALL }).size).toBe(0);
	});
	test("an item selected with its clip is the selection, not lit", () => {
		expect(sorted(linkedItemIds({ tracks, selection: [ref("m", "A"), ref("o", "t1")], kinds: ALL }))).toEqual(["cap", "music", "sA"]);
	});
	test("the probe changes nothing: the tracks are the same objects after", () => {
		const before = JSON.stringify(tracks);
		linkedItemIds({ tracks, selection: [ref("m", "A"), ref("m", "B")], kinds: ALL });
		expect(JSON.stringify(tracks)).toBe(before);
	});
});

describe("⇧-click is one rule: anchor → clicked, in timeline order, across the tracks they span", () => {
	const tracks = scene([clip("A", 0), clip("B", 10), clip("C", 20), clip("D", 30)], [text("t0", 1), text("t1", 12), text("t2", 25, 20), text("t3", 33)], [sound("s1", 15)]);
	test("on one track: B ⇧ D = B C D, D ⇧ B the same", () => {
		expect(ids(rangeSelection({ tracks, anchor: ref("m", "B"), target: ref("m", "D") }))).toEqual(["B", "C", "D"]);
		expect(ids(rangeSelection({ tracks, anchor: ref("m", "D"), target: ref("m", "B") }))).toEqual(["D", "B", "C"]);
	});
	test("across tracks: from B (main) to t2 (above): everything starting 10…25 on the layer and the main track, nothing below", () => {
		expect(ids(rangeSelection({ tracks, anchor: ref("m", "B"), target: ref("o", "t2") }))).toEqual(["B", "t1", "t2", "C"]);
	});
	test("a clip that starts in the range and ends past it is in (timeline order: by start)", () => {
		expect(ids(rangeSelection({ tracks, anchor: ref("o", "t1"), target: ref("m", "C") }))).toContain("C");
		expect(ids(rangeSelection({ tracks, anchor: ref("m", "C"), target: ref("o", "t2") }))).toEqual(["C", "t2"]);
	});
	test("from the layer to the sound: the main track between is spanned (nothing of it starts 12…15)", () => {
		expect(ids(rangeSelection({ tracks, anchor: ref("o", "t1"), target: ref("a", "s1") }))).toEqual(["t1", "s1"]);
	});
	test("a locked track between is left out", () => {
		const locked = {
			main: { id: "m", type: "video", locked: true, elements: [clip("M", 12)] },
			overlay: [{ id: "o", type: "text", elements: [text("t1", 10)] }],
			audio: [{ id: "a", type: "audio", elements: [sound("s1", 14)] }],
		} as unknown as SceneTracks;
		expect(ids(rangeSelection({ tracks: locked, anchor: ref("o", "t1"), target: ref("a", "s1") }))).toEqual(["t1", "s1"]);
	});
	test("click: plain = that one, the anchor; ⌘ toggles and moves the anchor; ⇧ extends from the anchor and keeps it", () => {
		let state = clickSelection({ tracks, current: [], anchor: null, target: ref("m", "B"), keys: { range: false, toggle: false } });
		expect(ids(state.elements)).toEqual(["B"]);
		state = clickSelection({ tracks, current: state.elements, anchor: state.anchor, target: ref("m", "D"), keys: { range: true, toggle: false } });
		expect(ids(state.elements)).toEqual(["B", "C", "D"]);
		expect(state.anchor.elementId).toBe("B");
		state = clickSelection({ tracks, current: state.elements, anchor: state.anchor, target: ref("m", "C"), keys: { range: true, toggle: false } });
		expect(ids(state.elements)).toEqual(["B", "C"]);
		state = clickSelection({ tracks, current: state.elements, anchor: state.anchor, target: ref("m", "A"), keys: { range: false, toggle: true } });
		expect(ids(state.elements)).toEqual(["B", "C", "A"]);
		expect(state.anchor.elementId).toBe("A");
		state = clickSelection({ tracks, current: state.elements, anchor: state.anchor, target: ref("m", "C"), keys: { range: false, toggle: true } });
		expect(ids(state.elements)).toEqual(["B", "A"]);
		state = clickSelection({ tracks, current: state.elements, anchor: state.anchor, target: ref("m", "D"), keys: { range: true, toggle: false } });
		// ⌘ taking C out keeps the anchor A (the last ⌘-click that added): A B C D
		expect(ids(state.elements)).toEqual(["A", "B", "C", "D"]);
	});
	test("⇧ with no anchor and nothing selected selects the clicked clip", () => {
		expect(ids(clickSelection({ tracks, current: [], anchor: null, target: ref("m", "C"), keys: { range: true, toggle: false } }).elements)).toEqual(["C"]);
	});
	test("⇧ with no anchor (a box select) extends from the last selected clip", () => {
		expect(ids(clickSelection({ tracks, current: [ref("m", "A"), ref("m", "B")], anchor: null, target: ref("m", "D"), keys: { range: true, toggle: false } }).elements)).toEqual(["B", "C", "D"]);
	});
	test("an anchor that is gone (deleted, undone) falls back to the last selected clip", () => {
		expect(ids(clickSelection({ tracks, current: [ref("m", "C")], anchor: ref("m", "Z"), target: ref("m", "D"), keys: { range: true, toggle: false } }).elements)).toEqual(["C", "D"]);
	});
	test("⌘ off on a grouped clip takes its whole group out", () => {
		const grouped = scene([clip("A", 0, 10, { groupId: "g" }), clip("B", 10)], [text("t1", 2, 3, { groupId: "g" })]);
		const out = clickSelection({ tracks: grouped, current: [ref("m", "A"), ref("o", "t1"), ref("m", "B")], anchor: null, target: ref("m", "A"), keys: { range: false, toggle: true } });
		expect(ids(out.elements)).toEqual(["B"]);
	});
});

describe("select next / previous clip on the track", () => {
	const tracks = scene([clip("A", 0), clip("C", 20), clip("B", 10)], [text("t1", 5), text("t2", 40)], [], { overlay: false });
	const step = (from: ElementRef | null, direction: 1 | -1, playhead = 0) => adjacentClip({ tracks, from, playhead, half: 1, direction });
	test("from a clip: its neighbour in time on its own track, with its start", () => {
		expect(step(ref("m", "A"), 1)).toEqual({ ref: ref("m", "B"), startTime: 10 });
		expect(step(ref("m", "B"), 1)?.ref.elementId).toBe("C");
		expect(step(ref("m", "B"), -1)?.ref.elementId).toBe("A");
		expect(step(ref("o", "t1"), 1)).toEqual({ ref: ref("o", "t2"), startTime: 40 });
	});
	test("at the ends: nothing", () => {
		expect(step(ref("m", "C"), 1)).toBeNull();
		expect(step(ref("m", "A"), -1)).toBeNull();
	});
	test("nothing selected: from the playhead on the main track", () => {
		expect(step(null, 1, 5)?.ref.elementId).toBe("B");
		expect(step(null, -1, 15)?.ref.elementId).toBe("B");
		// at a clip's start both ways take that clip; past the last start forwards: nothing
		expect(step(null, -1, 10)?.ref.elementId).toBe("B");
		expect(step(null, 1, 10)?.ref.elementId).toBe("B");
		expect(step(null, 1, 0)?.ref.elementId).toBe("A");
		expect(step(null, 1, 25)).toBeNull();
	});
	test("a locked track: nothing", () => {
		const locked = scene([clip("A", 0)], [text("t1", 5), text("t2", 9)], [], { overlay: true });
		expect(adjacentClip({ tracks: locked, from: ref("o", "t1"), playhead: 0, half: 1, direction: 1 })).toBeNull();
	});
});
