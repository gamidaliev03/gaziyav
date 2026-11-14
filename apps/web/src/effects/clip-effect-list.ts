// What Adjust → Effects lists for a clip, and what × takes away. The Color section above the list holds the clip's
// grading, so its colour effect is listed only when it carries a look (a filter), as that filter; the chroma key is
// Video → Cutout's and stays out of the list.
import { COLOR_EFFECT_TYPE, COLOR_GROUP_KEYS, type ColorGroup, colorEffect, isColorGroupNeutral } from "@/effects/definitions/studio/color";
import { LOOKS } from "@/effects/luts/looks";
import type { Effect } from "@/effects/types";

export const CHROMA_KEY_EFFECT_TYPE = "kadr.effect.chromaKey";

export type ClipEffectRow =
	| { kind: "effect"; effect: Effect }
	/** The look of the clip's colour effect, shown as a filter. */
	| { kind: "filter"; effect: Effect; name: string };

/** The look's name as the Filters panel shows it; an imported LUT by its file name. */
export function lookName(params: Effect["params"]): string {
	const look = typeof params.look === "string" ? params.look : "none";
	if (look === "custom") return typeof params.lutName === "string" && params.lutName ? params.lutName : "Imported LUT";
	return LOOKS.find((item) => item.id === look)?.name ?? look;
}

export function clipEffectRows(effects: readonly Effect[]): ClipEffectRow[] {
	const rows: ClipEffectRow[] = [];
	for (const effect of effects) {
		if (effect.type === CHROMA_KEY_EFFECT_TYPE) continue;
		if (effect.type === COLOR_EFFECT_TYPE) {
			const look = typeof effect.params.look === "string" ? effect.params.look : "none";
			if (look !== "none") rows.push({ kind: "filter", effect, name: lookName(effect.params) });
			continue;
		}
		rows.push({ kind: "effect", effect });
	}
	return rows;
}

/**
 * The clip's effects after × on a filter: the look is cleared (its intensity and an imported LUT with it); a colour
 * effect that then has no grading left goes away altogether, so nothing invisible stays on the clip.
 */
export function effectsWithoutFilter(effects: readonly Effect[], effectId: string): Effect[] {
	const defaults = Object.fromEntries(colorEffect.params.map((param) => [param.key, param.default]));
	return effects.flatMap((effect) => {
		if (effect.id !== effectId) return [effect];
		const params = { ...effect.params };
		for (const key of COLOR_GROUP_KEYS.look) if (key in defaults) params[key] = defaults[key];
		const graded = (Object.keys(COLOR_GROUP_KEYS) as ColorGroup[]).some((group) => !isColorGroupNeutral(group, params));
		return graded ? [{ ...effect, params }] : [];
	});
}
