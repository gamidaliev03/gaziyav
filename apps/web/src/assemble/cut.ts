// The first cut of a talking clip, by its words: which source seconds stay. Each kind of removal is its own switch so
// «Undo this step» can take one back and keep the others: earlier tries of a sentence said again (the last take stays),
// pauses over the speaker's own, filler words, and a length limit (the weakest sentences go first). Every edge is the
// word-edge rule of production/plan.ts (startCut / endCut): in the pause, never inside a word. Pure.
import { CUT_RULES } from "@/hear/cuts";
import { isFillerWord, type SpeechBrief, type Word } from "@/production/material";
import { endCut, startCut } from "@/production/plan";

export interface CutFlags {
	repeats: boolean;
	pauses: boolean;
	fillers: boolean;
	/** Cut pauses down to the clean-silence rule (0.4 s) instead of the speaker's own rhythm. */
	tight?: boolean;
	/** Keep about this many seconds: the weakest sentences go, the rest stay in the order said. */
	limit?: number;
}

export interface CutStats {
	repeats: number;
	repeatSeconds: number;
	pauses: number;
	pauseSeconds: number;
	fillers: number;
	fillerSeconds: number;
	dropped: number;
	droppedSeconds: number;
	kept: number;
}

export interface CutResult {
	ranges: Array<[number, number]>;
	stats: CutStats;
	/** Sentence indices that stay (in the brief's numbering). */
	sentences: number[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const sum = (ranges: Array<[number, number]>) => ranges.reduce((s, [a, b]) => s + (b - a), 0);

/** Only real pauses are touched: 0.5 s and longer (0.75 s or the speaker's own slow rhythm when not tightened). */
export function maxPauseOf(sp: Pick<SpeechBrief, "pause">, tight = false): number {
	const floor = Math.max(0.5, CUT_RULES.cleanSilence);
	return tight ? floor : Math.max(0.75, floor, (sp.pause || 0.3) * 2.2);
}

/** Breath room at every cut: at least 0.10 s before speech and 0.15 s after it, never into a neighbouring word. */
export const ROOM_BEFORE = 0.1;
export const ROOM_AFTER = 0.15;

function core(sp: SpeechBrief, seconds: number, flags: CutFlags, isFiller: (w: string) => boolean, gone: Set<number>): CutResult {
	const words = sp.words;
	const cuts = sp.cuts ?? [];
	const stats: CutStats = { repeats: 0, repeatSeconds: 0, pauses: 0, pauseSeconds: 0, fillers: 0, fillerSeconds: 0, dropped: 0, droppedSeconds: 0, kept: 0 };
	const sentenceOf = (w: Word) => sp.sentences.find((s) => w.start >= s.from - 0.01 && w.end <= s.to + 0.01);
	const retake = new Set(flags.repeats ? sp.sentences.filter((s) => s.retake).map((s) => s.i) : []);
	const why = (w: Word): "repeat" | "filler" | "dropped" | null => {
		const s = sentenceOf(w);
		if (s && retake.has(s.i)) return "repeat";
		if (s && gone.has(s.i)) return "dropped";
		if (flags.fillers && isFiller(w.text)) return "filler";
		return null;
	};
	const maxPause = maxPauseOf(sp, flags.tight);
	const next = (w: Word) => words.find((x) => x.start >= w.end - 1e-6 && x !== w)?.start ?? Number.POSITIVE_INFINITY;
	const prevEnd = (w: Word) => {
		let e = Number.NEGATIVE_INFINITY;
		for (const x of words) if (x !== w && x.end <= w.start + 1e-6) e = Math.max(e, x.end);
		return e;
	};
	const tail = (w: Word) => Math.max(endCut(cuts, w.end, words), Math.min(w.end + ROOM_AFTER, next(w) - 0.02));
	const head = (w: Word) => Math.max(0, Math.min(startCut(cuts, w.start, words), Math.max(w.start - ROOM_BEFORE, prevEnd(w) + 0.02)));
	const ranges: Array<[number, number]> = [];
	let open: number | null = null;
	let prev: Word | null = null;
	let removed: Set<"repeat" | "filler" | "dropped"> = new Set();
	const count = (kinds: Set<string>, seconds: number) => {
		// a removed stretch counts once for each reason in it; its seconds go to the strongest reason
		if (kinds.has("repeat")) stats.repeats++;
		if (kinds.has("dropped")) stats.dropped++;
		if (kinds.has("filler")) stats.fillers++;
		if (kinds.has("repeat")) stats.repeatSeconds += seconds;
		else if (kinds.has("dropped")) stats.droppedSeconds += seconds;
		else stats.fillerSeconds += seconds;
	};
	const kept = new Set<number>();
	for (const w of words) {
		const reason = why(w);
		if (reason) {
			removed.add(reason);
			continue;
		}
		const s = sentenceOf(w);
		if (s) kept.add(s.i);
		if (open === null) {
			// the first word: the lead-in before it stays unless pauses are cut (or something before it was removed)
			open = flags.pauses || removed.size ? head(w) : 0;
			if (removed.size) count(removed, open);
		} else if (prev) {
			const gap = w.start - prev.end;
			if (removed.size || (flags.pauses && gap > maxPause)) {
				const end = tail(prev);
				const start = head(w);
				if (start > end + 0.02) {
					ranges.push([open, end]);
					open = start;
					if (removed.size) count(removed, start - end);
					else {
						stats.pauses++;
						stats.pauseSeconds += start - end;
					}
				}
			}
		}
		removed = new Set();
		prev = w;
	}
	if (open !== null && prev) {
		const end = flags.pauses || removed.size ? Math.min(seconds || Number.POSITIVE_INFINITY, tail(prev)) : seconds || prev.end + 0.5;
		ranges.push([open, Math.max(open + 0.1, end)]);
		if (removed.size) count(removed, Math.max(0, (seconds || end) - end));
	}
	for (const k of ["repeatSeconds", "pauseSeconds", "fillerSeconds", "droppedSeconds"] as const) stats[k] = r3(stats[k]);
	stats.kept = r3(sum(ranges));
	return { ranges: ranges.map(([a, b]) => [r3(a), r3(b)] as [number, number]), stats, sentences: [...kept].sort((a, b) => a - b) };
}

/** The ranges of one talking clip that stay, and what each switch took out. */
export function cutRanges(sp: SpeechBrief, seconds: number, flags: CutFlags, isFiller: (w: string) => boolean): CutResult {
	const first = core(sp, seconds, flags, isFiller, new Set());
	if (!flags.limit || first.stats.kept <= flags.limit) return first;
	// Over the length: the weakest sentences go (lowest hook score first), the order said stays.
	const gone = new Set<number>();
	const pool = sp.sentences.filter((s) => first.sentences.includes(s.i)).sort((a, b) => a.hook - b.hook || b.to - b.from - (a.to - a.from));
	let kept = first.stats.kept;
	for (const s of pool) {
		if (kept <= flags.limit) break;
		gone.add(s.i);
		kept -= s.to - s.from + 0.2;
	}
	return core(sp, seconds, flags, isFiller, gone);
}

/**
 * A filler as whisper writes it: «Э-э-э,», «Ээээ», «Мм», «Um» — the shared list (material.ts isFillerWord) plus the
 * drawn-out hesitations it spells with hyphens and repeated letters.
 */
export function isFiller(word: string): boolean {
	if (isFillerWord(word)) return true;
	const w = word.toLowerCase().replace(/[^\p{L}]/gu, "");
	return /^(э+|э+м+|м+|ам+|у+м+|у+х*|а+|хм+|uh+|um+|hm+|erm+)$/u.test(w) && w.length >= 1 && !/^(а|у)$/u.test(w);
}

/** m:ss of a number of seconds (the strip's «−3:12»). */
export function clock(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
