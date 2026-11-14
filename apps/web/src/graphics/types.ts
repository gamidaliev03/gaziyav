import type { ParamDefinition, ParamValues } from "@/params";

export const DEFAULT_GRAPHIC_SOURCE_SIZE = 512;

export interface GraphicRenderContext {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	params: ParamValues;
	width: number;
	height: number;
	/** Seconds from the clip start (animated graphics only). */
	time?: number;
	/** Clip length in seconds (animated graphics only). */
	duration?: number;
}

export interface GraphicDefinition {
	id: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	/** Redrawn every frame with `time` / `duration` (Lottie). */
	animated?: boolean;
	render(context: GraphicRenderContext): void;
}

export interface GraphicInstance {
	definitionId: string;
	params: ParamValues;
}
