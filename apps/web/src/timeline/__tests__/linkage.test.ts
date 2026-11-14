import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline/types";
import { applyLinkage } from "../linkage";

const clip = (id: string, startTime: number, duration = 10, trimStart = 0) => ({ id, type: "video", startTime, duration, trimStart, trimEnd: 0 });
const text = (id: string, startTime: number) => ({ id, type: "text", startTime, duration: 3 });
const scene = (main: unknown[], overlay: unknown[] = [], audio: unknown[] = []) =>
	({ main: { id: "m", type: "video", elements: main }, overlay: [{ id: "o", type: "text", elements: overlay }], audio: [{ id: "a", type: "audio", elements: audio }] }) as unknown as SceneTracks;
const ALL = new Set(["text", "sticker", "effect", "audio", "overlay"] as const);
const overlay = (s: SceneTracks) => s.overlay[0].elements.map((e): [string, number] => [e.id, e.startTime as number]);

const caption = (id: string, startTime: number) => ({ id, type: "text", name: id, startTime, duration: 1, params: { "caption.style": "caption" } });
const voice = (id: string, startTime: number, duration: number) => ({ id, type: "audio", name: id, sourceType: "upload", startTime, duration, trimStart: 0, trimEnd: 0 });

describe("captions follow the voice they transcribe", () => {
	test("a picture stretched on the main track leaves the captions over a voice-over where the voice is", () => {
		// a 30 s voice-over from 0; the first picture grows from 10 to 25 s, the second picture moves to 25
		const before = scene([clip("P1", 0, 10), clip("P2", 10, 10)], [caption("c1", 2), caption("c2", 12), text("title", 12)], [voice("vo", 0, 30)]);
		const after = scene([clip("P1", 0, 25), clip("P2", 25, 10)], [caption("c1", 2), caption("c2", 12), text("title", 12)], [voice("vo", 0, 30)]);
		// the title over P2 follows P2 (CapCut), the captions stay with the voice
		expect(overlay(applyLinkage({ before, after, kinds: ALL }))).toEqual([["c1", 2], ["c2", 12], ["title", 27]]);
	});
	test("captions move with their voice-over when the voice-over itself follows a moved main clip", () => {
		const before = scene([clip("A", 0), clip("B", 10)], [caption("c", 12)], [voice("vo", 11, 5)]);
		const after = scene([clip("A", 0), clip("B", 30)], [caption("c", 12)], [voice("vo", 11, 5)]);
		const next = applyLinkage({ before, after, kinds: ALL });
		expect(next.audio[0].elements.map((e): [string, number] => [e.id, e.startTime as number])).toEqual([["vo", 31]]);
		expect(overlay(next)).toEqual([["c", 32]]);
	});
	test("a caption running past the end of its short voice keeps its length when another clip is trimmed", () => {
		const long = { ...caption("c", 40), duration: 15 }; // 40–55 over a voice 1–50.4
		const before = scene([clip("A", 0, 80), clip("B", 80, 80)], [long], [voice("tone", 1, 49.4)]);
		const after = scene([clip("A", 0, 80), clip("B", 80, 60)], [long], [voice("tone", 1, 49.4)]);
		expect(applyLinkage({ before, after, kinds: ALL }).overlay[0].elements.map((e) => `${e.id}@${e.startTime}+${e.duration}`)).toEqual(["c@40+15"]);
	});
	test("a caption over the cut end of its voice is cut there", () => {
		const long = { ...caption("c", 40), duration: 15 };
		const before = scene([clip("A", 0, 80)], [long], [voice("tone", 1, 49.4)]);
		const after = scene([clip("A", 0, 80)], [long], [voice("tone", 1, 44)]);
		expect(applyLinkage({ before, after, kinds: ALL }).overlay[0].elements.map((e) => `${e.id}@${e.startTime}+${e.duration}`)).toEqual(["c@40+5"]);
	});
	test("captions over a clip played 2× come twice as soon and last half as long; none is lost", () => {
		const caps = [0, 20, 40, 60, 80].map((t, i) => ({ ...caption(`w${i}`, t), duration: 15 }));
		const before = scene([{ ...clip("T", 0, 100), mediaId: "m" }], caps);
		const after = scene([{ ...clip("T", 0, 50), mediaId: "m", retime: { rate: 2 } }], caps);
		expect(applyLinkage({ before, after, kinds: ALL }).overlay[0].elements.map((e) => `${e.id}@${e.startTime}+${e.duration}`)).toEqual([
			"w0@0+8",
			"w1@10+8",
			"w2@20+8",
			"w3@30+8",
			"w4@40+8",
		]);
	});
	test("a split piece in slow motion: its caption is retimed, the one across the split stays whole", () => {
		const caps = [{ ...caption("w1", 20), duration: 15 }, { ...caption("w2", 40), duration: 15 }];
		const before = scene([{ ...clip("A", 0, 30), mediaId: "m" }, { ...clip("B", 30, 30, 30), mediaId: "m" }, { ...clip("C", 60, 40, 60), mediaId: "m" }], caps);
		const after = scene([{ ...clip("A", 0, 30), mediaId: "m" }, { ...clip("B", 30, 60, 30), mediaId: "m", retime: { rate: 0.5 } }, { ...clip("C", 90, 40, 60), mediaId: "m" }], caps);
		expect(applyLinkage({ before, after, kinds: ALL }).overlay[0].elements.map((e) => `${e.id}@${e.startTime}+${e.duration}`)).toEqual(["w1@20+15", "w2@50+30"]);
	});
	test("captions over a voice-over sped up 2× follow its new timing", () => {
		const caps = [{ ...caption("v0", 25), duration: 15 }, { ...caption("v1", 85), duration: 15 }];
		const before = scene([clip("P", 0, 200)], caps, [{ ...voice("vo", 20, 100), mediaId: "vm" }]);
		const after = scene([clip("P", 0, 200)], caps, [{ ...voice("vo", 20, 50), mediaId: "vm", retime: { rate: 2 } }]);
		expect(applyLinkage({ before, after, kinds: ALL }).overlay[0].elements.map((e) => `${e.id}@${e.startTime}+${e.duration}`)).toEqual(["v0@23+8", "v1@53+8"]);
	});
	test("Q (the head cut off, the clip itself kept and pulled to 0) keeps the captions over the rest and the sound", () => {
		const caps = [caption("c0", 0), caption("c2", 20), caption("c4", 40), caption("c6", 60), caption("c9", 90)].map((c) => ({ ...c, duration: 15 }));
		const before = scene([clip("A", 0, 80), clip("B", 80, 80)], caps, [{ id: "tone", type: "audio", sourceType: "library", startTime: 1, duration: 50, trimStart: 0, trimEnd: 0 }]);
		const after = scene([clip("A", 0, 50, 30), clip("B", 50, 80)], caps, [{ id: "tone", type: "audio", sourceType: "library", startTime: 1, duration: 50, trimStart: 0, trimEnd: 0 }]);
		const next = applyLinkage({ before, after, kinds: ALL });
		expect(next.overlay[0].elements.map((e) => `${e.id}@${e.startTime}+${e.duration}`)).toEqual(["c2@0+5", "c4@10+15", "c6@30+15", "c9@60+15"]);
		expect(next.audio[0].elements.map((e) => `${e.id}@${e.startTime}+${e.duration}`)).toEqual(["tone@0+21"]);
	});
	test("captions over a talking main clip (no voice-over under them) follow that clip as before", () => {
		const before = scene([clip("A", 0), clip("B", 10)], [caption("c", 12)], [{ id: "music", type: "audio", sourceType: "library", startTime: 0, duration: 60 }]);
		const after = scene([clip("A", 0), clip("B", 30)], [caption("c", 12)], [{ id: "music", type: "audio", sourceType: "library", startTime: 0, duration: 60 }]);
		expect(overlay(applyLinkage({ before, after, kinds: ALL }))).toEqual([["c", 32]]);
	});
	test("a deleted voice-over takes its captions along", () => {
		const before = scene([clip("A", 0, 40)], [caption("c", 12)], [voice("vo", 0, 30)]);
		const after = scene([clip("A", 0, 40)], [caption("c", 12)], []);
		expect(overlay(applyLinkage({ before, after, kinds: ALL }))).toEqual([]);
	});
});

