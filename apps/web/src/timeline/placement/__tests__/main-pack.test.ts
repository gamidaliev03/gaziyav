import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline/types";
import { mainTrackCutAt, packMainTrack, separateOverlaps } from "../main-track";

const S = 120000;
const clip = (id: string, s: number, d = 8) => ({ id, type: "video", startTime: s * S, duration: d * S, trimStart: 0, trimEnd: 0, params: {} });
const tracks = (main: unknown[], overlay: unknown[] = []) =>
	({ main: { id: "m", type: "video", elements: main }, overlay: [{ id: "o", type: "graphic", elements: overlay }], audio: [] }) as unknown as SceneTracks;
const starts = (t: SceneTracks) => t.main.elements.map((e) => [e.id, e.startTime / S]);

// The fuzz (seed 4242): a clip slowed down covered the next one; a paste past the end left a gap; the magnet switched
// on kept the gaps it found.
describe("the main track with its magnet", () => {
	test("packed already: the same object back", () => {
		const t = tracks([clip("A", 0), clip("B", 8)]);
		expect(packMainTrack({ tracks: t })).toBe(t);
	});
	test("a gap closes, a first clip moves to 0", () => {
		expect(starts(packMainTrack({ tracks: tracks([clip("A", 2), clip("B", 14)]) }))).toEqual([["A", 0], ["B", 8]]);
	});
	test("a clip that got longer pushes the next ones on", () => {
		expect(starts(packMainTrack({ tracks: tracks([clip("A", 0, 12), clip("B", 8), clip("C", 16)]) }))).toEqual([["A", 0], ["B", 12], ["C", 20]]);
	});
	test("a clip the step added goes before one already at its time (an insert)", () => {
		const t = tracks([clip("A", 0), clip("N", 8, 2), clip("B", 8)]);
		expect(starts(packMainTrack({ tracks: t, fresh: new Set(["N"]) }))).toEqual([["A", 0], ["N", 8], ["B", 10]]);
	});
	test("the stretch a compound clip covers from above stays", () => {
		const compound = { id: "K", type: "graphic", startTime: 0, duration: 16 * S, params: { compound: true } };
		const t = tracks([clip("C", 16)], [compound]);
		expect(packMainTrack({ tracks: t })).toBe(t);
	});
	test("the cut nearest a time: after every clip whose middle is left of it", () => {
		const els = [clip("A", 0), clip("B", 8)] as unknown as SceneTracks["main"]["elements"];
		expect([2, 5, 13, 30].map((s) => mainTrackCutAt({ elements: els, time: s * S }) / S)).toEqual([0, 8, 16, 16]);
	});
});

describe("no two items at once on a track above or below the main one", () => {
	const sound = (id: string, s: number, d = 4) => ({ id, type: "audio", startTime: s * S, duration: d * S, trimStart: 0, trimEnd: 0, params: {} });
	const withAudio = (...lists: unknown[][]) =>
		({ main: { id: "m", type: "video", elements: [] }, overlay: [], audio: lists.map((elements, i) => ({ id: `a${i}`, type: "audio", elements })) }) as unknown as SceneTracks;
	test("nothing over anything: the same object back", () => {
		const t = withAudio([sound("x", 0), sound("y", 4)]);
		expect(separateOverlaps({ tracks: t, moved: new Set(["x"]) })).toBe(t);
	});
	test("the moved sound goes to the next free sound track, the other stays", () => {
		const out = separateOverlaps({ tracks: withAudio([sound("x", 0), sound("y", 2)], []), moved: new Set(["y"]) });
		expect(out.audio.map((t) => t.elements.map((e) => e.id))).toEqual([["x"], ["y"]]);
	});
	test("no free track: a new one right below, its id from the item's (a redo makes the same)", () => {
		const out = separateOverlaps({ tracks: withAudio([sound("x", 0), sound("y", 2)]), moved: new Set(["y"]) });
		expect(out.audio.map((t) => [t.id, t.elements.map((e) => e.id)])).toEqual([["a0", ["x"]], ["track-y", ["y"]]]);
	});
	test("an effect layer goes up, never down (it only acts on what is below it): a free track below is not taken", () => {
		const layer = (id: string, s: number) => ({ id, type: "effect", startTime: s * S, duration: 5 * S, params: {} });
		const t = {
			main: { id: "m", type: "video", elements: [] },
			overlay: [
				{ id: "e0", type: "effect", elements: [layer("busy", 0)] },
				{ id: "e1", type: "effect", elements: [layer("x", 0), layer("copy", 1)] },
				{ id: "e2", type: "effect", elements: [] },
			],
			audio: [],
		} as unknown as SceneTracks;
		const out = separateOverlaps({ tracks: t, moved: new Set(["copy"]) });
		expect(out.overlay.map((track) => [track.id, track.elements.map((e) => e.id)])).toEqual([
			["e0", ["busy"]],
			["track-copy", ["copy"]],
			["e1", ["x"]],
			["e2", []],
		]);
	});
});

// pro-reliable's 60-min soak (09.11): from cycle 85, 88 broken rules — two tracks of one id. An item evicted onto a new
// track `track-<its id>` and later evicted again from that same track made a second `track-<its id>`.
describe("an item evicted twice gets a track of its own each time (pro-core)", () => {
	test("evicted from the track its first eviction made: a new id, not the same one again", () => {
		const t = {
			main: { id: "m", type: "video", elements: [] },
			overlay: [{ id: "track-X", type: "text", elements: [clip("X", 4, 5), clip("Z", 6, 4)] }],
			audio: [],
		} as unknown as SceneTracks;
		const out = separateOverlaps({ tracks: t, moved: new Set(["X"]) });
		const ids = out.overlay.map((track) => track.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual(["track-X-2", "track-X"]);
		expect(out.overlay.find((track) => track.id === "track-X-2")?.elements.map((e) => e.id)).toEqual(["X"]);
	});
	test("a redo of the same step makes the same ids (they come from the state, not from chance)", () => {
		const t = {
			main: { id: "m", type: "video", elements: [] },
			overlay: [{ id: "o", type: "text", elements: [clip("X", 4, 5), clip("Z", 6, 4)] }],
			audio: [],
		} as unknown as SceneTracks;
		const a = separateOverlaps({ tracks: t, moved: new Set(["X"]) }).overlay.map((track) => track.id);
		const b = separateOverlaps({ tracks: t, moved: new Set(["X"]) }).overlay.map((track) => track.id);
		expect(a).toEqual(["track-X", "o"]);
		expect(b).toEqual(a);
	});
});
