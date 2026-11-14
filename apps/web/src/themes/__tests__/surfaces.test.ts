import { describe, expect, test } from "bun:test";
import { contrast, labL } from "../color";
import { DEFAULT_STATE, resolve, type ThemeState } from "../engine";
import { FAMILIES } from "../families";

// The surface levels of every look (docs/DESIGN.md §1) as the engine makes them, over every backdrop a glass look has,
// for the default state, every tint and both ends of the glass slider: S1 (ΔL* ≥ 4 between levels that touch), S2 (a
// hairline ≥ 1.25 : 1 to both its neighbours), S4 (the scrim dims ≥ 35 %). The pixel proof is test/design-surfaces.mjs.
const dL = (a: string, b: string) => Math.abs(labL(a) - labL(b));
const lum = (hex: string) => {
	const f = (i: number) => {
		const s = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * f(0) + 0.7152 * f(1) + 0.0722 * f(2);
};
const scrimOver = (scrim: string, bg: string) => {
	const m = /rgb\(([\d\s]+)\/\s*([\d.]+)\)/.exec(scrim);
	if (!m) throw new Error(scrim);
	const [r, g, b] = m[1].trim().split(/\s+/).map(Number);
	const a = Number(m[2]);
	const B = [1, 3, 5].map((i) => Number.parseInt(bg.slice(i, i + 2), 16));
	return `#${[r, g, b].map((x, i) => Math.round(x * a + B[i] * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
};

describe("surfaces S1–S4 of every look", () => {
	for (const family of FAMILIES) {
		for (const mode of ["dark", "light"] as const) {
			if (!family[mode]) continue;
			test(`${family.id} · ${mode}`, () => {
				const bad: string[] = [];
				for (const tint of [null, "#ff0000", "#0a84ff", "#30d158"])
					for (const clarity of [0, 50, 100]) {
						const st: ThemeState = { ...DEFAULT_STATE, tint, clarity };
						const r = resolve(family, mode, st);
						if (!r) continue;
						const s = r.surfaces;
						const tag = `${tint ?? "-"}/${clarity}`;
						// L1 ↔ L2 (a tile on a panel), over every backdrop
						for (const p of s.s1) if (dL(p, s.s2) < 4) bad.push(`${tag} panel↔tile ΔL ${dL(p, s.s2).toFixed(2)}`);
						// inside a sheet: the tab track and a card are a level off the sheet
						for (const d of s.s4) {
							if (dL(d, s.s4Track) < 4) bad.push(`${tag} sheet↔track ${dL(d, s.s4Track).toFixed(2)}`);
							if (dL(d, s.s4Card) < 4) bad.push(`${tag} sheet↔card ${dL(d, s.s4Card).toFixed(2)}`);
						}
						// hairlines
						for (const bg of [...s.s1, s.s2]) if (contrast(s.line, bg) < 1.25) bad.push(`${tag} line on ${bg} ${contrast(s.line, bg).toFixed(2)}`);
						for (const bg of [...s.s4, s.s4Card]) if (contrast(s.lineIn, bg) < 1.25) bad.push(`${tag} sheet line on ${bg}`);
						for (const bg of [...s.s3, ...s.s4]) if (contrast(s.lineFloat, bg) < 1.25) bad.push(`${tag} floating edge on ${bg}`);
						// S4: the scrim dims white and mid grey by ≥ 35 %, and both shadows exist
						for (const bg of ["#ffffff", "#808080"]) {
							const dim = 1 - lum(scrimOver(s.scrim, bg)) / lum(bg);
							if (dim < 0.35) bad.push(`${tag} scrim dims ${bg} by ${(dim * 100).toFixed(0)} %`);
						}
						if (s.shadowFloat === "none" || s.shadowModal === "none") bad.push(`${tag} a missing shadow`);
					}
				expect(bad).toEqual([]);
			});
		}
	}
	test("a look whose numbers held keeps its colours («Минимал» dark: tiles and panels untouched)", () => {
		const f = FAMILIES.find((x) => x.id === "minimal");
		const r = f && resolve(f, "dark", DEFAULT_STATE);
		expect(r?.surfaces.s2).toBe(f?.dark?.raised);
		expect(r?.vars["--gz-panel-matte"]).toBe(f?.dark?.panel);
	});
});
