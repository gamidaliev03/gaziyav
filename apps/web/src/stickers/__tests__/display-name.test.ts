import { describe, expect, test } from "bun:test";
import { displayName } from "../display-name";

// Graphics named after the user's Lottie files («comment», «title») sat next to «Chat Bubble» and «New label».
describe("graphics: names from file names", () => {
	test("lower-case file names read like the built-in names", () => {
		expect(displayName("comment")).toBe("Comment");
		expect(displayName("chat_bubble")).toBe("Chat Bubble");
		expect(displayName("lower-third  2")).toBe("Lower Third 2");
		expect(displayName("подпись")).toBe("Подпись");
	});

	test("a name with capitals is the author's spelling and stays", () => {
		expect(displayName("New label")).toBe("New label");
		expect(displayName("iPhone_frame")).toBe("iPhone frame");
		expect(displayName("CTA")).toBe("CTA");
	});

	test("stray separators and spaces are tidied", () => {
		expect(displayName("  __arrow--up__ ")).toBe("Arrow Up");
	});
});
