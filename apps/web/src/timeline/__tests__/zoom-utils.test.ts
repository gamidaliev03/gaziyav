import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let zoomUtils: typeof import("../zoom-utils");

beforeAll(async () => {
	await installOpenCutWasm();
	zoomUtils = await import("../zoom-utils");
});

describe("timeline zoom maths", () => {
	test("an unmeasured container (0 px) still gives a positive minimum and a finite slider", () => {
		const minZoom = zoomUtils.getTimelineZoomMin({ duration: 0, containerWidth: 0 });
		expect(minZoom).toBeGreaterThan(0);
		expect(Number.isFinite(minZoom)).toBe(true);
		expect(Number.isFinite(zoomUtils.sliderToZoom({ sliderPosition: 0.5, minZoom: 0 }))).toBe(true);
		expect(Number.isFinite(zoomUtils.zoomToSlider({ zoomLevel: 0, minZoom: 0 }))).toBe(true);
	});

	test("slider ↔ zoom round-trips and the ends are exact", () => {
		const minZoom = zoomUtils.getTimelineZoomMin({ duration: 120_000, containerWidth: 1200 });
		for (const position of [0, 0.25, 0.5, 0.75, 1]) {
			const zoom = zoomUtils.sliderToZoom({ sliderPosition: position, minZoom });
			expect(zoomUtils.zoomToSlider({ zoomLevel: zoom, minZoom })).toBeCloseTo(position, 9);
		}
		expect(zoomUtils.zoomToSlider({ zoomLevel: minZoom, minZoom })).toBe(0);
		expect(zoomUtils.zoomToSlider({ zoomLevel: 100, minZoom })).toBe(1);
	});

	test("a minimum zoom equal to the maximum does not divide by zero", () => {
		expect(Number.isFinite(zoomUtils.getZoomPercent({ zoomLevel: 100, minZoom: 100 }))).toBe(true);
		expect(Number.isFinite(zoomUtils.sliderToZoom({ sliderPosition: 0.5, minZoom: 100, maxZoom: 100 }))).toBe(true);
		expect(Number.isFinite(zoomUtils.zoomToSlider({ zoomLevel: 100, minZoom: 100, maxZoom: 100 }))).toBe(true);
	});

	test("padding stays finite for a broken width or a zoom below the minimum", () => {
		expect(zoomUtils.getTimelinePaddingPx({ containerWidth: 0, zoomLevel: 1, minZoom: 1 })).toBe(0);
		expect(Number.isFinite(zoomUtils.getTimelinePaddingPx({ containerWidth: 1000, zoomLevel: 0, minZoom: 5 }))).toBe(true);
		expect(Number.isFinite(zoomUtils.getTimelinePaddingPx({ containerWidth: Number.NaN, zoomLevel: 5, minZoom: 5 }))).toBe(true);
	});
});
