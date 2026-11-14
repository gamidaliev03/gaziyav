// polish3 (11.11): Details said «25.00fps» and «23.98fps» (rounded) while Export says «23.976fps».
import { describe, expect, test } from "bun:test";
import { fpsLabel } from "../details-view";

describe("Details → Frame rate reads like the Export window", () => {
	test("whole rates without decimals, NTSC rates exact", () => {
		expect(fpsLabel(25)).toBe("25fps");
		expect(fpsLabel(30)).toBe("30fps");
		expect(fpsLabel(24000 / 1001)).toBe("23.976fps");
		expect(fpsLabel(30000 / 1001)).toBe("29.97fps");
		expect(fpsLabel(60000 / 1001)).toBe("59.94fps");
		expect(fpsLabel(12.5)).toBe("12.5fps");
	});
});
