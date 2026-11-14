import { useEffect, useState, useRef } from "react";
import { setLiveTimelineViewport } from "@/timeline/live-pps";

interface UseScrollPositionReturn {
	scrollLeft: number;
	viewportWidth: number;
}

export function useScrollPosition({
	scrollRef,
}: {
	scrollRef: React.RefObject<HTMLElement | null>;
}): UseScrollPositionReturn {
	const [scrollLeft, setScrollLeft] = useState(0);
	const [viewportWidth, setViewportWidth] = useState(0);
	const rafIdRef = useRef<number | null>(null);

	useEffect(() => {
		const scrollElement = scrollRef.current;
		if (!scrollElement) return;

		const updatePosition = () => {
			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current);
			}

			rafIdRef.current = requestAnimationFrame(() => {
				setScrollLeft(scrollElement.scrollLeft);
				setViewportWidth(scrollElement.clientWidth);
				rafIdRef.current = null;
			});
		};

		const resizeObserver = new ResizeObserver(() => {
			updatePosition();
		});

		updatePosition();

		scrollElement.addEventListener("scroll", updatePosition, { passive: true });
		resizeObserver.observe(scrollElement);

		return () => {
			scrollElement.removeEventListener("scroll", updatePosition);
			resizeObserver.disconnect();
			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current);
			}
		};
	}, [scrollRef]);

	return { scrollLeft, viewportWidth };
}

/**
 * Timeline-level variant: the live scroll position stays in a ref and state
 * changes only on resize or when the scroll crosses a half-viewport bucket, so
 * the whole timeline does not re-render on every scroll frame.
 */

interface UseScrollBucketReturn {
	/** Live scroll position (a ref: reading it never re-renders). */
	scrollLeftRef: React.RefObject<number>;
	viewportWidth: number;
	/**
	 * Index of the half-viewport bucket the scroll position is in. It changes
	 * only when the scroll crosses half a viewport, so consumers (timeline
	 * virtualization) re-render a few times per screen instead of every frame.
	 */
	scrollBucket: number;
}

export function getScrollBucketSize(viewportWidth: number): number {
	return Math.max(160, viewportWidth / 4);
}

export function useScrollBucket({
	scrollRef,
	publishViewport = false,
}: {
	scrollRef: React.RefObject<HTMLElement | null>;
	/** Keep the live timeline viewport (live-pps) current: the tracks scroller sets this. */
	publishViewport?: boolean;
}): UseScrollBucketReturn {
	const scrollLeftRef = useRef(0);
	const [state, setState] = useState({ viewportWidth: 0, scrollBucket: 0 });
	const rafIdRef = useRef<number | null>(null);

	useEffect(() => {
		const scrollElement = scrollRef.current;
		if (!scrollElement) return;

		let lastWidth = 0;
		const commit = () => {
			rafIdRef.current = null;
			const scrollLeft = scrollElement.scrollLeft;
			const viewportWidth = scrollElement.clientWidth;
			scrollLeftRef.current = scrollLeft;
			lastWidth = viewportWidth;
			if (publishViewport) {
				setLiveTimelineViewport({ left: scrollLeft, width: viewportWidth });
			}
			const scrollBucket = Math.floor(
				scrollLeft / getScrollBucketSize(viewportWidth),
			);
			setState((prev) =>
				prev.viewportWidth === viewportWidth &&
				prev.scrollBucket === scrollBucket
					? prev
					: { viewportWidth, scrollBucket },
			);
		};

		const updatePosition = () => {
			scrollLeftRef.current = scrollElement.scrollLeft;
			if (publishViewport && lastWidth > 0) {
				setLiveTimelineViewport({ left: scrollLeftRef.current, width: lastWidth });
			}
			if (rafIdRef.current !== null) return;
			rafIdRef.current = requestAnimationFrame(commit);
		};

		const resizeObserver = new ResizeObserver(() => {
			updatePosition();
		});

		updatePosition();

		scrollElement.addEventListener("scroll", updatePosition, { passive: true });
		resizeObserver.observe(scrollElement);

		return () => {
			scrollElement.removeEventListener("scroll", updatePosition);
			resizeObserver.disconnect();
			if (rafIdRef.current !== null) {
				cancelAnimationFrame(rafIdRef.current);
				rafIdRef.current = null;
			}
		};
	}, [scrollRef, publishViewport]);

	return {
		scrollLeftRef,
		viewportWidth: state.viewportWidth,
		scrollBucket: state.scrollBucket,
	};
}
