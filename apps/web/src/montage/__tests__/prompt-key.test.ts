// The composition prompt's keys: Return asks Gaziyav AI, Shift+Return is a new line, an IME's Return picks a word.
import { describe, expect, test } from "bun:test";
import { sendsPrompt } from "../prompt-key";

describe("composition prompt keys", () => {
	test("Return sends (the tester's Return did nothing, only the button worked)", () => {
		expect(sendsPrompt({ key: "Enter" })).toBe(true);
		expect(sendsPrompt({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 })).toBe(true);
	});
	test("Shift+Return and Option+Return are a new line, other keys type", () => {
		expect(sendsPrompt({ key: "Enter", shiftKey: true })).toBe(false);
		expect(sendsPrompt({ key: "Enter", altKey: true })).toBe(false);
		expect(sendsPrompt({ key: "a" })).toBe(false);
	});
	test("the Return that ends an IME composition never sends (Chrome marks it, Safari gives keyCode 229)", () => {
		expect(sendsPrompt({ key: "Enter", isComposing: true })).toBe(false);
		expect(sendsPrompt({ key: "Enter", keyCode: 229 })).toBe(false);
	});
});
