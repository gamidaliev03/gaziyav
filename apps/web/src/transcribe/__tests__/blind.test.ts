// A voice under a bed that drowns it (11.11, the captions stick): the zones of the speech detector are the islands
// there, long stretches keep Whisper's own times, numbers weigh what they take to say — and without the detector the
// words are laid exactly as before.
import { describe, expect, test } from "bun:test";
import { alignWords, dropPhantoms, FINE, type Span, speechIslands, type Word } from "../align";
import { lay, wordStretches } from "../server/listen";
import { blindZones, COVER, withBlind } from "../vad";

const words = (list: Array<[string, number, number]>): Word[] => list.map(([text, start, end]) => ({ text, start, end }));
// a bed's beats: a tenth of a second of «sound» every half second
const beats = (from: number, to: number): Span[] => {
	const out: Span[] = [];
	for (let t = from; t < to; t += 0.5) out.push({ start: +t.toFixed(2), end: +(t + 0.1).toFixed(2) });
	return out;
};

describe("a voice the bed drowns", () => {
	test("a zone the islands cover too little of is blind; speech that shows itself is not", () => {
		const zones = [{ start: 1, end: 9 }, { start: 10, end: 14 }];
		// zone 1: beats only (a fifth covered); zone 2: speech with its pauses (most of it covered)
		const islands = [...beats(1, 9), { start: 10, end: 11.6 }, { start: 11.8, end: 13.9 }];
		expect(COVER).toBeGreaterThan(0.2);
		expect(blindZones(islands, zones)).toEqual([{ start: 1, end: 9 }]);
		const laid = withBlind(islands, blindZones(islands, zones));
		expect(laid).toEqual([{ start: 1, end: 9 }, { start: 10, end: 11.6 }, { start: 11.8, end: 13.9 }]);
		expect(withBlind(islands, [])).toBe(islands);
	});

	test("words over beats keep their place within a few tenths of a second; crammed into the beats they were seconds off", () => {
		// Whisper's own times, 0.28 s early, over 20 s of voice under a bed (a new sentence every 2 s)
		const heard: Word[] = [];
		for (let k = 0; k < 10; k++) heard.push(...words([[`раз${k}`, 1 + 2 * k - 0.28, 1.6 + 2 * k - 0.28], [`два${k}.`, 1.7 + 2 * k - 0.28, 2.6 + 2 * k - 0.28]]));
		const zone = [{ start: 1, end: 21 }];
		// (gated to the zone first, as listen.ts does: the bed's beats outside the voice are gone)
		const islands = beats(1, 21);
		const blind = withBlind(islands, blindZones(islands, zone));
		const laid = alignWords(heard, blind, blind, { detector: true });
		const off = laid.map((w, i) => Math.abs(w.start - (heard[i].start + 0.28)));
		expect(Math.max(...off)).toBeLessThan(0.05);
		// the old way on the beats: some word lands far away
		const old = alignWords(heard, islands);
		expect(Math.max(...old.map((w, i) => Math.abs(w.start - (heard[i].start + 0.28))))).toBeGreaterThan(0.3);
	});

	test("a number takes what it takes to say: the words after it are not pushed", () => {
		// «Позвоните нам по номеру 555-35-35.» — 0.9 s for the first four words, 2.1 s for the number
		const heard = words([["Позвоните", 34.11, 34.46], ["нам", 34.46, 34.51], ["по", 34.51, 34.69], ["номеру", 34.69, 35.23], ["555-35-35.", 35.23, 37.9]]);
		const island = [{ start: 34.13, end: 38.04 }];
		const said = [34.13, 34.67, 34.84, 34.97, 35.4];
		const err = (laid: Word[]) => Math.max(...laid.map((w, i) => Math.abs(w.start - said[i])));
		expect(err(alignWords(heard, island, island, { detector: true }))).toBeLessThan(err(alignWords(heard, island)));
		expect(err(alignWords(heard, island, island, { detector: true }))).toBeLessThan(0.45);
	});

	test("without the detector's options the words are laid exactly as before", () => {
		const heard = words([["Добрый", 0, 0.51], ["вечер,", 0.51, 1.11], ["в", 1.11, 1.19], ["эфире", 1.19, 1.72], ["2026", 1.72, 2.4]]);
		const island = [{ start: 0.4, end: 2.6 }];
		expect(alignWords(heard, island, island, {})).toEqual(alignWords(heard, island, island));
	});

	test("lay: under a bed no heard word is dropped — with the detector's zones, and when it was caught missing the voice", () => {
		// 30 s of voice under a bed: levels that show only the beats (a loud frame every half second)
		const levels = new Float32Array(3200).fill(-30);
		for (let f = 0; f < levels.length; f += 50) levels.fill(-10, f, f + 10);
		const islands = beats(0, 32);
		const heard: Word[] = [];
		for (let k = 0; k < 15; k++) heard.push(...words([[`раз${k}`, 1 + 2 * k - 0.28, 1.6 + 2 * k - 0.28], [`два${k}.`, 1.7 + 2 * k - 0.28, 2.6 + 2 * k - 0.28]]));
		const trusted = lay({ words: heard, language: "ru", voiced: [{ start: 1, end: 31 }] }, levels, islands);
		expect(trusted.length).toBe(heard.length);
		expect(Math.max(...trusted.map((w, i) => Math.abs(w.start - (heard[i].start + 0.28))))).toBeLessThan(0.35);
		// caught missing the voice: the engine's own stretches are the islands where the bed hides the voice. (Not proven:
		// beats of the bed outside them are islands as before, and a first word may still be pulled to one up to 1.6 s
		// early — as on rc32.)
		const missed = lay({ words: heard, language: "ru", doubted: 1, believed: 1 }, levels, beats(1, 31));
		expect(missed.length).toBe(heard.length);
		expect(Math.max(...missed.map((w, i) => Math.abs(w.start - (heard[i].start + 0.28))))).toBeLessThan(0.35);
		// no detector at all: rc32's path, exactly the calls it made before the detector existed
		const plain = lay({ words: heard, language: "ru" }, levels, islands);
		expect(plain).toEqual(dropPhantoms(alignWords(heard, islands, speechIslands(levels, FINE)), islands));
	});

	test("the stretches the engine's own words cover", () => {
		expect(wordStretches(words([["a", 0, 1], ["b", 1, 2], [" ", 2, 9], ["c", 2.3, 3], ["d", 5, 6]]))).toEqual([{ start: 0, end: 3 }, { start: 5, end: 6 }]);
	});
});
