import { describe, expect, test } from "bun:test";
import type { FrameRate } from "opencut-wasm";
import { formatRulerLabel, getRulerConfig } from "../ruler-utils";

const NTSC_2997: FrameRate = { numerator: 30_000, denominator: 1_001 };
const NTSC_23976: FrameRate = { numerator: 24_000, denominator: 1_001 };

describe("timeline ruler frame labels", () => {
	test("a frame label never reaches the frame rate (no «30f» at 29.97, no «24f» at 23.976)", () => {
		for (const fps of [NTSC_2997, NTSC_23976, { numerator: 25, denominator: 1 }] as FrameRate[]) {
			const fpsFloat = fps.numerator / fps.denominator;
			const maxFrame = Math.ceil(fpsFloat) - 1;
			for (const zoomLevel of [0.2, 1, 10, 100]) {
				const config = getRulerConfig({ zoomLevel, fps });
				for (let index = 0; index < 3000; index++) {
					const time = index * config.labelIntervalSeconds;
					const label = formatRulerLabel({ timeInSeconds: time, fps });
					if (!label.endsWith("f")) continue;
					const frame = Number(label.slice(0, -1));
					expect(Number.isInteger(frame)).toBe(true);
					expect(frame).toBeGreaterThanOrEqual(0);
					expect(frame).toBeLessThanOrEqual(maxFrame);
				}
			}
		}
	});

	test("30 frames of 29.97 are 1.001 s: that frame is labelled as the second, not as «0f»", () => {
		expect(formatRulerLabel({ timeInSeconds: 1.001, fps: NTSC_2997 })).toBe("00:01");
		expect(formatRulerLabel({ timeInSeconds: 0.9843, fps: NTSC_2997 })).toBe("29f");
	});

	test("a broken frame rate or zoom falls back instead of dividing by zero", () => {
		const broken: FrameRate = { numerator: 0, denominator: 1 };
		expect(formatRulerLabel({ timeInSeconds: 1, fps: broken })).toBe("00:01");
		const config = getRulerConfig({ zoomLevel: 0, fps: broken });
		expect(Number.isFinite(config.labelIntervalSeconds)).toBe(true);
		expect(Number.isFinite(config.tickIntervalSeconds)).toBe(true);
		expect(config.labelIntervalSeconds).toBeGreaterThan(0);
		expect(config.tickIntervalSeconds).toBeGreaterThan(0);
	});
});
