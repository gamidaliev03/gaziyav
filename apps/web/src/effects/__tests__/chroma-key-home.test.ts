import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let effectsRegistry: typeof import("@/effects/registry").effectsRegistry;

beforeAll(async () => {
	await installOpenCutWasm();
	({ effectsRegistry } = await import("@/effects/registry"));
	(await import("@/effects/definitions")).registerDefaultEffects();
});

test("chroma key lives in the clip's inspector (Video → Cutout): registered for it and for old projects, no twin tile in Effects", () => {
	const chroma = effectsRegistry.get("kadr.effect.chromaKey");
	expect(chroma.name).toBe("Chroma Key");
	expect(chroma.hidden).toBe(true);
	const tiles = effectsRegistry.getAll().filter((effect) => !effect.hidden);
	expect(tiles.some((effect) => /chroma ?key|хромакей|green screen|keying/i.test(`${effect.name} ${(effect.keywords ?? []).join(" ")}`))).toBe(false);
	// Tools keeps its other tile
	expect(tiles.some((effect) => effect.category === "Tools")).toBe(true);
});
