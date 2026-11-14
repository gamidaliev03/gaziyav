import { type RefObject, useEffect } from "react";
import { toastBottomFor } from "./toast-bottom";

/** The CSS variable the Toaster's bottom offset reads (components/ui/sonner.tsx). */
export const TOAST_BOTTOM_VAR = "--toast-bottom";

/**
 * Toasts stack at the bottom left, just above the timeline (product review 04.11 №22: not over the player's picture).
 * Over the tracks they took the click meant for a clip, and a hovered toast never expires — so the timeline says
 * where its top is, as the panels are resized and the window changes.
 */
export function useToastsAboveTimeline(ref: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const root = document.documentElement.style;
		const place = () => {
			const rect = element.getBoundingClientRect();
			// a tall timeline: the toast stays whole under the window's top; a hidden one: the plain bottom offset
			const bottom = toastBottomFor({ timelineTop: rect.top, timelineHeight: rect.height, windowHeight: window.innerHeight });
			if (bottom === null) root.removeProperty(TOAST_BOTTOM_VAR);
			else root.setProperty(TOAST_BOTTOM_VAR, `${bottom}px`);
		};
		place();
		const observer = new ResizeObserver(place);
		observer.observe(element);
		window.addEventListener("resize", place);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", place);
			root.removeProperty(TOAST_BOTTOM_VAR);
		};
	}, [ref]);
}
