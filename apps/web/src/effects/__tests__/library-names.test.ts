import { expect, test } from "bun:test";

test("the Effects browser shows no two effects with the same name", async () => {
	const { studioEffectDefinitions } = await import("@/effects/definitions/studio");
	const src = await Bun.file(new URL("../definitions/index.ts", import.meta.url)).text();
	const hidden = new Set([...src.matchAll(/"([^"]+)": \{[^}]*hidden: true/g)].map((m) => m[1]));
	const shown = studioEffectDefinitions.filter((e) => !hidden.has(e.type) && !(e as { hidden?: boolean }).hidden);
	const names = shown.map((e) => e.name.toLowerCase());
	expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
	expect(shown.length).toBeGreaterThanOrEqual(95);
});
