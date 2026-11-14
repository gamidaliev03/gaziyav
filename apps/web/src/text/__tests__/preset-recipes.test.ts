import { expect, test } from "bun:test";
import { presetRecipe, TEXT_PRESETS } from "@/text/presets";

test("no two text presets are the same recipe in another colour", () => {
	const recipes = TEXT_PRESETS.map(presetRecipe);
	expect(new Set(recipes).size).toBe(TEXT_PRESETS.length);
	expect(TEXT_PRESETS.length).toBeGreaterThan(140);
});

test("the packs build one variant per recipe (a recoloured repeat is not even built), and the dictionary carries only the offered ones", async () => {
	const { PACK_PRESETS } = await import("@/text/preset-packs");
	const { PACK_RU, TEXT_PRESETS } = await import("@/text/presets");
	expect(new Set(PACK_PRESETS.map(presetRecipe)).size).toBe(PACK_PRESETS.length);
	const offered = new Set(TEXT_PRESETS.flatMap((p) => [p.name, p.content, ...(p.ru?.sub ? [p.ru.sub[0]] : [])]));
	for (const key of Object.keys(PACK_RU)) expect([key, offered.has(key)]).toEqual([key, true]);
	// a pack variant that is an own preset in another colour is not offered either (Subscribe, Ribbon, Night Drive, Note, Today's Plan)
	for (const id of ["pk-sub-1", "pk-ribbon-1", "pk-neonline-1", "pk-scribble-3", "pk-doodle-2"]) expect(TEXT_PRESETS.find((p) => p.id === id)).toBeUndefined();
});

test("the recipe ignores colour, a hair of size and a tenth of a second, and the order keys were written in", () => {
	const base = { duration: 3, plate: undefined, params: { fontSize: 7, color: "#ffffff", "anim.inDuration": 0.8, fontFamily: "Inter" } };
	const same = { duration: 3, plate: undefined, params: { fontFamily: "Inter", "anim.inDuration": 0.9, color: "#111111", fontSize: 8 } };
	const other = { duration: 3, plate: undefined, params: { fontFamily: "Inter", "anim.inDuration": 0.9, color: "#111111", fontSize: 5 } };
	expect(presetRecipe(same)).toBe(presetRecipe(base));
	expect(presetRecipe(other)).not.toBe(presetRecipe(base));
	expect(presetRecipe({ ...base, plate: { color: "#000", padX: 1, padY: 1, radius: 4 } })).not.toBe(presetRecipe(base));
});
