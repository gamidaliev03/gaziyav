// The song's score with the beat network's answer (score.ts + net-grid.ts), on made drum stems: what reaches the
// score — and so Claude's text, the bars on the timeline and the cache — and what stays exactly as it was.
import { describe, expect, test } from "bun:test";
import { NET_SCORE_VERSION, SCORE_RATE, SCORE_VERSION, scoreSong } from "../score";
import { scoreText } from "../score-text";

const R = SCORE_RATE;
const every = (step: number, from: number, to: number) => Array.from({ length: Math.floor((to - from) / step + 1e-9) + 1 }, (_, i) => Math.round((from + i * step) * 1000) / 1000);

let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;

/** Four stems of `seconds`: drums from hits («k» kick, «s» snare, «h» hat), the other parts silent. */
function stemsOf(seconds: number, hits: Array<[number, "k" | "s" | "h"]>) {
	const n = Math.round(seconds * R);
	const d = new Float32Array(n);
	const add = (t0: number, len: number, f: (t: number) => number) => {
		const a = Math.round(t0 * R);
		for (let i = 0; i < len * R && a + i < n; i++) d[a + i] += f(i / R);
	};
	for (const [t, kind] of hits) {
		if (kind === "k") {
			let ph = 0;
			add(t, 0.16, (x) => {
				ph += (2 * Math.PI * (45 + 75 * Math.exp(-x * 30))) / R;
				return 0.9 * Math.sin(ph) * Math.exp(-x * 18);
			});
		} else if (kind === "s") add(t, 0.14, (x) => (0.45 * rnd() + 0.25 * Math.sin(2 * Math.PI * 190 * x)) * Math.exp(-x * 28));
		else {
			let prev = 0;
			add(t, 0.035, (x) => {
				const v = rnd();
				const o = (v - prev) * 0.12 * Math.exp(-x * 90);
				prev = v;
				return o;
			});
		}
	}
	return { drums: d, bass: new Float32Array(n), other: new Float32Array(n), vocals: new Float32Array(n) };
}

/** A waltz at 150 BPM: kick on 1, snare on 2 and 3, from 0.5 s to 62.5 s. */
const W_BEATS = every(0.4, 0.5, 62.5);
const W_BARS = W_BEATS.filter((_, i) => i % 3 === 0);
const waltz = stemsOf(66, W_BEATS.flatMap((t, i): Array<[number, "k" | "s" | "h"]> => [[t, i % 3 === 0 ? "k" : "s"], [t + 0.2, "h"]]));
const W = { key: "a".repeat(32), duration: 66, stems: waltz };

describe("the beat network in the song's score", () => {
	const today = scoreSong(W);

	test("not asked (no part) or asked without an answer: today's very numbers; only the mark differs", () => {
		expect(today.v).toBe(SCORE_VERSION);
		const asked = scoreSong({ ...W, net: null });
		expect(asked.v).toBe(NET_SCORE_VERSION);
		expect({ ...asked, v: 0 }).toEqual({ ...today, v: 0 });
		// no answer: no «refereed» mark — the Beat markers, fit_music and check_cuts keep their own grid
		expect(today.refereed).toBeUndefined();
		expect(asked.refereed).toBeUndefined();
		// an answer that agrees (the same beats, its bars where today's are): nothing moves either, but the grid is now
		// the one those tools read too
		const agree = scoreSong({ ...W, net: { beats: today.beats, downbeats: today.bars.filter((t) => t >= today.beats[0] - 0.01) } });
		const { refereed: mark, ...rest } = agree;
		expect({ ...rest, v: 0 }).toEqual({ ...today, v: 0 });
		expect(mark).toBe(true);
	}, 60_000); // scoreSong on a minute of sound: ~1 s on a quiet Mac, 5–6 s at load 60

	test("a waltz: today's grid hears its beats but counts four; the network's three reach the bars and Claude's text", () => {
		// red before: 150 BPM, the bars four beats long, «4/4 assumed»
		expect(today.tempo.length).toBe(1);
		expect(Math.round(today.tempo[0].bpm)).toBe(150);
		expect(Math.round((today.bars[5] - today.bars[4]) * 10) / 10).toBe(1.6);
		const text = (s: typeof today) => scoreText(s, { toT: (x) => x, s0: 0, s1: 66, from: 0, to: 66 }).join("\n");
		expect(text(today)).toContain("4/4 assumed");
		// the network as it answered on the made waltz: one beat a bar, and stray «downbeats» on the last beats
		const net = { beats: W_BARS.slice(0, -2), downbeats: [...W_BARS.slice(0, -2), 59.7, 60.1, 60.5, 60.9, 61.3] };
		const s = scoreSong({ ...W, net });
		expect(s.v).toBe(NET_SCORE_VERSION);
		expect(s.meter).toBe(3);
		expect(s.beats).toEqual(today.beats); // today's beats stay
		const inSong = s.bars.filter((t) => t <= 62.6);
		expect(inSong.length).toBe(W_BARS.length);
		expect(inSong.every((t, i) => Math.abs(t - W_BARS[i]) <= 0.03)).toBe(true); // every bar on its «one», to the end
		expect(text(s)).toContain("3/4 heard");
	}, 60_000); // scoreSong on a minute of sound: ~1 s on a quiet Mac, 5–6 s at load 60

	test("today's grid flips between tempo levels: the network's steady beats, the bars placed on them by today's own rule", () => {
		// 120 BPM, kick on 1 and 3, snare on 2 and 4; from 30 s the snare and the hats stop, the kick goes on alone
		const beats = every(0.5, 0.5, 60);
		const hits = beats.flatMap((t, i): Array<[number, "k" | "s" | "h"]> => (t < 30 ? [[t, i % 2 === 0 ? "k" : "s"], [t + 0.25, "h"]] : i % 2 === 0 ? [[t, "k"]] : []));
		const song = { key: "b".repeat(32), duration: 62, stems: stemsOf(62, hits) };
		const flat = scoreSong(song);
		const flips = flat.tempo.some((t, i) => i > 0 && [2, 0.5].some((k) => Math.abs(t.bpm / flat.tempo[i - 1].bpm / k - 1) < 0.06));
		expect(flips).toBe(true); // red before: today's grid drops to half when the snare stops
		// the network: steady beats; its own bars implausible (a «bar» of five beats)
		const net = { beats, downbeats: beats.filter((_, i) => i % 5 === 0) };
		const s = scoreSong({ ...song, net });
		expect(s.tempo.length).toBe(1);
		expect(Math.round(s.tempo[0].bpm)).toBe(120);
		expect(s.beats.length).toBe(beats.length);
		expect(s.beats.every((b, i) => Math.abs(b - beats[i]) <= 0.03)).toBe(true);
		// bars by today's rule: a bar every four beats, on the kick that opens the pattern — not the network's fives
		const trueBars = beats.filter((_, i) => i % 4 === 0);
		const inSong = s.bars.filter((t) => t >= 0.4 && t <= 60.1);
		expect(inSong.length).toBe(trueBars.length);
		expect(inSong.every((t, i) => Math.abs(t - trueBars[i]) <= 0.03)).toBe(true);
		expect(s.meter).toBeUndefined();
	}, 60_000); // scoreSong on a minute of sound: ~1 s on a quiet Mac, 5–6 s at load 60
});
