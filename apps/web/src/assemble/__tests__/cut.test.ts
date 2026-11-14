import { describe, expect, test } from "bun:test";
import { isFillerWord, speechFacts, type Word } from "@/production/material";
import { cutRanges } from "../cut";

// «Hello there friend. [2.8 s] This is good. This is good. [0.3 s] Um, bye now all.»
const W = (text: string, start: number, end: number): Word => ({ text, start, end }) as Word;
const words = [W("Hello", 0.5, 0.8), W("there", 0.85, 1.1), W("friend.", 1.15, 1.5), W("This", 4.3, 4.6), W("is", 4.65, 4.75), W("good.", 4.8, 5.1), W("This", 5.9, 6.05), W("is", 6.1, 6.2), W("good.", 6.25, 6.6), W("Um,", 6.9, 7.1), W("bye", 7.12, 7.14), W("now", 7.15, 7.3), W("all.", 7.35, 7.6)];
const facts = speechFacts(words, 8);
const sp = { language: "en", words, sentences: facts.sentences, quotes: facts.quotes, retakes: facts.retakes, fillers: facts.fillers, deadAir: 0, fillerShare: 0, pause: 0.3, cuts: [] } as never;
const inside = (t: number) => words.some((w) => t > w.start + 1e-6 && t < w.end - 1e-6);

describe("assemble cut", () => {
	test("nothing on: the whole clip", () => {
		expect(cutRanges(sp, 8, { repeats: false, pauses: false, fillers: false }, isFillerWord).ranges).toEqual([[0, 8]]);
	});
	test("each switch removes its own and never cuts inside a word", () => {
		const r = cutRanges(sp, 8, { repeats: true, pauses: true, fillers: true }, isFillerWord);
		expect(r.stats.repeats).toBe(1);
		expect(r.stats.fillers).toBe(1);
		expect(r.stats.repeatSeconds).toBeGreaterThan(2.5);
		for (const [a, b] of r.ranges) {
			expect(inside(a)).toBe(false);
			expect(inside(b)).toBe(false);
			expect(b).toBeGreaterThan(a);
		}
		const kept = words.filter((w) => r.ranges.some(([a, b]) => w.start >= a && w.end <= b)).map((w) => w.text);
		expect(kept).toEqual(["Hello", "there", "friend.", "This", "is", "good.", "bye", "now", "all."]);
	});
	test("pauses alone keep every word", () => {
		const r = cutRanges(sp, 8, { repeats: false, pauses: true, fillers: false }, isFillerWord);
		const kept = words.filter((w) => r.ranges.some(([a, b]) => w.start >= a && w.end <= b));
		expect(kept.length).toBe(words.length);
		expect(r.stats.pauseSeconds).toBeGreaterThan(2);
	});
	test("a length limit drops the weakest sentences, order kept", () => {
		const r = cutRanges(sp, 8, { repeats: true, pauses: true, fillers: true, limit: 1.5 }, isFillerWord);
		expect(r.stats.kept).toBeLessThanOrEqual(2.2);
		expect(r.stats.dropped).toBeGreaterThan(0);
	});
});

describe("assemble cut: a human pace", () => {
	test("pauses under 0.5 s stay; every cut keeps ≥0.10 s before and ≥0.15 s after speech", () => {
		const ws = [W("One", 0.5, 0.8), W("two.", 0.85, 1.2), W("Three", 1.6, 1.9), W("four.", 1.95, 2.3), W("Five", 4.0, 4.3), W("six.", 4.35, 4.7)];
		const f = speechFacts(ws, 6);
		const s2 = { language: "en", words: ws, sentences: f.sentences, quotes: [], retakes: [], fillers: [], deadAir: 0, fillerShare: 0, pause: 0.2, cuts: [] } as never;
		const r = cutRanges(s2, 6, { repeats: true, pauses: true, fillers: true, tight: true }, isFillerWord);
		expect(r.stats.pauses).toBe(1);
		expect(r.ranges.length).toBe(2);
		expect(r.ranges[0][1] - 2.3).toBeGreaterThanOrEqual(0.15 - 1e-6);
		expect(4.0 - r.ranges[1][0]).toBeGreaterThanOrEqual(0.1 - 1e-6);
		expect(0.5 - r.ranges[0][0]).toBeGreaterThanOrEqual(0.1 - 1e-6);
	});
});

describe("assemble fillers as whisper spells them", () => {
	test("Э-э-э, Ээээ, Мм, Um are fillers; words are not", () => {
		const { isFiller } = require("../cut");
		for (const w of ["Э-э-э,", "Ээээээ,", "Э-э-э-э", "Мм", "Ну,", "Um,", "uh"]) expect(isFiller(w)).toBe(true);
		for (const w of ["А", "у", "Эх", "Эта", "мама", "Ummm-kay", "Hello"]) expect(isFiller(w)).toBe(false);
	});
});
