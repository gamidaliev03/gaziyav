import { useMemo, useRef } from "react";
import type { TimelineRenderWindow } from "@/timeline/components/timeline-track";
import { getScrollBucketSize } from "@/timeline/hooks/use-scroll-position";
import { speedOff } from "@/timeline/speed-flags";

/**
 * The timeline's virtualization window: the screen plus half a screen on each side, snapped to quarter-screen
 * buckets. Every mounted clip is ~9 paint layers that each edit paints and layerizes.
 *
 * A zoom step renders before the zoom moves the scroll (applyZoomLayout runs in the layout effect), and the scroll
 * bucket catches up only a frame later: windowed from the old scroll position, each wheel step on a two-hour film
 * mounted ~60 clips of a part of the film nobody was looking at and swapped them for the right ones a frame later
 * (120 mounts a step, ideal-longform 11.11). The window of a zoom step is taken from where the scroll lands
 * (`projectedScrollLeft`) and kept until the scroll bucket reports a new position.
 */
export function computeRenderWindow({
	viewportWidth,
	scrollLeft,
}: {
	viewportWidth: number;
	scrollLeft: number;
}): TimelineRenderWindow {
	const bucketSize = getScrollBucketSize(viewportWidth);
	const bucketStart = Math.floor(scrollLeft / bucketSize) * bucketSize;
	const margin = viewportWidth / 2;
	return { startPx: bucketStart - margin, endPx: bucketStart + bucketSize + viewportWidth + margin };
}

export function useRenderWindow({
	viewportWidth,
	scrollBucket,
	zoomLevel,
	projectedScrollLeft,
}: {
	viewportWidth: number;
	scrollBucket: number;
	zoomLevel: number;
	/** Where the zoom being rendered puts the scroll, or null when it keeps it. */
	projectedScrollLeft: number | null;
}): TimelineRenderWindow | null {
	const bucketSize = viewportWidth ? getScrollBucketSize(viewportWidth) : 1;
	// The bucket a zoom step lands on, kept while the scroll bucket state still shows the old one.
	const landing = useRef<{ zoom: number; staleBucket: number; bucket: number } | null>(null);
	if (projectedScrollLeft !== null && viewportWidth && !speedOff("window")) {
		landing.current = { zoom: zoomLevel, staleBucket: scrollBucket, bucket: Math.floor(projectedScrollLeft / bucketSize) };
	} else if (landing.current && (landing.current.zoom !== zoomLevel || landing.current.staleBucket !== scrollBucket)) {
		landing.current = null;
	}
	const bucket = landing.current?.bucket ?? scrollBucket;
	return useMemo(
		() => (viewportWidth ? computeRenderWindow({ viewportWidth, scrollLeft: bucket * getScrollBucketSize(viewportWidth) }) : null),
		[viewportWidth, bucket],
	);
}
