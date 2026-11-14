import { generateUUID } from "@/utils/id";
import { buildDefaultParamValues } from "@/params/registry";
import { effectsRegistry } from "./registry";
import type { ParamValues } from "@/params";
import type {
	Effect,
	EffectDefinition,
	EffectPass,
	EffectTimeContext,
} from "@/effects/types";
import { VISUAL_ELEMENT_TYPES } from "@/timeline";

export { effectsRegistry } from "./registry";
export { registerDefaultEffects } from "./definitions";

export function resolveEffectPasses({
	definition,
	effectParams,
	width,
	height,
	time,
}: {
	definition: EffectDefinition;
	effectParams: ParamValues;
	width: number;
	height: number;
	time?: EffectTimeContext;
}): EffectPass[] {
	// a setting the effect has and the saved layer doesn't (a retired twin's layer, a setting added later): its default
	if (definition.params.some((param) => !(param.key in effectParams))) {
		effectParams = { ...buildDefaultParamValues(definition.params), ...effectParams };
	}
	if (definition.renderer.buildPasses) {
		return definition.renderer.buildPasses({
			effectParams,
			width,
			height,
			time,
		});
	}
	return definition.renderer.passes.map((pass) => ({
		shader: pass.shader,
		uniforms: pass.uniforms({ effectParams, width, height, time }),
	}));
}

/** Builds the element-local time context from timeline ticks. */
export function buildEffectTimeContext({
	localTicks,
	durationTicks,
	ticksPerSecond,
	fps,
}: {
	localTicks: number;
	durationTicks: number;
	ticksPerSecond: number;
	fps: number;
}): EffectTimeContext {
	const time = Math.max(0, localTicks / ticksPerSecond);
	const duration = Math.max(0, durationTicks / ticksPerSecond);
	return {
		time,
		duration,
		progress: duration > 0 ? Math.min(1, time / duration) : 0,
		frame: Math.round(time * (fps > 0 ? fps : 30)),
	};
}

export const EFFECT_TARGET_ELEMENT_TYPES = VISUAL_ELEMENT_TYPES;

export function buildDefaultEffectInstance({
	effectType,
}: {
	effectType: string;
}): Effect {
	const definition = effectsRegistry.get(effectType);
	const params: ParamValues = buildDefaultParamValues(definition.params);

	return {
		id: generateUUID(),
		type: effectType,
		params,
		enabled: true,
	};
}
