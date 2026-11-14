import type {
	AnimationChannel,
	AnimationPath,
	ElementAnimations,
	ScalarAnimationKey,
} from "@/animation/types";
import { roundMediaTime } from "@/wasm";
import {
	getChannelEntriesFromData,
	isCompositeChannelData,
	isLeafChannelData,
} from "./channel-data";
import { isScalarChannel, normalizeScalarChannel } from "./interpolation";

/**
 * What the keyframe hotkeys set on a key (After Effects names):
 * - ease: Easy Ease (F9) — the value slows into and out of the key (flat tangents on both sides);
 * - ease-in / ease-out: only the side coming into / going out of the key;
 * - linear: constant speed through the key; hold: the value jumps at the next key.
 */
export type KeyframeEase = "ease" | "ease-in" | "ease-out" | "linear" | "hold";

export const KEYFRAME_EASE_LABELS: Record<KeyframeEase, string> = {
	ease: "Easy Ease",
	"ease-in": "Ease In",
	"ease-out": "Ease Out",
	linear: "Linear",
	hold: "Hold",
};

/** A third of the segment, flat: AE's 33% influence at zero speed. */
function flatHandle({ span, side }: { span: number; side: "left" | "right" }) {
	return { dt: roundMediaTime({ time: side === "right" ? span / 3 : -span / 3 }), dv: 0 };
}

/** The handle that keeps a bezier segment a straight line (what a linear segment looks like). */
function straightHandle({ from, to }: { from: ScalarAnimationKey; to: ScalarAnimationKey }) {
	return { dt: roundMediaTime({ time: (to.time - from.time) / 3 }), dv: (to.value - from.value) / 3 };
}

function easeKeys({
	keys,
	index,
	ease,
}: {
	keys: ScalarAnimationKey[];
	index: number;
	ease: KeyframeEase;
}): void {
	const key = keys[index];
	const previous = keys[index - 1];
	const next = keys[index + 1];
	if (ease === "hold") {
		keys[index] = { ...key, segmentToNext: "step", rightHandle: undefined };
		return;
	}
	if (ease === "linear") {
		keys[index] = { ...key, segmentToNext: "linear", rightHandle: undefined, leftHandle: undefined, tangentMode: "auto" };
		return;
	}
	let nextKey: ScalarAnimationKey = { ...key, tangentMode: "flat" };
	if (next && (ease === "ease" || ease === "ease-out")) {
		nextKey = { ...nextKey, segmentToNext: "bezier", rightHandle: flatHandle({ span: next.time - key.time, side: "right" }) };
	}
	// A hold before the key stays a hold: there is nothing to ease into.
	if (previous && previous.segmentToNext !== "step" && (ease === "ease" || ease === "ease-in")) {
		if (previous.segmentToNext !== "bezier") {
			keys[index - 1] = { ...previous, segmentToNext: "bezier", rightHandle: straightHandle({ from: previous, to: key }) };
		}
		nextKey = { ...nextKey, leftHandle: flatHandle({ span: key.time - previous.time, side: "left" }) };
	}
	keys[index] = nextKey;
}

function easeChannel({
	channel,
	keyframeIds,
	ease,
}: {
	channel: AnimationChannel;
	keyframeIds: ReadonlySet<string>;
	ease: KeyframeEase;
}): AnimationChannel {
	if (!isScalarChannel(channel)) return channel;
	const normalized = normalizeScalarChannel({ channel });
	const keys = [...normalized.keys];
	let changed = false;
	for (let index = 0; index < keys.length; index++) {
		if (!keyframeIds.has(keys[index].id)) continue;
		easeKeys({ keys, index, ease });
		changed = true;
	}
	return changed ? normalizeScalarChannel({ channel: { ...normalized, keys } }) : channel;
}

/** Sets the ease of the given keys of one property (every component of a colour or a pair). */
export function applyKeyframeEase({
	animations,
	propertyPath,
	keyframeIds,
	ease,
}: {
	animations: ElementAnimations | undefined;
	propertyPath: AnimationPath;
	keyframeIds: Iterable<string>;
	ease: KeyframeEase;
}): ElementAnimations | undefined {
	const data = animations?.[propertyPath];
	if (!animations || !data) return animations;
	const ids = new Set(keyframeIds);
	const nextData = isLeafChannelData(data)
		? easeChannel({ channel: data, keyframeIds: ids, ease })
		: isCompositeChannelData(data)
			? Object.fromEntries(
					getChannelEntriesFromData({ data }).map(([componentKey, channel]) => [
						componentKey,
						easeChannel({ channel, keyframeIds: ids, ease }),
					]),
				)
			: data;
	return { ...animations, [propertyPath]: nextData };
}
