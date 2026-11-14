import { describe, expect, test } from "bun:test";
import { DUCK_MERGE_SECONDS, DUCK_SHAPE, type DuckKey, type Measured, duckKeys, ducksOf, phrasesOf, planGains, roleOf } from "../balance/plan";

/** The level a clip's keys give at a time (straight between keys, flat outside), as the mixer reads them. */
const levelAt = (keys: DuckKey[], base: number, t: number) => {
	if (keys.length === 0) return base;
	if (t <= keys[0].time) return keys[0].db;
	for (let i = 1; i < keys.length; i++) if (t <= keys[i].time) return keys[i - 1].db + ((keys[i].db - keys[i - 1].db) * (t - keys[i - 1].time)) / (keys[i].time - keys[i - 1].time);
	return keys[keys.length - 1].db;
};

describe("phrases and ducks", () => {
	test("words close together are one phrase; phrases too close for the music to come back are one duck", () => {
		const words = [{ start: 1, end: 1.3 }, { start: 1.4, end: 1.9 }, { start: 2.2, end: 2.6 }, { start: 4, end: 4.5 }, { start: 9, end: 9.6 }];
		const phrases = phrasesOf(words);
		expect(phrases).toEqual([{ start: 1, end: 2.6 }, { start: 4, end: 4.5 }, { start: 9, end: 9.6 }]);
		// 2.6 → 4 is 1.4 s: less than a fall, a rise and a breath of music — the music stays down across it
		expect(DUCK_MERGE_SECONDS).toBeGreaterThan(1.4);
		expect(ducksOf(phrases)).toEqual([{ start: 1, end: 4.5 }, { start: 9, end: 9.6 }]);
	});
});

describe("the ducking keyframes of a music clip", () => {
	const ducks = [{ start: 5, end: 8 }, { start: 20, end: 24 }];
	const keys = duckKeys({ start: 0, duration: 30, baseDb: -6, duckDb: 12, ducks });

	test("four keys a duck: down before the first word, back after the last", () => {
		const { attack, lead, hold, release } = DUCK_SHAPE;
		expect(keys.map((k) => [k.time, k.db])).toEqual([
			[5 - lead - attack, -6],
			[5 - lead, -18],
			[8 + hold, -18],
			[8 + hold + release, -6],
			[20 - lead - attack, -6],
			[20 - lead, -18],
			[24 + hold, -18],
			[24 + hold + release, -6],
		].map(([t, db]) => [Math.round(t * 1000) / 1000, db]));
	});

	test("under every word the music is lower by exactly the chosen amount; between phrases it is back", () => {
		for (let t = 5; t <= 8; t += 0.05) expect(levelAt(keys, -6, t)).toBeCloseTo(-18, 6);
		for (let t = 20; t <= 24; t += 0.05) expect(levelAt(keys, -6, t)).toBeCloseTo(-18, 6);
		for (const t of [0, 2, 4.5, 9.2, 12, 19, 25.2, 29]) expect(levelAt(keys, -6, t)).toBeCloseTo(-6, 6);
	});

	test("no pumping: one move down and one up per duck, each one-way, the fall no faster than 12 dB in a quarter second", () => {
		let moves = 0;
		let direction = 0;
		let steepest = 0;
		let last = levelAt(keys, -6, 0);
		for (let t = 0.01; t <= 30; t += 0.01) {
			const now = levelAt(keys, -6, t);
			const d = now - last;
			if (Math.abs(d) > 1e-9) {
				const dir = Math.sign(d);
				if (dir !== direction) moves++;
				direction = dir;
				steepest = Math.max(steepest, Math.abs(d) / 0.01);
			} else direction = 0;
			last = now;
		}
		expect(moves).toBe(4);
		expect(steepest).toBeLessThanOrEqual(12 / DUCK_SHAPE.attack + 1e-6);
	});

	test("a clip that starts or ends inside a duck starts or ends at the level the duck has there", () => {
		const late = duckKeys({ start: 6, duration: 10, baseDb: 0, duckDb: 9, ducks });
		expect(late[0]).toEqual({ time: 0, db: -9 });
		expect(levelAt(late, 0, 1)).toBeCloseTo(-9, 6);
		expect(levelAt(late, 0, 5)).toBeCloseTo(0, 6);
		const cut = duckKeys({ start: 0, duration: 8.65, baseDb: 0, duckDb: 9, ducks });
		// 8.65 s is half way up the 0.8 s rise that starts at 8.25
		expect(cut[cut.length - 1].time).toBeCloseTo(8.65, 6);
		expect(cut[cut.length - 1].db).toBeCloseTo(-4.5, 2);
	});

	test("no words over the clip: no keys at all (its volume says it)", () => {
		expect(duckKeys({ start: 30, duration: 10, baseDb: -3, duckDb: 12, ducks })).toEqual([]);
		expect(duckKeys({ start: 0, duration: 10, baseDb: -3, duckDb: 12, ducks: [] })).toEqual([]);
	});
});

