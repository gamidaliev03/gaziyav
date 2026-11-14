import type { ParamDefinition, ParamValues } from "@/params";
import { defineShaderSource } from "@/effects/shader-sources";
import type {
	EffectDefinition,
	EffectPass,
	EffectRenderParams,
	EffectTimeContext,
} from "@/effects/types";

const ZERO_TIME: EffectTimeContext = {
	time: 0,
	duration: 0,
	progress: 0,
	frame: 0,
};

export function num(values: ParamValues, key: string, fallback = 0): number {
	const raw = values[key];
	const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
	return Number.isFinite(value) ? value : fallback;
}

export function bool(values: ParamValues, key: string): number {
	const raw = values[key];
	return raw === true || raw === "true" ? 1 : 0;
}

/** Hex color → straight sRGB [r,g,b] in 0..1. */
export function rgb(values: ParamValues, key: string, fallback: [number, number, number]): [number, number, number] {
	const raw = values[key];
	if (typeof raw !== "string") return fallback;
	const match = /^#?([0-9a-f]{6})/i.exec(raw.trim());
	if (!match) return fallback;
	const n = Number.parseInt(match[1], 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export type PackContext = EffectRenderParams & { t: EffectTimeContext; p: ParamValues };

/**
 * Single-pass effect backed by a runtime WGSL shader. `pack` maps params to up
 * to 32 floats (read in WGSL as P0()..P7()).
 */
export function defineShaderEffect({
	type,
	name,
	keywords,
	category,
	params,
	shader,
	wgsl,
	pack,
	hidden,
	textures,
	thumbnailParams,
}: {
	type: string;
	name: string;
	keywords: string[];
	category: string;
	params: ParamDefinition[];
	/** Shader id; defaults to `type` (lets several effects share one shader). */
	shader?: string;
	wgsl: string;
	pack: (ctx: PackContext) => number[];
	hidden?: boolean;
	textures?: (ctx: PackContext) => string[];
	thumbnailParams?: ParamValues;
}): EffectDefinition {
	const shaderId = shader ?? type;
	defineShaderSource({ id: shaderId, wgsl });
	const buildPasses = (ctx: EffectRenderParams): EffectPass[] => {
		const full: PackContext = { ...ctx, t: ctx.time ?? ZERO_TIME, p: ctx.effectParams };
		const pass: EffectPass = {
			shader: shaderId,
			uniforms: {
				u_time: full.t.time,
				u_progress: full.t.progress,
				u_frame: full.t.frame,
				u_params: pack(full).slice(0, 32),
			},
		};
		const ids = textures?.(full);
		if (ids && ids.length > 0) pass.textures = ids;
		return [pass];
	};
	return {
		type,
		name,
		keywords,
		category,
		params,
		hidden,
		thumbnailParams,
		shaders: [{ id: shaderId, wgsl }],
		renderer: { passes: [], buildPasses },
	};
}

export function numberParam(
	key: string,
	label: string,
	def: number,
	min: number,
	max: number,
	step: number,
	extra: Partial<ParamDefinition> = {},
): ParamDefinition {
	return {
		key,
		label,
		type: "number",
		default: def,
		min,
		max,
		step,
		keyframable: true,
		...extra,
	} as ParamDefinition;
}
