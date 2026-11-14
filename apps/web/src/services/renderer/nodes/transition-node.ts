import type { EffectPass } from "@/effects/types";
import type { ParamValues } from "@/params";
import { BaseNode } from "./base-node";

/**
 * Renders a transition window [start, start + duration) (ticks). Children are
 * exactly two visual nodes: [0] = outgoing clip A', [1] = incoming clip B'
 * (clones with extended timing). They are resolved by the generic tree walk
 * and collected by the frame builder into one two-input "transition" item.
 */
export type TransitionNodeParams = {
	transitionType: string;
	transitionParams: ParamValues;
	start: number;
	duration: number;
};

export type ResolvedTransitionNodeState = {
	passes: EffectPass[];
};

export class TransitionNode extends BaseNode<
	TransitionNodeParams,
	ResolvedTransitionNodeState
> {}
