// The timeline's pixels per second, outside React. Zoom changes it on every wheel step; what draws from it inside
// clips (waveforms) redraws in one batched frame instead of re-rendering every clip through context or props.

let pps = 0;
const listeners = new Set<() => void>();

export function getLivePixelsPerSecond(): number {
	return pps;
}

export function setLivePixelsPerSecond(next: number): void {
	if (next === pps || !(next > 0)) return;
	pps = next;
	for (const fn of listeners) fn();
}

/**
 * The tracks' visible range in content pixels (scrollLeft, clientWidth), kept from scroll and resize events so
 * code that runs after a commit can tell what is on screen without forcing a layout. Width 0 = unknown.
 */
let viewportLeft = 0;
let viewportWidth = 0;

export function setLiveTimelineViewport({ left, width }: { left: number; width: number }): void {
	viewportLeft = left;
	viewportWidth = width;
}

export function getLiveTimelineViewport(): { left: number; width: number } {
	return { left: viewportLeft, width: viewportWidth };
}

/** Waveform redraws by clip id (a waveform draws only the visible part of its clip). */
const clipRedraws = new Map<string, Set<() => void>>();

export function subscribeClipMoved(clipId: string, fn: () => void): () => void {
	let set = clipRedraws.get(clipId);
	if (!set) {
		set = new Set();
		clipRedraws.set(clipId, set);
	}
	set.add(fn);
	return () => {
		const current = clipRedraws.get(clipId);
		current?.delete(fn);
		if (current?.size === 0) clipRedraws.delete(clipId);
	};
}

/**
 * Clips moved without a re-render (a ripple, see moveShiftedClips) whose visible part changed: their
 * waveforms measure and draw again. A clip that stays fully on screen (or off it) needs nothing: every
 * waveform measuring after each delete/undo cost ~7 ms with 260 clips on screen.
 */
export function notifyClipsMoved(clipIds: readonly string[]): void {
	for (const id of clipIds) {
		const set = clipRedraws.get(id);
		if (set) for (const fn of set) fn();
	}
}

export function subscribeLivePixelsPerSecond(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}
