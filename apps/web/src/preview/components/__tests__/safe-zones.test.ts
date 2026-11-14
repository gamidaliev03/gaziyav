import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let zones: typeof import("../safe-zones");
beforeAll(async () => {
	await installOpenCutWasm();
	zones = await import("../safe-zones");
});

describe("safe zones", () => {
	test("TikTok's safe rectangle on 1080×1920 (DESIGN.md S1 acceptance 1)", () => {
		const tiktok = zones.SAFE_ZONES.find((zone) => zone.id === "tiktok")!;
		const rect = zones.safeRect(tiktok, { width: 1080, height: 1920 });
		expect(Math.round(rect.left)).toBe(60);
		expect(Math.round(rect.right)).toBe(940);
		expect(Math.round(rect.top)).toBe(221);
		expect(Math.round(rect.bottom)).toBe(1440);
	});

	test("Move in takes the shortest way, centres what is too big", () => {
		const rect = { left: 60, top: 220, right: 940, bottom: 1440 };
		expect(zones.moveInto({ left: 200, top: 1500, right: 800, bottom: 1600 }, rect)).toEqual({ dx: 0, dy: -160 });
		expect(zones.moveInto({ left: 0, top: 300, right: 100, bottom: 400 }, rect)).toEqual({ dx: 60, dy: 0 });
		expect(zones.moveInto({ left: 200, top: 300, right: 300, bottom: 400 }, rect)).toEqual({ dx: 0, dy: 0 });
		expect(zones.moveInto({ left: 0, top: 300, right: 1080, bottom: 400 }, rect).dx).toBe(-40);
	});
});
