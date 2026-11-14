import { describe, expect, test } from "bun:test";
import { cleanupMarks } from "../cleanup";

// What reaches the CleanUp engine from the window: clicks clamped to the frame, at most 16, 0/1 labels; nothing to
// remove (no click on the object, no brush) is refused before any work starts.
describe("CleanUp marks", () => {
	test("clicks are clamped, labelled 0/1 and capped", () => {
		const many = Array.from({ length: 30 }, (_, i) => [i / 30, 1.4, 1]);
		const { points } = cleanupMarks({ points: [[-0.2, 0.5, 1], [0.3, 0.3, 0], ["x", 1, 1], ...many] });
		expect(points[0]).toEqual([0, 0.5, 1]);
		expect(points[1]).toEqual([0.3, 0.3, 0]);
		expect(points).toHaveLength(16);
		expect(points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
	});

	test("only 'keep' clicks, or nothing at all: refused with a clear message", () => {
		expect(() => cleanupMarks({ points: [[0.5, 0.5, 0]] })).toThrow("Click the object or paint over it first.");
		expect(() => cleanupMarks({})).toThrow("Click the object or paint over it first.");
	});
});
