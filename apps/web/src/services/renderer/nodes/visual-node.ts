import type { FollowOffset } from "@/motion/follow";
import { BaseNode } from "./base-node";
import type { CropRect } from "@/timeline/crop";
import type { Effect, EffectPass } from "@/effects/types";
import type { Mask } from "@/masks/types";
import type { BlendMode, Transform } from "@/rendering";
import type { RetimeConfig, VisualElement } from "@/timeline";
import type { LayerShadow } from "@/shadow/layer-shadow";

export interface VisualNodeParams {
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	transform: Transform;
	animations?: VisualElement["animations"];
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
	/** CapCut Crop: the part of the source frame the clip shows (fractions; timeline/crop.ts). */
	crop?: CropRect;
	/** Timeline ranges (ticks) where a transition renders this element instead. */
	excludeRanges?: Array<{ start: number; end: number }>;
	/** Clamp of the source time (ticks) — transitions hold the edge frame. */
	sourceClamp?: { min: number; max: number };
	/** Decoder key override so a transition's incoming clip gets its own decoder. */
	decoderKey?: string;
	/** Offset from a tracker this layer follows (src/motion/follow.ts), per timeline time (ticks). */
	followOffset?: (timelineTicks: number) => FollowOffset | null;
	/** The clip's params when it has an In / Out / Loop animation (CapCut Animation tab): the same procedural
	 * presets as text (animation/presets.ts), applied to the whole picture. */
	clipAnim?: Record<string, unknown>;
	/** Drop shadow (shadow/layer-shadow.ts), when it is on. */
	shadow?: LayerShadow;
}

export interface ResolvedVisualNodeState {
	localTime: number;
	transform: Transform;
	opacity: number;
	effectPasses: EffectPass[][];
}

export interface ResolvedVisualSourceNodeState extends ResolvedVisualNodeState {
	source: CanvasImageSource;
	/** Changes when a reused source canvas holds a different frame (video). */
	sourceKey?: number | string;
	sourceWidth: number;
	sourceHeight: number;
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
	Resolved extends ResolvedVisualNodeState = ResolvedVisualNodeState,
> extends BaseNode<Params, Resolved> {}
