import type { BlendMode } from "@/rendering";
import type { EffectPass } from "@/effects/types";

export type FrameDescriptor = {
	width: number;
	height: number;
	clear: {
		color: [number, number, number, number];
	};
	items: FrameItemDescriptor[];
};

export type FrameItemDescriptor =
	| {
			type: "layer";
			textureId: string;
			transform: QuadTransformDescriptor;
			opacity: number;
			blendMode: BlendMode;
			effectPassGroups: EffectPass[][];
			mask: LayerMaskDescriptor | null;
			afterMaskPassGroups?: EffectPass[][];
	  }
	| {
			type: "sceneEffect";
			effectPassGroups: EffectPass[][];
	  }
	| {
			/**
			 * Two-input item: both layers are rendered, then the passes run with
			 * `src` = from and `orig` = to; the result is blended over the scene.
			 */
			type: "transition";
			from: LayerDescriptor | null;
			to: LayerDescriptor | null;
			effectPassGroups: EffectPass[][];
			blendMode: BlendMode;
	  }
	| {
			/**
			 * Adjustment-layer transition: `from` and `to` (the composite below the layer before and after its cut) are
			 * drawn over a copy of the scene so far, the passes run with `src` = from and `orig` = to, and the result
			 * replaces the scene.
			 */
			type: "sceneTransition";
			from: FrameItemDescriptor[];
			to: FrameItemDescriptor[];
			effectPassGroups: EffectPass[][];
	  };

export type LayerDescriptor = {
	textureId: string;
	transform: QuadTransformDescriptor;
	opacity: number;
	blendMode: BlendMode;
	effectPassGroups: EffectPass[][];
	mask: LayerMaskDescriptor | null;
	/** Passes run after the mask (the drop shadow follows the masked silhouette). */
	afterMaskPassGroups?: EffectPass[][];
};

export type QuadTransformDescriptor = {
	centerX: number;
	centerY: number;
	width: number;
	height: number;
	rotationDegrees: number;
	flipX: boolean;
	flipY: boolean;
};

export type LayerMaskDescriptor = {
	textureId: string;
	feather: number;
	inverted: boolean;
};

export type TextureCanvasDrawFn = (
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
) => void;

/**
 * A layer texture whose pixels come from somewhere outside the renderer —
 * typically a decoded video/image frame or a sticker. Cached by reference
 * identity of the source object.
 */
export type ExternalTextureDescriptor = {
	kind: "external";
	id: string;
	source: CanvasImageSource;
	/** Frame identity for pooled canvases (video timestamp). */
	sourceKey?: number | string;
	width: number;
	height: number;
};

/**
 * A layer texture that the renderer rasterizes from scene state (color fill,
 * text layout, mask shape, blur backdrop). Cached by `contentHash`: when it
 * matches the previous frame's hash for this id, the upload is skipped
 * entirely and the persistent canvas is not even cleared.
 */
export type RenderedTextureDescriptor = {
	kind: "rendered";
	id: string;
	contentHash: string;
	width: number;
	height: number;
	draw: TextureCanvasDrawFn;
};

export type TextureUploadDescriptor =
	| ExternalTextureDescriptor
	| RenderedTextureDescriptor;
