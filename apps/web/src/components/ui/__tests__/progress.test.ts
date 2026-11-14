import { describe, expect, test } from "bun:test";
import { progressPercent } from "../progress";

// Jobs report progress from many places (export, imports, AI models); the one bar must never draw past its ends.
describe("progress bar: the value it draws", () => {
	test("in range: as given", () => {
		expect(progressPercent(0)).toBe(0);
		expect(progressPercent(42.5)).toBe(42.5);
		expect(progressPercent(100)).toBe(100);
	});

	test("out of range: clamped", () => {
		expect(progressPercent(102)).toBe(100);
		expect(progressPercent(-3)).toBe(0);
	});

	test("missing or broken: empty bar", () => {
		expect(progressPercent(undefined)).toBe(0);
		expect(progressPercent(null)).toBe(0);
		expect(progressPercent(Number.NaN)).toBe(0);
		expect(progressPercent(Number.POSITIVE_INFINITY)).toBe(0);
	});
});
