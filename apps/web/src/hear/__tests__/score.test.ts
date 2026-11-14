// The score by parts on stems with known truth (the same plan as the shell's test/ideal-hear-truth.mjs, a buzzing
// «voice» instead of `say`): 120 → 140 BPM, bass and pad in known bars, four phrases, a pad alone, silence.
import { describe, expect, test } from "bun:test";
import { SCORE_RATE, scoreSong } from "../score";
import { barAt, partsIn, scoreText } from "../score-text";

const R = SCORE_RATE;
const barA = 2;
const barB = (60 / 140) * 4;
const B0 = 12 * barA;
const drumsEnd = B0 + 12 * barB;
const duration = drumsEnd + 9.5;
const n = Math.round(duration * R);
const beats = [...Array.from({ length: 48 }, (_, i) => i * 0.5), ...Array.from({ length: 48 }, (_, i) => B0 + (i * 60) / 140)];
const bars = [...Array.from({ length: 12 }, (_, i) => i * barA), ...Array.from({ length: 12 }, (_, i) => B0 + i * barB)];
const bar = (k: number) => bars[k - 1];
const end = (k: number) => (k < 24 ? bars[k] : drumsEnd);
const BASS: Array<[number, number]> = [
	[bar(5), end(12)],
	[bar(17), end(24)],
];
const PAD: Array<[number, number]> = [
	[bar(1), end(4)],
	[bar(13), end(16)],
	[drumsEnd, drumsEnd + 6],
];
const PHRASES: Array<[number, number]> = [
	[4, 5.5],
	[13, 14.3],
	[27.5, 28.7],
	[37, 38.2],
];

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;

function make() {
	const d = new Float32Array(n);
	const add = (x: Float32Array, t0: number, len: number, f: (t: number) => number) => {
		const a = Math.round(t0 * R);
		for (let i = 0; i < len * R && a + i < n; i++) x[a + i] += f(i / R);
	};
	beats.forEach((b, i) => {
		let ph = 0;
		add(d, b, 0.16, (t) => {
			ph += (2 * Math.PI * (45 + 75 * Math.exp(-t * 30))) / R;
			return 0.9 * Math.sin(ph) * Math.exp(-t * 18);
		});
		if (i % 2 === 1) add(d, b, 0.14, (t) => (0.45 * rnd() + 0.25 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 28));
		const next = beats[i + 1] ?? b + 60 / 140;
		for (const h of [b, (b + next) / 2]) {
			let prev = 0;
			add(d, h, 0.035, (t) => {
				const v = rnd();
				const o = (v - prev) * 0.12 * Math.exp(-t * 90);
				prev = v;
				return o;
			});
		}
	});
	const tone = (spans: Array<[number, number]>, partials: Array<[number, number]>, g: number) => {
		const x = new Float32Array(n);
		for (const [s, e] of spans) {
			const a = Math.round(s * R);
			const b = Math.min(n, Math.round(e * R));
			for (let i = a; i < b; i++) {
				let v = 0;
				for (const [f, l] of partials) v += l * Math.sin((2 * Math.PI * f * i) / R);
				x[i] = g * v * Math.min(1, (i - a) / (0.015 * R), (b - i) / (0.015 * R));
			}
		}
		return x;
	};
	const bass = tone(BASS, [[82.41, 1], [164.8, 0.5], [247.2, 0.25]], 0.35);
	const other = tone(PAD, [[261.6, 0.5], [329.6, 0.45], [392, 0.45], [523.3, 0.3]], 0.18);
	// a «voice»: a 160 Hz buzz with syllables (6 Hz), the phrase's level envelope
	const vocals = new Float32Array(n);
	for (const [s, e] of PHRASES) {
		for (let i = Math.round(s * R); i < Math.round(e * R); i++) {
			const t = i / R;
			const syl = 0.55 + 0.45 * Math.sin(2 * Math.PI * 6 * (t - s));
			let v = 0;
			for (let k = 1; k <= 12; k++) v += Math.sin(2 * Math.PI * 160 * k * t) / k;
			vocals[i] = 0.25 * v * syl * Math.min(1, (t - s) / 0.02, (e - t) / 0.02);
		}
	}
	return { drums: d, bass, other, vocals };
}

const stems = make();
const words = [
	{ text: "hello", start: 4.1, end: 4.5 },
	{ text: "world", start: 4.6, end: 5.2 },
	{ text: "faster", start: 27.6, end: 28.2 },
];
const score = scoreSong({ key: "0".repeat(32), duration, stems, words, language: "en" });

