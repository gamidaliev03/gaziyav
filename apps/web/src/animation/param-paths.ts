// Animation paths of effect and graphic params ("effects.<id>.params.<key>", "params.<key>"). A leaf: no
// keyframe maths here, so pure edits (paste attributes) can read paths without loading the engine.
import type { EffectParamPath, GraphicParamPath } from "@/animation/types";

export const EFFECT_PARAM_PATH_PREFIX = "effects.";
export const EFFECT_PARAM_PATH_SUFFIX = ".params.";

export function buildEffectParamPath({
	effectId,
	paramKey,
}: {
	effectId: string;
	paramKey: string;
}): EffectParamPath {
	return `${EFFECT_PARAM_PATH_PREFIX}${effectId}${EFFECT_PARAM_PATH_SUFFIX}${paramKey}`;
}

export function isEffectParamPath(
	propertyPath: string,
): propertyPath is EffectParamPath {
	return (
		propertyPath.startsWith(EFFECT_PARAM_PATH_PREFIX) &&
		propertyPath.includes(EFFECT_PARAM_PATH_SUFFIX)
	);
}

export function parseEffectParamPath({
	propertyPath,
}: {
	propertyPath: string;
}): { effectId: string; paramKey: string } | null {
	if (!isEffectParamPath(propertyPath)) {
		return null;
	}

	const withoutPrefix = propertyPath.slice(EFFECT_PARAM_PATH_PREFIX.length);
	const separatorIndex = withoutPrefix.indexOf(EFFECT_PARAM_PATH_SUFFIX);
	if (separatorIndex <= 0) {
		return null;
	}

	const effectId = withoutPrefix.slice(0, separatorIndex);
	const paramKey = withoutPrefix.slice(
		separatorIndex + EFFECT_PARAM_PATH_SUFFIX.length,
	);
	if (!effectId || !paramKey) {
		return null;
	}

	return { effectId, paramKey };
}

export const GRAPHIC_PARAM_PATH_PREFIX = "params.";

export function buildGraphicParamPath({
	paramKey,
}: {
	paramKey: string;
}): GraphicParamPath {
	return `${GRAPHIC_PARAM_PATH_PREFIX}${paramKey}`;
}

export function isGraphicParamPath(
	propertyPath: string,
): propertyPath is GraphicParamPath {
	return propertyPath.startsWith(GRAPHIC_PARAM_PATH_PREFIX);
}

export function parseGraphicParamPath({
	propertyPath,
}: {
	propertyPath: string;
}): { paramKey: string } | null {
	if (!isGraphicParamPath(propertyPath)) {
		return null;
	}

	const paramKey = propertyPath.slice(GRAPHIC_PARAM_PATH_PREFIX.length);
	return paramKey.length > 0 ? { paramKey } : null;
}
