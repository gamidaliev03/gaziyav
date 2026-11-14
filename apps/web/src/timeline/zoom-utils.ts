import {
	BASE_TIMELINE_PIXELS_PER_SECOND,
	TIMELINE_ZOOM_MAX,
} from "@/timeline/scale";
import { TICKS_PER_SECOND } from "@/wasm";

const PADDING_MAX_RATIO = 0.75;
const PADDING_MIN_RATIO = 0.15;
const PADDING_MIN_AT_ZOOM_PERCENT = 0.2;

export function getTimelineZoomMin({
	duration,
	containerWidth,
}: {
	duration: number;
	containerWidth: number | null | undefined;
}): number {
	const safeDurationSeconds = Number.isFinite(duration) ? Math.max(duration / TICKS_PER_SECOND, 1) : 1;
	// A container that has not been measured yet is 0: it used to make the minimum zoom 0, and the exponential
	// slider then divided 0 by 0 and returned NaN.
	const safeContainerWidth =
		typeof containerWidth === "number" && Number.isFinite(containerWidth) && containerWidth > 0
			? containerWidth
			: 1000;
	const contentRatioAtMinZoom = 1 - PADDING_MAX_RATIO;
	const availableWidth = safeContainerWidth * contentRatioAtMinZoom;
	const zoomToFit =
		availableWidth / (safeDurationSeconds * BASE_TIMELINE_PIXELS_PER_SECOND);

	return Math.max(1e-6, Math.min(TIMELINE_ZOOM_MAX, zoomToFit));
}

export function getTimelinePaddingPx({
	containerWidth,
	zoomLevel,
	minZoom,
}: {
	containerWidth: number;
	zoomLevel: number;
	minZoom: number;
}): number {
	const safeWidth = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0;
	const zoomPercent = Math.max(
		0,
		Math.min(1, getZoomPercent({ zoomLevel, minZoom })),
	);
	const paddingTransitionPercent = Math.min(
		zoomPercent / PADDING_MIN_AT_ZOOM_PERCENT,
		1,
	);
	const paddingRatio =
		PADDING_MAX_RATIO -
		(PADDING_MAX_RATIO - PADDING_MIN_RATIO) * paddingTransitionPercent;

	return safeWidth * paddingRatio;
}

export function getZoomPercent({
	zoomLevel,
	minZoom,
}: {
	zoomLevel: number;
	minZoom: number;
}): number {
	const range = TIMELINE_ZOOM_MAX - minZoom;
	return range > 0 ? (zoomLevel - minZoom) / range : 0;
}

/** The slider maths only needs a positive base: an unmeasured timeline (0) must not become NaN. */
function safeMinZoom({ minZoom, maxZoom }: { minZoom: number; maxZoom: number }): number {
	if (Number.isFinite(minZoom) && minZoom > 0 && (!Number.isFinite(maxZoom) || maxZoom > minZoom)) return minZoom;
	if (Number.isFinite(maxZoom) && maxZoom > 0) return maxZoom / 100;
	return 0.001;
}

/**
 * convert linear slider position (0-1) to exponential zoom level.
 * at low slider values, zoom changes are small. at high values, changes are large.
 */
export function sliderToZoom({
	sliderPosition,
	minZoom,
	maxZoom = TIMELINE_ZOOM_MAX,
}: {
	sliderPosition: number;
	minZoom: number;
	maxZoom?: number;
}): number {
	const clampedPosition = Math.max(0, Math.min(1, sliderPosition));
	const base = safeMinZoom({ minZoom, maxZoom });
	const top = Number.isFinite(maxZoom) && maxZoom > base ? maxZoom : base * 100;
	return base * (top / base) ** clampedPosition;
}

/**
 * convert exponential zoom level to linear slider position (0-1).
 */
export function zoomToSlider({
	zoomLevel,
	minZoom,
	maxZoom = TIMELINE_ZOOM_MAX,
}: {
	zoomLevel: number;
	minZoom: number;
	maxZoom?: number;
}): number {
	const base = safeMinZoom({ minZoom, maxZoom });
	const top = Number.isFinite(maxZoom) && maxZoom > base ? maxZoom : base * 100;
	const clampedZoom = Math.max(base, Math.min(top, Number.isFinite(zoomLevel) ? zoomLevel : base));
	return Math.log(clampedZoom / base) / Math.log(top / base);
}
