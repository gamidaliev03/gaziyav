import { DefinitionRegistry } from "@/params/registry";
import type { EffectDefinition } from "@/effects/types";

/**
 * Effects removed from the library because another one does the same job (1.0.79: the pro pack's twins, two of Kadr's). A project
 * that still has one draws it as that effect, with its own settings where the names match.
 */
export const RETIRED_EFFECTS: Readonly<Record<string, string>> = {
	"pro.fx.handheld": "studio.handheld",
	"pro.fx.pushIn": "studio.kenBurns",
	"pro.fx.tiltShift": "kadr.effect.tiltShift",
	"pro.fx.neonEdges": "kadr.effect.neon",
	"pro.fx.filmGrain": "studio.grain",
	"pro.fx.oldFilm": "kadr.effect.oldFilm",
	"pro.fx.halftone": "kadr.effect.halftone",
	"pro.fx.posterize": "kadr.effect.posterize",
	"pro.fx.thermal": "kadr.effect.thermal",
	"pro.fx.nightVision": "kadr.effect.nightVision",
	"pro.fx.comic": "kadr.effect.comic",
	// Kadr's own that another effect does better: RGB Split has Radial, Flash has Repeats
	"kadr.effect.chromatic": "studio.rgbSplit",
	"kadr.effect.strobe": "studio.flash",
	// 1.0.82: the pro pack's colour, direction and size twins of effects that have that setting (Light Leak, Flash,
	// Duotone, Neon Edges, Mirror, Kaleidoscope, Cinematic Bars, Vignette, RGB Split, Zoom Blur, Shake), plus Tiles and
	// Motion Blur, which now carry the number their twins varied by
	"pro.fx.leakWarm": "studio.lightLeak",
	"pro.fx.leakPink": "studio.lightLeak",
	"pro.fx.leakBlue": "studio.lightLeak",
	"pro.fx.flashIn": "studio.flash",
	"pro.fx.strobe": "studio.flash",
	"pro.fx.colorFlash": "studio.flash",
	"pro.fx.duotonePink": "kadr.effect.duotone",
	"pro.fx.duotoneTeal": "kadr.effect.duotone",
	"pro.fx.neonEdgesCyan": "kadr.effect.neon",
	"pro.fx.mirrorH": "kadr.effect.mirror",
	"pro.fx.mirrorV": "kadr.effect.mirror",
	"pro.fx.kaleido6": "kadr.effect.kaleidoscope",
	"pro.fx.kaleido8": "kadr.effect.kaleidoscope",
	"pro.fx.letterbox239": "kadr.effect.letterbox",
	"pro.fx.letterbox185": "kadr.effect.letterbox",
	"pro.fx.vignetteSoft": "studio.vignette",
	"pro.fx.chromaticAberration": "studio.rgbSplit",
	"pro.fx.radialBlur": "studio.zoomBlur",
	"pro.fx.earthquake": "studio.shake",
	"pro.fx.vibrate": "studio.shake",
	"pro.fx.impact": "studio.shake",
	"pro.fx.motionBlurV": "pro.fx.motionBlur",
	"pro.fx.tiles2": "pro.fx.tiles",
	"pro.fx.tiles3": "pro.fx.tiles",
};

export class EffectsRegistry extends DefinitionRegistry<string, EffectDefinition> {
	constructor() {
		super("effect");
	}

	override has(key: string): boolean {
		return super.has(key) || (key in RETIRED_EFFECTS && super.has(RETIRED_EFFECTS[key]));
	}

	override get(key: string): EffectDefinition {
		return !super.has(key) && key in RETIRED_EFFECTS ? super.get(RETIRED_EFFECTS[key]) : super.get(key);
	}
}

export const effectsRegistry = new EffectsRegistry();
