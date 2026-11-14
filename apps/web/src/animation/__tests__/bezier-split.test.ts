import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// Dropping the playhead inside a bezier segment (⌘B, a left trim, a speed change) cuts the curve with
// de Casteljau. The left half used to keep the original left key AND its shortened copy, so two keys shared
// one id and one time, and the curve from that key to the cut was flattened by the copy's clamped handle.

type ScalarAnimationChannel = import("@/animation/types").ScalarAnimationChannel;

let splitAnimationsAtTime: typeof import("@/animation").splitAnimationsAtTime;
let getChannelValueAtTime: typeof import("@/animation/interpolation").getChannelValueAtTime;

beforeAll(async () => {
	await installOpenCutWasm();
	({ splitAnimationsAtTime } = await import("@/animation"));
	({ getChannelValueAtTime } = await import("@/animation/interpolation"));
});

const T = 120_000;
const t = (seconds: number) => Math.round(seconds * T) as import("@/wasm").MediaTime;

function curve(): ScalarAnimationChannel {
	return {
		extrapolation: { before: "hold", after: "hold" },
		keys: [
			{ id: "a", time: t(0), value: 0, segmentToNext: "bezier", rightHandle: { dt: t(0.3), dv: 0 } },
			{ id: "b", time: t(1), value: 100, segmentToNext: "linear", leftHandle: { dt: -t(0.3), dv: 0 } },
		],
	} as ScalarAnimationChannel;
}

describe("a bezier keyframe segment cut in two", () => {
	test("the left half has one key per time and keeps the curve before the cut", () => {
		const channel = curve();
		const { leftAnimations } = splitAnimationsAtTime({
			animations: { opacity: channel },
			splitTime: t(0.6),
			shouldIncludeSplitBoundary: true,
		});
		const keys = (leftAnimations as { opacity: ScalarAnimationChannel }).opacity.keys;
		expect(new Set(keys.map((key) => key.id)).size).toBe(keys.length);
		expect(keys.filter((key) => key.time === t(0.6))).toHaveLength(1);
		for (const seconds of [0.1, 0.3, 0.45, 0.55, 0.599]) {
			const before = getChannelValueAtTime({ channel, time: t(seconds), fallbackValue: 0 });
			const after = getChannelValueAtTime({
				channel: (leftAnimations as { opacity: ScalarAnimationChannel }).opacity,
				time: t(seconds),
				fallbackValue: 0,
			});
			// Hands are rounded to whole ticks when the segment is cut: the curve stays within 1e-4 of the original.
			expect(after).toBeCloseTo(before, 3);
		}
	});

	test("the right half starts on the cut's value and keeps the rest of the curve", () => {
		const channel = curve();
		const { rightAnimations } = splitAnimationsAtTime({
			animations: { opacity: channel },
			splitTime: t(0.6),
			shouldIncludeSplitBoundary: true,
		});
		const right = (rightAnimations as { opacity: ScalarAnimationChannel }).opacity;
		expect(Number(right.keys[0].time)).toBe(0);
		expect(getChannelValueAtTime({ channel: right, time: 0 as import("@/wasm").MediaTime, fallbackValue: 0 })).toBe(
			getChannelValueAtTime({ channel, time: t(0.6), fallbackValue: 0 }),
		);
		expect(getChannelValueAtTime({ channel: right, time: t(0.4), fallbackValue: 0 })).toBeCloseTo(
			getChannelValueAtTime({ channel, time: t(1), fallbackValue: 0 }),
			4,
		);
	});
});
