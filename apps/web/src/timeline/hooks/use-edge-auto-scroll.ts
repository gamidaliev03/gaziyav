import { useEffect, useRef } from "react";

interface UseEdgeAutoScrollParams {
	isActive: boolean;
	getMouseClientX: () => number;
	rulerScrollRef: React.RefObject<HTMLDivElement | null>;
	tracksScrollRef: React.RefObject<HTMLDivElement | null>;
	contentWidth: number;
	edgeThreshold?: number;
	maxScrollSpeed?: number;
}

export function useEdgeAutoScroll({
	isActive,
	getMouseClientX,
	rulerScrollRef,
	tracksScrollRef,
	contentWidth,
	edgeThreshold = 100,
	maxScrollSpeed = 15,
}: UseEdgeAutoScrollParams): void {
	const rafRef = useRef<number | null>(null);
	// The last real pointer position of this drag. Outside the effect: getMouseClientX is a new function on every
	// render, so the effect re-runs while dragging and a position kept inside it was lost each time.
	const pointerRef = useRef({ x: 0, y: 0, known: false });
	// Where the drag began (kept outside the effect for the same reason): the view scrolls toward an edge only once the
	// pointer has moved that way. A trim of the last clip's tail, grabbed within 100 px of the right edge, scrolled the
	// view right at once while the pointer went left: everything jumped 34 px under the cursor and the marker aimed at
	// was missed (pro-core, 09.11).
	const originRef = useRef<number | null>(null);

	useEffect(() => {
		if (!isActive) {
			pointerRef.current = { x: 0, y: 0, known: false };
			originRef.current = null;
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			return;
		}

		// While the view scrolls under a still mouse, the drag must follow the time now under the cursor: the last
		// mousemove is repeated after each scroll step (the clip used to drop at the time of the last real move, seconds
		// before the scrolled-to place).
		const pointer = pointerRef.current;
		const remember = (event: MouseEvent) => {
			if (!event.isTrusted) return;
			pointer.x = event.clientX;
			pointer.y = event.clientY;
			pointer.known = true;
		};
		document.addEventListener("mousemove", remember, true);

		const step = () => {
			const rulerViewport = rulerScrollRef.current;
			const tracksViewport = tracksScrollRef.current;
			if (!rulerViewport || !tracksViewport) {
				rafRef.current = requestAnimationFrame(step);
				return;
			}

			const viewportRect = rulerViewport.getBoundingClientRect();
			const mouseX = getMouseClientX();
			// (a pointer not known yet reads 0: then both ways, as before)
			if (originRef.current === null && mouseX > 0) originRef.current = mouseX;
			const origin = originRef.current;
			const towardLeft = origin === null || mouseX < origin - 2;
			const towardRight = origin === null || mouseX > origin + 2;
			const mouseXRelative = mouseX - viewportRect.left;

			const viewportWidth = rulerViewport.clientWidth;
			const intrinsicContentWidth = rulerViewport.scrollWidth;
			const effectiveContentWidth = Math.max(
				contentWidth,
				intrinsicContentWidth,
			);
			const scrollMax = Math.max(0, effectiveContentWidth - viewportWidth);

			let scrollSpeed = 0;

			if (mouseXRelative < edgeThreshold && rulerViewport.scrollLeft > 0 && towardLeft) {
				const edgeDistance = Math.max(0, mouseXRelative);
				const intensity = 1 - edgeDistance / edgeThreshold;
				scrollSpeed = -maxScrollSpeed * intensity;
			} else if (
				mouseXRelative > viewportWidth - edgeThreshold &&
				rulerViewport.scrollLeft < scrollMax &&
				towardRight
			) {
				const edgeDistance = Math.max(0, viewportWidth - mouseXRelative);
				const intensity = 1 - edgeDistance / edgeThreshold;
				scrollSpeed = maxScrollSpeed * intensity;
			}

			if (scrollSpeed !== 0) {
				const newScrollLeft = Math.max(
					0,
					Math.min(scrollMax, rulerViewport.scrollLeft + scrollSpeed),
				);
				const moved = newScrollLeft !== rulerViewport.scrollLeft;
				rulerViewport.scrollLeft = newScrollLeft;
				tracksViewport.scrollLeft = newScrollLeft;
				if (moved && pointer.known) {
					document.dispatchEvent(new MouseEvent("mousemove", { clientX: pointer.x, clientY: pointer.y, buttons: 1, bubbles: true }));
				}
			}

			rafRef.current = requestAnimationFrame(step);
		};

		rafRef.current = requestAnimationFrame(step);

		return () => {
			document.removeEventListener("mousemove", remember, true);
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};
	}, [
		isActive,
		getMouseClientX,
		rulerScrollRef,
		tracksScrollRef,
		contentWidth,
		edgeThreshold,
		maxScrollSpeed,
	]);
}
