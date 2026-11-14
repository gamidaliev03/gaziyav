// The generators as graphic definitions («gen.<id>»): the inspector, keyframes (graphic param channels), the tiles and
// the timeline's icon read them like any graphic. They are never stored as a clip's definitionId (document.ts).
import type { GraphicDefinition } from "@/graphics/types";
import { GENERATORS } from "./catalog";
import { generatorDefinitionId } from "./document";
import type { GeneratorSpec } from "./types";

function toGraphic(spec: GeneratorSpec): GraphicDefinition {
	return {
		id: generatorDefinitionId(spec.id),
		name: spec.name,
		keywords: spec.keywords,
		params: spec.params,
		render({ ctx, params, width, height, time }) {
			const w = Math.max(1, Math.round(width));
			const h = Math.max(1, Math.round(height));
			const image = ctx.createImageData(w, h);
			// a tile or the timeline's icon: the clip's first frame (or `time` when given), at 30 fps
			spec.pixels({ data: image.data, width: w, height: h }, params, { frame: Math.round((time ?? 0) * 30), fps: 30 });
			ctx.putImageData(image, 0, 0);
		},
	};
}

export const generatorGraphicDefinitions: GraphicDefinition[] = GENERATORS.map(toGraphic);
