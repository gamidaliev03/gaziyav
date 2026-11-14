import { describe, expect, test } from "bun:test";
import { constantRetimeFrom, isSpeedChange, parseSpeedInput } from "@/speed/speed-input";

// Speed field: 0.001, 0 or -2 gave 1× instead of the slowest speed; every visit to the field (and a speed
// ramp's average typed back) added an undo step.
describe("a typed speed", () => {
	test("below the slowest speed is the slowest speed, not 1×", () => {
		expect(parseSpeedInput({ input: "0.001" })).toBe(0.1);
		expect(parseSpeedInput({ input: "0.05" })).toBe(0.1);
		expect(parseSpeedInput({ input: "0" })).toBe(0.1);
		expect(parseSpeedInput({ input: "-2" })).toBe(0.1);
	});

	test("in range is kept, above the fastest is the fastest, text is nothing", () => {
		expect(parseSpeedInput({ input: "2" })).toBe(2);
		expect(parseSpeedInput({ input: "0.5" })).toBe(0.5);
		expect(parseSpeedInput({ input: "50" })).toBe(10);
		expect(parseSpeedInput({ input: "fast" })).toBeNull();
	});
});

describe("committing the Speed field", () => {
	test("the same speed is no change (no undo step)", () => {
		expect(isSpeedChange({ committed: undefined, rate: 1, maintainPitch: false })).toBe(false);
		expect(isSpeedChange({ committed: { rate: 2 }, rate: 2, maintainPitch: false })).toBe(false);
	});

	test("a speed ramp shown by its average stays a ramp when only visited", () => {
		expect(
			isSpeedChange({ committed: { rate: 1.2345, mode: "curve" }, rate: 1.2345, maintainPitch: false }),
		).toBe(false);
	});

	test("a new speed or a pitch change is a change", () => {
		expect(isSpeedChange({ committed: undefined, rate: 2, maintainPitch: false })).toBe(true);
		expect(isSpeedChange({ committed: { rate: 2 }, rate: 2, maintainPitch: true })).toBe(true);
	});
});

// keys9: a clip at 2×, «1» typed in Speed and Enter — the preview showed 1×, the clip stayed 2×.
describe("a typed constant speed over the saved retime", () => {
	test("1× over 2× is 1×", () => {
		expect(constantRetimeFrom({ committed: { rate: 2, maintainPitch: false }, rate: 1, maintainPitch: false })).toBeUndefined();
	});
	test("1× keeps other settings, with rate 1", () => {
		const committed = { rate: 2, maintainPitch: true, opticalFlow: true } as unknown as Parameters<typeof constantRetimeFrom>[0]["committed"];
		expect(constantRetimeFrom({ committed, rate: 1, maintainPitch: false })).toEqual({ opticalFlow: true, rate: 1, maintainPitch: false } as never);
	});
	test("a curve becomes a constant speed", () => {
		const committed = { rate: 1.5, mode: "curve", curve: { preset: "hero" } } as unknown as Parameters<typeof constantRetimeFrom>[0]["committed"];
		expect(constantRetimeFrom({ committed, rate: 0.5, maintainPitch: false })).toEqual({ rate: 0.5, maintainPitch: false });
	});
});
