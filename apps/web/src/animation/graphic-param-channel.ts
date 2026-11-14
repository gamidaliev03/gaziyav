import type { ElementAnimations } from "@/animation/types";
import type { ParamDefinition, ParamValues } from "@/params";
import { resolveAnimationPathValueAtTime } from "./resolve";
import {
	GRAPHIC_PARAM_PATH_PREFIX,
	buildGraphicParamPath,
	isGraphicParamPath,
	parseGraphicParamPath,
} from "./param-paths";

export {
	GRAPHIC_PARAM_PATH_PREFIX,
	buildGraphicParamPath,
	isGraphicParamPath,
	parseGraphicParamPath,
};

export function resolveGraphicParamsAtTime({
	params,
	definitions,
	animations,
	localTime,
}: {
	params: ParamValues;
	definitions: ParamDefinition[];
	animations?: ElementAnimations;
	localTime: number;
}): ParamValues {
	const resolved: ParamValues = { ...params };

	for (const param of definitions) {
		const path = buildGraphicParamPath({ paramKey: param.key });
		if (!animations?.[path]) {
			continue;
		}

		resolved[param.key] = resolveAnimationPathValueAtTime({
			animations,
			propertyPath: path,
			localTime: Math.max(0, localTime),
			fallbackValue: params[param.key] ?? param.default,
		});
	}

	return resolved;
}
