import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let ZoomController: typeof import("@/timeline/controllers/zoom-controller").ZoomController;
let computeRenderWindow: typeof import("@/timeline/hooks/use-render-window").computeRenderWindow;
let getTimelinePixelsPerSecond: typeof import("@/timeline/pixel-utils").getTimelinePixelsPerSecond;
beforeAll(async () => {
	await installOpenCutWasm();
	({ ZoomController } = await import("@/timeline/controllers/zoom-controller"));
	({ computeRenderWindow } = await import("@/timeline/hooks/use-render-window"));
	({ getTimelinePixelsPerSecond } = await import("@/timeline/pixel-utils"));
});

// A wheel zoom step renders before the scroll moves: the window of that render must be the one the scroll lands on.
function controller({ scrollLeft, clientWidth }: { scrollLeft: number; clientWidth: number }) {
	const scroller = {
		scrollLeft,
		clientWidth,
		scrollWidth: 10_000_000,
		getBoundingClientRect: () => ({ left: 0, top: 0, right: clientWidth, bottom: 100, width: clientWidth, height: 100 }),
	} as unknown as HTMLDivElement;
	const config = {
		minZoom: 0.01,
		getContainerEl: () => null,
		getTracksScrollEl: () => scroller,
		getRulerScrollEl: () => null,
		getCurrentPlayheadTime: () => 0 as never,
		seek: () => {},
		setTimelineViewState: () => {},
	};
	return { zoom: new ZoomController({ configRef: { current: config }, initialZoom: 1 }), scroller };
}

describe("zoom render window", () => {
	test("a wheel step projects the scroll it lands on, and applyZoomLayout lands there", () => {
		const { zoom, scroller } = controller({ scrollLeft: 50_000, clientWidth: 1000 });
		zoom.zoomAt({ zoomLevel: 0.9, clientX: 500 });
		const projected = zoom.projectScrollLeft(0.9, 1000);
		expect(projected).not.toBeNull();
		zoom.applyZoomLayout(0.9);
		expect(Math.abs((projected ?? 0) - scroller.scrollLeft)).toBeLessThan(1);
		// the time under the pointer stayed under it
		const before = (50_000 + 500) / getTimelinePixelsPerSecond({ zoomLevel: 1 });
		const after = (scroller.scrollLeft + 500) / getTimelinePixelsPerSecond({ zoomLevel: 0.9 });
		expect(Math.abs(before - after)).toBeLessThan(0.01);
		// once applied, nothing is pending
		expect(zoom.projectScrollLeft(0.9, 1000)).toBeNull();
	});

	test("the window covers the screen with half a screen on each side", () => {
		const w = computeRenderWindow({ viewportWidth: 1000, scrollLeft: 12_345 });
		expect(w.startPx).toBeLessThanOrEqual(12_345 - 500 + 1);
		expect(w.endPx).toBeGreaterThanOrEqual(12_345 + 1000 + 500 - 1);
		expect(w.endPx - w.startPx).toBeLessThan(3 * 1000);
	});
});
