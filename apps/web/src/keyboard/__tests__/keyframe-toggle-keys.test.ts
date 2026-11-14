import { describe, expect, test } from "bun:test";
import { spacePressesFocused, tabStaysInList } from "@/keyboard/navigation";

// The ◆ beside a parameter could not be reached from the keyboard: it had tabIndex -1 and Tab jumped to the next
// panel. Now Tab walks the inspector's controls, and Space presses a ◆ reached with Tab (not one clicked with the
// mouse: there Space keeps playing the timeline).
const element = (matching: string[]) => ({ matches: (selector: string) => matching.includes(selector) });

describe("Space on a ◆", () => {
	test("reached with Tab: Space presses it", () => {
		expect(spacePressesFocused({ element: element(["[data-keyframe-toggle]"]), reachedWithTab: true })).toBe(true);
	});

	test("clicked with the mouse: Space plays the timeline", () => {
		expect(spacePressesFocused({ element: element(["[data-keyframe-toggle]"]), reachedWithTab: false })).toBe(false);
	});

	test("any other focused button keeps Space = play", () => {
		expect(spacePressesFocused({ element: element(["button"]), reachedWithTab: true })).toBe(false);
		expect(spacePressesFocused({ element: null, reachedWithTab: true })).toBe(false);
	});
});

describe("Tab in the inspector", () => {
	test("walks the controls and leaves the panel only from the last (⇧Tab: the first)", () => {
		expect(tabStaysInList({ index: 0, count: 3, backwards: false })).toBe(true);
		expect(tabStaysInList({ index: 2, count: 3, backwards: false })).toBe(false);
		expect(tabStaysInList({ index: 0, count: 3, backwards: true })).toBe(false);
		expect(tabStaysInList({ index: 2, count: 3, backwards: true })).toBe(true);
		expect(tabStaysInList({ index: -1, count: 3, backwards: false })).toBe(false);
	});
});

describe("keys while a control has the focus", () => {
	test("a focused list (Blend, Format…) keeps ↑/↓: they open it instead of jumping between cuts", async () => {
		const { OWN_ARROW_ROLES } = await import("@/actions/keybinding-scope");
		expect(OWN_ARROW_ROLES.has("combobox")).toBe(true);
	});

	test("⌘S, ⌘E, ⌘/ work from a text field; editing keys stay the field's", async () => {
		const { FIELD_SAFE_ACTIONS } = await import("@/actions/keybinding-scope");
		for (const action of ["save-project", "export-project", "show-shortcuts"] as const) expect(FIELD_SAFE_ACTIONS.has(action)).toBe(true);
		for (const action of ["undo", "select-all", "copy-selected", "paste-copied", "delete-selected", "toggle-play"] as const) {
			expect(FIELD_SAFE_ACTIONS.has(action)).toBe(false);
		}
	});
});
