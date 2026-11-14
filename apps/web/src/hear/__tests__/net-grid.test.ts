// The beat network as a referee (net-grid.ts): what it may change in the song's grid and what it must leave alone.
import { expect, test } from "bun:test";
import { beatsPerBar, bpmOf, referee, snapTo, tempoOf } from "../net-grid";

const every = (step: number, from: number, to: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => Math.round((from + i * step) * 1000) / 1000);
const stretch = (bpm: number, start: number, end: number) => ({ start, end, bpm });
const grid = (bpm: number, start = 0.5, end = 60) => ({ tempo: [stretch(bpm, start, end)], beats: every(60 / bpm, start, end) });

test("the helpers: tempo of a list of beats, beats in a bar, snapping, tempo stretches", () => {
	expect(Math.round(bpmOf(every(0.5, 0, 30)))).toBe(120);
	expect(beatsPerBar(every(0.5, 0, 30), every(2, 0, 30))).toEqual({ count: 4, share: 1 });
	expect(beatsPerBar(every(0.4, 0, 30), every(1.2, 0, 30)).count).toBe(3);
	expect(snapTo([1.02, 2.0, 3.2], [1.0, 2.01, 5], 0.03)).toEqual([1, 2.01, 3.2]);
	const two = tempoOf([...every(0.5, 0, 23.5), ...every(60 / 140, 24, 44)]);
	expect(two.map((t) => Math.round(t.bpm))).toEqual([120, 140]);
	expect(Math.abs(two[1].start - 24)).toBeLessThan(1.5);
});

test("no answer, or an answer that agrees: today's grid stands, untouched", () => {
	const g = grid(120);
	expect(referee(g, null).rule).toBe("dsp");
	expect(referee(g, { beats: [1, 2, 3], downbeats: [1] }).rule).toBe("dsp");
	const same = referee(g, { beats: every(0.5, 0.52, 60), downbeats: every(2, 1.02, 60) });
	expect(same.rule).toBe("dsp"); // even though its bars start a beat later: where the tempo agrees nothing moves
	expect(same.beats).toBe(g.beats);
	expect(same.bars).toBeNull();
});

test("half-time: today's grid at half the network's tempo → the network's beats and bars, set on the drum hits", () => {
	const hits = every(60 / 140, 0.5, 60);
	const r = referee(grid(70), { beats: every(60 / 140, 0.52, 60).map((t) => Math.round(t * 50) / 50), downbeats: every(240 / 140, 0.52, 60).map((t) => Math.round(t * 50) / 50) }, hits);
	expect(r.rule).toBe("network");
	expect(r.meter).toBe(4);
	expect(Math.round(r.tempo[0].bpm)).toBe(140);
	expect(r.beats.every((b) => hits.some((h) => Math.abs(h - b) < 0.001))).toBe(true); // on the hits, not on the 20 ms steps
	expect(Math.abs((r.bars as number[])[1] - (r.bars as number[])[0] - 240 / 140)).toBeLessThan(0.01);
});

test("a grid that flips between tempo levels gives way to a steady network", () => {
	const flipping = { tempo: [stretch(115, 0, 100), stretch(152.4, 100, 230)], beats: [...every(60 / 115, 0, 100), ...every(60 / 152.4, 100.3, 230)] };
	const r = referee(flipping, { beats: every(60 / 115, 0.02, 230), downbeats: every(240 / 115, 0.02, 230) });
	expect(r.rule).toBe("network");
	expect(r.tempo.length).toBe(1);
	expect(Math.round(r.tempo[0].bpm)).toBe(115);
	// …but a real tempo change (120 → 140) is no flip: the grid stands
	const changing = { tempo: [stretch(120, 0, 24), stretch(140, 24, 44)], beats: [...every(0.5, 0, 23.5), ...every(60 / 140, 24, 44)] };
	expect(referee(changing, { beats: changing.beats.map((t) => t + 0.01), downbeats: changing.beats.filter((_, i) => i % 4 === 0) }).rule).toBe("dsp");
});

