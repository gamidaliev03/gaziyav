import { clampAnimationsToDuration } from "@/animation";
import { remapAnimationsForContentChange } from "@/animation/remap-time";
import { remapBeats } from "@/timeline/beats";
import {
	clampRetimeRate,
	getSourceSpanAtClipTime,
	getTimelineDurationForSourceSpan,
} from "@/retime";
import type { RetimeConfig, SceneTracks, TimelineElement } from "@/timeline";
import { isRetimableElement } from "@/timeline";
import { TICKS_PER_SECOND, ZERO_MEDIA_TIME, roundMediaTime } from "@/wasm";

type ElementUpdateField = keyof TimelineElement | string;

export interface ElementUpdateContext {
	tracks: SceneTracks;
	trackId: string;
}

interface ElementUpdateRuleResult {
	element: TimelineElement;
	changedFields?: ElementUpdateField[];
}

interface ElementUpdateRuleParams {
	element: TimelineElement;
	originalElement: TimelineElement;
	patch: Partial<TimelineElement>;
	context: ElementUpdateContext;
}

interface ElementUpdateRule {
	triggers: ElementUpdateField[];
	apply: (params: ElementUpdateRuleParams) => ElementUpdateRuleResult;
}

const deriveRules: ElementUpdateRule[] = [
	{
		triggers: ["retime"],
		apply: ({ element, originalElement, patch }) => {
			if (!("retime" in patch) || !isRetimableElement(element)) {
				return { element };
			}

			// Smooth slow motion (src/motion) survives speed edits that don't mention it.
			const keepSmooth =
				patch.retime && !("smooth" in patch.retime) && isRetimableElement(originalElement) && originalElement.retime?.smooth
					? { smooth: true }
					: {};
			const nextRetime = patch.retime
				? {
						...keepSmooth,
						...patch.retime,
						rate: clampRetimeRate({ rate: patch.retime.rate }),
					}
				: undefined;

			const sourceDuration = getSourceDuration({
				trimStart: originalElement.trimStart,
				trimEnd: originalElement.trimEnd,
				duration: originalElement.duration,
				sourceDuration: isRetimableElement(originalElement)
					? originalElement.sourceDuration
					: undefined,
				retime: isRetimableElement(originalElement)
					? originalElement.retime
					: undefined,
			});
			const visibleSourceSpan = Math.max(
				0,
				sourceDuration - element.trimStart - element.trimEnd,
			);
			const nextDuration = roundMediaTime({
				time: getTimelineDurationForSourceSpan({
					sourceSpan: visibleSourceSpan,
					retime: nextRetime,
				}),
			});

			return {
				element: {
					...element,
					retime: nextRetime,
					duration: nextDuration,
				},
				changedFields: ["retime", "duration"],
			};
		},
	},
];

