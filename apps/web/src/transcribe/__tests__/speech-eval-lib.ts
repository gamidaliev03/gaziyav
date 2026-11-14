// Scoring for the speech measurements (manual benchmarks, not unit tests): a recogniser's words against the ground
// truth of test/media-gen/make-speech.mjs (the Mac's voices saying known sentences at known times).
export interface TruthSentence {
	text: string;
	start: number;
	end: number;
}
export interface Truth {
	name: string;
	lang: string;
	seconds: number;
	sentences: TruthSentence[];
	quiet: Array<{ kind: string; start: number; end: number }>;
}
export interface TimedWord {
	text: string;
	start: number;
	end: number;
	p?: number;
}

const ONES: Record<string, string> = {
	ноль: "0", один: "1", одна: "1", одну: "1", одной: "1", два: "2", две: "2", двух: "2", три: "3", трех: "3", четыре: "4", пять: "5", пяти: "5", шесть: "6", семь: "7", восемь: "8", девять: "9",
	десять: "10", шестнадцать: "16", двадцать: "20", двадцати: "20", тридцать: "30", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
	sixteen: "16", twenty: "20", thirty: "30",
};

/** Lower case, ё → е, no punctuation, small numerals as digits («десять» = «10»): what counts as the same word. */
export function tokens(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/ё/g, "е")
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => ONES[w] ?? w);
}

export interface Alignment {
	/** For every reference token: the hypothesis token it was matched to (−1 = lost), and whether the text is the same. */
	ref: Array<{ hyp: number; same: boolean }>;
	/** Hypothesis tokens matched to nothing: invented. */
	inserted: number[];
	errors: number;
}

/** Levenshtein alignment of reference and hypothesis tokens. */
export function align(ref: string[], hyp: string[]): Alignment {
	const n = ref.length;
	const m = hyp.length;
	const d = new Uint32Array((n + 1) * (m + 1));
	const at = (i: number, j: number) => i * (m + 1) + j;
	for (let i = 0; i <= n; i++) d[at(i, 0)] = i;
	for (let j = 0; j <= m; j++) d[at(0, j)] = j;
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			d[at(i, j)] = Math.min(d[at(i - 1, j)] + 1, d[at(i, j - 1)] + 1, d[at(i - 1, j - 1)] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
		}
	}
	const out: Alignment = { ref: new Array(n), inserted: [], errors: d[at(n, m)] };
	let i = n;
	let j = m;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && d[at(i, j)] === d[at(i - 1, j - 1)] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
			out.ref[i - 1] = { hyp: j - 1, same: ref[i - 1] === hyp[j - 1] };
			i--;
			j--;
		} else if (i > 0 && d[at(i, j)] === d[at(i - 1, j)] + 1) {
			out.ref[i - 1] = { hyp: -1, same: false };
			i--;
		} else {
			out.inserted.push(j - 1);
			j--;
		}
	}
	out.inserted.reverse();
	return out;
}

export interface Score {
	refWords: number;
	hypWords: number;
	wer: number;
	lost: number;
	wrong: number;
	invented: number;
	/** Runs of invented words (a run = one invented line), with their text and time. */
	inventedLines: Array<{ text: string; start: number; end: number }>;
	/** Rightly heard words that start more than 0.3 s outside their own sentence. */
	misplaced: number;
	misplacedMax: number;
	/** |first word's start − sentence start| and |last word's end − sentence end| over the sentences whose edge words were heard (ms). */
	startErr: number[];
	endErr: number[];
	/** Reference token → the hypothesis word's times (for drift between two engines). */
	times: Array<{ start: number; end: number } | null>;
}

const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)] : Number.NaN);
export const stats = (v: number[]) => ({ n: v.length, median: Math.round(median(v)), p90: Math.round([...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * 0.9)] ?? Number.NaN), max: v.length ? Math.round(Math.max(...v)) : Number.NaN });

/** A hypothesis word may be several tokens («слова-паразиты»): every token carries the word's times. */
export function score(truth: Truth, words: TimedWord[]): Score {
	const ref: string[] = [];
	const refSentence: number[] = [];
	const edge: Array<"first" | "last" | "both" | null> = [];
	truth.sentences.forEach((s, k) => {
		const t = tokens(s.text);
		t.forEach((w, i) => {
			ref.push(w);
			refSentence.push(k);
			edge.push(t.length === 1 ? "both" : i === 0 ? "first" : i === t.length - 1 ? "last" : null);
		});
	});
	const hyp: string[] = [];
	const hypWord: number[] = [];
	words.forEach((w, k) => {
		for (const t of tokens(w.text)) {
			hyp.push(t);
			hypWord.push(k);
		}
	});
	const a = align(ref, hyp);
	let lost = 0;
	let wrong = 0;
	let misplaced = 0;
	let misplacedMax = 0;
	const startErr: number[] = [];
	const endErr: number[] = [];
	const times: Score["times"] = [];
	a.ref.forEach((r, i) => {
		if (r.hyp < 0) {
			lost++;
			times.push(null);
			return;
		}
		if (!r.same) wrong++;
		const w = words[hypWord[r.hyp]];
		times.push(r.same ? { start: w.start, end: w.end } : null);
		if (!r.same) return;
		const s = truth.sentences[refSentence[i]];
		const off = Math.max(s.start - w.start, w.start - s.end, 0);
		if (off > 0.3) {
			misplaced++;
			misplacedMax = Math.max(misplacedMax, off);
		}
		if (edge[i] === "first" || edge[i] === "both") startErr.push(Math.abs(w.start - s.start) * 1000);
		if (edge[i] === "last" || edge[i] === "both") endErr.push(Math.abs(w.end - s.end) * 1000);
	});
	// invented words → lines: neighbours in the hypothesis, the same word counted once
	const inventedWords = [...new Set(a.inserted.map((j) => hypWord[j]))].sort((x, y) => x - y);
	const inventedLines: Score["inventedLines"] = [];
	let run: number[] = [];
	const flush = () => {
		if (!run.length) return;
		inventedLines.push({ text: run.map((k) => words[k].text).join(" "), start: words[run[0]].start, end: words[run[run.length - 1]].end });
		run = [];
	};
	for (const k of inventedWords) {
		if (run.length && k !== run[run.length - 1] + 1) flush();
		run.push(k);
	}
	flush();
	return {
		refWords: ref.length,
		hypWords: hyp.length,
		wer: ref.length ? a.errors / ref.length : 0,
		lost,
		wrong,
		invented: a.inserted.length,
		inventedLines,
		misplaced,
		misplacedMax: Math.round(misplacedMax * 1000) / 1000,
		startErr,
		endErr,
		times,
	};
}

/** |start| and |end| differences (ms) of the reference words both engines heard. */
export function drift(a: Score, b: Score): { start: number[]; end: number[] } {
	const start: number[] = [];
	const end: number[] = [];
	a.times.forEach((x, i) => {
		const y = b.times[i];
		if (!x || !y) return;
		start.push(Math.abs(x.start - y.start) * 1000);
		end.push(Math.abs(x.end - y.end) * 1000);
	});
	return { start, end };
}
