import { describe, expect, test } from "bun:test";
import { joinColor, splitColor } from "../color-value";

// An AI plate's colour reads as a colour and its opacity (never «rgba(…)»), and a pick keeps the plate see-through.
describe("an AI layer's colour field", () => {
	test("hex, short hex, hex with alpha, rgb() and rgba() all read", () => {
		expect(splitColor("#FFF")).toEqual({ hex: "#ffffff", alpha: 1 });
		expect(splitColor("#0a141e")).toEqual({ hex: "#0a141e", alpha: 1 });
		expect(splitColor("#0a141e80")?.hex).toBe("#0a141e");
		expect(Math.round((splitColor("#0a141e80")?.alpha ?? 0) * 100)).toBe(50);
		expect(splitColor("rgb(10, 20, 30)")).toEqual({ hex: "#0a141e", alpha: 1 });
		expect(splitColor("rgba(10,20,30,0.6)")).toEqual({ hex: "#0a141e", alpha: 0.6 });
		expect(splitColor("rgba(10 20 30 / 40%)")).toEqual({ hex: "#0a141e", alpha: 0.4 });
		expect(splitColor("linear-gradient(red, blue)")).toBeNull();
	});
	test("a pick keeps the opacity the colour had; an opaque one stays hex", () => {
		expect(joinColor("#ff0000", 0.6)).toBe("rgba(255, 0, 0, 0.6)");
		expect(joinColor("#ff0000", 1)).toBe("#ff0000");
	});
});
