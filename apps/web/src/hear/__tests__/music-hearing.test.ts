import { describe, expect, test } from "bun:test";
import type { Note } from "../describe";
import { dropHallucinations } from "../hallucinations";
import { type MusicWin, playsDuring, playsIn, summarizeMusic, sungLines } from "../music";
import { isSong, notesFor } from "../song";

// stem), «где тишина или другой муз инструмент ебашит другой» (nothing said which instrument plays when), «a low voice
// speaks» and «mains hum → fix_sound» on a song. Then the hearing reads a song like a musician, on the full mix.

const tags = (o: Record<string, number>): Array<[string, number]> => Object.entries(o).sort((a, b) => b[1] - a[1]);
const ROCK = { Music: 0.95, "Rock music": 0.55, "Punk rock": 0.62, Grunge: 0.2, "Musical instrument": 0.5, Guitar: 0.6, "Electric guitar": 0.42 };

/** A punk song in 3 s windows: guitar alone, then the band with a woman singing, a hole of silence, drums alone. */
const SONG: MusicWin[] = [
	{ t: 0, len: 3, tags: tags({ ...ROCK }), db: -14 },
	{ t: 3, len: 3, tags: tags({ ...ROCK, "Drum kit": 0.5, Drum: 0.4, "Bass guitar": 0.15, Singing: 0.55, "Female singing": 0.3 }), db: -11 },
	{ t: 6, len: 3, tags: tags({ ...ROCK, "Drum kit": 0.55, "Bass guitar": 0.2, Singing: 0.6, "Female singing": 0.35 }), db: -11 },
	{ t: 9, len: 3, tags: tags({ ...ROCK, "Drum kit": 0.5, "Bass guitar": 0.12, Singing: 0.5, "Female singing": 0.25, "Electric guitar": 0.4 }), db: -11 },
	{ t: 12, len: 3, tags: tags({ Silence: 0.8, Music: 0.05 }), db: -90 },
	{ t: 15, len: 3, tags: tags({ Music: 0.9, "Drum kit": 0.7, Drum: 0.6, "Rock music": 0.3, "Punk rock": 0.3 }), db: -16 },
	{ t: 18, len: 3, tags: tags({ Music: 0.9, "Drum kit": 0.68, Drum: 0.6, "Rock music": 0.3, "Punk rock": 0.32 }), db: -16 },
];

describe("what plays when, on the full mix", () => {
	test("the instruments of every stretch, the silence, the singer's voice, the genre from AudioSet's classes", () => {
		const s = summarizeMusic(SONG, (x) => x + 100);
		expect(s.genre[0][0]).toBe("Punk rock");
		expect(s.genre.map(([l]) => l)).toContain("Rock music");
		expect(s.stretches.map((x) => [x.start, x.end])).toEqual([[100, 103], [103, 112], [112, 115], [115, 121]]);
		expect(s.stretches[0].plays).toEqual(["electric guitar"]);
		expect(s.stretches[0].voice).toBeNull();
		expect(s.stretches[1].plays).toEqual(expect.arrayContaining(["drum kit", "electric guitar", "bass guitar"]));
		expect(s.stretches[1].voice).toBe("singing (female voice)");
		expect(s.stretches[2].silent).toBe(true);
		expect(s.stretches[3].plays).toEqual(["drum kit"]);
		expect(s.singing).toBeCloseTo(3 / 7, 2);
		expect(s.instruments.slice(0, 2)).toEqual([["drum kit", 0.71], ["electric guitar", 0.57]]);
	});

	test("the style from 10 s windows, low as the tagger's style classes are: their family is named (punk, grunge, metal → rock)", () => {
		const long: MusicWin[] = [0, 10].map((t) => ({ t, len: 10, tags: tags({ Music: 0.9, "Punk rock": 0.05, "Rock music": 0.04, Grunge: 0.02, "Pop music": 0.01 }) }));
		const s = summarizeMusic(SONG, (x) => x, long);
		expect(s.family).toBe("rock");
		expect(s.genre.map(([l]) => l)).toEqual(["Punk rock", "Rock music", "Grunge"]);
	});

	test("a section's instruments are those heard in half of it; a voice counts from a third", () => {
		const s = summarizeMusic(SONG);
		const verse = playsDuring(s.stretches, 3, 12);
		expect(verse.plays).toEqual(expect.arrayContaining(["drum kit", "electric guitar", "bass guitar"]));
		expect(verse.voice).toMatch(/singing/);
		expect(playsDuring(s.stretches, 12, 15).silent).toBe(true);
	});

	test("a guitar named «Guitar» only counts as a guitar when no electric or acoustic one is heard", () => {
		expect(playsIn({ t: 0, len: 3, tags: tags({ Music: 0.9, Guitar: 0.5, "Electric guitar": 0.3 }) }).plays).toEqual(["electric guitar"]);
		expect(playsIn({ t: 0, len: 3, tags: tags({ Music: 0.9, Guitar: 0.5 }) }).plays).toEqual(["guitar"]);
	});

	test("sung lines with times, where a voice is heard; a credit line in the drum break is Whisper's, not the singer's", () => {
		const s = summarizeMusic(SONG);
		const w = (text: string, start: number) => ({ text, start, end: start + 0.4 });
		const lines = sungLines([w("мама", 3.5), w("я", 4), w("тебя", 4.5), w("люблю.", 5), w("Субтитры", 16), w("подогнал", 16.5), w("«Симон»!", 17)], s.stretches);
		expect(lines.map((l) => l.text)).toEqual(["мама я тебя люблю."]);
		expect(lines[0].start).toBe(3.5);
	});
});

