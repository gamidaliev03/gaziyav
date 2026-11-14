import { describe, expect, test } from "bun:test";
import { stepControl } from "../header-keys";

// The header was out of reach from the keyboard: Tab jumps between panels, and ←/→ stepped frames instead.
describe("header: arrow keys move between its buttons", () => {
	const items = ["projects", "menu", "undo", "redo", "agent", "export"];

	test("→ and ← move to the neighbour", () => {
		expect(stepControl(items, "menu", 1)).toBe("undo");
		expect(stepControl(items, "agent", -1)).toBe("redo");
	});

	test("the ends wrap around", () => {
		expect(stepControl(items, "export", 1)).toBe("projects");
		expect(stepControl(items, "projects", -1)).toBe("export");
	});

	test("from the header itself (no button focused): → the first, ← the last", () => {
		expect(stepControl(items, null, 1)).toBe("projects");
		expect(stepControl(items, "elsewhere", -1)).toBe("export");
	});

	test("nothing to focus: no move", () => {
		expect(stepControl([], null, 1)).toBeNull();
	});
});
