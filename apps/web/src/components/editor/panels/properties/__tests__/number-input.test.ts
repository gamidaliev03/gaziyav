import { describe, expect, test } from "bun:test";
import {
	evaluateNumberInput,
	mixedScrubValue,
	normalizeDecimalInput,
	nudgeNumberInput,
	scrubUnitsPerPixel,
} from "@/components/editor/panels/properties/hooks/number-input";

describe("drag speed of a number field", () => {
	test("whole-number values keep one unit per pixel", () => {
		expect(scrubUnitsPerPixel({ min: -100_000, step: 1 })).toBeNull(); // position
		expect(scrubUnitsPerPixel({ min: -360, max: 360, step: 1 })).toBeNull(); // rotation
	});

	test("a bounded fine value crosses its range in about 300 px", () => {
		// Fade in 0–10 s: 20 px used to cross it all
		expect(10 / (scrubUnitsPerPixel({ min: 0, max: 10, step: 0.1 }) ?? 1)).toBeCloseTo(300);
		// Volume −60…20 dB
		expect(80 / (scrubUnitsPerPixel({ min: -60, max: 20, step: 0.01 }) ?? 1)).toBeCloseTo(300);
		// Active word scale 0.5–3: 5 px used to cross it all
		expect(2.5 / (scrubUnitsPerPixel({ min: 0.5, max: 3, step: 0.01 }) ?? 1)).toBeCloseTo(300);
	});

	test("an open fine value moves one step per pixel (line height: 0.1, not 0.5)", () => {
		expect(scrubUnitsPerPixel({ min: 0.1, step: 0.1 })).toBe(0.1);
	});

	test("a Mixed field moves from the first clip's value, not from 0", () => {
		expect(mixedScrubValue({ first: -6, pixels: 10, perPixel: 0.25 })).toBe(-3.5);
		expect(mixedScrubValue({ first: 100, pixels: -5, perPixel: null })).toBe(95);
	});
});

describe("↑/↓ in a number field", () => {
	test("one step, ten with Shift, from what the field shows", () => {
		expect(nudgeNumberInput({ input: "-3,5", direction: 1, step: 0.01, shiftKey: false })).toBe(-3.49);
		expect(nudgeNumberInput({ input: "-3.49", direction: 1, step: 0.01, shiftKey: true })).toBe(-3.39);
		expect(nudgeNumberInput({ input: "100", direction: -1, step: 1, shiftKey: true })).toBe(90);
		expect(nudgeNumberInput({ input: "0.2", direction: 1, step: 0.1, shiftKey: false })).toBe(0.3);
	});

	test("nothing to nudge in a Mixed field", () => {
		expect(nudgeNumberInput({ input: "Mixed", direction: 1, step: 1, shiftKey: false })).toBeNull();
	});
});

// A Russian keyboard types a decimal comma: «-3,5» dB was saved as -3 (parseFloat stops at the comma).
describe("number field text", () => {
	test("a decimal comma reads as a point", () => {
		expect(normalizeDecimalInput("1,5")).toBe("1.5");
		expect(evaluateNumberInput({ input: "-3,5" })).toBe(-3.5);
		expect(evaluateNumberInput({ input: "0,25" })).toBe(0.25);
		expect(evaluateNumberInput({ input: " 12 " })).toBe(12);
	});

	test("an expression gives its result while it is typed, with a comma too", () => {
		expect(evaluateNumberInput({ input: "10+5" })).toBe(15);
		expect(evaluateNumberInput({ input: "1,5*2" })).toBe(3);
		expect(evaluateNumberInput({ input: "-10+4" })).toBe(-6);
		// not finished yet: nothing to preview (it used to preview the 10 before the operator)
		expect(evaluateNumberInput({ input: "10+" })).toBeNull();
	});

	test("text that isn't a number gives nothing", () => {
		expect(evaluateNumberInput({ input: "" })).toBeNull();
		expect(evaluateNumberInput({ input: "Mixed" })).toBeNull();
	});

	test("expressions can be turned off", () => {
		expect(evaluateNumberInput({ input: "10+5", supportsExpressions: false })).toBe(10);
	});
});
