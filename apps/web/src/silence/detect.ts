// What «Убрать паузы» cuts: silences longer than the threshold and the "э / мм" hesitations.
// Cuts stay inside the silence with a little air left on both sides, so seams join two quiet
// stretches (no clicks, breaths are not chopped mid-way) and no word is ever touched.
// Pure (seconds in, seconds out) — the timeline edit is in ./remove.ts.

export interface TimedWord {
	text: string;
	start: number;
	end: number;
}

export interface Span {
	start: number;
	end: number;
}

export interface Cut extends Span {
	kind: "pause" | "filler";
	/** The filler word, for the list. */
	text?: string;
}

export interface CutOptions {
	/** Silences longer than this are shortened (seconds). */
	minPause?: number;
	/** Air kept on each side of a cut pause (seconds). */
	keep?: number;
	/** Also cut «э», «мм», «эм»… */
	fillers?: boolean;
}

export const DEFAULT_MIN_PAUSE = 0.35;
const DEFAULT_KEEP = 0.08;
const MIN_CUT = 0.1;
/** Never cut closer than this to a recognized word. */
const WORD_GUARD = 0.04;

/** Hesitations only — words that never carry meaning. «Ну», «типа», «короче» are left to the user. */
const FILLERS = new Set([
	"э", "ээ", "эээ", "ээээ", "эм", "эмм", "эммм", "мм", "ммм", "мммм", "хм", "хмм", "а-а", "э-э", "э-э-э", "м-м",
	"uh", "uhh", "um", "umm", "erm", "hmm", "mm", "mmm", "ah", "eh",
]);

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, "").replace(/^-+|-+$/g, "");

export function isFiller(word: string): boolean {
	return FILLERS.has(bare(word));
}

/** `spans` minus `holes` (both sorted or not), dropping leftovers shorter than `min`. */
function subtract(span: Span, holes: Span[], min: number): Span[] {
	let pieces: Span[] = [{ ...span }];
	for (const h of holes) {
		const next: Span[] = [];
		for (const p of pieces) {
			if (h.end <= p.start || h.start >= p.end) {
				next.push(p);
				continue;
			}
			if (h.start > p.start) next.push({ start: p.start, end: h.start });
			if (h.end < p.end) next.push({ start: h.end, end: p.end });
		}
		pieces = next;
	}
	return pieces.filter((p) => p.end - p.start >= min);
}

export function findCuts({
	words,
	speech,
	duration,
	minPause = DEFAULT_MIN_PAUSE,
	keep = DEFAULT_KEEP,
	fillers = true,
}: { words: TimedWord[]; speech: Span[]; duration: number } & CutOptions): Cut[] {
	const islands = [...speech].sort((a, b) => a.start - b.start);
	if (islands.length === 0) return [];
	const fillerWords = fillers ? words.filter((w) => isFiller(w.text)) : [];
	const kept = words.filter((w) => !fillerWords.includes(w));
	const guards = kept.map((w) => ({ start: w.start - WORD_GUARD, end: w.end + WORD_GUARD }));

	const cuts: Cut[] = [];
	// Silences: before the first island, between islands, after the last one.
	const gaps: Span[] = [];
	gaps.push({ start: 0, end: islands[0].start });
	for (let i = 1; i < islands.length; i++) gaps.push({ start: islands[i - 1].end, end: islands[i].start });
	gaps.push({ start: islands[islands.length - 1].end, end: duration });
	for (const g of gaps) {
		if (g.end - g.start <= minPause) continue;
		// The very start and end of the video keep no air before the first / after the last word.
		const lead = g.start <= 0.001 ? 0 : keep;
		const tail = g.end >= duration - 0.001 ? 0 : keep;
		const span = { start: g.start + lead, end: g.end - tail };
		for (const p of subtract(span, guards, MIN_CUT)) cuts.push({ ...p, kind: "pause" });
	}

	// Fillers: the word plus the silence around it, if it stands alone between pauses.
	for (const w of fillerWords) {
		let start = w.start;
		let end = w.end;
		const before = gaps.find((g) => g.end >= w.start - 0.15 && g.end <= w.start + 0.15);
		const after = gaps.find((g) => g.start >= w.end - 0.15 && g.start <= w.end + 0.15);
		if (before) start = Math.min(start, Math.max(before.start + keep, before.end - 0.02));
		if (after) end = Math.max(end, Math.min(after.end - keep, after.start + 0.02));
		for (const p of subtract({ start, end }, guards, 0.05)) cuts.push({ ...p, kind: "filler", text: w.text });
	}

	return mergeCuts(cuts, duration);
}

/** Sorted, non-overlapping; a filler swallowed by a pause keeps its label. */
export function mergeCuts(cuts: Cut[], duration: number): Cut[] {
	const sorted = cuts
		.map((c) => ({ ...c, start: Math.max(0, c.start), end: Math.min(duration, c.end) }))
		.filter((c) => c.end - c.start > 0.001)
		.sort((a, b) => a.start - b.start);
	const out: Cut[] = [];
	for (const c of sorted) {
		const last = out[out.length - 1];
		if (last && c.start <= last.end + 0.02) {
			last.end = Math.max(last.end, c.end);
			if (c.kind === "filler") {
				last.kind = "filler";
				last.text = last.text ?? c.text;
			}
		} else {
			out.push({ ...c });
		}
	}
	return out;
}

export function totalLength(cuts: Span[]): number {
	return cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
}
