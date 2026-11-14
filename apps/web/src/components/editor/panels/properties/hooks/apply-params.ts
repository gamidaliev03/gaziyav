import {
	getKeyframeAtTime,
	hasKeyframesForPath,
	upsertPathKeyframe,
} from "@/animation";
import { coerceParamValue, getParamChannelLayout, type ParamValue } from "@/params";
import { writeElementParamValue, type ElementParamDefinition } from "@/params/registry";
import { getChannelEntriesFromData } from "@/animation/channel-data";
import type { EditorCore } from "@/core";
import type { TimelineElement } from "@/timeline";
import { addMediaTime, mediaTime, type MediaTime } from "@/wasm";

/**
 * The update for several parameters of one clip: animated parameters get a keyframe at the playhead, the
 * rest change their base value (writing the base of an animated value changes nothing on screen).
 */
export function buildParamUpdates({
	element,
	entries,
	localTime,
	isPlayheadWithinElementRange,
}: {
	element: TimelineElement;
	entries: Array<{ param: ElementParamDefinition; value: ParamValue }>;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
}): Partial<TimelineElement> {
	let next: TimelineElement = element;
	let animations = element.animations;
	for (const { param, value } of entries) {
		const animated =
			isPlayheadWithinElementRange &&
			hasKeyframesForPath({ animations: element.animations, propertyPath: param.key });
		if (animated) {
			animations = upsertPathKeyframe({
				animations,
				propertyPath: param.key,
				time: localTime,
				value,
				channelLayout: getParamChannelLayout({ param }),
				coerceValue: ({ value: v }) => coerceParamValue({ param, value: v }),
			});
		} else {
			next = writeElementParamValue({ element: next, param, value });
		}
	}
	// Only what changed (perfb, 14.11): a section that skipped a re-render when the clip only moved holds the clip as it
	// was before the move; writing the whole object back would move the clip back with the edit.
	const changed: Record<string, unknown> = {};
	const before = element as unknown as Record<string, unknown>;
	const after = next as unknown as Record<string, unknown>;
	for (const key of Object.keys(after)) if (after[key] !== before[key]) changed[key] = after[key];
	if (animations !== element.animations) changed.animations = animations;
	return changed as Partial<TimelineElement>;
}

/**
 * Writes several parameters of one clip as ONE change (Position X+Y, linked Scale X+Y, a reset). Preview
 * only unless `commit` — then it lands as a single undo step.
 */
export function applyParamValues({
	editor,
	element,
	trackId,
	entries,
	localTime,
	isPlayheadWithinElementRange,
	commit = false,
}: {
	editor: EditorCore;
	element: TimelineElement;
	trackId: string;
	entries: Array<{ param: ElementParamDefinition; value: ParamValue }>;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
	commit?: boolean;
}) {
	const updates = buildParamUpdates({ element, entries, localTime, isPlayheadWithinElementRange });
	editor.timeline.previewElements({
		updates: [{ trackId, elementId: element.id, updates }],
	});
	if (commit) editor.timeline.commitPreview();
}

/** One ◆ for several channels (Position = X + Y): adds both keyframes, or removes both, in one step. */
export function toggleKeyframes({
	editor,
	element,
	trackId,
	channels,
	localTime,
}: {
	editor: EditorCore;
	element: TimelineElement;
	trackId: string;
	channels: Array<{ path: string; value: number }>;
	localTime: MediaTime;
}) {
	const existing = channels.flatMap(({ path }) => {
		const keyframe = getKeyframeAtTime({ animations: element.animations, propertyPath: path, time: localTime });
		return keyframe ? [{ path, id: keyframe.id }] : [];
	});
	if (existing.length > 0) {
		editor.timeline.removeKeyframes({
			keyframes: existing.map(({ path, id }) => ({
				trackId,
				elementId: element.id,
				propertyPath: path,
				keyframeId: id,
			})),
		});
		return;
	}
	editor.timeline.upsertKeyframes({
		keyframes: channels.map(({ path, value }) => ({
			trackId,
			elementId: element.id,
			propertyPath: path,
			time: localTime,
			value,
		})),
	});
}

/**
 * ‹ and › of an animated row (Premiere's keyframe navigator): the playhead to the previous / next key of these paths
 * (Position = X + Y), in the clip's own time. Nothing that way: undefined (the arrow is off). Only the playhead moves.
 */
export function keyStepper({
	editor,
	element,
	paths,
	localTime,
}: {
	editor: EditorCore;
	element: TimelineElement;
	paths: string[];
	localTime: MediaTime;
}): { onPrev?: () => void; onNext?: () => void } {
	const times = new Set<number>();
	for (const path of paths) {
		for (const [, channel] of getChannelEntriesFromData({ data: element.animations?.[path as keyof typeof element.animations] })) {
			for (const key of channel.keys) times.add(key.time);
		}
	}
	if (times.size === 0) return {};
	const sorted = [...times].sort((a, b) => a - b);
	const now = Number(localTime);
	const prev = [...sorted].reverse().find((time) => time < now);
	const next = sorted.find((time) => time > now);
	const seek = (time: number) => editor.playback.seek({ time: addMediaTime({ a: element.startTime, b: mediaTime({ ticks: time }) }) });
	return {
		onPrev: prev === undefined ? undefined : () => seek(prev),
		onNext: next === undefined ? undefined : () => seek(next),
	};
}

export function keyframeState({
	element,
	paths,
	localTime,
	isPlayheadWithinElementRange,
}: {
	element: TimelineElement;
	paths: string[];
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
}) {
	return {
		isAnimated: paths.some((path) => hasKeyframesForPath({ animations: element.animations, propertyPath: path })),
		isActive:
			isPlayheadWithinElementRange &&
			paths.some((path) => getKeyframeAtTime({ animations: element.animations, propertyPath: path, time: localTime }) !== null),
	};
}
