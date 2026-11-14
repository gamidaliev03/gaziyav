import { describe, expect, test } from "bun:test";
import { stepSegment } from "../segmented";

const items = [
	{ value: "sfx", label: "Sounds" },
	{ value: "music", label: "Music" },
	{ value: "mine", label: "Saved" },
	{ value: "web", label: "Online" },
] as const;

// ←/→ in a segmented switch (panel sections, export format) move like macOS segmented controls.
describe("segmented: arrow keys", () => {
	test("→ and ← move to the neighbour", () => {
		expect(stepSegment(items, "sfx", 1)).toBe("music");
		expect(stepSegment(items, "mine", -1)).toBe("music");
	});

	test("the ends wrap around", () => {
		expect(stepSegment(items, "web", 1)).toBe("sfx");
		expect(stepSegment(items, "sfx", -1)).toBe("web");
	});

	test("disabled segments are skipped", () => {
		const withDisabled = [items[0], { ...items[1], disabled: true }, items[2], items[3]];
		expect(stepSegment(withDisabled, "sfx", 1)).toBe("mine");
		expect(stepSegment(withDisabled, "mine", -1)).toBe("sfx");
	});

	test("nothing else to choose: no change", () => {
		expect(stepSegment([items[0]], "sfx", 1)).toBeNull();
		expect(stepSegment([{ ...items[0], disabled: true }], "sfx", 1)).toBeNull();
	});

	test("from a value that is not a segment: → the first, ← the last", () => {
		expect(stepSegment<string>(items, "gone", 1)).toBe("sfx");
		expect(stepSegment<string>(items, "gone", -1)).toBe("web");
	});
});
