import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { ElementAnimations } from "@/animation/types";
import type { SceneTracks, TimelineElement, VideoElement } from "@/timeline";
import type { MediaTime } from "@/wasm";

// Keyframes sit on a frame of the picture. A speed change cut off the second half of the animation for good
// (2×: the keys past the new end were clamped away) and a left trim slid every key off its frame by the
// trimmed amount (keys are timed from the clip's start, the trim start was not taken into account).
let animation: typeof import("@/animation");
let params: typeof import("@/params");
let pipeline: typeof import("@/timeline/update-pipeline");
let edits: typeof import("@/actions/timeline-edits");

beforeAll(async () => {
	await installOpenCutWasm();
	animation = await import("@/animation");
	params = await import("@/params");
	pipeline = await import("@/timeline/update-pipeline");
	edits = await import("@/actions/timeline-edits");
});

const OPACITY = {
	key: "opacity",
	label: "Opacity",
	type: "number",
	default: 1,
	min: 0,
	max: 1,
	step: 0.01,
} as const;

const TPS = 120_000;
const t = (seconds: number) => Math.round(seconds * TPS) as MediaTime;

function opacityKeys(values: Array<[number, number]>): ElementAnimations | undefined {
	let animations: ElementAnimations | undefined;
	for (const [seconds, value] of values) {
		animations = animation.upsertPathKeyframe({
			animations,
			propertyPath: "opacity",
			time: t(seconds),
			value,
			channelLayout: params.getParamChannelLayout({ param: OPACITY }),
			coerceValue: ({ value: v }) => v,
		});
	}
	return animations;
}

type Key = { id: string; time: number; value: number; rightHandle?: { dt: number; dv: number } };
const keysOf = (animations: ElementAnimations | undefined) =>
	((animations?.opacity as { keys: Key[] } | undefined)?.keys ?? []);
const pairs = (animations: ElementAnimations | undefined) =>
	keysOf(animations).map((k) => [Math.round((k.time / TPS) * 1000) / 1000, Math.round(k.value * 1000) / 1000]);
const valueAt = (animations: ElementAnimations | undefined, seconds: number) =>
	animation.resolveAnimationPathValueAtTime({
		animations,
		propertyPath: "opacity",
		localTime: t(seconds),
		fallbackValue: 1,
	});

function video(overrides: Partial<VideoElement>): VideoElement {
	return {
		id: "v",
		type: "video",
		name: "Video",
		startTime: t(0),
		duration: t(10),
		trimStart: t(0),
		trimEnd: t(0),
		sourceDuration: t(10),
		mediaId: "m",
		params: { opacity: 1 },
		...overrides,
	} as VideoElement;
}

function update(element: TimelineElement, patch: Partial<TimelineElement>): TimelineElement {
	const tracks = {
		overlay: [{ id: "o", name: "Video", type: "video", elements: [element], muted: false, hidden: false }],
		main: { id: "main", name: "Main", type: "video", elements: [], muted: false, hidden: false },
		audio: [],
	} as unknown as SceneTracks;
	return pipeline.applyElementUpdate({ element, patch, context: { tracks, trackId: "o" } });
}

describe("speed change", () => {
	test("2×: the whole animation plays in the shorter clip, nothing is cut off", () => {
		const element = video({ animations: opacityKeys([[0, 0], [8, 1]]) });
		const next = update(element, { retime: { rate: 2 } } as Partial<TimelineElement>);
		expect(next.duration).toBe(t(5));
		expect(pairs(next.animations)).toEqual([[0, 0], [4, 1]]);
	});

	test("0.5×: the animation stretches over the longer clip", () => {
		const element = video({ animations: opacityKeys([[2, 0], [6, 1]]) });
		const next = update(element, { retime: { rate: 0.5 } } as Partial<TimelineElement>);
		expect(next.duration).toBe(t(20));
		expect(pairs(next.animations)).toEqual([[4, 0], [12, 1]]);
	});

	test("a key on the last frame stays on the last frame (rounding adds no extra key)", () => {
		const element = video({ duration: t(10), animations: opacityKeys([[0, 0], [10, 1]]) });
		const next = update(element, { retime: { rate: 3 } } as Partial<TimelineElement>);
		expect(keysOf(next.animations).map((k) => k.time)).toEqual([0, next.duration]);
		expect(keysOf(next.animations).map((k) => k.id)).toEqual(keysOf(element.animations).map((k) => k.id));
	});

	test("bezier handles stretch with the keys: the ease keeps its shape", () => {
		const keyed = opacityKeys([[0, 0], [8, 1]]);
		const first = keysOf(keyed)[0];
		const animations = animation.updateScalarKeyframeCurve({
			animations: keyed,
			propertyPath: "opacity",
			componentKey: "value",
			keyframeId: first.id,
			patch: { segmentToNext: "bezier", rightHandle: { dt: t(4), dv: 0 } },
		});
		const element = video({ animations });
		const before = valueAt(animations, 2);
		const next = update(element, { retime: { rate: 2 } } as Partial<TimelineElement>);
		expect(keysOf(next.animations)[0].rightHandle?.dt).toBe(t(2));
		expect(valueAt(next.animations, 1)).toBeCloseTo(before, 6);
	});
});

