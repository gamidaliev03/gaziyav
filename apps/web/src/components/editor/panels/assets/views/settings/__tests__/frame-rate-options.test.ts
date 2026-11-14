import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let settings: typeof import("../index");
let fps: typeof import("@/fps/utils");

beforeAll(async () => {
	await installOpenCutWasm();
	settings = await import("../index");
	fps = await import("@/fps/utils");
});

// H2-8: a 50 fps project showed an empty Frame rate select (only 24/25/30/60/120 were listed).
describe("Project settings › Frame rate", () => {
	test("a preset rate is selected as before", () => {
		const r = settings.frameRateOptions({ numerator: 30, denominator: 1 });
		expect(r.value).toBe("30");
		// pro-core 09.11: the film and NTSC rates are presets too
		expect(r.options.map((o) => o.value)).toEqual(["23.976", "24", "25", "29.97", "30", "50", "59.94", "60", "120"]);
	});

	test("50 fps is listed and selected", () => {
		const r = settings.frameRateOptions({ numerator: 50, denominator: 1 });
		expect(r.value).toBe("50");
		expect(r.options.find((o) => o.value === r.value)?.label).toBe("50 fps");
		expect(r.options.map((o) => o.value)).toEqual(["23.976", "24", "25", "29.97", "30", "50", "59.94", "60", "120"]);
	});

	test("29.97 is shown as 29.97, not 30, and picking it keeps 30000/1001", () => {
		const r = settings.frameRateOptions({ numerator: 30000, denominator: 1001 });
		expect(r.value).toBe("29.97");
		expect(r.options.find((o) => o.value === r.value)?.label).toBe("29.97 fps");
		expect(fps.floatToFrameRate(Number.parseFloat(r.value))).toEqual({ numerator: 30000, denominator: 1001 });
	});

	test("23.976 and 59.94", () => {
		expect(settings.frameRateOptions({ numerator: 24000, denominator: 1001 }).value).toBe("23.976");
		expect(settings.frameRateOptions({ numerator: 60000, denominator: 1001 }).value).toBe("59.94");
	});
	test("a rate not in the list is still shown and selected (an imported 48 fps clip)", () => {
		const r = settings.frameRateOptions({ numerator: 48, denominator: 1 });
		expect(r.value).toBe("48");
		expect(r.options.map((o) => o.value)).toContain("48");
	});
});