describe("the song's score on stems with known truth", () => {
	test("tempo per stretch within 1 BPM, the change found", () => {
		expect(score.tempo.length).toBe(2);
		expect(Math.abs(score.tempo[0].bpm - 120)).toBeLessThanOrEqual(1);
		expect(Math.abs(score.tempo[1].bpm - 140)).toBeLessThanOrEqual(1);
		expect(Math.abs(score.tempo[1].start - B0)).toBeLessThan(0.05);
	});
	test("downbeats within 30 ms of the true bars", () => {
		for (const t of bars) {
			const near = score.bars.reduce((m, b) => (Math.abs(b - t) < Math.abs(m - t) ? b : m), Infinity);
			expect(Math.abs(near - t)).toBeLessThanOrEqual(0.03);
		}
	});
	test("beats within 30 ms (bar 1's beat at 0 s may be missed: the song starts on it)", () => {
		let found = 0;
		for (const t of beats) if (score.beats.some((b) => Math.abs(b - t) <= 0.03)) found++;
		expect(found).toBeGreaterThanOrEqual(beats.length - 1);
	});
	test("each part's stretches within 0.15 s", () => {
		const close = (got: Array<[number, number]>, want: Array<[number, number]>) => {
			expect(got.length).toBe(want.length);
			got.forEach(([a, b], i) => {
				expect(Math.abs(a - want[i][0])).toBeLessThanOrEqual(0.15);
				expect(Math.abs(b - want[i][1])).toBeLessThanOrEqual(0.15);
			});
		};
		close(score.parts.bass.active, BASS);
		close(score.parts.other.active, PAD);
		close(score.parts.vocals.active, PHRASES);
		// the drums: from the first hit to the last one's decay
		close(score.parts.drums.active, [[0, beats[beats.length - 1] + 0.18]]);
	});
	test("hits by kind: a kick on every beat, the snare on 2 and 4", () => {
		const kicks = score.hits.filter((h) => h[1] === "k");
		const snares = score.hits.filter((h) => h[1] === "s");
		expect(beats.filter((b) => kicks.some((k) => Math.abs(k[0] - b) < 0.03)).length).toBeGreaterThanOrEqual(beats.length - 2);
		const backbeats = beats.filter((_, i) => i % 2 === 1);
		expect(backbeats.filter((b) => snares.some((k) => Math.abs(k[0] - b) < 0.03)).length).toBeGreaterThanOrEqual(backbeats.length - 2);
		// no snare on the kick-only beats
		expect(snares.filter((s) => beats.filter((_, i) => i % 2 === 0).some((b) => Math.abs(s[0] - b) < 0.03)).length).toBeLessThanOrEqual(2);
	});
	test("phrases carry their words; silence and the drums' break", () => {
		expect(score.phrases[0].text).toBe("hello world");
		expect(score.phrases[2].text).toBe("faster");
		expect(score.silences.length).toBe(1);
		expect(Math.abs(score.silences[0][0] - (drumsEnd + 6))).toBeLessThan(0.15);
		expect(score.breaks.length).toBe(1);
	});
	test("sections: the same pattern again gets the same letter", () => {
		const s = score.sections;
		expect(s[0].letter).toBe(s[2].letter);
		expect(s[1].letter).toBe(s[3].letter);
		expect(s[0].letter).not.toBe(s[1].letter);
		expect(s[1].parts).toContain("bass");
	});
	test("the text: parts by bars, phrases, drums stop", () => {
		const text = scoreText(score, { toT: (x) => x + 10, s0: 0, s1: duration, from: 0, to: duration }).join("\n");
		expect(text).toContain("120 BPM");
		expect(text).toContain("140 BPM");
		expect(text).toMatch(/bars 5–12 \(1[78]\.\d\d–3[34]\.\d\d\): drums, bass/);
		expect(text).toContain("“hello world”");
		expect(text).toMatch(/stop at 5[34]\.\d\d/);
		expect(text.split("\n").length).toBeLessThan(45);
		expect(partsIn(score, bar(17), end(17))).toEqual(["drums", "bass"]);
		expect(barAt(score, 30)).toBe(16);
		const detail = scoreText(score, { toT: (x) => x, s0: 0, s1: duration, from: 24, to: 32 }).join("\n");
		expect(detail).toMatch(/bar 13 2[34]\.\d\d: drums -?\d+, other -?\d+ · kick/);
		expect(detail).toContain("faster@");
	});
});
