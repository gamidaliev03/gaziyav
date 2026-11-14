/**
 * Batches the clips' canvas/SVG redraws (waveforms, filmstrips) into one animation frame: all reads
 * (getBoundingClientRect) first, then all writes. Redrawing each clip right away interleaved reads and
 * writes, forcing a layout per clip on every zoom/scroll step (296 clips: ~50 ms per step).
 */
const pendingMeasures = new Set<() => (() => void) | null>();
let frame = 0;

function runDraws(): void {
	frame = 0;
	const measures = [...pendingMeasures];
	pendingMeasures.clear();
	const writes = measures.map((measureOne) => measureOne());
	for (const write of writes) write?.();
}

/** `measure` reads layout only and returns the write phase, or null when nothing changed. */
export function scheduleTimelineDraw(measure: () => (() => void) | null): void {
	pendingMeasures.add(measure);
	if (frame) return;
	frame = requestAnimationFrame(runDraws);
}

/**
 * Draws the pending clips now instead of in the next animation frame. For a caller that is itself
 * inside an animation frame (the zoom step): waveforms and frames are redrawn in the frame that shows
 * the new zoom, not one frame later.
 */
export function flushTimelineDraws(): void {
	if (!frame) return;
	cancelAnimationFrame(frame);
	runDraws();
}
