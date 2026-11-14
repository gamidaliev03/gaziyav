import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { RU } from "@/i18n/ru";

beforeAll(() => installOpenCutWasm());

/** Every tile of the materials panel has a Russian name (the search finds it in either language). */
test("every effect, set, transition, filter, motion graphic, template, caption style and text preset has a Russian name", async () => {
	const { effectsRegistry, registerDefaultEffects } = await import("@/effects");
	registerDefaultEffects();
	const { EFFECT_SETS } = await import("@/effects/sets/catalog");
	const { LIBRARY_TRANSITIONS } = await import("@/transitions/definitions");
	const { LOOKS } = await import("@/effects/luts/looks");
	const { MOGRAPH_KINDS } = await import("@/montage/mograph");
	const { TEMPLATES } = await import("@/templates/catalog");
	const { CAPTION_STYLES } = await import("@/subtitles/styles");
	const { TEXT_PRESETS } = await import("@/text/presets");
	const names = {
		effects: effectsRegistry.getAll().filter((e) => !e.hidden).map((e) => e.name),
		sets: EFFECT_SETS.map((s) => s.name),
		transitions: LIBRARY_TRANSITIONS.map((d) => d.name),
		filters: LOOKS.map((l) => l.name),
		motion: MOGRAPH_KINDS.filter((k) => !k.hidden).map((k) => k.label),
		templates: TEMPLATES.map((tp) => tp.name),
		captions: CAPTION_STYLES.map((s) => s.name),
		// pack presets carry their own Russian names (text/presets.ts PACK_RU)
		text: TEXT_PRESETS.filter((p) => !p.ru).map((p) => p.name),
	};
	const missing = Object.entries(names).flatMap(([kind, list]) => list.filter((name) => !(name in RU) || !RU[name]).map((name) => `${kind}: ${name}`));
	expect(missing).toEqual([]);
	// and the Russian name is a real name, not the English one left as it is (brands and codes aside)
	const same = Object.entries(names).flatMap(([kind, list]) => list.filter((name) => RU[name] === name && !/^(TikTok|Hormozi|Y2K|Super 8|Gold 200|VHS|VHS Play|CapCut)$/.test(name)).map((name) => `${kind}: ${name}`));
	expect(same).toEqual([]);
});
