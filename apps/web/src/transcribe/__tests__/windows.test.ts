import { describe, expect, test } from "bun:test";
import type { Span } from "../align";
import { speechWindows, zonesOfWords } from "../windows";

const flat = (seconds: number, db = -30) => new Float32Array(Math.round(seconds * 100)).fill(db);

describe("windows for an engine that hears 25 s at once", () => {
	test("phrases go together while the window stays short; silence between windows is not given to the engine", () => {
		// six 4-s phrases 0.6 s apart, a 20-s pause, three more
		const islands: Span[] = [];
		for (let i = 0; i < 6; i++) islands.push({ start: 1 + i * 4.6, end: 5 + i * 4.6 });
		for (let i = 0; i < 3; i++) islands.push({ start: 49 + i * 4.6, end: 53 + i * 4.6 });
		const windows = speechWindows(islands, flat(70), 70);
		expect(windows).toEqual([
			{ start: 0.8, end: 19 }, // four phrases: 18 s
			{ start: 19.2, end: 28.2 }, // the next two, up to the long pause
			{ start: 48.8, end: 62.4 },
		]);
		for (const w of windows) expect(w.end - w.start).toBeLessThanOrEqual(25);
		// every phrase is inside exactly one window
		for (const island of islands) expect(windows.filter((w) => w.start <= island.start && island.end <= w.end).length).toBe(1);
	});

	test("a stretch with no pause (a voice over music) is cut at its quietest moment, never longer than a window", () => {
		const levels = flat(92, -20);
		// the voice stops for a breath at 18.3–18.9, 41–42 and 63.5–64.1: the bed alone is 20 dB lower
		for (const [a, b] of [[18.3, 18.9], [41, 42], [63.5, 64.1]]) levels.fill(-40, Math.round(a * 100), Math.round(b * 100));
		const windows = speechWindows([{ start: 0, end: 92 }], levels, 92);
		for (const w of windows) expect(w.end - w.start).toBeLessThanOrEqual(25);
		// the cuts fall into the breaths
		const cuts = windows.slice(1).map((w) => w.start);
		expect(cuts.length).toBeGreaterThanOrEqual(3);
		expect(cuts.some((c) => c >= 18.3 && c <= 18.9)).toBe(true);
		expect(cuts.some((c) => c >= 41 && c <= 42)).toBe(true);
		expect(cuts.some((c) => c >= 63.5 && c <= 64.1)).toBe(true);
		// nothing of the sound is left out, nothing is given twice
		expect(windows[0].start).toBe(0);
		expect(windows[windows.length - 1].end).toBe(92);
		for (let i = 1; i < windows.length; i++) expect(windows[i].start).toBeCloseTo(windows[i - 1].end, 3);
	});

	test("no sound: no window", () => {
		expect(speechWindows([], flat(10), 10)).toEqual([]);
	});
});

describe("where the voice is, from the engine's own word times", () => {
	test("words close together are one stretch, a pause splits them", () => {
		const words = [
			{ start: 15.04, end: 15.4 },
			{ start: 15.4, end: 16.2 },
			{ start: 16.2, end: 16.9 },
			{ start: 18.92, end: 19.4 },
			{ start: 19.4, end: 20.1 },
		];
		expect(zonesOfWords(words)).toEqual([
			{ start: 14.92, end: 17.02 },
			{ start: 18.8, end: 20.22 },
		]);
		expect(zonesOfWords([])).toEqual([]);
	});
});