describe("left trim", () => {
	test("trimming the start in keeps every key on its frame; the value at the new first frame is kept", () => {
		const animations = opacityKeys([[2, 0], [6, 1]]);
		const element = video({ animations });
		const next = update(element, { trimStart: t(3), startTime: t(3), duration: t(7) });
		expect(pairs(next.animations)).toEqual([[0, 0.25], [3, 1]]);
		// Timeline time 4 s showed opacity 0.5 before the trim and still does.
		expect(valueAt(next.animations, 1)).toBeCloseTo(valueAt(animations, 4), 6);
	});

	test("pulling the start back out moves the keys later by the same amount", () => {
		const element = video({ trimStart: t(3), startTime: t(3), duration: t(7), animations: opacityKeys([[1, 0], [5, 1]]) });
		const next = update(element, { trimStart: t(1), startTime: t(1), duration: t(9) });
		expect(pairs(next.animations)).toEqual([[3, 0], [7, 1]]);
	});

	test("trimming past every key keeps the last value as one key at the start", () => {
		const element = video({ animations: opacityKeys([[1, 0], [2, 0.6]]) });
		const next = update(element, { trimStart: t(5), startTime: t(5), duration: t(5) });
		expect(pairs(next.animations)).toEqual([[0, 0.6]]);
	});

	test("a slowed clip: the trim is converted to clip time (2 s of source = 4 s of clip at 0.5×)", () => {
		const element = video({
			duration: t(20),
			retime: { rate: 0.5 },
			animations: opacityKeys([[4, 0], [12, 1]]),
		} as Partial<VideoElement>);
		const next = update(element, { trimStart: t(2), startTime: t(4), duration: t(16) });
		expect(pairs(next.animations)).toEqual([[0, 0], [8, 1]]);
	});

	test("the right edge and moves leave the keys alone", () => {
		const animations = opacityKeys([[2, 0], [6, 1]]);
		const element = video({ animations });
		expect(update(element, { trimEnd: t(1), duration: t(9) }).animations).toEqual(animations);
		expect(update(element, { startTime: t(4) }).animations).toBe(animations);
		expect(update(element, { trimStart: t(0), startTime: t(0) }).animations).toBe(animations);
	});

	test("a patch that brings its own keys (split, paste) is not moved again", () => {
		const own = opacityKeys([[0, 0.3]]);
		const element = video({ animations: opacityKeys([[2, 0], [6, 1]]) });
		const next = update(element, { trimStart: t(3), startTime: t(3), duration: t(7), animations: own });
		expect(next.animations).toEqual(own);
	});
});

describe("keys survive the other edits", () => {
	test("split (⌘B): each half keeps its part, the picture at every frame is unchanged", () => {
		const animations = opacityKeys([[2, 0], [6, 1]]);
		const { leftAnimations, rightAnimations } = animation.splitAnimationsAtTime({
			animations,
			splitTime: t(4),
		});
		expect(pairs(leftAnimations)).toEqual([[2, 0], [4, 0.5]]);
		expect(pairs(rightAnimations)).toEqual([[0, 0.5], [2, 1]]);
		for (const seconds of [0, 1, 2.5, 3.9]) expect(valueAt(leftAnimations, seconds)).toBeCloseTo(valueAt(animations, seconds), 6);
		for (const seconds of [0.1, 1, 2, 5]) expect(valueAt(rightAnimations, seconds)).toBeCloseTo(valueAt(animations, seconds + 4), 6);
	});

	test("split after the last key: the right half holds the end value (it jumped back to the clip's base value)", () => {
		const animations = opacityKeys([[1, 0], [2, 0.6]]);
		const { leftAnimations, rightAnimations } = animation.splitAnimationsAtTime({ animations, splitTime: t(5) });
		expect(pairs(leftAnimations)).toEqual([[1, 0], [2, 0.6]]);
		expect(pairs(rightAnimations)).toEqual([[0, 0.6]]);
		expect(valueAt(rightAnimations, 3)).toBeCloseTo(0.6, 6);
	});

	test("split before the first key: the left half holds the first value", () => {
		const animations = opacityKeys([[4, 0.2], [6, 1]]);
		const { leftAnimations, rightAnimations } = animation.splitAnimationsAtTime({ animations, splitTime: t(2) });
		expect(pairs(leftAnimations)).toEqual([[2, 0.2]]);
		expect(pairs(rightAnimations)).toEqual([[2, 0.2], [4, 1]]);
		expect(valueAt(leftAnimations, 1)).toBeCloseTo(0.2, 6);
	});

	test("⌥-drag copy carries the keys with it", () => {
		const animations = opacityKeys([[2, 0], [6, 1]]);
		const original = video({ id: "a", animations });
		const tracks = (elements: TimelineElement[]) =>
			({
				overlay: [],
				main: { id: "main", name: "Main", type: "video", elements, muted: false, hidden: false },
				audio: [],
			}) as unknown as SceneTracks;
		const { tracks: after, copies } = edits.placeDragCopies({
			before: tracks([original]),
			moved: tracks([{ ...original, startTime: t(30) }]),
			moves: [{ elementId: "a", sourceTrackId: "main", targetTrackId: "main" }],
			newId: () => "copy",
			magnetTrackId: null,
		});
		const copy = after.main.elements.find((e) => e.id === copies[0]?.elementId);
		expect(pairs(copy?.animations)).toEqual(pairs(animations));
	});
});
