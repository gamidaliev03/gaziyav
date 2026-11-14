import { describe, expect, test } from "bun:test";
import { accumulateAngleDelta, unwrapAngleDelta } from "../rotation-angle";

describe("rotation drag angles", () => {
	test("a step across the ±180° line is the short way round", () => {
		expect(unwrapAngleDelta({ from: 170, to: -170 })).toBe(20);
		expect(unwrapAngleDelta({ from: -170, to: 170 })).toBe(-20);
		expect(unwrapAngleDelta({ from: 350, to: 10 })).toBe(20);
		expect(unwrapAngleDelta({ from: 10, to: 350 })).toBe(-20);
	});

	test("several turns add up instead of wrapping at 180°", () => {
		let state = { lastAngle: 10, accumulatedAngle: 0 };
		for (const angle of [90, 180, 270, 350, 10]) {
			state = accumulateAngleDelta({ ...state, currentAngle: angle });
		}
		// 10° → 370°: a full clockwise turn, not back to 0°.
		expect(state.accumulatedAngle).toBeCloseTo(360, 9);
	});

	test("bad pointer angles do not poison the total", () => {
		expect(unwrapAngleDelta({ from: Number.NaN, to: 10 })).toBe(0);
		expect(accumulateAngleDelta({ lastAngle: 0, accumulatedAngle: 45, currentAngle: Number.POSITIVE_INFINITY })).toEqual({
			lastAngle: 0,
			accumulatedAngle: 45,
		});
	});
});
