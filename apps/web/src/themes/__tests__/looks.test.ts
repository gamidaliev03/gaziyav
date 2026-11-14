// The looks pack (WISHES 56): the contract (./skin.ts) and its guards on every look of the pack, by numbers.
import { describe, expect, test } from "bun:test";
import { DEFAULT_STATE, makeRecord, resolve, themeCss } from "../engine";
import { FAMILIES } from "../families";
import { LOOKS_PACK } from "../looks";
import { COMMON_DECISIONS, LOOK_KINDS, MOTION_MAX_MS, SKIN_TOKENS, skinVars, undecided } from "../skin";

const LOOK_PACK_UNDECIDED = () => LOOKS_PACK.flatMap((f) => undecided(f.skin!).map((k) => `${f.id}: ${k}`));
const modesOf = (f: (typeof FAMILIES)[number]) => (["dark", "light"] as const).filter((m) => !!f[m]);

describe("the looks pack: every look is a whole skin that passes its guards", () => {
	for (const f of LOOKS_PACK) {
		for (const mode of modesOf(f)) {
			test(`${f.id} · ${mode}: every guard holds (clip labels, playhead, selection, motion, texture)`, () => {
				const r = resolve(f, mode, { ...DEFAULT_STATE, family: f.id });
				expect(r).not.toBeNull();
				const bad = r!.guards.filter((g) => !g.ok).map((g) => `${g.what}: ${g.value} (${g.min !== undefined ? `≥ ${g.min}` : `≤ ${g.max}`})`);
				expect(bad).toEqual([]);
				expect(r!.guards.length).toBeGreaterThanOrEqual(19);
			});
			test(`${f.id} · ${mode}: every token of the contract is in its CSS`, () => {
				const css = themeCss({ ...DEFAULT_STATE, family: f.id });
				const missing = SKIN_TOKENS.filter((k) => !css.includes(`${k}:`));
				expect(missing).toEqual([]);
				expect(makeRecord({ ...DEFAULT_STATE, family: f.id }).skin).toBe(true);
			});
		}
		test(`${f.id}: not a recolour — its geometry, type, icons and motion differ from «Минимал»'s`, () => {
			const v = skinVars(f.skin!);
			const differs = ["--gz-r-control", "--gz-raise", "--gz-font-head", "--gz-icon-stroke", "--gz-anim-appear", "--gz-dur-appear", "--gz-clip-r"].filter((k) => {
				const minimal: Record<string, string> = { "--gz-r-control": "6px", "--gz-raise": "none", "--gz-font-head": "system", "--gz-icon-stroke": "1.5", "--gz-anim-appear": "gz-pop", "--gz-dur-appear": "160ms", "--gz-clip-r": "4px" };
				return v[k] !== minimal[k];
			});
			expect(differs.length).toBeGreaterThanOrEqual(5);
		});
	}
	test("the completeness checklist: every kind on screen decided in every look (target 0 undecided)", () => {
		const open = LOOK_KINDS.length >= 60 ? LOOK_PACK_UNDECIDED() : ["the checklist lost kinds"];
		expect(open).toEqual([]);
	});
	test("every look re-decides its own checklist: no map IS the shared base, and the kinds the critic named are its own", () => {
		// (looksfix: the four maps were copies of COMMON_DECISIONS — «64 / 64 decided» proved a spread, not a decision)
		const OWN = ["tooltip", "scrollbar", "slider", "segmented", "tabs", "menu.context", "toast", "progress.line", "empty-state", "drag-ghost", "home.tile", "player.bar"] as const;
		const bad: string[] = [];
		for (const f of LOOKS_PACK) {
			const d = f.skin!.decided;
			if (JSON.stringify(d) === JSON.stringify(COMMON_DECISIONS)) bad.push(`${f.id}: the map is COMMON_DECISIONS`);
			for (const k of OWN) if (JSON.stringify(d[k]) === JSON.stringify(COMMON_DECISIONS[k])) bad.push(`${f.id}: ${k} not re-decided`);
		}
		expect(bad).toEqual([]);
	});
	test("no movement over the budget in any look; the press answers at once", () => {
		for (const f of LOOKS_PACK) {
			expect(f.skin!.motion.appear).toBeLessThanOrEqual(MOTION_MAX_MS);
			expect(f.skin!.motion.land).toBeLessThanOrEqual(MOTION_MAX_MS);
			expect(f.skin!.motion.press).toBeLessThanOrEqual(80);
		}
	});
	test("the four looks of the first group, in their order, with their own ids", () => {
		expect(LOOKS_PACK.map((f) => f.id)).toEqual(["retro95", "terminal", "pixel", "neon"]);
		for (const f of LOOKS_PACK) expect(FAMILIES.includes(f)).toBe(true);
	});
	test("a look without a skin makes no skin token and no skin flag (the default stays byte for byte)", () => {
		for (const f of FAMILIES.filter((x) => !x.skin)) {
			const css = themeCss({ ...DEFAULT_STATE, family: f.id });
			expect(SKIN_TOKENS.filter((k) => k !== "--gz-ease" && k !== "--gz-r-panel" && k !== "--gz-r-dialog" && k !== "--gz-r-menu" && k !== "--gz-panel-shadow" && k !== "--gz-shadow-float" && k !== "--gz-shadow-modal" && css.includes(`${k}:`))).toEqual([]);
			expect(makeRecord({ ...DEFAULT_STATE, family: f.id }).skin).toBe(false);
		}
	});
	test("the genre only: no system's, film's or game's name in a look's text", () => {
		const text = JSON.stringify(LOOKS_PACK).toLowerCase();
		for (const w of ["windows", "microsoft", "matrix", "nintendo", "mario", "cyberpunk 2077", "tron", "apple ii", "macintosh"]) expect(text.includes(w)).toBe(false);
	});
});
