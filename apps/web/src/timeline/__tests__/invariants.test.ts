import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline/types";
import { checkLinkedAudio, checkTimelineInvariants, describeStateDifference, timelineStateKey } from "../invariants";

const S = 120000;
const clip = (id: string, startTime: number, duration = 10 * S, more: Record<string, unknown> = {}) => ({
	id,
	name: id,
	type: "video",
	mediaId: "m1",
	startTime,
	duration,
	trimStart: 0,
	trimEnd: 0,
	sourceDuration: 60 * S,
	params: {},
	...more,
});
const sound = (id: string, startTime: number, duration = 2 * S) => ({ id, name: id, type: "audio", sourceType: "upload", mediaId: "m1", startTime, duration, trimStart: 0, trimEnd: 0, params: {} });
const scene = ({ main = [] as unknown[], overlay = [] as unknown[], audio = [] as unknown[], transitions = [] as unknown[] } = {}) =>
	({
		main: { id: "main", type: "video", elements: main, transitions },
		overlay: [{ id: "o1", type: "video", elements: overlay }],
		audio: [{ id: "a1", type: "audio", elements: audio }],
	}) as unknown as SceneTracks;
const rules = (tracks: SceneTracks, magnet = true, selection?: { selectedElements: { trackId: string; elementId: string }[] }) =>
	checkTimelineInvariants({ tracks, magnet, selection: selection && { ...selection, selectedKeyframes: [] } }).map((v) => v.rule);

