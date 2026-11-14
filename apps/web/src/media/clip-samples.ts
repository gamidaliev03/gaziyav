// Where a clip's sound lands in a mix, in whole samples (media/audio.ts). Counted from the clip's tick times, so two
// clips that touch on the timeline (one ends at the tick where the next starts) touch in the mix too: no sample is
// written by both, none by neither. The mix used to start a clip at floor(start × rate) and give it ceil(length × rate)
// samples: 6.4333… s × 48 kHz is 308800.00000000006 in floating point, so the first clip of a split took one sample of
// the next and that sample was summed twice — a click at every other cut, at every frame rate (pro-heavy, 09.11).

/** The timeline's ticks per second (@/wasm TICKS_PER_SECOND; kept here so this stays free of the wasm module). */
const TICKS_PER_SECOND = 120_000;

/** The output samples `[start, start + length)` of a clip at `startTime` lasting `duration` (seconds of the timeline). */
export function clipSampleSpan({ startTime, duration }: { startTime: number; duration: number }, sampleRate: number): { start: number; length: number } {
	const startTicks = Math.round(startTime * TICKS_PER_SECOND);
	const endTicks = startTicks + Math.round(duration * TICKS_PER_SECOND);
	const start = Math.round((startTicks * sampleRate) / TICKS_PER_SECOND);
	const end = Math.round((endTicks * sampleRate) / TICKS_PER_SECOND);
	return { start, length: Math.max(0, end - start) };
}

/**
 * The clip's own time (s) at output sample `start + i`: measured from the clip's exact start, not from the sample it was
 * rounded to, so the two halves of a split play the source on without a seam (never below 0).
 */
export function clipTimeAtSample(span: { start: number }, startTime: number, i: number, sampleRate: number): number {
	return Math.max(0, (span.start + i) / sampleRate - startTime);
}
