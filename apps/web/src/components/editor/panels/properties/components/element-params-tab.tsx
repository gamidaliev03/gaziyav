"use client";

import { resolveAnimationPathValueAtTime } from "@/animation";
import { useElementPlayhead } from "@/components/editor/panels/properties/hooks/use-element-playhead";
import { useKeyframedParamProperty } from "@/components/editor/panels/properties/hooks/use-keyframed-param-property";
import { PropertyParamField } from "@/components/editor/panels/properties/components/property-param-field";
import { keyStepper } from "@/components/editor/panels/properties/hooks/apply-params";
import { EditorCore } from "@/core";
import type { ParamValue, ParamValues } from "@/params";
import {
	getElementParams,
	readElementParamValue,
	writeElementParamValue,
	type ElementParamDefinition,
} from "@/params/registry";
import type { TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";

/** One row of a group: which parameter, and optionally a shorter label / unit / display override. */
export interface ParamRowSpec {
	key: string;
	label?: string;
	unit?: string;
	/** Display-only changes (e.g. opacity shown as 0–100 %). */
	override?: Partial<ElementParamDefinition>;
}

/** The rows of one group, in the given order; rows whose dependencies aren't met are hidden. */
export function ParamRows({
	element,
	trackId,
	rows,
}: {
	element: TimelineElement;
	trackId: string;
	rows: readonly (ParamRowSpec | string)[];
}) {
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: element.startTime,
		duration: element.duration,
		animated: Object.keys(element.animations ?? {}).length > 0,
		elementId: element.id,
	});
	const all = getElementParams({ element });
	const specs = rows.map((row) => (typeof row === "string" ? { key: row } : row));
	const params = specs.flatMap((spec) => {
		const param = all.find((p) => p.key === spec.key);
		return param ? [{ spec, param }] : [];
	});
	const baseValues = buildValues({ element, params: all });
	return (
		<>
			{params
				.filter(({ param }) => isVisible({ param, values: baseValues }))
				.map(({ spec, param }) => (
					<ElementParamField
						key={param.key}
						element={element}
						trackId={trackId}
						param={spec.override ? ({ ...param, ...spec.override } as ElementParamDefinition) : param}
						label={spec.label}
						unit={spec.unit}
						baseValue={baseValues[param.key] ?? param.default}
						localTime={localTime}
						isPlayheadWithinElementRange={isPlayheadWithinElementRange}
					/>
				))}
		</>
	);
}

export function ElementParamField({
	element,
	trackId,
	param,
	baseValue,
	localTime,
	isPlayheadWithinElementRange,
	label,
	unit,
}: {
	element: TimelineElement;
	trackId: string;
	param: ElementParamDefinition;
	baseValue: ParamValue;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
	label?: string;
	unit?: string;
}) {
	const resolvedValue = resolveAnimationPathValueAtTime({
		animations: element.animations,
		propertyPath: param.key,
		localTime,
		fallbackValue: baseValue,
	});
	const animatedParam = useKeyframedParamProperty({
		param,
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath: param.key,
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue,
		buildBaseUpdates: ({ value }) =>
			writeElementParamValue({ element, param, value }),
	});

	return (
		<PropertyParamField
			param={param}
			value={resolvedValue}
			label={label}
			unit={unit}
			onPreview={animatedParam.onPreview}
			onCommit={animatedParam.onCommit}
			keyframe={
				param.keyframable === false
					? undefined
					: {
							isActive: animatedParam.isKeyframedAtTime,
							isAnimated: animatedParam.hasAnimatedKeyframes,
							isDisabled: !isPlayheadWithinElementRange,
							onToggle: animatedParam.toggleKeyframe,
							onReset: animatedParam.resetParam,
							...(animatedParam.hasAnimatedKeyframes ? keyStepper({ editor: EditorCore.getInstance(), element, paths: [param.key], localTime }) : {}),
						}
			}
		/>
	);
}

export function buildValues({
	element,
	params,
}: {
	element: TimelineElement;
	params: readonly ElementParamDefinition[];
}): ParamValues {
	const values: ParamValues = {};
	for (const param of params) {
		const value = readElementParamValue({ element, param });
		if (value !== null) {
			values[param.key] = value;
		}
	}
	return values;
}

export function isVisible({
	param,
	values,
}: {
	param: ElementParamDefinition;
	values: ParamValues;
}): boolean {
	return (param.dependencies ?? []).every(
		(dependency) => values[dependency.param] === dependency.equals,
	);
}
