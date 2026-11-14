/** How far a press on a plain cut "+" has to move before it becomes a trim of the edge under it. */
export const CUT_DRAG_THRESHOLD_PX = 3;

type PointerTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * A press on a plain "+" that moves is a trim, not a click: the "+" covers the middle of both clips' trim handles at
 * the cut, and a press-and-drag there used to select the cut instead of trimming. Once the pointer moves past the
 * threshold, the gesture is handed to the trim handle on the pressed side of the cut (CapCut's seam halves): the left
 * half trims the left clip's end, the right half the right clip's start. A press that doesn't move stays a click.
 */
export function watchCutPress({
	startX,
	startY,
	cutX,
	target,
	startTrim,
	onTrim,
}: {
	startX: number;
	startY: number;
	/** The cut's x on screen (same space as startX). */
	cutX: number;
	/** Where the rest of the gesture is heard (the document). */
	target: PointerTarget;
	/** Starts the trim of that side's edge as if pressed at (startX, startY), then moves it to the pointer. */
	startTrim: (args: { side: "left" | "right"; startX: number; startY: number; x: number; y: number }) => boolean;
	/** Called when the press became a trim (its click must not select the cut). */
	onTrim: () => void;
}): () => void {
	const side = startX < cutX ? "left" : "right";
	const onMove = (event: Event) => {
		const { clientX, clientY, buttons } = event as MouseEvent;
		// No button held: the press is over even if its mouseup never reached us (the "+" stops it from bubbling) —
		// moving on to a transition tile trimmed the clip on that side down to a frame.
		if (buttons === 0) {
			stop();
			return;
		}
		if (Math.abs(clientX - startX) <= CUT_DRAG_THRESHOLD_PX) return;
		stop();
		if (startTrim({ side, startX, startY, x: clientX, y: clientY })) onTrim();
	};
	const stop = () => {
		target.removeEventListener("mousemove", onMove);
		target.removeEventListener("mouseup", stop, true);
	};
	target.addEventListener("mousemove", onMove);
	// heard on the way down (capture): the "+" stops its mouseup from bubbling to the document
	target.addEventListener("mouseup", stop, true);
	return stop;
}