const enforceRules: ElementUpdateRule[] = [
	{
		// Keys and beat marks stay on their frame of the picture: a left trim moves them, a speed change
		// stretches them (keys9). A patch that sets either explicitly (split, resize) keeps its own values.
		triggers: ["trimStart", "retime"],
		apply: ({ element, originalElement, patch }) => {
			const before = {
				trimStart: originalElement.trimStart,
				retime: isRetimableElement(originalElement) ? originalElement.retime : undefined,
			};
			const after = {
				trimStart: element.trimStart,
				retime: isRetimableElement(element) ? element.retime : undefined,
			};
			return {
				element: {
					...element,
					...("animations" in patch
						? {}
						: {
								animations: remapAnimationsForContentChange({
									animations: element.animations,
									before,
									after,
									duration: element.duration,
								}),
							}),
					...("beats" in patch
						? {}
						: {
								beats: remapBeats({
									beats: element.beats,
									before,
									after,
									duration: element.duration,
								}),
							}),
				},
			};
		},
	},
	{
		triggers: ["duration"],
		apply: ({ element }) => ({
			element: {
				...element,
				animations: clampAnimationsToDuration({
					animations: element.animations,
					duration: element.duration,
				}),
			},
		}),
	},
	{
		// A fade never runs past its clip, and in + out fit in it (CapCut): typed 99 s on a 5 s sound it was stored as 10 s
		// and drew a tent-shaped volume line (targeted test 05.11). Also after the clip got shorter.
		triggers: ["params", "duration"],
		apply: ({ element }) => {
			const params = element.params as Record<string, unknown> | undefined;
			const fadeIn = typeof params?.fadeIn === "number" ? params.fadeIn : 0;
			const fadeOut = typeof params?.fadeOut === "number" ? params.fadeOut : 0;
			if (!fadeIn && !fadeOut) return { element };
			const length = Math.max(0, element.duration / TICKS_PER_SECOND);
			const nextIn = Math.min(fadeIn, length);
			const nextOut = Math.min(fadeOut, Math.max(0, length - nextIn));
			if (nextIn === fadeIn && nextOut === fadeOut) return { element };
			const round = (seconds: number) => Math.floor(seconds * 100) / 100;
			return { element: { ...element, params: { ...params, fadeIn: round(nextIn), fadeOut: round(nextOut) } } as TimelineElement };
		},
	},
	{
		triggers: ["startTime"],
		apply: ({ element, context }) => {
			const requestedStartTime =
				element.startTime < ZERO_MEDIA_TIME
					? ZERO_MEDIA_TIME
					: element.startTime;
			if (context.trackId !== context.tracks.main.id) {
				return {
					element: {
						...element,
						startTime: requestedStartTime,
					},
				};
			}

			const earliestElement = context.tracks.main.elements
				.filter((candidate) => candidate.id !== element.id)
				.reduce<TimelineElement | null>((earliest, candidate) => {
					if (!earliest || candidate.startTime < earliest.startTime) {
						return candidate;
					}
					return earliest;
				}, null);

			return {
				element: {
					...element,
					startTime:
						!earliestElement || requestedStartTime <= earliestElement.startTime
							? ZERO_MEDIA_TIME
							: requestedStartTime,
				},
			};
		},
	},
];

export function applyElementUpdate({
	element,
	patch,
	context,
}: {
	element: TimelineElement;
	patch: Partial<TimelineElement>;
	context: ElementUpdateContext;
}): TimelineElement {
	let nextElement = {
		...element,
		...patch,
		params: {
			...element.params,
			...(patch.params ?? {}),
		},
	} as TimelineElement;
	const changedFields = new Set(
		Object.keys(patch) as ElementUpdateField[],
	);

	for (const rule of deriveRules) {
		if (!shouldApplyRule({ rule, changedFields })) {
			continue;
		}

		const result = rule.apply({
			element: nextElement,
			originalElement: element,
			patch,
			context,
		});
		nextElement = result.element;
		for (const field of result.changedFields ?? []) {
			changedFields.add(field);
		}
	}

	for (const rule of enforceRules) {
		if (!shouldApplyRule({ rule, changedFields })) {
			continue;
		}

		nextElement = rule.apply({
			element: nextElement,
			originalElement: element,
			patch,
			context,
		}).element;
	}

	return nextElement;
}

function shouldApplyRule({
	rule,
	changedFields,
}: {
	rule: ElementUpdateRule;
	changedFields: Set<ElementUpdateField>;
}): boolean {
	return rule.triggers.some((trigger) => changedFields.has(trigger));
}

function getSourceDuration({
	trimStart,
	trimEnd,
	duration,
	sourceDuration,
	retime,
}: {
	trimStart: number;
	trimEnd: number;
	duration: number;
	sourceDuration?: number;
	retime?: RetimeConfig;
}): number {
	if (typeof sourceDuration === "number") {
		return sourceDuration;
	}

	return (
		trimStart +
		getSourceSpanAtClipTime({
			clipTime: duration,
			retime,
		}) +
		trimEnd
	);
}
