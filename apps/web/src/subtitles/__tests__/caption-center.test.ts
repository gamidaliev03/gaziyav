import { describe, expect, test } from "bun:test";
import { resolveCaptionCenterY } from "../build-subtitle-text-element";

// The exam 03.11: a 16:9 documentary came out with every caption across the middle of its pictures.
describe("where captions sit", () => {
	test("a wide frame puts them in the lower third (0.82 H), as CapCut's 16:9 default", () => {
		expect(resolveCaptionCenterY({ canvasHeight: 1080, canvasWidth: 1920, fontSize: 5 })).toBe(Math.round(0.32 * 1080));
	});
	test("a tall frame keeps the feed's safe zone (0.59 H)", () => {
		expect(resolveCaptionCenterY({ canvasHeight: 1920, canvasWidth: 1080, fontSize: 5 })).toBe(Math.round(0.09 * 1920));
		expect(resolveCaptionCenterY({ canvasHeight: 1920, fontSize: 5 })).toBe(Math.round(0.09 * 1920));
	});
	test("a face under the wide-frame captions moves them above it", () => {
		const y = resolveCaptionCenterY({ canvasHeight: 1080, canvasWidth: 1920, fontSize: 5, faceBox: { x: 0.4, y: 0.6, width: 0.2, height: 0.35 } });
		expect(y).toBeLessThan(Math.round(0.1 * 1080));
	});
});
