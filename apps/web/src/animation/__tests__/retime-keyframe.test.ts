import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { ElementAnimations } from "@/animation/types";
import type { MediaTime } from "@/wasm";

// A keyframe dragged onto another keyframe's frame made two keys on one frame: the inspector showed one value
// and the ◆ removed only one of them, so the other "came back".
let animation: typeof import("@/animation");
let params: typeof import("@/params");

beforeAll(async () => {
	await installOpenCutWasm();
	animation = await import("@/animation");
	params = await import("@/params");
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

const t = (seconds: number) => Math.round(seconds * 120_000) as MediaTime;

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

function keysOf(animations: ElementAnimations | undefined) {
	const data = animations?.opacity as { keys: Array<{ id: string; time: number; value: number }> } | undefined;
	return data?.keys ?? [];
}

const pairs = (animations: ElementAnimations | undefined) =>
	keysOf(animations).map((k) => [k.time / 120_000, k.value]);

describe("moving a keyframe", () => {
	test("onto another key's time replaces that key", () => {
		const animations = opacityKeys([[1, 1], [3, 0.5], [5, 0.2]]);
		const moved = keysOf(animations).find((k) => k.time === t(3));
		const next = animation.retimeElementKeyframe({
			animations,
			propertyPath: "opacity",
			keyframeId: moved?.id ?? "",
			time: t(1),
		});
		expect(pairs(next)).toEqual([[1, 0.5], [5, 0.2]]);
	});

	test("to a free time keeps every key", () => {
		const animations = opacityKeys([[1, 1], [3, 0.5]]);
		const moved = keysOf(animations).find((k) => k.time === t(3));
		const next = animation.retimeElementKeyframe({
			animations,
			propertyPath: "opacity",
			keyframeId: moved?.id ?? "",
			time: t(2),
		});
		expect(pairs(next)).toEqual([[1, 1], [2, 0.5]]);
	});

	test("two selected keys dragged right by their gap both survive (leading key first)", () => {
		let animations = opacityKeys([[1, 1], [3, 0.5]]);
		// the order the timeline drag uses for a positive delta: later keys first
		const selected = [...keysOf(animations)].sort((a, b) => b.time - a.time);
		for (const key of selected) {
			animations = animation.retimeElementKeyframe({
				animations,
				propertyPath: "opacity",
				keyframeId: key.id,
				time: (key.time + t(2)) as MediaTime,
			});
		}
		expect(pairs(animations)).toEqual([[3, 1], [5, 0.5]]);
	});
});
