import { describe, expect, test } from "bun:test";
import { chaptersOf, youtubeChapters } from "../model";
import { proposeMarks } from "../propose";

const S = 120000;
const mark = (s: number, note?: string) => ({ time: (s * S) as never, chapter: true as const, ...(note ? { note } : {}) });

describe("chapters from marks", () => {
	test("no marks: no scenes; plain markers are not scenes", () => {
		expect(chaptersOf([], 60 * S)).toEqual([]);
		expect(chaptersOf([{ time: (5 * S) as never }], 60 * S)).toEqual([]);
	});
	test("the first starts at 0 without a mark, the last ends at the end, marks past the end are ignored", () => {
		const c = chaptersOf([mark(20, "B"), mark(40, "C"), mark(70, "late")], 60 * S);
		expect(c.map((x) => [x.start / S, x.end / S, x.title ?? null, x.mark === null])).toEqual([
			[0, 20, null, true],
			[20, 40, "B", false],
			[40, 60, "C", false],
		]);
	});
	test("one mark at 0: one scene", () => {
		expect(chaptersOf([mark(0, "All")], 60 * S).map((x) => [x.start, x.end / S, x.title])).toEqual([[0, 60, "All"]]);
	});
});

describe("YouTube chapters", () => {
	const name = (c: { title?: string; index: number }) => c.title ?? `Scene ${c.index + 1}`;
	test("lines from 00:00, hours when the film is long", () => {
		const c = chaptersOf([mark(0, "Intro"), mark(75, "Middle"), mark(3700, "Late")], 3800 * S);
		const out = youtubeChapters(c, S, name);
		expect(out.text).toBe("0:00:00 Intro\n0:01:15 Middle\n1:01:40 Late");
		expect(out.problem).toBe(null);
	});
	test("fewer than three, or one under 10 s: a warning", () => {
		expect(youtubeChapters(chaptersOf([mark(0), mark(30)], 60 * S), S, name).problem).toBe("fewer");
		const short = youtubeChapters(chaptersOf([mark(0), mark(30), mark(35)], 60 * S), S, name);
		expect(short.text).toBe("00:00 Scene 1\n00:30 Scene 2\n00:35 Scene 3");
		expect(short.problem).toBe("short");
	});
});

describe("Find scenes proposals", () => {
	test("five clips of two minutes with speech in each: five scenes at the cuts", () => {
		const cuts = [0, 120, 240, 360, 480].map((time, i) => ({ time, title: `clip ${i + 1}` }));
		// Speech in the first 40 s of every clip; small pauses between sentences.
		const speech = cuts.flatMap((c) => [0, 8, 16, 24, 32].map((s) => ({ start: c.time + 1 + s, end: c.time + 7.5 + s })));
		const out = proposeMarks({ total: 600, cuts, speech });
		expect(out.map((p) => p.time)).toEqual([0, 120, 240, 360, 480]);
		expect(out.map((p) => p.title)).toEqual(["clip 1", "clip 2", "clip 3", "clip 4", "clip 5"]);
	});
	test("one long recording: the long pauses become scenes, the short ones do not", () => {
		// Phrases of 4.6 s with 0.4 s breaths, a 3 s pause at 50 s and a 5 s pause at 200 s.
		const speech: { start: number; end: number }[] = [];
		for (let t = 0; t < 300; t += 5) {
			const shift = t >= 200 ? 8 : t >= 50 ? 3 : 0;
			if (t + shift + 4.6 <= 308) speech.push({ start: t + shift, end: t + shift + 4.6 });
		}
		const out = proposeMarks({ total: 308, cuts: [{ time: 0 }], speech });
		expect(out.map((p) => Math.round(p.time * 10) / 10)).toEqual([0, 52.6, 207.6]);
	});
	test("no two scenes closer than the minimum, none at the very end", () => {
		const out = proposeMarks({ total: 100, cuts: [0, 5, 9, 50, 95].map((time) => ({ time })) });
		expect(out.map((p) => p.time)).toEqual([0, 50]);
	});
});