describe("captions stay inside their speech", () => {
	// a talking clip A 0–10 (media mA), B 10–20 after it; captions every 2 s over A
	const talk = (id: string, start: number, duration: number, trimStart = 0, mediaId = "mA") => ({ ...clip(id, start, duration, trimStart), mediaId });
	const caps = () => [caption("c0", 0), caption("c2", 2), caption("c4", 4), caption("c6", 6), caption("c8", 8)].map((c) => ({ ...c, duration: 2 }));
	const capsOf = (s: SceneTracks) => s.overlay[0].elements.map((e): [string, number, number] => [e.id, e.startTime as number, e.duration as number]);
	test("a head trim: the cut words go, the rest move with the speech (none piles up at 0)", () => {
		const before = scene([talk("A", 0, 10), talk("B", 10, 10, 0, "mB")], caps());
		// the first 3 s of A cut, the magnet closes up: A 0–7 shows media 3–10, B at 7
		const after = scene([talk("A", 0, 7, 3), talk("B", 7, 10, 0, "mB")], caps());
		expect(capsOf(applyLinkage({ before, after, kinds: ALL }))).toEqual([["c2", 0, 1], ["c4", 1, 2], ["c6", 3, 2], ["c8", 5, 2]]);
	});
	test("a tail trim: the captions of the cut tail go, none hangs over the next clip", () => {
		const before = scene([talk("A", 0, 10), talk("B", 10, 10, 0, "mB")], caps());
		const after = scene([talk("A", 0, 5), talk("B", 5, 10, 0, "mB")], caps());
		expect(capsOf(applyLinkage({ before, after, kinds: ALL }))).toEqual([["c0", 0, 2], ["c2", 2, 2], ["c4", 4, 1]]);
	});
	test("a split keeps every caption: each with the piece its words are in", () => {
		const before = scene([talk("A", 0, 10)], caps());
		const after = scene([talk("A", 0, 5), talk("A2", 5, 5, 5)], caps());
		expect(capsOf(applyLinkage({ before, after, kinds: ALL }))).toEqual(capsOf(before));
	});
	test("a head trim of a clip with a voice-over under it: the voice loses its head (in sync), the words with it", () => {
		const before = scene([talk("A", 0, 10), talk("B", 10, 10, 0, "mB")], caps(), [voice("vo", 0, 6)]);
		const after = scene([talk("A", 0, 7, 3), talk("B", 7, 10, 0, "mB")], caps(), [voice("vo", 0, 6)]);
		const next = applyLinkage({ before, after, kinds: ALL });
		expect(next.audio[0].elements.map((e) => [e.id, e.startTime, e.duration, (e as { trimStart: number }).trimStart])).toEqual([["vo", 0, 3, 3]]);
		// c0 cut away, c2 keeps its last second, c4 the rest of the voice; c6 and c8 (past the voice) follow the clip
		expect(capsOf(next)).toEqual([["c2", 0, 1], ["c4", 1, 2], ["c6", 3, 2], ["c8", 5, 2]]);
	});
	test("with Linkage off the captions still follow a moved clip (a title does not)", () => {
		const before = scene([talk("A", 0, 10), talk("B", 10, 10, 0, "mB")], [caption("cB", 12), text("tB", 12)]);
		const after = scene([talk("A", 0, 10), talk("B", 30, 10, 0, "mB")], [caption("cB", 12), text("tB", 12)]);
		expect(overlay(applyLinkage({ before, after, kinds: new Set() }))).toEqual([["cB", 32], ["tB", 12]]);
	});
});

