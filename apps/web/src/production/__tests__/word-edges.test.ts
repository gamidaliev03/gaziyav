import { expect, test } from "bun:test";
import type { PauseCut, Sentence, Word } from "../material";
import { endCut, startCut, tightRanges } from "../plan";

// claude-produce's 3-minute YouTube test (talk-en.mp4, 09.11 20:41): the sentence «Step 2.» became the chapter card,
// and the piece «Add one lamp.» started at 55.600 s — 120 ms before «Add», 70 ms into «2.»: the two words are only
// 40 ms apart, so no pause cut point exists there, and the fallback ignored the word before. The words and the cut
// points are that clip's brief, as analyze.ts made them.
const words: Word[] = [
	{ text: "alone.", start: 52.85, end: 53.25 },
	{ text: "Step", start: 55.3, end: 55.53 },
	{ text: "2.", start: 55.53, end: 55.68 },
	{ text: "Add", start: 55.72, end: 55.91 },
	{ text: "one", start: 55.91, end: 56.11 },
	{ text: "lamp.", start: 56.34, end: 57.32 },
	{ text: "One", start: 58.1, end: 58.43 },
	{ text: "lamp,", start: 58.43, end: 58.84 },
];
const cuts: PauseCut[] = [
	{ lo: 53.25, hi: 55.3, end: 53.467, start: 55.067 },
	{ lo: 56.11, hi: 56.34, end: 56.2, start: 56.233 },
	{ lo: 57.32, hi: 58.1, end: 57.6, start: 57.867 },
	{ lo: 58.84, hi: 59.17, end: 59.067, start: 59.067 },
];
const addOneLamp: Sentence = { i: 12, from: 55.72, to: 57.32, text: "Add one lamp.", words: 3, hook: 0.42, complete: true };
const stepTwo: Sentence = { i: 11, from: 55.3, to: 55.68, text: "Step 2.", words: 2, hook: 0.25, complete: true };

test("a piece that starts at a word with no pause before it takes nothing of the word before («Add» after «2.», 40 ms apart)", () => {
	const [first] = tightRanges(addOneLamp, words, cuts, 0.6, () => false);
	expect(first[0]).toBeGreaterThanOrEqual(55.68);
	expect(first[0]).toBeLessThanOrEqual(55.72);
	expect(first[1]).toBe(57.6);
	expect(startCut(cuts, 55.72, words)).toBe(first[0]);
});

test("a piece that ends at a word with the next one right after it takes nothing of the next word («2.» before «Add»)", () => {
	const [only] = tightRanges(stepTwo, words, cuts, 0.6, () => false);
	expect(only[0]).toBe(55.067);
	expect(only[1]).toBeGreaterThanOrEqual(55.68);
	expect(only[1]).toBeLessThanOrEqual(55.72);
	// Words that touch (no gap at all): the cut is the boundary itself.
	expect(endCut(cuts, 55.53, words)).toBe(55.53);
	expect(startCut(cuts, 55.53, words)).toBe(55.53);
	// With a pause cut point there, it wins as before; with no word near, the old margins stay.
	expect(startCut(cuts, 55.3, words)).toBe(55.067);
	expect(startCut(cuts, 10, words)).toBeCloseTo(9.88, 6);
	expect(endCut(cuts, 70, words)).toBeCloseTo(70.15, 6);
});
