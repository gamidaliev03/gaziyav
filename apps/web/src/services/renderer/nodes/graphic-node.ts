import { createCanvasSurface } from "../canvas-utils";
import {
	DEFAULT_GRAPHIC_SOURCE_SIZE,
	getGraphicDefinition,
	registerDefaultGraphics,
} from "@/graphics";
import type { ParamValues } from "@/params";
import type { GraphicDefinition } from "@/graphics/types";
import { TICKS_PER_SECOND } from "@/wasm";
import {
	VisualNode,
	type ResolvedVisualNodeState,
	type VisualNodeParams,
} from "./visual-node";

/** Shapes drawn in their own proportions (sourceSize). */
const SHAPES = new Set(["rectangle", "ellipse", "polygon", "star"]);

export interface GraphicNodeParams extends VisualNodeParams {
	definitionId: string;
	params: ParamValues;
}

export interface ResolvedGraphicNodeState extends ResolvedVisualNodeState {
	resolvedParams: ParamValues;
}

export class GraphicNode extends VisualNode<
	GraphicNodeParams,
	ResolvedGraphicNodeState
> {
	private cachedKey: string | null = null;
	private cachedSource: OffscreenCanvas | null = null;

	constructor(params: GraphicNodeParams) {
		super(params);
		registerDefaultGraphics();
	}

	getSource({
		resolvedParams,
	}: {
		resolvedParams: ParamValues;
	}): OffscreenCanvas {
		const definition = getGraphicDefinition({
			definitionId: this.params.definitionId,
		});
		if (definition.animated) {
			return this.getAnimatedSource({ definition, resolvedParams });
		}
		const { width, height } = this.sourceSize();
		const cacheKey = JSON.stringify({
			definitionId: this.params.definitionId,
			params: resolvedParams,
			width,
			height,
		});
		if (this.cachedSource && this.cachedKey === cacheKey) {
			return this.cachedSource;
		}

		const { canvas, context } = createCanvasSurface({ width, height });

		definition.render({
			ctx: context,
			params: resolvedParams,
			width,
			height,
		});

		this.cachedKey = cacheKey;
		this.cachedSource = canvas;
		return canvas;
	}

	/**
	 * A shape is drawn in its own proportions (the layer's scale X : Y), not into a 512 square stretched afterwards: a
	 * wide rectangle kept round corners and an even stroke (AE / Figma shape layers). The texture still fills the same
	 * layout box (512 × scale), so the size on screen is unchanged. Other graphics keep their square.
	 */
	private sourceSize(): { width: number; height: number } {
		const square = { width: DEFAULT_GRAPHIC_SOURCE_SIZE, height: DEFAULT_GRAPHIC_SOURCE_SIZE };
		if (!SHAPES.has(this.params.definitionId)) return square;
		const sx = Math.abs(this.resolved?.transform.scaleX ?? 1);
		const sy = Math.abs(this.resolved?.transform.scaleY ?? 1);
		if (!(sx > 0 && sy > 0) || Math.abs(sx - sy) < 1e-3) return square;
		// The long side at 512 px per unit of scale (16 px steps: an animated scale isn't redrawn every frame), 128–2048.
		const long = Math.min(2048, Math.max(128, Math.round((DEFAULT_GRAPHIC_SOURCE_SIZE * Math.max(sx, sy)) / 16) * 16));
		const short = Math.max(2, Math.round((long * Math.min(sx, sy)) / Math.max(sx, sy)));
		return sx >= sy ? { width: long, height: short } : { width: short, height: long };
	}

	/**
	 * Animated graphics (Lottie) are redrawn when their frame changes. Two
	 * canvases alternate so the compositor sees a new source object and
	 * re-uploads the texture, without allocating a canvas per frame.
	 */
	private animatedSources: OffscreenCanvas[] = [];
	private animatedIndex = 0;

	private getAnimatedSource({
		definition,
		resolvedParams,
	}: {
		definition: GraphicDefinition;
		resolvedParams: ParamValues;
	}): OffscreenCanvas {
		const time = Math.max(0, this.resolved?.localTime ?? 0) / TICKS_PER_SECOND;
		const duration = Math.max(0, this.params.duration) / TICKS_PER_SECOND;
		// Params without the (large) animation JSON; its length identifies it.
		const { "lottie.json": data, ...rest } = resolvedParams;
		const cacheKey = `${this.params.definitionId}|${Math.round(time * 1000)}|${String(data ?? "").length}|${JSON.stringify(rest)}`;
		if (this.cachedSource && this.cachedKey === cacheKey) {
			return this.cachedSource;
		}
		while (this.animatedSources.length < 2) {
			this.animatedSources.push(
				createCanvasSurface({
					width: DEFAULT_GRAPHIC_SOURCE_SIZE,
					height: DEFAULT_GRAPHIC_SOURCE_SIZE,
				}).canvas,
			);
		}
		this.animatedIndex = (this.animatedIndex + 1) % 2;
		const canvas = this.animatedSources[this.animatedIndex];
		const context = canvas.getContext("2d");
		if (context) {
			definition.render({
				ctx: context,
				params: resolvedParams,
				width: DEFAULT_GRAPHIC_SOURCE_SIZE,
				height: DEFAULT_GRAPHIC_SOURCE_SIZE,
				time,
				duration,
			});
		}
		this.cachedKey = cacheKey;
		this.cachedSource = canvas;
		return canvas;
	}
}
