// The looks pack, second hand (WISHES 56): «Комикс», «Сакура», «Роза» — the same contract checks as looks.test.ts,
// on LOOKS_PACK2, plus the genre words of these three looks and the faces they name.
import { describe, expect, test } from "bun:test";
import { DEFAULT_STATE, makeRecord, resolve, themeCss } from "../engine";
import { FAMILIES } from "../families";
import { LOOKS_PACK2 } from "../looks2";
import { COMMON_DECISIONS, LOOK_KINDS, MOTION_MAX_MS, PRESS_MAX_MS, SKIN_TOKENS, skinVars, undecided } from "../skin";
import { RU_LOOKS2 } from "../../i18n/ru-looks2";

const modesOf = (f: (typeof FAMILIES)[number]) => (["dark", "light"] as const).filter((m) => !!f[m]);

describe("looks2: «Комикс», «Сакура», «Роза» are whole skins that pass their guards", () => {
	for (const f of LOOKS_PACK2) {
		for (const mode of modesOf(f)) {
			test(`${f.id} · ${mode}: every guard holds`, () => {
				const r = resolve(f, mode, { ...DEFAULT_STATE, family: f.id });
				expect(r).not.toBeNull();
				const bad = r!.guards.filter((g) => !g.ok).map((g) => `${g.what}: ${g.value}`);
				expect(bad).toEqual([]);
				expect(r!.guards.length).toBeGreaterThanOrEqual(19);
			});
			test(`${f.id} · ${mode}: every token of the contract is in its CSS`, () => {
				const css = themeCss({ ...DEFAULT_STATE, family: f.id });
				expect(SKIN_TOKENS.filter((k) => !css.includes(`${k}:`))).toEqual([]);
				expect(makeRecord({ ...DEFAULT_STATE, family: f.id }).skin).toBe(true);
			});
		}
		test(`${f.id}: not a recolour`, () => {
			const v = skinVars(f.skin!);
			const minimal: Record<string, string> = { "--gz-r-control": "6px", "--gz-raise": "none", "--gz-font-head": "system", "--gz-icon-stroke": "1.5", "--gz-anim-appear": "gz-pop", "--gz-dur-appear": "160ms", "--gz-clip-r": "4px" };
			expect(Object.keys(minimal).filter((k) => v[k] !== minimal[k]).length).toBeGreaterThanOrEqual(5);
		});
		test(`${f.id}: every kind on screen decided, motion in budget, Russian name`, () => {
			expect(LOOK_KINDS.length).toBeGreaterThanOrEqual(60);
			expect(undecided(f.skin!)).toEqual([]);
			expect(f.skin!.motion.appear).toBeLessThanOrEqual(MOTION_MAX_MS);
			expect(f.skin!.motion.land).toBeLessThanOrEqual(MOTION_MAX_MS);
			expect(f.skin!.motion.press).toBeLessThanOrEqual(PRESS_MAX_MS);
			expect(RU_LOOKS2[f.name]).toBeTruthy();
			expect(RU_LOOKS2[f.note]).toBeTruthy();
			expect(FAMILIES.includes(f)).toBe(true);
		});
	}
	test("each look decides on its own (the critic's P9): ≥ 15 kinds re-stated, never a copy of COMMON_DECISIONS", () => {
		for (const f of LOOKS_PACK2) {
			const own = LOOK_KINDS.filter((k) => JSON.stringify(f.skin!.decided[k]) !== JSON.stringify(COMMON_DECISIONS[k]));
			expect(own.length).toBeGreaterThanOrEqual(15);
		}
	});
	test("the player's surround is never themed (C1): the same stage as «Минимал» light", () => {
		for (const f of LOOKS_PACK2) expect(f.light!.stage).toBe(FAMILIES.find((x) => x.id === "minimal")!.light!.stage);
	});
	test("the ids and the owner's names", () => {
		expect(LOOKS_PACK2.map((f) => f.id)).toEqual(["comic", "sakura", "rose"]);
		expect(LOOKS_PACK2.map((f) => RU_LOOKS2[f.name])).toEqual(["Комикс", "Сакура", "Роза"]);
	});
	test("the genre only: no publisher's, studio's or character's name", () => {
		const text = JSON.stringify(LOOKS_PACK2).toLowerCase();
		for (const w of ["marvel", "dc comics", "spider", "batman", "superman", "avengers", "ghibli", "sailor", "pokemon", "naruto", "barbie", "hello kitty", "sanrio", "kitty"]) expect(text.includes(w)).toBe(false);
	});
	test("the faces named first exist on every Mac (system fonts, nothing downloaded)", () => {
		const fs = require("node:fs") as typeof import("node:fs");
		for (const file of ["/System/Library/Fonts/MarkerFelt.ttc", "/System/Library/Fonts/Avenir Next.ttc", "/System/Library/Fonts/SFNSRounded.ttf"]) expect(fs.existsSync(file)).toBe(true);
	});
	test("no Russian text from a CJK face (full-width Cyrillic): no Japanese / Chinese / Korean family in any font role", () => {
		const CJK = /hiragino|ヒラギノ|pingfang|heiti|songti|kaiti|apple sd gothic|applegothic|applemyungjo|osaka|ms gothic|yu gothic|meiryo|noto sans (cjk|jp|sc|tc|kr)|source han/i;
		for (const f of LOOKS_PACK2) for (const role of ["head", "digits", "label"] as const) expect(`${f.id} ${role}: ${CJK.test(f.skin!.type[role]) ? f.skin!.type[role] : "ok"}`).toBe(`${f.id} ${role}: ok`);
	});
});
