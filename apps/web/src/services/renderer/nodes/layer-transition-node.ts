import type { EffectPass } from "@/effects/types";
import type { ParamValues } from "@/params";
import type { LayerTransitionMode } from "@/transitions/layer";
import { BaseNode } from "./base-node";

/**
 * A transition on an adjustment layer (transitions/layer.ts). Children: [0] = everything below the layer as it plays
 * (a RootNode group); for a "pair" transition with a cut also [1] = side A and [2] = side B (the composite below
 * before / after the cut, continued past it). Inside the window a pair draws only A and B (the live group is not
 * resolved), a single draws the live group and warps it; outside the window only the live group is drawn.
 */
export type LayerTransitionNodeParams = {
	transitionType: string;
	transitionParams: ParamValues;
	start: number;
	end: number;
	cut: number | null;
	mode: LayerTransitionMode;
};

export type ResolvedLayerTransitionNodeState = {
	passes: EffectPass[];
};

export class LayerTransitionNode extends BaseNode<LayerTransitionNodeParams, ResolvedLayerTransitionNodeState> {
	/** Side A and B, when the transition draws two composites. */
	get sides(): [BaseNode, BaseNode] | null {
		const [, a, b] = this.children;
		return a && b ? [a, b] : null;
	}
}
