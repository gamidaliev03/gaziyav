import type { AnimationPath, ElementAnimations } from "@/animation/types";
import type { EditorCore } from "@/core";
import type { ParamValue } from "@/params";
import { type ElementParamDefinition, getElementParams, writeElementParamValue } from "@/params/registry";
import type { TimelineElement } from "@/timeline";

export type ParamReset = { param: ElementParamDefinition; value: ParamValue; path?: AnimationPath };

/** The clip's animations without the given parameters' keys (undefined when nothing is left). */
export function removeAnimationPaths({
	animations,
	paths,
}: {
	animations: ElementAnimations | undefined;
	paths: Iterable<AnimationPath>;
}): ElementAnimations | undefined {
	if (!animations) return undefined;
	const remove = new Set(paths);
	const kept = Object.fromEntries(Object.entries(animations).filter(([path]) => !remove.has(path)));
	return Object.keys(kept).length > 0 ? kept : undefined;
}

/** The reset ↺: the parameters' keys go and their default values come back, as one patch. */
export function buildResetPatch({ element, entries }: { element: TimelineElement; entries: ParamReset[] }): Partial<TimelineElement> {
	let next = element;
	for (const { param, value } of entries) next = writeElementParamValue({ element: next, param, value });
	return {
		...next,
		animations: removeAnimationPaths({ animations: element.animations, paths: entries.map((entry) => entry.path ?? entry.param.key) }),
	};
}

/** Resets parameters of one clip (row ↺ or the section's ↺): keys removed, defaults back — one ⌘Z. */
export function resetParams({
	editor,
	trackId,
	element,
	entries,
}: {
	editor: EditorCore;
	trackId: string;
	element: TimelineElement;
	entries: ParamReset[];
}): void {
	if (entries.length === 0) return;
	editor.timeline.updateElements({ updates: [{ trackId, elementId: element.id, patch: buildResetPatch({ element, entries }) }] });
}

const TRANSFORM_PARAM_KEYS = ["transform.positionX", "transform.positionY", "transform.scaleX", "transform.scaleY", "transform.rotate"];

/** ⌥⇧R: Transform of every given clip back to defaults with its keys gone (flips too), one ⌘Z for all. */
export function resetTransform({ editor, clips }: { editor: EditorCore; clips: Array<{ trackId: string; element: TimelineElement }> }): number {
	const updates = clips.flatMap(({ trackId, element }) => {
		const params = getElementParams({ element });
		const own = element as { params?: Record<string, unknown>; animations?: Record<string, unknown> };
		const entries = TRANSFORM_PARAM_KEYS.flatMap((key) => {
			const param = params.find((candidate) => candidate.key === key);
			if (!param) return [];
			// already at its default and not animated: nothing to reset (no empty undo step — register A5)
			const current = own.params?.[key];
			if (!own.animations?.[key] && (current === undefined || current === param.default)) return [];
			return [{ param, value: param.default }];
		});
		return entries.length > 0 ? [{ trackId, elementId: element.id, patch: buildResetPatch({ element, entries }) }] : [];
	});
	if (updates.length > 0) editor.timeline.updateElements({ updates });
	return updates.length;
}
