// The looks pack, third piece (looks3): «Арена», «Плёнка», «Аналог» on the contract's own guards, by numbers.
import { describe, expect, test } from "bun:test";
import { DEFAULT_STATE, makeRecord, resolve, themeCss } from "../engine";
import { FAMILIES } from "../families";
import { LOOKS_PACK_3 } from "../looks3";
import { MOTION_MAX_MS, PRESS_MAX_MS, SKIN_TOKENS, TEXTURE_MAX_ALPHA, skinVars, undecided } from "../skin";

const modesOf = (f: (typeof FAMILIES)[number]) => (["dark", "light"] as const).filter((m) => !!f[m]);

describe("looks3: every look is a whole skin that passes its guards", () => {
	test("the three looks, in their order, registered", () => {
		expect(LOOKS_PACK_3.map((f) => f.id)).toEqual(["arena", "film", "analog"]);
		for (const f of LOOKS_PACK_3) expect(FAMILIES.includes(f)).toBe(true);
		expect(new Set(FAMILIES.map((f) => f.id)).size).toBe(FAMILIES.length);
	});
	for (const f of LOOKS_PACK_3) {
		for (const mode of modesOf(f)) {
			test(`${f.id} · ${mode}: every guard holds`, () => {
				const r = resolve(f, mode, { ...DEFAULT_STATE, family: f.id });
				expect(r).not.toBeNull();
				const bad = r!.guards.filter((g) => !g.ok).map((g) => `${g.what}: ${g.value}`);
				expect(bad).toEqual([]);
				expect(r!.guards.length).toBeGreaterThanOrEqual(19);
			});
			test(`${f.id} · ${mode}: every token in its CSS, skinned record`, () => {
				const css = themeCss({ ...DEFAULT_STATE, family: f.id });
				expect(SKIN_TOKENS.filter((k) => !css.includes(`${k}:`))).toEqual([]);
				expect(makeRecord({ ...DEFAULT_STATE, family: f.id }).skin).toBe(true);
			});
		}
		test(`${f.id}: every kind decided, motion in budget, texture capped, no filter in the timeline`, () => {
			const s = f.skin!;
			expect(undecided(s)).toEqual([]);
			expect(s.motion.appear).toBeLessThanOrEqual(MOTION_MAX_MS);
			expect(s.motion.land).toBeLessThanOrEqual(MOTION_MAX_MS);
			expect(s.motion.press).toBeLessThanOrEqual(PRESS_MAX_MS);
			// every alpha written in the textures (gradients and the SVG grain's colour matrix) is ≤ 3 %
			const tex = `${s.texture.room} ${s.texture.panel}`;
			for (const m of tex.matchAll(/\/\s*([\d.]+)\)/g)) expect(Number(m[1])).toBeLessThanOrEqual(TEXTURE_MAX_ALPHA);
			for (const m of tex.matchAll(/values='([^']+)'/g)) expect(Number(m[1].trim().split(/\s+/)[18])).toBeLessThanOrEqual(TEXTURE_MAX_ALPHA);
			// C5: the clip skin is colours and a radius only; no blur anywhere in a control's edges (hard shadows)
			const v = skinVars(s);
			for (const k of ["--gz-raise", "--gz-sink", "--gz-field", "--gz-raise-fill"]) expect(/\bblur\(/.test(v[k])).toBe(false);
			expect(s.clip.radius).toBeLessThanOrEqual(4);
		});
	}
	test("the genre only: no game's, film's or maker's name in their text", () => {
		const text = JSON.stringify(LOOKS_PACK_3).toLowerCase();
		for (const w of ["kodak", "fuji", "agfa", "ilford", "steam", "xbox", "playstation", "nvidia", "razer", "alienware", "ssl", "neve", "studer", "nagra", "technics", "teac", "revox", "ampex"]) expect(new RegExp(`\\b${w}\\b`).test(text)).toBe(false);
	});
});