describe("linkage", () => {
	test("a speed change of a split piece leaves the items over it where they are (only its length changes)", () => {
		// B is the second piece of a split clip: it shows the media from 0.967 s (trimStart), a photo sits over it at 1.9 s
		const fast = (id: string, start: number, duration: number, trimStart: number, rate: number) => ({ ...clip(id, start, duration, trimStart), retime: { rate } });
		const before = scene([clip("A", 0, 0.967), fast("B", 0.967, 7.033, 0.967, 1)], [text("photo", 1.9)]);
		for (const rate of [2, 10, 100, 0.01]) {
			const after = scene([clip("A", 0, 0.967), fast("B", 0.967, 7.033 / rate, 0.967, rate)], [text("photo", 1.9)]);
			expect(overlay(applyLinkage({ before, after, kinds: ALL }))).toEqual([["photo", 1.9]]);
		}
		// …and a later clip that a ripple moved after that speed change still takes its title along
		const before2 = scene([fast("A", 0, 8, 1, 1), clip("B", 8)], [text("tB", 9)]);
		const after2 = scene([fast("A", 0, 4, 1, 2), clip("B", 4)], [text("tB", 9)]);
		expect(overlay(applyLinkage({ before: before2, after: after2, kinds: ALL }))).toEqual([["tB", 5]]);
	});
	test("a main clip dragged onto a layer track keeps the items over it (they move with it, nothing is deleted)", () => {
		const before = scene([clip("A", 0), clip("B", 10)], [text("tB", 12), caption("c", 13)]);
		// B went to an overlay track at 20 (a drag up and to the right); A is alone on main
		const after = {
			...scene([clip("A", 0)], [text("tB", 12), caption("c", 13)]),
			overlay: [{ id: "o", type: "text", elements: [text("tB", 12), caption("c", 13)] }, { id: "v", type: "video", elements: [clip("B", 20)] }],
		} as unknown as SceneTracks;
		const next = applyLinkage({ before, after, kinds: ALL });
		expect(overlay(next)).toEqual([["tB", 22], ["c", 23]]);
		expect(next.overlay[1].elements.map((e) => e.id)).toEqual(["B"]);
	});
	test("a moved main clip takes the title over it along; a title over another clip stays", () => {
		const before = scene([clip("A", 0), clip("B", 10)], [text("tA", 2), text("tB", 12)]);
		const after = scene([clip("A", 0), clip("B", 30)], [text("tA", 2), text("tB", 12)]);
		expect(overlay(applyLinkage({ before, after, kinds: ALL }))).toEqual([["tA", 2], ["tB", 32]]);
	});
	test("a deleted main clip takes its title and its sound along", () => {
		const before = scene([clip("A", 0), clip("B", 10)], [text("tA", 2), text("tB", 12)], [{ id: "s", type: "audio", startTime: 11, duration: 2 }]);
		const after = scene([clip("A", 0)], [text("tA", 2), text("tB", 12)], [{ id: "s", type: "audio", startTime: 11, duration: 2 }]);
		const next = applyLinkage({ before, after, kinds: ALL });
		expect(overlay(next)).toEqual([["tA", 2]]);
		expect(next.audio[0].elements).toEqual([]);
	});
	test("a long song that starts on a deleted short piece stays (it belongs to more than that piece)", () => {
		const T = 100;
		const before = scene([clip("A", 0, 10 * T), clip("B", 10 * T, T)], [], [{ id: "song", type: "audio", startTime: 10.5 * T, duration: 5 * T }]);
		const after = scene([clip("A", 0, 10 * T)], [], [{ id: "song", type: "audio", startTime: 10.5 * T, duration: 5 * T }]);
		const next = applyLinkage({ before, after, kinds: ALL });
		expect(next.audio[0].elements.map((e) => e.id)).toEqual(["song"]);
	});
	test("a reversed split piece (new file, new trim) keeps its music and titles where they are", () => {
		const piece = { ...clip("A", 0, 2, 0), mediaId: "m" };
		const before = scene([piece, { ...clip("B", 2, 6, 2), mediaId: "m" }], [text("t", 0.3)], [{ id: "s", type: "audio", startTime: 0.1, duration: 5 }]);
		const after = scene([{ ...piece, mediaId: "m-rev", trimStart: 6 }, { ...clip("B", 2, 6, 2), mediaId: "m" }], [text("t", 0.3)], [{ id: "s", type: "audio", startTime: 0.1, duration: 5 }]);
		const next = applyLinkage({ before, after, kinds: ALL });
		expect(overlay(next)).toEqual([["t", 0.3]]);
		expect(next.audio[0].elements.map((e) => `${e.id}@${e.startTime}`)).toEqual(["s@0.1"]);
	});
	test("W (the tail cut, the next clip closed up): a layer clip over the cut tail goes to the cut, like Q", () => {
		const before = scene([clip("A", 0, 80), clip("B", 80, 80)], [{ id: "L", type: "video", startTime: 60, duration: 80, trimStart: 0, trimEnd: 0 }]);
		const after = scene([clip("A", 0, 30), clip("B", 30, 80)], [{ id: "L", type: "video", startTime: 60, duration: 80, trimStart: 0, trimEnd: 0 }]);
		expect(overlay(applyLinkage({ before, after, kinds: ALL }))).toEqual([["L", 30]]);
	});
	test("a tail trim that leaves a gap keeps the items over the gap where they are", () => {
		const before = scene([clip("A", 0, 80), clip("B", 80, 80)], [text("t", 60)]);
		const after = scene([clip("A", 0, 30), clip("B", 80, 80)], [text("t", 60)]);
		expect(overlay(applyLinkage({ before, after, kinds: ALL }))).toEqual([["t", 60]]);
	});
	test("Q on the second clip: a title over its cut head goes to the clip's new start, not over the first clip", () => {
		const before = scene([clip("A", 0, 80), clip("B", 80, 80)], [text("t", 90)]);
		const after = scene([clip("A", 0, 80), clip("B", 80, 50, 30)], [text("t", 90)]);
		expect(overlay(applyLinkage({ before, after, kinds: ALL }))).toEqual([["t", 80]]);
	});
	test("a left trim doesn't move the items (the picture stays where it was)", () => {
		const before = scene([clip("A", 0, 10, 0)], [text("tA", 5)]);
		const after = scene([clip("A", 3, 7, 3)], [text("tA", 5)]);
		expect(applyLinkage({ before, after, kinds: ALL })).toBe(after);
	});
	test("items the edit moved itself, and kinds switched off, stay as they are", () => {
		const before = scene([clip("A", 0)], [text("tA", 2)], [{ id: "s", type: "audio", startTime: 1, duration: 2 }]);
		const after = scene([clip("A", 20)], [text("tA", 25)], [{ id: "s", type: "audio", startTime: 1, duration: 2 }]);
		const next = applyLinkage({ before, after, kinds: new Set(["text"]) });
		expect(overlay(next)).toEqual([["tA", 25]]);
		expect(next.audio[0].elements[0].startTime as number).toBe(1);
	});
});

