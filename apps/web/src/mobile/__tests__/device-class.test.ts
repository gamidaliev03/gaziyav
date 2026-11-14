// The layout switch (mobile, 14.11). NOT RUN YET: written before the release, run after it.
import { describe, expect, test } from "bun:test";
import { classify, readChoice } from "../device-class";
import { PHONE_TOOLS } from "../shell/tools";
import { phoneBudget } from "../memory-tier";

const sig = (coarse: boolean, a: number, b: number) => ({ coarse, anyHover: !coarse, shortSide: Math.min(a, b), longSide: Math.max(a, b) });

describe("phone / tablet / desktop from the pointer and the short side", () => {
	test("iPhone portrait and landscape: phone both ways (turning never swaps the editor)", () => {
		expect(classify(sig(true, 393, 852))).toBe("phone");
		expect(classify(sig(true, 852, 393))).toBe("phone");
	});
	test("iPhone Pro Max, a big Android: phone", () => {
		expect(classify(sig(true, 440, 956))).toBe("phone");
		expect(classify(sig(true, 412, 915))).toBe("phone");
	});
	test("iPad mini, iPad, iPad Pro 13: tablet", () => {
		expect(classify(sig(true, 744, 1133))).toBe("tablet");
		expect(classify(sig(true, 820, 1180))).toBe("tablet");
		expect(classify(sig(true, 1032, 1376))).toBe("tablet");
	});
	test("a fine pointer is desktop at any size (a narrow desktop window stays desktop)", () => {
		expect(classify(sig(false, 1440, 900))).toBe("desktop");
		expect(classify(sig(false, 390, 800))).toBe("desktop");
	});
	test("a huge touch screen is desktop", () => expect(classify(sig(true, 1200, 1920))).toBe("desktop"));
	test("the visitor's choice wins", () => {
		expect(classify(sig(true, 393, 852), "desktop")).toBe("desktop");
		expect(classify(sig(false, 1440, 900), "phone")).toBe("phone");
	});
	test("?layout= overrides (tests, the self-check)", () => {
		expect(readChoice("?layout=phone")).toBe("phone");
		expect(readChoice("?layout=nonsense")).toBe("auto");
	});
});

describe("the bottom bar follows the creator's path", () => {
	test("import first, export last, in the path's order", () => {
		const ids: string[] = PHONE_TOOLS.map((t) => t.id);
		expect(ids[0]).toBe("import");
		// (Export is the top bar's button, not a seventh tool: it was cut off on a 375-px phone)
		expect(ids.at(-1)).toBe("format");
		const order = ["import", "edit", "text", "audio", "filters", "format"];
		expect(ids.filter((id) => order.includes(id))).toEqual(order);
	});
	test("every tool ends in an existing action or a sheet (no dead buttons)", () => {
		for (const t of PHONE_TOOLS) expect(t.action !== undefined || t.sheet !== undefined).toBe(true);
	});
});

describe("the phone's memory column", () => {
	test("never above the desktop's smallest (base) column, decoders at most 2", () => {
		const b = phoneBudget();
		expect(b["video.decoders"]).toBeLessThanOrEqual(2);
		expect(b["video.back"]).toBe(0);
	});
});
