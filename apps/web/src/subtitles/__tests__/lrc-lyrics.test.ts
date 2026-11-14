import { describe, expect, test } from "bun:test";
import { parseLrc } from "../lrc";
import { wordsToLyricLines } from "../lyric-lines";
import { linesFromAnswer } from "../translate-prompt";

describe("captions: LRC, lyric lines, translation answers", () => {
	test("LRC lines last until the next one; the last 3 s; repeated stamps", () => {
		const { captions } = parseLrc({ input: "[ti:Song]\n[00:01.00]One\n[00:03.50][00:10.00]Two\n[00:05.00]Three\n" });
		expect(captions.map((c) => c.text)).toEqual(["One", "Two", "Three", "Two"]);
		expect(captions[0]).toMatchObject({ startTime: 1, duration: 2.5 });
		expect(captions[3].duration).toBe(3);
	});
	test("lyric lines break at a pause or 8 words and never overlap", () => {
		const words = ["la", "la", "la", "oh", "yeah"].map((text, i) => ({ text, start: i < 3 ? i * 0.4 : 3 + i * 0.3, end: i < 3 ? i * 0.4 + 0.3 : 3.25 + i * 0.3 }));
		const lines = wordsToLyricLines(words);
		expect(lines.map((l) => l.text)).toEqual(["la la la", "oh yeah"]);
		expect(lines[0].startTime + lines[0].duration).toBeLessThanOrEqual(lines[1].startTime);
		expect(lines[1].words?.length).toBe(2);
	});
	test("a translation keeps the line count; a missing line keeps the original", () => {
		expect(linesFromAnswer({ lines: ["Hello", ""] }, ["Привет", "Пока", "Да"])).toEqual(["Hello", "Пока", "Да"]);
		expect(linesFromAnswer(null, ["А"])).toEqual(["А"]);
	});
});