describe("the gains", () => {
	const voice = (id: string, loudness: number, seconds = 8): Measured => ({ id, role: "voice", loudness, momentary: loudness + 3, seconds });
	const music = (id: string, loudness: number, group?: string): Measured => ({ id, role: "music", loudness, momentary: loudness + 2, seconds: 30, group });
	const effect = (id: string, momentary: number): Measured => ({ id, role: "effect", loudness: momentary - 3, momentary, seconds: 1 });
	const plan = (clips: Measured[], target = -14) => Object.fromEntries(planGains(clips, target).map((g) => [g.id, g]));

	test("every voice clip lands on the target: the voice is evened between clips", () => {
		const p = plan([voice("a", -20), voice("b", -11.5), voice("c", -14.02)]);
		expect(p.a.gainDb).toBe(6);
		expect(p.b.gainDb).toBe(-2.5);
		expect(p.c.changed).toBe(false);
		for (const id of ["a", "b"]) expect(p[id].willBe).toBeCloseTo(-14, 6);
	});

	test("a clip too short to be judged takes the gain of the others; a silent one is left alone", () => {
		const p = plan([voice("a", -20), voice("b", -19), voice("word", -30, 0.6), voice("silent", Number.NEGATIVE_INFINITY, 0)]);
		expect(p.word.gainDb).toBe(5.5);
		expect(p.silent.changed).toBe(false);
	});

	test("music stands 4 LU under the voice where nobody speaks; with no voice at all it is the programme", () => {
		expect(plan([voice("v", -16), music("m", -9)]).m.gainDb).toBe(-9);
		expect(plan([music("m", -9)]).m.gainDb).toBe(-5);
		expect(plan([music("m", -9)], -23).m.gainDb).toBe(-14);
	});

	test("the stems of one song move by one gain: their balance is the song's", () => {
		const p = plan([voice("v", -14), music("drums", -12, "song"), music("bass", -20, "song"), music("other", -10)]);
		expect(p.drums.gainDb).toBe(-6);
		expect(p.bass.gainDb).toBe(-6);
		expect(p.other.gainDb).toBe(-8);
	});

	test("an effect louder than the voice comes down to just under it; a far too quiet one comes into hearing; one in between is left", () => {
		const p = plan([voice("v", -14), effect("bang", -6), effect("whisper", -40), effect("fine", -20)]);
		expect(p.bang.gainDb).toBe(-9);
		expect(p.whisper.gainDb).toBe(14);
		expect(p.fine.changed).toBe(false);
	});
});

describe("what a clip is", () => {
	test("what the person said wins; then stems and the library; then what was heard", () => {
		expect(roleOf({ said: "yes", library: true, seconds: 60 })).toBe("voice");
		expect(roleOf({ library: true, seconds: 60 })).toBe("music");
		expect(roleOf({ library: true, seconds: 2 })).toBe("effect");
		expect(roleOf({ stem: "part", seconds: 60 })).toBe("music");
		expect(roleOf({ stem: "music", seconds: 60 })).toBe("music");
		// a song's vocal beside its instrumental is the song; cut free of it, it is a voice
		expect(roleOf({ stem: "voice", stemTogether: true, seconds: 60 })).toBe("music");
		expect(roleOf({ stem: "voice", words: 40, speechSeconds: 30, seconds: 60 })).toBe("voice");
		expect(roleOf({ song: true, words: 80, speechSeconds: 40, seconds: 180 })).toBe("music");
		expect(roleOf({ words: 25, speechSeconds: 9, seconds: 12 })).toBe("voice");
		expect(roleOf({ words: 0, seconds: 3 })).toBe("effect");
		// a long sound with no words is a bed: it goes under the voice like music
		expect(roleOf({ words: 0, seconds: 45 })).toBe("music");
		expect(roleOf({ said: "no", words: 25, speechSeconds: 9, seconds: 12 })).toBe("effect");
	});
});
