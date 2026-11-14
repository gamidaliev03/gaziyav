import type { ElementAnimations } from "@/animation/types";
import type { ParamValues } from "@/params";
import { removeElementKeyframe } from "./keyframes";
import { resolveAnimationPathValueAtTime } from "./resolve";
import {
	EFFECT_PARAM_PATH_PREFIX,
	EFFECT_PARAM_PATH_SUFFIX,
	buildEffectParamPath,
	isEffectParamPath,
	parseEffectParamPath,
} from "./param-paths";

export {
	EFFECT_PARAM_PATH_PREFIX,
	EFFECT_PARAM_PATH_SUFFIX,
	buildEffectParamPath,
	isEffectParamPath,
	parseEffectParamPath,
};

export function resolveEffectParamsAtTime({
	effectId,
	params,
	animations,
	localTime,
}: {
	effectId: string;
	params: ParamValues;
	animations: ElementAnimations | undefined;
	localTime: number;
}): ParamValues {
	const safeLocalTime = Math.max(0, localTime);
	const resolved: ParamValues = {};

	for (const [paramKey, staticValue] of Object.entries(params)) {
		const path = buildEffectParamPath({ effectId, paramKey });
		resolved[paramKey] = animations?.[path]
			? resolveAnimationPathValueAtTime({
					animations,
					propertyPath: path,
					localTime: safeLocalTime,
					fallbackValue: staticValue,
				})
			: staticValue;
	}

	return resolved;
}

export function removeEffectParamKeyframe({
	animations,
	effectId,
	paramKey,
	keyframeId,
}: {
	animations: ElementAnimations | undefined;
	effectId: string;
	paramKey: string;
	keyframeId: string;
}): ElementAnimations | undefined {
	return removeElementKeyframe({
		animations,
		propertyPath: buildEffectParamPath({ effectId, paramKey }),
		keyframeId,
	});
}
