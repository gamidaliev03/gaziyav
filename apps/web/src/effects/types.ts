import type { ParamDefinition, ParamValues } from "@/params";

export interface Effect {
	id: string;
	type: string;
	params: ParamValues;
	enabled: boolean;
}

export type EffectUniformValue = number | number[];

export interface EffectPass {
	shader: string;
	uniforms: Record<string, EffectUniformValue>;
	/** Compositor texture ids bound to aux0/aux1 (LUT strips, overlays). */
	textures?: string[];
}

/**
 * Element-local time for animated effects. Identical in preview and export:
 * both derive it from the same timeline time.
 */
export interface EffectTimeContext {
	/** Seconds since the element (or transition) started. */
	time: number;
	/** Element (or transition) duration in seconds. */
	duration: number;
	/** 0..1 through the element / transition. */
	progress: number;
	/** Element-local frame index (deterministic noise seed). */
	frame: number;
}

export interface EffectRenderParams {
	effectParams: ParamValues;
	width: number;
	height: number;
	time?: EffectTimeContext;
}

export interface EffectPassTemplate {
	shader: string;
	uniforms(params: EffectRenderParams): Record<string, EffectUniformValue>;
}

export interface EffectRendererConfig {
	passes: EffectPassTemplate[];
	buildPasses?: (params: EffectRenderParams) => EffectPass[];
}

/** A runtime WGSL shader body (`fn effect(uv: vec2f) -> vec4f`). */
export interface EffectShaderSource {
	id: string;
	wgsl: string;
}

export interface EffectDefinition {
	type: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	renderer: EffectRendererConfig;
	/** Grouping in the Effects tab. */
	category?: string;
	/** Runtime shaders this effect needs; registered lazily with the engine. */
	shaders?: EffectShaderSource[];
	/** Hidden from the Effects grid (e.g. color correction lives in «Цвет»). */
	hidden?: boolean;
	/** Parameter overrides for the tile preview only (effects that are neutral by default). */
	thumbnailParams?: Record<string, number | string | boolean>;
}
