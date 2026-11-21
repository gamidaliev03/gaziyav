// A compound clip as one picture in the renderer (montage/compound-group.ts marks its tracks):
// - the scene builder wraps the layers of a compound's tracks into a CompoundGroupNode (nestCompoundGroups);
// - while the compound plays, the frame gets a «sceneTransition»: A = the scene with the compound's layers over it,
//   B = the scene without them, mixed by GROUP_SHADER through the compound's mask (aux0, drawn on the canvas at the
//   compound's box, its feather blurred in) — what the mask hides shows what is under the compound. Preview and export
//   build the same frame.
import { defineShaderSource } from "@/effects/shader-sources";
import type { EffectPass } from "@/effects/types";
import { tfAt } from "@/montage/flatten";
import type { GraphicElement } from "@/timeline/types";
import type { AnyBaseNode } from "./nodes/base-node";
import { CompoundGroupNode, type ResolvedCompoundGroupNodeState } from "./nodes/compound-group-node";
import type { QuadTransformDescriptor } from "./compositor/types";

export const GROUP_SHADER = "studio.compound.group";

// P0.x = mask on (1/0), P0.y = inverted (1/0). src = the scene with the compound, orig = the scene without it.
defineShaderSource({
	id: GROUP_SHADER,
	wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    var m = 1.0;
    if (P0().x > 0.5) {
        m = aux0(uv).a;
        if (P0().y > 0.5) { m = 1.0 - m; }
    }
    return mix(orig(uv), src(uv), clamp(m, 0.0, 1.0));
}`,
});

const GROUPS_OF = new WeakMap<AnyBaseNode, GraphicElement[]>();

/** Marks a built layer with the compounds its track belongs to (outermost first). */
export function markCompoundGroups(node: AnyBaseNode, groups: GraphicElement[]): void {
	if (groups.length > 0) GROUPS_OF.set(node, groups);
}

/** Runs of layers of the same compound become one CompoundGroupNode each (nested compounds nest), bottom to top kept. */
export function nestCompoundGroups(nodes: AnyBaseNode[], level = 0): AnyBaseNode[] {
	const out: AnyBaseNode[] = [];
	let i = 0;
	while (i < nodes.length) {
		const group = GROUPS_OF.get(nodes[i])?.[level];
		if (!group) {
			out.push(nodes[i]);
			i++;
			continue;
		}
		let j = i;
		while (j < nodes.length && GROUPS_OF.get(nodes[j])?.[level]?.id === group.id) j++;
		const node = new CompoundGroupNode({ compound: group, masks: group.masks });
		node.children = nestCompoundGroups(nodes.slice(i, j), level + 1);
		out.push(node);
		i = j;
	}
	return out;
}

/** The compound's box at `time` (ticks), or null when it doesn't play then (its layers are drawn as usual). */
export function resolveCompoundGroup(node: CompoundGroupNode, time: number, canvas: { width: number; height: number }): ResolvedCompoundGroupNodeState | null {
	const el = node.params.compound;
	if (time < el.startTime || time >= el.startTime + el.duration) return null;
	const tf = tfAt(el as never, time);
	const transform: QuadTransformDescriptor = {
		centerX: canvas.width / 2 + tf.x,
		centerY: canvas.height / 2 + tf.y,
		width: Math.abs(canvas.width * tf.sx),
		height: Math.abs(canvas.height * tf.sy),
		rotationDegrees: tf.rot,
		flipX: tf.sx < 0,
		flipY: tf.sy < 0,
	};
	return { transform };
}

/** The mixing pass of a group: through the mask texture when it has one. */
export function groupPasses(mask: { textureId: string; inverted: boolean } | null): EffectPass[][] {
	return [[{ shader: GROUP_SHADER, uniforms: { u_params: [mask ? 1 : 0, mask?.inverted ? 1 : 0, 0, 0] }, ...(mask ? { textures: [mask.textureId] } : {}) }]];
}