describe("timeline invariants", () => {
	test("clips back to back from 0, a transition on their cut, the selection on a clip: all hold", () => {
		const tracks = scene({
			main: [clip("A", 0), clip("B", 10 * S)],
			transitions: [{ id: "t", type: "x", fromElementId: "A", toElementId: "B", duration: S, params: {} }],
		});
		expect(rules(tracks, true, { selectedElements: [{ trackId: "main", elementId: "B" }] })).toEqual([]);
	});

	test("two clips at once on a track", () => {
		expect(rules(scene({ overlay: [clip("A", 0), clip("B", 9 * S)] }))).toEqual(["no-overlap"]);
	});

	test("the main track with its magnet: a gap, or a first clip not at 0; without the magnet both are fine", () => {
		expect(rules(scene({ main: [clip("A", 0), clip("B", 12 * S)] }))).toEqual(["main-no-gap"]);
		expect(rules(scene({ main: [clip("A", S)] }))).toEqual(["main-no-gap"]);
		expect(rules(scene({ main: [clip("A", 0), clip("B", 12 * S)] }), false)).toEqual([]);
		// a compound clip of main-track clips plays in their place from the track above
		const compound = { id: "K", name: "Compound clip 1", type: "graphic", definitionId: "x", startTime: 0, duration: 16 * S, trimStart: 0, trimEnd: 0, params: { compound: true } };
		expect(rules(scene({ main: [clip("C", 16 * S)], overlay: [compound] }))).toEqual([]);
		expect(rules(scene({ main: [clip("C", 18 * S)], overlay: [compound] }))).toEqual(["main-no-gap"]);
	});

	test("a transition off its cut: clips apart, a clip gone, longer than a clip", () => {
		const t = (from: string, to: string, duration = S) => ({ id: `t${from}${to}`, type: "x", fromElementId: from, toElementId: to, duration, params: {} });
		expect(rules(scene({ main: [clip("A", 0), clip("B", 10 * S)], transitions: [t("A", "B", 11 * S)] }))).toEqual(["transition-on-cut"]);
		expect(rules(scene({ main: [clip("A", 0)], transitions: [t("A", "B")] }))).toEqual(["transition-on-cut"]);
		expect(rules(scene({ main: [clip("A", 0), clip("B", 12 * S)], transitions: [t("A", "B")] }), false)).toEqual(["transition-on-cut"]);
		// the clips touch, but the transition names them the other way round
		expect(rules(scene({ main: [clip("A", 0), clip("B", 10 * S)], transitions: [t("B", "A")] }))).toEqual(["transition-on-cut"]);
	});

	test("a clip past its file's end (at its speed), or trimmed below 0", () => {
		expect(rules(scene({ main: [clip("A", 0, 10 * S, { trimStart: 55 * S })] }))).toEqual(["source-bounds"]);
		expect(rules(scene({ main: [clip("A", 0, 10 * S, { retime: { rate: 7 } })] }))).toEqual(["source-bounds"]);
		expect(rules(scene({ main: [clip("A", 0, 10 * S, { retime: { rate: 6 } })] }))).toEqual([]);
		expect(rules(scene({ main: [clip("A", 0, 10 * S, { trimStart: -1 })] }))).toEqual(["source-bounds"]);
	});

	test("a selection on a deleted clip, an id twice, a time between ticks", () => {
		expect(rules(scene({ main: [clip("A", 0)] }), true, { selectedElements: [{ trackId: "main", elementId: "B" }] })).toEqual(["selection-exists"]);
		expect(rules(scene({ main: [clip("A", 0)], overlay: [clip("A", 0)] }))).toEqual(["unique-ids"]);
		expect(rules(scene({ main: [clip("A", 0, 10 * S + 0.5)] }))).toEqual(["integer-ticks"]);
	});

	test("linkage: sound over a moved main clip moves with its picture; sound over a deleted one goes", () => {
		const kinds = new Set(["audio"] as const);
		const before = scene({ main: [clip("A", 0), clip("B", 10 * S)], audio: [sound("s", 12 * S)] });
		const moved = scene({ main: [clip("B", 0), clip("A", 10 * S)], audio: [sound("s", 12 * S)] });
		expect(checkLinkedAudio({ before, afterCommand: moved, after: scene({ main: [clip("B", 0), clip("A", 10 * S)], audio: [sound("s", 2 * S)] }), kinds })).toEqual([]);
		expect(checkLinkedAudio({ before, afterCommand: moved, after: moved, kinds }).map((v) => v.rule)).toEqual(["linked-audio"]);
		const deleted = scene({ main: [clip("A", 0)], audio: [sound("s", 12 * S)] });
		expect(checkLinkedAudio({ before, afterCommand: deleted, after: deleted, kinds }).map((v) => v.rule)).toEqual(["linked-audio"]);
		expect(checkLinkedAudio({ before, afterCommand: deleted, after: scene({ main: [clip("A", 0)] }), kinds })).toEqual([]);
		// A replaced clip (a new main clip at its start, as a lipsync result in place): the sound over it may stay (final-B D1).
		const replaced = scene({ main: [clip("A", 0), clip("R", 10 * S)], audio: [sound("s", 12 * S)] });
		expect(checkLinkedAudio({ before, afterCommand: replaced, after: replaced, kinds })).toEqual([]);
		// the sound the edit moved itself is the user's
		const dragged = scene({ main: [clip("A", 0), clip("B", 10 * S)], audio: [sound("s", 30 * S)] });
		expect(checkLinkedAudio({ before, afterCommand: dragged, after: dragged, kinds })).toEqual([]);
		// linkage without sound: nothing to keep
		expect(checkLinkedAudio({ before, afterCommand: moved, after: moved, kinds: new Set(["text"] as const) })).toEqual([]);
	});

	test("the state key tells what an undo didn't give back", () => {
		const a = timelineStateKey({ tracks: scene({ main: [clip("A", 0)] }) });
		const b = timelineStateKey({ tracks: scene({ main: [clip("A", 0, 9 * S)] }) });
		expect(a).not.toBe(b);
		expect(describeStateDifference(a, b)).toContain("duration");
		expect(describeStateDifference(a, timelineStateKey({ tracks: scene() }))).toContain("gone");
	});
});

// pro-reliable's long day (cycle 8, seed 1008): «audio «tone.mp3» stayed when its clip video «clip.mp4» was deleted» —
// the 5 s sound started on a 1-frame piece of the clip; linkage keeps a sound that runs on past its clip, the rule did not.
describe("linked-audio and a sound that runs on past its deleted clip (pro-core)", () => {
	test("a sound mostly past the deleted clip stays without a fault; one inside it must go", () => {
		const kinds = new Set(["audio"] as const);
		const before = scene({ main: [clip("A", 0, S / 10), clip("B", S / 10)], audio: [sound("s", 0, 5 * S)] });
		const after = scene({ main: [clip("B", 0)], audio: [sound("s", 0, 5 * S)] });
		expect(checkLinkedAudio({ before, afterCommand: after, after, kinds })).toEqual([]);
		const inside = scene({ main: [clip("A", 0, 6 * S), clip("B", 6 * S)], audio: [sound("s", 0, 5 * S)] });
		const left = scene({ main: [clip("B", 0)], audio: [sound("s", 0, 5 * S)] });
		expect(checkLinkedAudio({ before: inside, afterCommand: left, after: left, kinds }).map((v) => v.rule)).toEqual(["linked-audio"]);
	});
});