describe("a replaced main clip (final-B D1, 07.11)", () => {
	const picture = (id: string, startTime: number, duration: number) => ({ id, type: "image", startTime, duration });
	const voice = (id: string, startTime: number, duration: number) => ({ id, type: "audio", name: id, sourceType: "upload", startTime, duration, trimStart: 0, trimEnd: 0 });
	test("a lipsync result in place of the whole clip keeps the picture, the title and the voice-over above it", () => {
		// A (0–15, media a) is replaced by R (a new clip, same start, 10 s) with the rest of A re-inserted after it.
		const before = scene([clip("A", 0, 15), clip("B", 15, 8)], [picture("photo", 0, 5), text("title", 2)], [voice("vo", 1, 6)]);
		const after = scene([{ ...clip("R", 0, 10), mediaId: "r" }, { ...clip("A2", 10, 5, 10), mediaId: "a" }, clip("B", 15, 8)], [picture("photo", 0, 5), text("title", 2)], [voice("vo", 1, 6)]);
		const next = applyLinkage({ before, after, kinds: ALL });
		expect(overlay(next)).toEqual([["photo", 0], ["title", 2]]);
		expect(next.audio[0].elements.map((e) => [e.id, e.startTime as number])).toEqual([["vo", 1]]);
	});
	test("the old captions over the replaced clip go (the speech they wrote is gone); a plain delete still takes the items along", () => {
		const before = scene([clip("A", 0, 15), clip("B", 15, 8)], [caption("c1", 2), text("title", 2)]);
		const replacedBy = scene([{ ...clip("R", 0, 15), mediaId: "r" }, clip("B", 15, 8)], [caption("c1", 2), text("title", 2)]);
		expect(overlay(applyLinkage({ before, after: replacedBy, kinds: ALL }))).toEqual([["title", 2]]);
		// B moved up into A's place after a delete: B is not new, so the title and the caption go with A, as in CapCut.
		const deleted = scene([clip("B", 0, 8)], [caption("c1", 2), text("title", 2)]);
		expect(overlay(applyLinkage({ before, after: deleted, kinds: ALL }))).toEqual([]);
	});
});

