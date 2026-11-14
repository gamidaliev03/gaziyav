// Windows for a recogniser that hears a short stretch at once (the Russian engine: 25 s). The sound is cut at the
// pauses we already know (align.ts speechIslands), a long stretch without a pause at its quietest moment; silence
// between the windows is never given to the engine. And the other way round: where the engine's own word times show a
// pause, that pause is one — the words are laid window by window, never spread over the music between two phrases.
// Pure functions: shared by the server job, the benchmark and the unit tests.
import type { Span } from "./align";

const FRAME = 0.01;

/** The quietest moment of [from, to]: the middle of the 0.2 s with the lowest level (a breath between two words). */
function quietest(levels: Float32Array, from: number, to: number): number {
	const a = Math.max(0, Math.round(from / FRAME));
	const b = Math.min(levels.length, Math.round(to / FRAME));
	const span = 20;
	if (b - a <= span) return (from + to) / 2;
	let sum = 0;
	for (let f = a; f < a + span; f++) sum += levels[f];
	let best = sum;
	let at = a;
	for (let f = a + 1; f + span <= b; f++) {
		sum += levels[f + span - 1] - levels[f - 1];
		if (sum < best) {
			best = sum;
			at = f;
		}
	}
	return (at + span / 2) * FRAME;
}

/**
 * The stretches of sound as windows of at most `max` seconds. Neighbouring stretches go into one window while it
 * stays under `fill` (the engine hears a phrase with its neighbours: fewer cold starts, steadier words); `pad` of
 * silence is kept around each window. A stretch longer than a window (speech over a music bed never pauses in
 * loudness) is cut at its quietest moment between `fill` and `max`.
 */
export function speechWindows(islands: Span[], levels: Float32Array, seconds: number, { max = 25, fill = 20, pad = 0.2 }: { max?: number; fill?: number; pad?: number } = {}): Span[] {
	const room = max - 2 * pad;
	// 1. no piece longer than a window
	const pieces: Span[] = [];
	for (const island of islands) {
		let start = island.start;
		while (island.end - start > room) {
			const cut = quietest(levels, start + Math.min(fill, room) - 2 * pad - 5, start + room);
			pieces.push({ start, end: cut });
			start = cut;
		}
		if (island.end - start > 0.02) pieces.push({ start, end: island.end });
	}
	// 2. neighbours together while the window stays under `fill`
	const windows: Span[] = [];
	for (const piece of pieces) {
		const last = windows[windows.length - 1];
		if (last && piece.end - last.start <= fill - 2 * pad) last.end = piece.end;
		else windows.push({ ...piece });
	}
	// 3. a little silence around each, never into the neighbour
	return windows.map((w, i) => {
		const before = i > 0 ? (windows[i - 1].end + w.start) / 2 : 0;
		const after = i + 1 < windows.length ? (w.end + windows[i + 1].start) / 2 : seconds;
		return { start: Math.round(Math.max(before, w.start - pad, 0) * 1000) / 1000, end: Math.round(Math.min(after, w.end + pad, seconds) * 1000) / 1000 };
	});
}

interface Timed {
	start: number;
	end: number;
}

/**
 * Where the voice is, from the engine's own word times (it marks every word where it hears it, to a few hundredths
 * of a second): words less than `pause` apart are one stretch, with `edge` around it. For vad.ts voicedIslands.
 */
export function zonesOfWords(words: Timed[], { pause = 0.35, edge = 0.12 }: { pause?: number; edge?: number } = {}): Span[] {
	const round = (t: number) => Math.round(t * 1000) / 1000;
	const out: Span[] = [];
	for (const w of words) {
		const last = out[out.length - 1];
		if (last && w.start - edge - last.end < pause - 2 * edge) last.end = Math.max(last.end, round(w.end + edge));
		else out.push({ start: round(Math.max(0, w.start - edge)), end: round(w.end + edge) });
	}
	return out;
}
