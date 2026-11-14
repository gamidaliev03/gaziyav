import type {
	AnimationChannel,
	ChannelData,
	ElementAnimations,
	ScalarAnimationKey,
} from "@/animation/types";
import { getEffectiveRateAt } from "@/retime/resolve";
import type { RetimeConfig } from "@/timeline";
import { type MediaTime, roundMediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import {
	getChannelEntriesFromData,
	isAnimationStorageKey,
	isCompositeChannelData,
	isLeafChannelData,
} from "./channel-data";
import { isScalarChannel, normalizeChannel } from "./interpolation";
import { splitAnimationsAtTime } from "./keyframes";

/** New clip time = old clip time × scale + offset. */
export interface ClipTimeRemap {
	scale: number;
	offset: number;
}

export interface ContentTiming {
	trimStart: number;
	retime?: RetimeConfig;
}

/** Keys this close (ticks) to the clip's start or end land exactly on it: rounding must not add a boundary key. */
const EDGE_SNAP_TICKS = 1;

/**
 * How a change of trim start or speed moves the clip's picture in clip time. A key sits on a frame of the
 * source (source time = trimStart + clipTime × rate), so it moves and stretches with that frame.
 * Null when nothing moves.
 */
export function getContentTimeRemap({
	before,
	after,
}: {
	before: ContentTiming;
	after: ContentTiming;
}): ClipTimeRemap | null {
	const rateBefore = getEffectiveRateAt({ retime: before.retime });
	const rateAfter = getEffectiveRateAt({ retime: after.retime });
	const scale = rateBefore / rateAfter;
	const offset = (before.trimStart - after.trimStart) / rateAfter;
	if (Math.abs(scale - 1) < 1e-9 && Math.abs(offset) < 0.5) return null;
	return { scale, offset };
}

function remapKeyTime({
	time,
	remap,
	maxTime,
}: {
	time: number;
	remap: ClipTimeRemap;
	maxTime?: number;
}): MediaTime {
	const next = time * remap.scale + remap.offset;
	if (Math.abs(next) <= EDGE_SNAP_TICKS) return ZERO_MEDIA_TIME;
	if (maxTime !== undefined && Math.abs(next - maxTime) <= EDGE_SNAP_TICKS) {
		return roundMediaTime({ time: maxTime });
	}
	return roundMediaTime({ time: next });
}

function remapChannel({
	channel,
	remap,
	maxTime,
}: {
	channel: AnimationChannel;
	remap: ClipTimeRemap;
	maxTime?: number;
}): AnimationChannel {
	if (!isScalarChannel(channel)) {
		return normalizeChannel({
			channel: {
				...channel,
				keys: channel.keys.map((key) => ({
					...key,
					time: remapKeyTime({ time: key.time, remap, maxTime }),
				})),
			},
		});
	}
	const scaleHandle = (handle: ScalarAnimationKey["leftHandle"]) =>
		handle ? { dt: roundMediaTime({ time: handle.dt * remap.scale }), dv: handle.dv } : undefined;
	return normalizeChannel({
		channel: {
			...channel,
			keys: channel.keys.map((key) => ({
				...key,
				time: remapKeyTime({ time: key.time, remap, maxTime }),
				leftHandle: scaleHandle(key.leftHandle),
				rightHandle: scaleHandle(key.rightHandle),
			})),
		},
	});
}

function remapChannelData({
	data,
	remap,
	maxTime,
}: {
	data: ChannelData | undefined;
	remap: ClipTimeRemap;
	maxTime?: number;
}): ChannelData | undefined {
	if (isLeafChannelData(data)) return remapChannel({ channel: data, remap, maxTime });
	if (!isCompositeChannelData(data)) return data;
	return Object.fromEntries(
		getChannelEntriesFromData({ data }).map(([componentKey, channel]) => [
			componentKey,
			remapChannel({ channel, remap, maxTime }),
		]),
	);
}

/**
 * Moves and stretches every key: new time = time × scale + offset (bezier handles stretch too).
 * Keys pushed before the clip's start are cut off; the value there is kept as a key at 0, so what
 * the picture shows at the new first frame does not change. `maxTime` (the new duration) only
 * snaps keys that rounding put a tick off the end; cutting at the end is the duration rule's job.
 */
export function remapAnimationsTime({
	animations,
	remap,
	maxTime,
}: {
	animations: ElementAnimations | undefined;
	remap: ClipTimeRemap;
	maxTime?: number;
}): ElementAnimations | undefined {
	if (!animations) return undefined;
	let source = animations;
	const { scale } = remap;
	let { offset } = remap;
	// Old clip time that lands on the new 0: everything before it is cut off.
	const cutTime = -offset / scale;
	if (cutTime > EDGE_SNAP_TICKS) {
		const { rightAnimations } = splitAnimationsAtTime({
			animations,
			splitTime: roundMediaTime({ time: cutTime }),
			shouldIncludeSplitBoundary: true,
		});
		if (!rightAnimations) return undefined;
		// The right half already starts at the cut: only the stretch is left.
		source = rightAnimations;
		offset = 0;
	}
	const next: ElementAnimations = {};
	for (const [propertyPath, data] of Object.entries(source)) {
		if (!isAnimationStorageKey({ key: propertyPath })) continue;
		const remapped = remapChannelData({ data, remap: { scale, offset }, maxTime });
		if (remapped) next[propertyPath] = remapped;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The clip's keys after its trim start or speed changed (left trim, ⌘R speed, Q/W, a speed ramp):
 * each key stays on its frame of the picture. Returns `animations` itself when nothing moved.
 */
export function remapAnimationsForContentChange({
	animations,
	before,
	after,
	duration,
}: {
	animations: ElementAnimations | undefined;
	before: ContentTiming;
	after: ContentTiming;
	/** The clip's new duration. */
	duration?: number;
}): ElementAnimations | undefined {
	if (!animations) return animations;
	const remap = getContentTimeRemap({ before, after });
	if (!remap) return animations;
	return remapAnimationsTime({ animations, remap, maxTime: duration });
}
