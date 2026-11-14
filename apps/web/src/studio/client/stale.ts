// Stale lips (the charter's rule G, lip3): a lipsynced take remembers what it was made from — the sound the lips follow
// and the clip's span of the take — and is stale when either is different now. Pure: plain numbers in, a verdict out
// (the clip's overlay feeds it from the timeline; undo restores the timeline, so the verdict comes back by itself).

/** One sound on the timeline (seconds): where it starts, how long it lasts, where inside its file it starts. */
export interface SoundOnTimeline {
	mediaId: string;
	start: number;
	length: number;
	trimStart: number;
	muted?: boolean;
}

/** What a take was made from. `sound` is an identity string (soundUnder / soundOfFile); `span` the clip's piece of the take. */
export interface Made {
	sound: string;
	span: { start: number; end: number };
}

const r2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

/**
 * The identity of the sound that plays under a clip at `at` for `length` seconds: every audible piece overlapping it,
 * relative to the clip's start (moving the sound, trimming it, replacing it or moving the clip over it all change it;
 * moving clip and sound together does not).
 */
export function soundUnder(clip: { at: number; length: number }, sounds: readonly SoundOnTimeline[]): string {
	const end = clip.at + clip.length;
	const parts: string[] = [];
	for (const s of sounds) {
		if (s.muted || s.length <= 0) continue;
		const from = Math.max(clip.at, s.start);
		const to = Math.min(end, s.start + s.length);
		if (to - from < 0.01) continue;
		// where in its file the overlap starts: a trim of its head or a slip shows here
		parts.push(`${s.mediaId}@${r2(s.trimStart + (from - s.start))}:${r2(from - clip.at)}-${r2(to - clip.at)}`);
	}
	return `under:${parts.sort().join(",")}`;
}

/** The identity of a voice that is a file of its own (typed words voiced, a file picked): the file. */
export function soundOfFile(fileId: string | undefined): string {
	return `file:${fileId ?? ""}`;
}

/** The clip's piece of the take it shows (seconds inside the take's file). */
export function spanOf(el: { trimStart: number; length: number }): { start: number; end: number } {
	return { start: el.trimStart, end: el.trimStart + el.length };
}

/** Is the take stale? A different sound, or a span that moved by more than `tolerance` seconds (a frame by default). */
export function isStale(made: Made, now: Made, tolerance = 1 / 50): boolean {
	if (made.sound !== now.sound) return true;
	return Math.abs(made.span.start - now.span.start) > tolerance || Math.abs(made.span.end - now.span.end) > tolerance;
}
