/** Toasts' distance from the window's bottom edge when nothing says otherwise (components/ui/sonner.tsx). */
export const TOAST_BOTTOM_FALLBACK_PX = 24;
/** Never closer to the bottom edge than this. */
export const TOAST_BOTTOM_MIN_PX = 16;
/** Room kept above the toasts' bottom edge: a two-line error with a button fits whole under the top of the window. */
export const TOAST_ROOM_PX = 160;
const GAP_PX = 12;

/**
 * The toasts' bottom offset (px from the window's bottom edge): just above the timeline's top, but never so high that
 * a toast runs out of the window at the top (a tall timeline), never under the bottom edge, and the plain fallback
 * when the timeline is not on screen (hidden, collapsed to nothing). Null: use the fallback.
 */
export function toastBottomFor({ timelineTop, timelineHeight, windowHeight }: { timelineTop: number; timelineHeight: number; windowHeight: number }): number | null {
	if (!(windowHeight > 0) || !Number.isFinite(timelineTop) || !(timelineHeight > 0)) return null;
	if (timelineTop >= windowHeight) return null;
	const above = Math.round(windowHeight - Math.max(0, timelineTop) + GAP_PX);
	const highest = windowHeight - TOAST_ROOM_PX;
	return Math.max(TOAST_BOTTOM_MIN_PX, Math.min(above, highest));
}
