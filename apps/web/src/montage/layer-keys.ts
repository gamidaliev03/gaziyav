// Simple keyframes of a composition layer (the ◇ beside Position, Size, Rotation, Opacity in the Layers panel).
// They are the editor's own transform keyframes (src/animation): the composition's timeline shows them as diamonds
// on the clip, the preview and the export play the same curve (flatten.ts puts the In / Out motion on top).
// Pure: element in, the element's new params + animations out (the panel makes it one ⌘Z).
import { getKeyframeAtTime, hasKeyframesForPath, removeElementKeyframe, resolveAnimationPathValueAtTime, upsertPathKeyframe } from "@/animation";
import type { ElementAnimations } from "@/animation/types";
import { NUMBER_CHANNEL_LAYOUT } from "@/params";
import type { MediaTime } from "@/wasm";

export const KEY_GROUPS = {
	position: ["transform.positionX", "transform.positionY"],
	scale: ["transform.scaleX", "transform.scaleY"],
	rotation: ["transform.rotate"],
	opacity: ["opacity"],
} as const;
export type KeyGroup = keyof typeof KEY_GROUPS;

const DEFAULTS: Record<string, number> = { "transform.positionX": 0, "transform.positionY": 0, "transform.scaleX": 1, "transform.scaleY": 1, "transform.rotate": 0, opacity: 1 };

interface Keyed {
	params: Record<string, unknown>;
	animations?: ElementAnimations;
}

const base = (el: Keyed, path: string) => {
	const v = el.params[path];
	return typeof v === "number" && Number.isFinite(v) ? v : (DEFAULTS[path] ?? 0);
};

/** The value the layer shows at `localTime` (its key curve, else its own value). */
export function valueAt(el: Keyed, path: string, localTime: number): number {
	return Number(resolveAnimationPathValueAtTime({ animations: el.animations, propertyPath: path, localTime, fallbackValue: base(el, path) }));
}

/** ◇ state: the group has keys (`animated`), one sits under the playhead (`active`). */
export function keyState(el: Keyed, group: KeyGroup, localTime: number): { animated: boolean; active: boolean } {
	const paths = KEY_GROUPS[group];
	return {
		animated: paths.some((p) => hasKeyframesForPath({ animations: el.animations, propertyPath: p })),
		active: paths.some((p) => getKeyframeAtTime({ animations: el.animations, propertyPath: p, time: localTime }) !== null),
	};
}

const upsert = (animations: ElementAnimations | undefined, path: string, time: number, value: number) =>
	upsertPathKeyframe({
		animations,
		propertyPath: path,
		time: time as MediaTime,
		value,
		channelLayout: NUMBER_CHANNEL_LAYOUT,
		coerceValue: ({ value: v }) => (typeof v === "number" && Number.isFinite(v) ? v : null),
	});

/**
 * ◇ clicked: a key under the playhead goes (for every channel of the group), else one is added with what the layer
 * shows now. A channel left without keys keeps that value as its own (what you see stays).
 */
export function toggleKeys(el: Keyed, group: KeyGroup, localTime: number): { params: Record<string, unknown>; animations: ElementAnimations | undefined } {
	const paths = KEY_GROUPS[group];
	const params = { ...el.params };
	let animations = el.animations;
	const { active } = keyState(el, group, localTime);
	for (const path of paths) {
		const now = valueAt(el, path, localTime);
		if (active) {
			const key = getKeyframeAtTime({ animations, propertyPath: path, time: localTime });
			if (!key) continue;
			animations = removeElementKeyframe({ animations, propertyPath: path, keyframeId: key.id });
			if (!hasKeyframesForPath({ animations, propertyPath: path })) params[path] = now;
		} else {
			animations = upsert(animations, path, localTime, now);
		}
	}
	return { params, animations };
}

/**
 * A typed or scrubbed value: a keyed channel gets a key at the playhead (After Effects), the rest change the
 * layer's own value. `within`: the playhead is over the layer (outside it, keys are never added).
 */
export function writeValues(el: Keyed, values: Record<string, number>, localTime: number, within: boolean): { params: Record<string, unknown>; animations: ElementAnimations | undefined } {
	const params = { ...el.params };
	let animations = el.animations;
	for (const [path, value] of Object.entries(values)) {
		if (within && hasKeyframesForPath({ animations, propertyPath: path })) animations = upsert(animations, path, localTime, value);
		else params[path] = value;
	}
	return { params, animations };
}
