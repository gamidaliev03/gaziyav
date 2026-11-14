import { cloneAnimations } from "@/animation";
import type { TimelineElement } from "@/timeline";

/**
 * A copy of a clip under a new id with its own keyframe ids (⌥-drag, the magnet's ⌥ insert). With the original's
 * keyframe ids, selecting or dragging a keyframe on one clip also matched the other's.
 */
export function copyElementWithFreshKeyframes(element: TimelineElement, id: string): TimelineElement {
	return {
		...element,
		id,
		animations: cloneAnimations({ animations: element.animations, shouldRegenerateKeyframeIds: true }),
	};
}
