import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// The preview's reduced frames must keep the source's proportions: the layer is laid out from the frame's size, and a
// frame of 720×406 for a 16:9 clip was drawn narrower than the canvas with dark edges (what the scopes showed).
let capFrameSize: typeof import("@/services/video-cache/service").capFrameSize;
beforeAll(async () => {
	await installOpenCutWasm();
	({ capFrameSize } = await import("@/services/video-cache/service"));
});

describe("preview frame size keeps the picture's proportions", () => {
	test("1920×1080 at every eighth", () => {
		for (let eighths = 1; eighths <= 7; eighths++) {
			const scale = eighths / 8;
			const size = capFrameSize({ width: 1920, height: 1080, max: { width: Math.round(1920 * scale), height: Math.round(1080 * scale) } });
			expect(size.width * 1080).toBe(size.height * 1920);
			expect(Math.abs(size.width - 1920 * scale)).toBeLessThanOrEqual(1);
		}
		expect(capFrameSize({ width: 1920, height: 1080, max: { width: 720, height: 405 } })).toEqual({ width: 720, height: 405 });
	});

	test("4K, vertical, 4:3, 21:9 and a phone's 886×1920", () => {
		for (const [width, height] of [
			[3840, 2160],
			[1080, 1920],
			[2160, 3840],
			[1440, 1080],
			[2560, 1080],
			[886, 1920],
		]) {
			for (const scale of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75]) {
				const size = capFrameSize({ width, height, max: { width: Math.round(width * scale), height: Math.round(height * scale) } });
				// exactly proportional, or (no whole-pixel size near enough) within half a pixel
				const off = Math.abs(size.width / size.height - width / height) * size.height;
				expect(off).toBeLessThanOrEqual(0.5);
				expect(size.width).toBeLessThanOrEqual(width);
				expect(size.width).toBeGreaterThanOrEqual(width * scale * 0.9 - 1);
			}
		}
	});

	test("an odd-sized source falls back to the nearest whole pixels", () => {
		const size = capFrameSize({ width: 1279, height: 719, max: { width: 480, height: 270 } });
		expect(Math.abs(size.width - 480)).toBeLessThanOrEqual(1);
		expect(Math.abs(size.height - 270)).toBeLessThanOrEqual(1);
	});

	test("no cap, or a cap near the source: the source's own size", () => {
		expect(capFrameSize({ width: 1920, height: 1080, max: null })).toEqual({ width: 1920, height: 1080 });
		expect(capFrameSize({ width: 1920, height: 1080, max: { width: 1800, height: 1012 } })).toEqual({ width: 1920, height: 1080 });
	});
});
