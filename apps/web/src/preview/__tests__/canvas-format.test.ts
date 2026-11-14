import { describe, expect, test } from "bun:test";
import { formatOf, sizeInFormat } from "@/preview/canvas-format";

// The format switch under the preview: the shape changes, the quality (short side) stays.
describe("preview: canvas format", () => {
	test("recognises the common formats at any size", () => {
		expect(formatOf({ width: 1080, height: 1920 })).toBe("9:16");
		expect(formatOf({ width: 608, height: 1080 })).toBe("9:16");
		expect(formatOf({ width: 3840, height: 2160 })).toBe("16:9");
		expect(formatOf({ width: 1080, height: 1080 })).toBe("1:1");
		expect(formatOf({ width: 1080, height: 1350 })).toBe("4:5");
		expect(formatOf({ width: 1000, height: 700 })).toBeNull();
	});

	test("keeps the short side when the format changes", () => {
		expect(sizeInFormat({ width: 1080, height: 1920 }, "16:9")).toEqual({ width: 1920, height: 1080 });
		expect(sizeInFormat({ width: 1920, height: 1080 }, "1:1")).toEqual({ width: 1080, height: 1080 });
		expect(sizeInFormat({ width: 1080, height: 1080 }, "4:5")).toEqual({ width: 1080, height: 1350 });
		expect(sizeInFormat({ width: 720, height: 1280 }, "9:16")).toEqual({ width: 720, height: 1280 });
	});

	test("both sides stay even (the H.264 encoder needs it)", () => {
		const size = sizeInFormat({ width: 608, height: 1080 }, "16:9");
		expect(size.width % 2).toBe(0);
		expect(size.height % 2).toBe(0);
		expect(size).toEqual({ width: 1080, height: 608 });
	});
});
