// What to do when the speech and the video piece differ in length — chosen before paying.
// "trim" (lipa, 14.11, the lead's decision): new words replace the clip's speech — the clip takes the voice's length, the
// rest of it is trimmed off (one ⌘Z), so nothing of the old words is heard after the new line. The server sends the
// same piece as "loop" (as long as the speech); the difference is how the result lands (actions.ts completeLipsync).
export type FitChoice = "trim" | "extend" | "speed" | "loop" | "pad" | "pingpong" | "freeze" | "cut";

export interface FitOption {
	id: FitChoice;
	/** English source (the key of its Russian line). */
	label: string;
	hint: string;
	/** Values for the hint's {placeholders} (seconds already formatted by the caller's `sec`). */
	vars?: Record<string, number>;
}

const MAX_SPEEDUP = 1.25;
const MAX_SLOWDOWN = 0.8;
/** Differences below this are invisible: no choice needed. */
export const FIT_TOLERANCE = 0.4;

/**
 * Choices for this speech/piece pair, best first; null when the lengths already match.
 * `room` = seconds of the same footage available right after the piece (for "use more video").
 * `newWords`: the sound is new words (typed, a file) — they replace the clip's speech by default; a sound that already
 * lies under the clip keeps the clip as it is.
 */
export function fitOptions(speech: number, video: number, room: number, newWords = true): FitOption[] | null {
	if (!(speech > 0) || !(video > 0) || Math.abs(speech - video) <= FIT_TOLERANCE) return null;
	const factor = speech / video;
	const out: FitOption[] = [];
	if (speech > video) {
		const extra = speech - video;
		// The video is made as long as the speech before it is sent: looped, played forward and back, or held on its
		// last frame; or the speech is cut to the video. The result is longer: Where (replace / insert) decides what moves.
		// ping-pong first (the lead, 14.11): a loop's jump is visible, the lips are redrawn either way
		out.push({ id: "pingpong", label: "Ping-pong the video", hint: "forward and back · no jump" });
		out.push({ id: "loop", label: "Loop the video", hint: "+{a} · a jump at each loop", vars: { a: extra } });
		out.push({ id: "freeze", label: "Hold the last frame", hint: "+{a} still", vars: { a: extra } });
		out.push({ id: "cut", label: "Cut the voice", hint: "to {a}", vars: { a: video } });
		if (factor <= MAX_SPEEDUP) out.push({ id: "speed", label: "Speed up voice", hint: "{n}% faster", vars: { n: Math.round((factor - 1) * 100) } });
		if (room >= extra - 0.05) out.push({ id: "extend", label: "Use more video", hint: "+{a} of the clip", vars: { a: extra } });
	} else {
		const trim: FitOption = { id: "trim", label: "Clip to the voice's length", hint: "{a} of {b} · the rest trimmed", vars: { a: speech, b: video } };
		const piece: FitOption = { id: "loop", label: "Only a piece, the rest stays", hint: "{a} of {b} · old words after", vars: { a: speech, b: video } };
		if (newWords) out.push(trim, piece);
		else out.push(piece, trim);
		out.push({ id: "pad", label: "Whole clip", hint: "silence after {a}", vars: { a: speech } });
		if (factor >= MAX_SLOWDOWN) out.push({ id: "speed", label: "Slow down voice", hint: "{n}% slower", vars: { n: Math.round((1 - factor) * 100) } });
	}
	return out;
}

/** The user's choice if it applies to this pair, else the best option. */
export function resolveFit(choice: FitChoice | undefined, options: FitOption[] | null): FitChoice {
	if (!options) return "loop";
	return options.find((o) => o.id === choice)?.id ?? options[0].id;
}

/** What the server is asked for: "trim" sends the piece as long as the speech, as "loop" does; "extend" loops too. */
export const serverFit = (fit: FitChoice): Exclude<FitChoice, "trim" | "extend"> => (fit === "trim" || fit === "extend" ? "loop" : fit);