describe("Whisper's hallucinations", () => {
	const w = (text: string, start: number, end = start + 0.4) => ({ text, start, end });
	test("a subtitle credit that stands alone goes, real words stay", () => {
		const words = [w("Сегодня", 1), w("про", 1.5), w("кофе.", 2), w("Субтитры", 20), w("сделал", 20.5), w("DimaTorzok", 21)];
		expect(dropHallucinations(words).map((x) => x.text)).toEqual(["Сегодня", "про", "кофе."]);
	});
	test("«Спасибо за просмотр» goes only over music: a person may really say it", () => {
		const words = [w("Вот", 1), w("и", 1.5), w("всё.", 2), w("Спасибо", 9), w("за", 9.5), w("просмотр!", 10)];
		expect(dropHallucinations(words, () => false).map((x) => x.text)).toHaveLength(6);
		expect(dropHallucinations(words, (a) => a >= 8).map((x) => x.text)).toEqual(["Вот", "и", "всё."]);
		expect(dropHallucinations([w("Продолжение", 30), w("следует...", 30.6)], () => true)).toEqual([]);
	});
});

describe("a song is sung, not spoken", () => {
	const notes: Note[] = [
		{ area: "sound", what: "hum", severity: 2, line: "mains hum 50 Hz", fix: "hum" },
		{ area: "sound", what: "noise", severity: 2, line: "noisy", fix: "noise" },
		{ area: "sound", what: "sibilance", severity: 2, line: "sibilant", fix: "sibilance" },
		{ area: "sound", what: "clipping", severity: 2, line: "clipping in 2 places" },
		{ area: "voice", what: "pitch", severity: 0, line: "low voice (typical adult male range), median 120 Hz" },
		{ area: "voice", what: "pace", severity: 1, line: "190 words/min (fast)" },
		{ area: "music", what: "character", severity: 0, line: "energetic music, intense, dark, 172 BPM" },
	];
	test("on a song: no voice-recording fixes, no voice range from the mix — said so instead", () => {
		const v = isSong({ library: false, stem: null, heardAll: [["Music", 0.92], ["Punk rock", 0.4], ["Speech", 0.3]], segments: [{ start: 0, end: 60, kind: "speech" }], from: 0, to: 60, words: 80 });
		expect(v.song).toBe(true);
		expect(v.sung).toBe(true);
		const out = notesFor(notes, v, 80);
		expect(out.map((n) => n.what)).toEqual(["clipping", "character", "pitch"]);
		expect(out.find((n) => n.what === "pitch")?.line).toMatch(/singing over music: the voice's range is not measured/);
	});
	test("on a song's voice stem the range is measured (on the separated vocal); a talking clip keeps everything", () => {
		const stem = isSong({ library: false, stem: "voice", segments: [], from: 0, to: 60, words: 80 });
		const out = notesFor(notes, stem, 80);
		expect(out.find((n) => n.what === "pitch")?.line).toMatch(/measured on the separated vocal/);
		expect(out.some((n) => n.fix === "hum" || n.fix === "sibilance")).toBe(false);
		const talk = isSong({ library: false, stem: null, heardAll: [["Speech", 0.9]], segments: [{ start: 0, end: 60, kind: "speech" }], from: 0, to: 60, words: 120 });
		expect(talk.song).toBe(false);
		expect(notesFor(notes, talk, 120)).toEqual(notes);
	});
});

describe("beat markers keep their grid", () => {
	test("a second pass at 170 BPM over markers at 118 keeps the 118 grid; 120 over 118 replaces it", async () => {
		const { markersTempo, tempoDisagrees } = await import("../music");
		const old = Array.from({ length: 16 }, (_, i) => 2 + (i * 60) / 118);
		expect(Math.round(markersTempo(old))).toBe(118);
		expect(tempoDisagrees(markersTempo(old), 170)).toBe(true);
		expect(tempoDisagrees(markersTempo(old), 120)).toBe(false);
		expect(markersTempo(old.slice(0, 5))).toBe(0);
	});
});
