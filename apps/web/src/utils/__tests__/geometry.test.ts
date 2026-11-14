import { describe, expect, test } from "bun:test";
import { dimensionToAspectRatio } from "../geometry";

describe("dimensionToAspectRatio", () => {
	test("a normal frame is reduced", () => {
		expect(dimensionToAspectRatio({ width: 1920, height: 1080 })).toBe("16:9");
		expect(dimensionToAspectRatio({ width: 1080, height: 1920 })).toBe("9:16");
	});

	test("a broken size cannot hang the gcd or print NaN", () => {
		expect(dimensionToAspectRatio({ width: Number.NaN, height: 1080 })).toBe("1:1");
		expect(dimensionToAspectRatio({ width: 0, height: 1080 })).toBe("1:1");
		expect(dimensionToAspectRatio({ width: Number.POSITIVE_INFINITY, height: 1080 })).toBe("1:1");
	});
});