test("a waltz: today's beats, the network's bars, three in a bar", () => {
	const g = grid(150);
	const bars = every(1.2, 0.5, 60);
	const r = referee(g, { beats: bars, downbeats: bars });
	expect(r.rule).toBe("network-bars");
	expect(r.meter).toBe(3);
	expect(r.beats).toBe(g.beats);
	expect((r.bars as number[]).slice(0, 3)).toEqual([0.5, 1.7, 2.9]);
});

test("stray downbeats at a song's end start no bars of their own (the made waltz's last bars)", () => {
	// the network's bars every 1.2 s, then a «downbeat» on every beat for the last two seconds — as it answered
	const g = grid(150, 0.5, 62.5);
	const tail = [59.7, 60.1, 60.5, 60.9, 61.3];
	const r = referee(g, { beats: every(1.2, 0.5, 59.3), downbeats: [...every(1.2, 0.5, 59.3), ...tail] });
	expect(r.rule).toBe("network-bars");
	const bars = r.bars as number[];
	const steps = bars.slice(1).map((t, i) => Math.round((t - bars[i]) * 100) / 100);
	expect(new Set(steps)).toEqual(new Set([1.2])); // every bar three beats long, to the very last
	expect(bars[bars.length - 1]).toBeCloseTo(61.7, 3);
	// the phase is the network's even when today's first beat is beat 2 of a bar
	const late = referee(grid(150, 0.9, 62.5), { beats: every(1.2, 1.7, 59.3), downbeats: every(1.2, 1.7, 59.3) });
	expect((late.bars as number[]).slice(0, 3)).toEqual([0.5, 1.7, 2.9]);
	// the network's own bars (half-time trap): a stray downbeat one beat after a true one is dropped
	const beat = 60 / 140;
	const downs = every(4 * beat, 0.5, 60).map((t) => Math.round(t * 50) / 50);
	const stray = [...downs.slice(0, 10), Math.round((downs[9] + beat) * 50) / 50, ...downs.slice(10), Math.round((downs[downs.length - 1] + beat) * 50) / 50];
	const trap = referee(grid(70), { beats: every(beat, 0.52, 60).map((t) => Math.round(t * 50) / 50), downbeats: stray });
	expect(trap.rule).toBe("network");
	const tb = trap.bars as number[];
	expect(tb.length).toBe(downs.length);
	expect(tb.slice(1).every((t, i) => Math.abs(t - tb[i] - 4 * beat) < 0.03)).toBe(true);
});

test("implausible bars from the network never replace today's", () => {
	const g = grid(100);
	// a «bar» on almost every beat, at the same tempo
	expect(referee(g, { beats: every(0.6, 0.5, 60), downbeats: every(0.6, 0.5, 60) }).rule).toBe("dsp");
	// today's grid twice as fast as the network, whose bars hold six of today's beats: its own bars are kept
	expect(referee(grid(174), { beats: every(120 / 174, 0.5, 60), downbeats: every(360 / 174, 0.5, 60) }).rule).toBe("dsp");
	// today's grid flips and the network's bars are implausible: its steady beats are taken, the bars left to the caller
	const flipping = { tempo: [stretch(124, 0, 60), stretch(62, 60, 120)], beats: [...every(60 / 124, 0, 60), ...every(60 / 62, 60.5, 120)] };
	const r = referee(flipping, { beats: every(60 / 124, 0.02, 120), downbeats: every(180 / 124 + 0.01, 0.02, 120).filter((_, i) => i % 3 !== 1) });
	expect(r.rule).toBe("network-beats");
	expect(r.bars).toBeNull();
	expect(Math.round(r.tempo[0].bpm)).toBe(124);
});

test("a network that heard only a corner of the song is no referee", () => {
	expect(referee(grid(70, 0.5, 200), { beats: every(60 / 140, 0.5, 30), downbeats: every(240 / 140, 0.5, 30) }).rule).toBe("dsp");
});
