// CapCut keeps the stack of tracks in the middle of the timeline when it is shorter than the timeline (the space above
// the tracks is where overlays go, a drop there opens a new track). Every vertical position in the tracks area — rows,
// track headers, drops, box selection, pointer maths — goes through this one offset.
let offset = 0;

/** How far the first track row sits below the top of the tracks area (px). */
export const getTracksTopOffset = () => offset;

export function setTracksTopOffset(value: number): void {
	offset = value;
}

/** The offset that centres a stack of `stackHeight` px in a tracks area `viewportHeight` px high. */
export function centeredTracksOffset({ viewportHeight, stackHeight }: { viewportHeight: number; stackHeight: number }): number {
	if (!(viewportHeight > 0)) return 0;
	return Math.max(0, Math.floor((viewportHeight - stackHeight) / 2));
}
