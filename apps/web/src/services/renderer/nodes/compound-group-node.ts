import type { Mask } from "@/masks/types";
import type { GraphicElement } from "@/timeline/types";
import type { QuadTransformDescriptor } from "../compositor/types";
import { BaseNode } from "./base-node";

/**
 * A compound clip drawn as one picture (montage/compound-group.ts): its children are the layers of the tracks it opens
 * into. While it plays, the compositor draws the scene with them and the scene without them and mixes the two by the
 * compound's mask (services/renderer/compound-group.ts); before and after it, the children are drawn as usual.
 */
export type CompoundGroupNodeParams = {
	compound: GraphicElement;
	/** Mask editing reads the node like a layer's: the compound's masks. */
	masks?: Mask[];
};

export type ResolvedCompoundGroupNodeState = {
	/** The compound's own box on the canvas at this moment (its transform, keyframes included). */
	transform: QuadTransformDescriptor;
};

export class CompoundGroupNode extends BaseNode<CompoundGroupNodeParams, ResolvedCompoundGroupNodeState> {}
