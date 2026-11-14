import { useCallback, useEffect, useState } from "react";

/**
 * The player's full screen (CapCut ⛶ / ⇧⌘F): the player covers the editor window; Esc, the button or ⇧⌘F again bring
 * it back. With the window itself full screen (⌃⌘F, the green button) it covers the screen.
 * The system's HTML full screen is not used: on macOS its ~1 s animation and its late or missing events left the
 * player stuck over the editor (Esc during the animation), or the page taking no clicks at all.
 */
export function usePlayerFullscreen() {
	const [isFullscreen, setIsFullscreen] = useState(false);

	useEffect(() => {
		if (!isFullscreen) return;
		// Esc leaves full screen first; the editor's Esc (clear the selection…) waits for the next press.
		const handleKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			setIsFullscreen(false);
		};
		document.addEventListener("keydown", handleKey, true);
		return () => document.removeEventListener("keydown", handleKey, true);
	}, [isFullscreen]);

	const toggleFullscreen = useCallback(() => setIsFullscreen((on) => !on), []);

	return { isFullscreen, toggleFullscreen };
}
