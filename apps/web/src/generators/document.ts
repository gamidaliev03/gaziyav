//
// A generator clip is an ordinary graphic element whose definition is the RECTANGLE every build knows, carrying its
// own parameters under the «gen.» prefix: { definitionId: "rectangle", params: { fill: <its mean colour>,
// "gen.id": "gradient", "gen.v": 1, "gen.c1": …, transform: the full frame } }. A build that knows generators draws
// the generator; an older one (rc41d) draws a full-frame rectangle of `fill` — a flat colour of about the same look —
// and keeps every «gen.» value and keyframe untouched (it neither reads nor drops unknown params), so opening the
// project again in a new build gives the generator back exactly. A NEW definition id would have made the older build
// throw «Unknown graphic» in the timeline and in the player (graphics/registry.get).
import type { ParamValues } from "@/params";
import { DEFAULT_GRAPHIC_SOURCE_SIZE } from "@/graphics/types";
import { generatorSpec } from "./catalog";
import type { GeneratorSpec } from "./types";

export const GEN_ID_PARAM = "gen.id";
export const GEN_VERSION_PARAM = "gen.v";
export const GEN_VERSION = 1;
export const CARRIER_DEFINITION = "rectangle";
export const GEN_DEFINITION_PREFIX = "gen.";

export const generatorDefinitionId = (id: string) => `${GEN_DEFINITION_PREFIX}${id}`;

/** The generator a graphic element is, when this build knows it (an unknown, newer one stays its carrier rectangle). */
export function generatorOf(element: { definitionId?: string; params?: ParamValues }): GeneratorSpec | undefined {
	if (element.definitionId?.startsWith(GEN_DEFINITION_PREFIX)) return generatorSpec(element.definitionId.slice(GEN_DEFINITION_PREFIX.length));
	if (element.definitionId !== CARRIER_DEFINITION) return undefined;
	const id = element.params?.[GEN_ID_PARAM];
	return typeof id === "string" ? generatorSpec(id) : undefined;
}

/** The graphic definition that draws this element: «gen.<id>» for a generator, else its own. */
export function effectiveGraphicDefinitionId(element: { definitionId: string; params?: ParamValues }): string {
	const spec = generatorOf(element);
	return spec ? generatorDefinitionId(spec.id) : element.definitionId;
}

/** The layer scale that makes the 512-px graphic box cover the whole project canvas (contain, then stretch). */
export function fullFrameScale(canvas: { width: number; height: number }): { scaleX: number; scaleY: number } {
	const contain = Math.min(canvas.width / DEFAULT_GRAPHIC_SOURCE_SIZE, canvas.height / DEFAULT_GRAPHIC_SOURCE_SIZE);
	const box = DEFAULT_GRAPHIC_SOURCE_SIZE * contain;
	return { scaleX: canvas.width / box, scaleY: canvas.height / box };
}

/** The carrier's own params: what an older build shows (a rectangle of the mean colour, no stroke, square corners). */
export function carrierParams(spec: GeneratorSpec, params: ParamValues): ParamValues {
	return { fill: spec.representative(params), strokeWidth: 0, cornerRadius: 0 };
}

/** The params of a new generator clip on this canvas. */
export function buildGeneratorParams({
	spec,
	params,
	canvas,
}: {
	spec: GeneratorSpec;
	params: ParamValues;
	canvas: { width: number; height: number };
}): ParamValues {
	const { scaleX, scaleY } = fullFrameScale(canvas);
	return {
		...params,
		...carrierParams(spec, params),
		[GEN_ID_PARAM]: spec.id,
		[GEN_VERSION_PARAM]: GEN_VERSION,
		"transform.scaleX": scaleX,
		"transform.scaleY": scaleY,
		"transform.positionX": 0,
		"transform.positionY": 0,
		...(spec.blend ? { blendMode: spec.blend } : {}),
	};
}

/** After a change of a «gen.» value: the carrier's colour follows, so an older build shows the new look too. */
export function withCarrierSynced(params: ParamValues): ParamValues {
	const spec = generatorOf({ definitionId: CARRIER_DEFINITION, params });
	return spec ? { ...params, ...carrierParams(spec, params) } : params;
}
