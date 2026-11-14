import { describe, expect, test } from "bun:test";
import {
	getHighestImportedVideoFps,
	getRaisedProjectFpsForImportedMedia,
} from "@/fps/utils";

describe("getHighestImportedVideoFps", () => {
	test("returns the highest valid video fps", () => {
		expect(
			getHighestImportedVideoFps({
				mediaAssets: [
					{ type: "audio" },
					{ type: "video", fps: 30 },
					{ type: "image", fps: 120 },
					{ type: "video", fps: 60 },
				],
			}),
		).toBe(60);
	});

	test("ignores missing and invalid fps values", () => {
		expect(
			getHighestImportedVideoFps({
				mediaAssets: [
					{ type: "video" },
					{ type: "video", fps: 0 },
					{ type: "video", fps: -10 },
					{ type: "audio", fps: 120 },
				],
			}),
		).toBeNull();
	});
});

describe("getRaisedProjectFpsForImportedMedia", () => {
	test("raises the project fps to match a higher-fps import", () => {
		expect(
			getRaisedProjectFpsForImportedMedia({
				currentFps: { numerator: 30, denominator: 1 },
				importedAssets: [{ type: "video", fps: 60 }],
			}),
		).toEqual({ numerator: 60, denominator: 1 });
	});

	test("does not lower the project fps for lower-fps imports", () => {
		expect(
			getRaisedProjectFpsForImportedMedia({
				currentFps: { numerator: 60, denominator: 1 },
				importedAssets: [{ type: "video", fps: 10 }],
			}),
		).toBeNull();
	});

	test("ignores non-video imports", () => {
		expect(
			getRaisedProjectFpsForImportedMedia({
				currentFps: { numerator: 30, denominator: 1 },
				importedAssets: [
					{ type: "image", fps: 60 },
					{ type: "audio", fps: 120 },
				],
			}),
		).toBeNull();
	});
});

describe("normalizeMediaFps (pro-core: NTSC clips keep their rate)", () => {
	test("23.976, 29.97 and 59.94 stay NTSC, so the project gets 24000/1001 and not 24", async () => {
		const { normalizeMediaFps, floatToFrameRate } = await import("@/fps/utils");
		expect(normalizeMediaFps(23.976)).toBeCloseTo(24_000 / 1_001, 9);
		expect(normalizeMediaFps(23.97602)).toBeCloseTo(24_000 / 1_001, 9);
		expect(floatToFrameRate(normalizeMediaFps(23.976) as number)).toEqual({ numerator: 24_000, denominator: 1_001 });
		expect(floatToFrameRate(normalizeMediaFps(29.97) as number)).toEqual({ numerator: 30_000, denominator: 1_001 });
		expect(floatToFrameRate(normalizeMediaFps(59.94) as number)).toEqual({ numerator: 60_000, denominator: 1_001 });
	});

	test("whole rates and variable-rate averages round to a whole number", async () => {
		const { normalizeMediaFps } = await import("@/fps/utils");
		expect(normalizeMediaFps(24)).toBe(24);
		expect(normalizeMediaFps(30.0004)).toBe(30);
		expect(normalizeMediaFps(29.81)).toBe(30);
		expect(normalizeMediaFps(25.02)).toBe(25);
		expect(normalizeMediaFps(Number.NaN)).toBeUndefined();
		expect(normalizeMediaFps(0)).toBeUndefined();
	});
});
