/**
 * Seeks made by a click or drag on the timeline itself. The "keep the playhead in view" scroll is for keyboard and
 * programmatic seeks: a click is already where the user looks, and recentring on it (a click or a scrub released
 * near an edge) made the view jump half a screen under the mouse.
 */
let depth = 0;

export function seekFromPointer(seek: () => void): void {
	depth++;
	try {
		seek();
	} finally {
		depth--;
	}
}

export function isPointerSeek(): boolean {
	return depth > 0;
}
