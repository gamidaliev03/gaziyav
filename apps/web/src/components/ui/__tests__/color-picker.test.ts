import { describe, expect, test } from "bun:test";
import { isSameColor, resolveTypedColor } from "../color-picker";

// H2-14 / H2-15: a typed hex committed twice (Enter + the blur after it) or committed an unchanged colour
// (empty undo steps), and an unreadable hex ("zzzz") stayed in the field.
describe("colour picker: typed colours", () => {
	test("spellings of one colour are the same colour", () => {
		expect(isSameColor({ a: "FFFFFF", b: "#ffffff" })).toBe(true);
		expect(isSameColor({ a: "fff", b: "FFFFFF" })).toBe(true);
		expect(isSameColor({ a: "FFFFFFFF", b: "ffffff" })).toBe(true);
		expect(isSameColor({ a: "ff000080", b: "FF0000" })).toBe(false);
		expect(isSameColor({ a: "00FF00", b: "00ff01" })).toBe(false);
	});

	test("a new colour is applied (keeping the current opacity)", () => {
		expect(resolveTypedColor({ input: "FF0000", format: "hex", current: "FFFFFF", alpha: 1 })).toBe("FF0000");
		expect(resolveTypedColor({ input: "#00ff00", format: "hex", current: "FFFFFF", alpha: 1 })).toBe("00ff00");
		expect(resolveTypedColor({ input: "000000", format: "hex", current: "FFFFFF80", alpha: 0.5 })).toBe("00000080");
	});

	test("the current colour, typed again, commits nothing", () => {
		expect(resolveTypedColor({ input: "ffffff", format: "hex", current: "FFFFFF", alpha: 1 })).toBeNull();
		expect(resolveTypedColor({ input: "FFF", format: "hex", current: "FFFFFF", alpha: 1 })).toBeNull();
	});

	test("an unreadable value commits nothing", () => {
		expect(resolveTypedColor({ input: "zzzz", format: "hex", current: "FF0000", alpha: 1 })).toBeNull();
		expect(resolveTypedColor({ input: "", format: "hex", current: "FF0000", alpha: 1 })).toBeNull();
	});

	test("other formats and CSS text still work", () => {
		expect(resolveTypedColor({ input: "0, 0, 255", format: "rgb", current: "FFFFFF", alpha: 1 })).toBe("0000ff");
		expect(resolveTypedColor({ input: "color: #123456;", format: "hex", current: "FFFFFF", alpha: 1 })).toBe("123456");
	});
});
