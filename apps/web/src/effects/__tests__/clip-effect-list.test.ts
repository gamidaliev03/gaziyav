import { describe, expect, test } from "bun:test";
import { COLOR_EFFECT_TYPE, colorEffect } from "@/effects/definitions/studio/color";
import { CHROMA_KEY_EFFECT_TYPE, clipEffectRows, effectsWithoutFilter, lookName } from "../clip-effect-list";

const defaults = Object.fromEntries(colorEffect.params.map((param) => [param.key, param.default]));
const color = (params: Record<string, string | number | boolean>) => ({ id: "c1", type: COLOR_EFFECT_TYPE, enabled: true, params: { ...defaults, ...params } });
const glow = { id: "g1", type: "pro.fx.bloom", params: {}, enabled: true };
const chroma = { id: "k1", type: CHROMA_KEY_EFFECT_TYPE, params: {}, enabled: true };

describe("Adjust → Effects list", () => {
	test("an effect is a row; the chroma key (Cutout's) and a colour effect without a look (the Color section's) are not", () => {
		const rows = clipEffectRows([glow, chroma, color({ exposure: 0.5 })]);
		expect(rows.map((row) => row.kind)).toEqual(["effect"]);
		expect(rows[0].effect.id).toBe("g1");
	});

	test("a look on the colour effect is a filter row, named as in the Filters panel; an imported LUT by its file", () => {
		expect(clipEffectRows([color({ look: "clean" })])).toEqual([{ kind: "filter", effect: expect.objectContaining({ id: "c1" }), name: "Clean" }]);
		expect(lookName({ look: "custom", lutName: "Teal" })).toBe("Teal");
		expect(lookName({ look: "custom" })).toBe("Imported LUT");
	});

	test("× on the filter clears the look; the colour effect stays only while some grading is left", () => {
		const graded = color({ look: "clean", lookIntensity: 40, exposure: 0.5 });
		const kept = effectsWithoutFilter([glow, graded], "c1");
		expect(kept.map((e) => e.id)).toEqual(["g1", "c1"]);
		expect(kept[1].params.look).toBe("none");
		expect(kept[1].params.lookIntensity).toBe(100);
		expect(kept[1].params.exposure).toBe(0.5);
		expect(effectsWithoutFilter([color({ look: "clean", vignette: 30 }), glow], "c1").map((e) => e.id)).toEqual(["g1"]);
	});
});
