/** How much one pixel of a label drag counts: Shift ×10, ⌥ ×0.1 (read on every move, so it can change mid-drag). */
export function scrubModifier({ shiftKey, altKey }: { shiftKey: boolean; altKey: boolean }): number {
	if (shiftKey) return 10;
	if (altKey) return 0.1;
	return 1;
}

/**
 * Dragging a row's label sideways changes its value (the label is the scrub zone, as in After Effects and Figma; the
 * grip glyph in each field read as Pause). The value previews while the pointer moves and is committed on release:
 * one undo step. Returns the label's onPointerDown, or undefined when the row has nothing to scrub. The callbacks are
 * the ones of the render the drag started in (as NumberField's own scrub does): each move previews from them.
 */
export function labelScrub({
	value,
	perPixel,
	onPreview,
	onCommit,
	enabled = true,
}: {
	/** The value shown now, in the units of `perPixel` and `onPreview`. */
	value: number;
	perPixel: number;
	onPreview: (value: number) => void;
	onCommit: () => void;
	enabled?: boolean;
}): ((event: React.PointerEvent<HTMLElement>) => void) | undefined {
	if (!enabled) return undefined;
	return (event) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const start = value;
		let pixels = 0;
		let firstMove = true;
		let released = false;
		let lastX = event.clientX;
		const target = event.currentTarget;
		// Can be refused (window not focused, right after an Esc): the cursor then moves and is read where it is. It can
		// also arrive after the button is up (a quick click): it is let go at once, or the cursor stayed hidden.
		target
			.requestPointerLock?.()
			?.then?.(() => {
				if (released) document.exitPointerLock();
			})
			?.catch?.(() => {});
		const move = (moveEvent: PointerEvent) => {
			const fromCursor = moveEvent.clientX - lastX;
			lastX = moveEvent.clientX;
			// the first movementX after a pointer lock often carries the cursor's jump
			if (firstMove && moveEvent.movementX !== 0 && document.pointerLockElement === target) {
				firstMove = false;
				return;
			}
			firstMove = false;
			pixels += (moveEvent.movementX !== 0 ? moveEvent.movementX : fromCursor) * scrubModifier(moveEvent);
			onPreview(start + pixels * perPixel);
		};
		const up = () => {
			released = true;
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", up);
			if (document.pointerLockElement) document.exitPointerLock();
			onCommit();
		};
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", up);
	};
}