describe("a detached sound in lockstep with its clip is edited with it (pro-core 09.11)", () => {
	const pic = (id: string, startTime: number, duration: number, trimStart = 0, extra: Record<string, unknown> = {}) => ({ ...clip(id, startTime, duration, trimStart), mediaId: "f", isSourceAudioEnabled: false, ...extra });
	const sound = (id: string, startTime: number, duration: number, trimStart = 0, extra: Record<string, unknown> = {}) => ({ id, type: "audio", name: id, sourceType: "upload", mediaId: "f", startTime, duration, trimStart, trimEnd: 0, ...extra });
	const audio = (s: SceneTracks) => s.audio[0].elements.map((e) => `${e.id}@${e.startTime}+${e.duration}/${(e as { trimStart: number }).trimStart}`);
	test("a head trim with the magnet trims the sound's head: it no longer slides under the clip before", () => {
		const before = scene([clip("A", 0, 10), pic("B", 10, 10)], [], [sound("s", 10, 10)]);
		const after = scene([clip("A", 0, 10), pic("B", 10, 7, 3)], [], [sound("s", 10, 10)]);
		expect(audio(applyLinkage({ before, after, kinds: ALL }))).toEqual(["s@10+7/3"]);
	});
	test("a tail trim, a move and a speed change are the sound's too", () => {
		const before = scene([pic("B", 0, 10)], [], [sound("s", 0, 10)]);
		expect(audio(applyLinkage({ before, after: scene([pic("B", 0, 6)], [], [sound("s", 0, 10)]), kinds: ALL }))).toEqual(["s@0+6/0"]);
		expect(audio(applyLinkage({ before, after: scene([pic("B", 4, 10)], [], [sound("s", 0, 10)]), kinds: ALL }))).toEqual(["s@4+10/0"]);
		const sped = applyLinkage({ before, after: scene([pic("B", 0, 5, 0, { retime: { rate: 2 } })], [], [sound("s", 0, 10)]), kinds: ALL });
		expect(audio(sped)).toEqual(["s@0+5/0"]);
		expect((sped.audio[0].elements[0] as { retime?: { rate: number } }).retime?.rate).toBe(2);
	});
	test("a sound the user moved or cut on its own is no pair: it follows the old way", () => {
		// J cut: the sound starts 2 before its picture; the picture's head trim moves it with the picture's content
		const before = scene([clip("A", 0, 10), pic("B", 10, 10)], [], [sound("s", 8, 12)]);
		const after = scene([clip("A", 0, 10), pic("B", 10, 7, 3)], [], [sound("s", 8, 12)]);
		expect(audio(applyLinkage({ before, after, kinds: ALL }))).toEqual(["s@8+12/0"]);
		// the picture plays its own sound: an aligned copy of the file is not its detached sound
		const own = scene([clip("A", 0, 10), { ...pic("B", 10, 10), isSourceAudioEnabled: true }], [], [sound("s", 10, 10)]);
		const ownAfter = scene([clip("A", 0, 10), { ...pic("B", 10, 7, 3), isSourceAudioEnabled: true }], [], [sound("s", 10, 10)]);
		expect(audio(applyLinkage({ before: own, after: ownAfter, kinds: ALL }))).toEqual(["s@7+10/0"]);
	});
	test("deleting the clip still takes its sound", () => {
		const before = scene([clip("A", 0, 10), pic("B", 10, 10)], [], [sound("s", 10, 10)]);
		const after = scene([clip("A", 0, 10)], [], [sound("s", 10, 10)]);
		expect(audio(applyLinkage({ before, after, kinds: ALL }))).toEqual([]);
	});
});
