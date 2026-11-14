"use client";

import { useEditor } from "@/editor/use-editor";
import { removeAnimationPaths } from "./reset-params";
import {
	buildGraphicParamPath,
	getKeyframeAtTime,
	hasKeyframesForPath,
	upsertPathKeyframe,
} from "@/animation";
import type {
	AnimationPath,
	ElementAnimations,
} from "@/animation/types";
import {
	coerceParamValue,
	getParamChannelLayout,
	type ParamDefinition,
} from "@/params";
import type { TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";

export interface KeyframedParamPropertyResult {
	hasAnimatedKeyframes: boolean;
	isKeyframedAtTime: boolean;
	keyframeIdAtTime: string | null;
	onPreview: (value: number | string | boolean) => void;
	onCommit: () => void;
	toggleKeyframe: () => void;
	/** ↺: the parameter's keys removed and its default value back, one ⌘Z. */
	resetParam: () => void;
}

/**
 * The inspector's range is in display units (Opacity 0–100 % over a stored 0–1): a keyframe is checked in stored units,
 * or 20 % snapped to step 1 of 0–1 and every key became 0 or 100 %.
 */
function storedUnits<T extends { type: string }>(param: T): T {
	const p = param as T & { min?: number; max?: number; step?: number; displayMultiplier?: number };
	const m = p.displayMultiplier;
	if (p.type !== "number" || !m || m === 1) return param;
	return { ...p, min: p.min !== undefined ? p.min / m : p.min, max: p.max !== undefined ? p.max / m : p.max, step: p.step !== undefined ? p.step / m : p.step };
}

export function useKeyframedParamProperty({
	param,
	trackId,
	elementId,
	animations,
	propertyPath,
	localTime,
	isPlayheadWithinElementRange,
	resolvedValue,
	buildBaseUpdates,
}: {
	param: ParamDefinition;
	trackId: string;
	elementId: string;
	animations: ElementAnimations | undefined;
	propertyPath?: AnimationPath;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
	resolvedValue: number | string | boolean;
	buildBaseUpdates: ({
		value,
	}: {
		value: number | string | boolean;
	}) => Partial<TimelineElement>;
}): KeyframedParamPropertyResult {
	const editor = useEditor();
	const resolvedPropertyPath =
		propertyPath ?? buildGraphicParamPath({ paramKey: param.key });
	const hasAnimatedKeyframes = hasKeyframesForPath({
		animations,
		propertyPath: resolvedPropertyPath,
	});
	const keyframeAtTime = isPlayheadWithinElementRange
		? getKeyframeAtTime({
				animations,
				propertyPath: resolvedPropertyPath,
				time: localTime,
			})
		: null;
	const keyframeIdAtTime = keyframeAtTime?.id ?? null;
	const isKeyframedAtTime = keyframeAtTime !== null;
	const shouldUseAnimatedChannel =
		hasAnimatedKeyframes && isPlayheadWithinElementRange;

	const previewValue: KeyframedParamPropertyResult["onPreview"] = (value) => {
		if (shouldUseAnimatedChannel) {
			editor.timeline.previewElements({
				updates: [
					{
						trackId,
						elementId,
						updates: {
							animations: upsertPathKeyframe({
								animations,
								propertyPath: resolvedPropertyPath,
								time: localTime,
								value,
								channelLayout: getParamChannelLayout({ param }),
								coerceValue: ({ value: nextValue }) =>
									coerceParamValue({
										param: storedUnits(param),
										value: nextValue,
									}),
							}),
						},
					},
				],
			});
			return;
		}

		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId,
					updates: buildBaseUpdates({ value }),
				},
			],
		});
	};

	const toggleKeyframe = () => {
		if (!isPlayheadWithinElementRange) {
			return;
		}

		if (keyframeIdAtTime) {
			editor.timeline.removeKeyframes({
				keyframes: [
					{
						trackId,
						elementId,
						propertyPath: resolvedPropertyPath,
						keyframeId: keyframeIdAtTime,
					},
				],
			});
			return;
		}

		editor.timeline.upsertKeyframes({
			keyframes: [
				{
					trackId,
					elementId,
					propertyPath: resolvedPropertyPath,
					time: localTime,
					value: resolvedValue,
				},
			],
		});
	};

	const resetParam = () => {
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId,
					patch: {
						...buildBaseUpdates({ value: param.default }),
						animations: removeAnimationPaths({ animations, paths: [resolvedPropertyPath] }),
					},
				},
			],
		});
	};

	return {
		hasAnimatedKeyframes,
		isKeyframedAtTime,
		keyframeIdAtTime,
		onPreview: previewValue,
		onCommit: () => editor.timeline.commitPreview(),
		toggleKeyframe,
		resetParam,
	};
}
