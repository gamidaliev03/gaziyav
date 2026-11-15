// Whose shape the project has (canvas/first-clip.ts): the next first clip of an emptied timeline gives its own only
// when the shape was the first clip's, never when it was chosen.
import { describe, expect, test } from "bun:test";
import { canvasIsChosen } from "../first-clip";

const wide = { width: 1920, height: 1080 };
const tall = { width: 1080, height: 1920 };
const square = { width: 1920, height: 1920 };

describe("the project's shape: a choice, or the first clip's", () => {
	test("a new project with no format picked has no shape of its own yet", () => {
		expect(canvasIsChosen({ canvasSize: wide, originalCanvasSize: null })).toBe(false);
		expect(canvasIsChosen(undefined)).toBe(false);
	});

	test("a format picked on the start page stays (the project is born with it)", () => {
		expect(canvasIsChosen({ canvasSize: tall, originalCanvasSize: tall })).toBe(true);
	});

	test("the shape the first clip gave is not a choice: the next first clip gives its own", () => {
		expect(canvasIsChosen({ canvasSize: square, originalCanvasSize: square, canvasFromClip: true })).toBe(false);
	});

	test("a size picked by hand after the first clip stays", () => {
		expect(canvasIsChosen({ canvasSize: tall, originalCanvasSize: square, canvasFromClip: true })).toBe(true);
	});

	test("a project made before the flag keeps its shape, as it did", () => {
		expect(canvasIsChosen({ canvasSize: square, originalCanvasSize: square })).toBe(true);
	});
});
