import { effectsRegistry } from "../registry";
import type { EffectDefinition } from "../types";
import { blurEffectDefinition } from "./blur";
import { studioEffectDefinitions } from "./studio";

const defaultEffects = [...studioEffectDefinitions, blurEffectDefinition];

/** The group the Effects tab opens on (same idea as the Transitions' Trending). */
export const EFFECT_TRENDING = "Trending";

/** Effects tab groups, in order (the AI group from neural/catalog goes right after Trending). */
export const EFFECT_CATEGORY_ORDER = [EFFECT_TRENDING, "Camera", "Light", "Glitch", "Retro", "Film", "Blur", "Style", "Distort", "Frame", "Weather", "Party", "Lens", "Tools"];

/**
 * Library organisation: the category each effect is shown in, and the ones
 * hidden because another effect does the same job better (they stay
 * registered, so projects that use them keep rendering and stay editable).
 */
const LIBRARY: Record<string, { category?: string; name?: string; hidden?: boolean }> = {
	// Trending: the 8 short-form looks (docs/creative-trends.md §2, DESIGN «Specs · Effects browser»), all moving,
	// so the tile hover shows motion
	"studio.zoomPunch": { category: EFFECT_TRENDING },
	"studio.shake": { category: EFFECT_TRENDING },
	"studio.glitch": { category: EFFECT_TRENDING },
	"studio.zoomBlur": { category: EFFECT_TRENDING },
	"studio.rgbSplit": { category: EFFECT_TRENDING },
	"studio.vhs": { category: EFFECT_TRENDING },
	"studio.lightLeak": { category: EFFECT_TRENDING },
	"kadr.effect.oldFilm": { category: EFFECT_TRENDING },
	"studio.handheld": { category: "Camera" },
	"studio.kenBurns": { category: "Camera" },
	"studio.flash": { category: "Light" },
	"kadr.effect.glow": { category: "Light" },
	"studio.vignette": { category: "Light" },
	"studio.grain": { category: "Retro" },
	"kadr.effect.filmLook": { category: "Retro" },
	"kadr.effect.letterbox": { category: "Retro" },
	"kadr.effect.duotone": { category: "Style" },
	"kadr.effect.blackWhite": { category: "Style" },
	"kadr.effect.posterize": { category: "Style" },
	"kadr.effect.halftone": { category: "Style" },
	"kadr.effect.comic": { category: "Style" },
	"kadr.effect.neon": { category: "Style" },
	"kadr.effect.nightVision": { category: "Style" },
	"kadr.effect.thermal": { category: "Style" },
	"kadr.effect.kaleidoscope": { category: "Lens" },
	"kadr.effect.mirror": { category: "Lens" },
	"kadr.effect.tiltShift": { category: "Lens" },
	"kadr.effect.mosaic": { category: "Lens" },
	blur: { category: "Lens" },
	"studio.sharpen": { category: "Tools" },
	// in the Color section now (Color wheels group); kept registered so projects that use it still render
	"kadr.effect.colorWheels": { hidden: true },
	// same job elsewhere: AI → Denoise, the inspector's Masks (kept so projects that use them still render)
	"kadr.effect.denoise": { hidden: true },
	"kadr.effect.mask": { hidden: true },
	// keying is the clip's own (CapCut: Video → Cutout → Chroma key, which adds this effect); no twin tile in Effects
	"kadr.effect.chromaKey": { hidden: true },
};

function organised(definition: EffectDefinition): EffectDefinition {
	const patch = LIBRARY[definition.type];
	return patch ? { ...definition, ...patch } : definition;
}

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (effectsRegistry.has(definition.type)) {
			continue;
		}
		effectsRegistry.register({
			key: definition.type,
			definition: organised(definition),
		});
	}
}
