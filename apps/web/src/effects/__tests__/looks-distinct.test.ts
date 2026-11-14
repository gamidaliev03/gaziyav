import { expect, test } from "bun:test";
import { LOOKS } from "@/effects/luts/looks";

/** Every look on a 6×6×6 grid of the RGB cube, 0–255. */
const grid: [number, number, number][] = [];
for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) grid.push([r / 5, g / 5, b / 5]);
const sample = (fn: (c: [number, number, number]) => [number, number, number]) => grid.flatMap((c) => fn(c).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)));
const distance = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

test("the filters differ to the eye: no two closer than 3/255 over the gamut, none within 4/255 of no change (1.0.82: Disco=Party, Mono 400=Silver Screen… and Broadcast left)", () => {
	const samples = LOOKS.map((look) => ({ name: look.name, s: sample(look.fn as (c: [number, number, number]) => [number, number, number]) }));
	const same: string[] = [];
	for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) if (distance(samples[i].s, samples[j].s) <= 3) same.push(`${samples[i].name} ~ ${samples[j].name}`);
	expect(same).toEqual([]);
	const identity = sample((c) => c);
	expect(samples.filter(({ s }) => distance(s, identity) <= 4).map(({ name }) => name)).toEqual([]);
	expect(LOOKS.length).toBeGreaterThanOrEqual(100);
	expect(new Set(LOOKS.map((look) => look.name)).size).toBe(LOOKS.length);
});
