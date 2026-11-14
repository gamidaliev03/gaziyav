import { describe, expect, test } from "bun:test";
import { FIELD_SAFE_ACTIONS } from "@/actions/keybinding-scope";
import { getPresetBindings, KEYMAP_PRESET_IDS } from "@/actions/keybindings/presets";

describe("goto-timecode (G)", () => {
	test("G is the Go to Timecode key in every preset, and no other action has it", () => {
		expect(KEYMAP_PRESET_IDS.length).toBeGreaterThan(0);
		for (const preset of KEYMAP_PRESET_IDS) {
			const keys = getPresetBindings({ preset });
			expect(keys.get("g")).toBe("goto-timecode");
			expect([...keys.entries()].filter(([, action]) => action === "goto-timecode").map(([k]) => k)).toEqual(["g"]);
		}
	});
	test("inside a text field the key does nothing (the letter is typed)", () => {
		expect(FIELD_SAFE_ACTIONS.has("goto-timecode" as never)).toBe(false);
	});
});
