// A pure split of one element at a timeline time: the same arithmetic as the timeline's split (SplitElementsCommand:
// trims, speed ramps, keyframes, beat marks, the fade of the cut side), without the live editor, so the scene engine
// can cut plain track data and be tested on it.
import { splitAnimationsAtTime } from "@/animation";
import { getSourceSpanAtClipTime, splitRetimeAtClipTime } from "@/retime";
import { splitBeats } from "@/timeline/beats";
import { isRetimableElement } from "@/timeline/element-utils";
import type { TimelineElement } from "@/timeline/types";
import type { MediaTime } from "@/wasm";

const ticks = (n: number) => Math.round(n) as MediaTime;

/** The params of a half without the fade / animation of the side the cut made (the split's own rule). */
function withoutEdge(element: TimelineElement, side: "in" | "out"): { params?: TimelineElement["params"] } {
	const params = (element.params ?? null) as Record<string, unknown> | null;
	if (!params) return {};
	const fadeKey = side === "in" ? "fadeIn" : "fadeOut";
	const animKey = side === "in" ? "anim.in" : "anim.out";
	const fade = typeof params[fadeKey] === "number" && (params[fadeKey] as number) > 0;
	const anim = typeof params[animKey] === "string" && params[animKey] !== "none";
	if (!fade && !anim) return {};
	return { params: { ...params, ...(fade ? { [fadeKey]: 0 } : {}), ...(anim ? { [animKey]: "none" } : {}) } as TimelineElement["params"] };
}

/** [left, right] halves of `element` cut at timeline time `at` (strictly inside it); the right half gets `rightId`. */
export function splitElementAt<T extends TimelineElement>(element: T, at: number, rightId: string): [T, T] {
	const relative = at - element.startTime;
	const retime = isRetimableElement(element) ? element.retime : undefined;
	const leftSpan = Math.round(getSourceSpanAtClipTime({ clipTime: relative, retime, duration: element.duration }));
	const totalSpan = Math.round(getSourceSpanAtClipTime({ clipTime: element.duration, retime, duration: element.duration }));
	const splitRetime = splitRetimeAtClipTime({ retime, splitClipTime: ticks(relative), duration: element.duration });
	const { leftAnimations, rightAnimations } = splitAnimationsAtTime({
		animations: element.animations,
		splitTime: ticks(relative),
		shouldIncludeSplitBoundary: true,
	});
	const beats = splitBeats({ beats: element.beats, at: relative, duration: element.duration });
	const left = {
		...element,
		duration: ticks(relative),
		trimEnd: ticks(element.trimEnd + (totalSpan - leftSpan)),
		animations: leftAnimations,
		beats: beats.left,
		...(retime !== undefined ? { retime: splitRetime.left } : {}),
		...withoutEdge(element, "out"),
	} as T;
	const right = {
		...element,
		id: rightId,
		startTime: ticks(at),
		duration: ticks(element.duration - relative),
		trimStart: ticks(element.trimStart + leftSpan),
		animations: rightAnimations,
		beats: beats.right,
		...(retime !== undefined ? { retime: splitRetime.right } : {}),
		...withoutEdge(element, "in"),
	} as T;
	return [left, right];
}
