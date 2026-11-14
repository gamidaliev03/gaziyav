import { describe, expect, test } from "bun:test";
import { scrubModifier } from "@/components/editor/panels/properties/hooks/label-scrub";

// Dragging a row's label: Shift moves ten times as far, ⌥ a tenth (as the design spec and Figma/After Effects do).
describe("label drag modifiers", () => {
	test("plain, Shift, ⌥", () => {
		expect(scrubModifier({ shiftKey: false, altKey: false })).toBe(1);
		expect(scrubModifier({ shiftKey: true, altKey: false })).toBe(10);
		expect(scrubModifier({ shiftKey: false, altKey: true })).toBe(0.1);
	});
});
