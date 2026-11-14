import { useEffect, useRef, type RefObject } from "react";

/**
 * True while ⇧ or ⌘ is held: timeline drags, trims and the playhead ignore snapping
 * (CapCut/Kadr "hold ⌘ to drag without snapping"; ⇧ kept for OpenCut users).
 */
export function useSnapSuspendKey(): RefObject<boolean> {
	const heldRef = useRef(false);

	useEffect(() => {
		const update = (event: KeyboardEvent) => {
			heldRef.current = event.shiftKey || event.metaKey;
		};
		const updateFromMouse = (event: MouseEvent) => {
			heldRef.current = event.shiftKey || event.metaKey;
		};
		const reset = () => {
			heldRef.current = false;
		};
		document.addEventListener("keydown", update);
		document.addEventListener("keyup", update);
		// Modifier state is also on every mouse event (keys pressed before focusing the window).
		document.addEventListener("mousemove", updateFromMouse, { capture: true, passive: true });
		document.addEventListener("mousedown", updateFromMouse, { capture: true });
		window.addEventListener("blur", reset);
		return () => {
			document.removeEventListener("keydown", update);
			document.removeEventListener("keyup", update);
			document.removeEventListener("mousemove", updateFromMouse, { capture: true });
			document.removeEventListener("mousedown", updateFromMouse, { capture: true });
			window.removeEventListener("blur", reset);
		};
	}, []);

	return heldRef;
}

/** True while ⌥ is held (⌥-drag duplicates clips on the timeline). */
export function useAltKey(): RefObject<boolean> {
	const heldRef = useRef(false);
	useEffect(() => {
		const update = (event: KeyboardEvent | MouseEvent) => {
			heldRef.current = event.altKey;
		};
		const reset = () => {
			heldRef.current = false;
		};
		document.addEventListener("keydown", update);
		document.addEventListener("keyup", update);
		document.addEventListener("mousemove", update, { capture: true, passive: true });
		document.addEventListener("mouseup", update, { capture: true });
		window.addEventListener("blur", reset);
		return () => {
			document.removeEventListener("keydown", update);
			document.removeEventListener("keyup", update);
			document.removeEventListener("mousemove", update, { capture: true });
			document.removeEventListener("mouseup", update, { capture: true });
			window.removeEventListener("blur", reset);
		};
	}, []);
	return heldRef;
}
