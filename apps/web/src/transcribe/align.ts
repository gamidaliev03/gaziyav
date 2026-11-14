// Word timings that match the sound. Whisper's word starts run ~0.3–0.5 s early (worst right after a pause),
// and it glues pauses onto neighbouring words: karaoke captions light up before the word is said and filler
// cuts miss. We find where speech actually is (frame energy), match every pause to a word boundary (dynamic
// programming) and lay the words between pauses over the real speech.
// Pure functions: shared by the server job and the unit tests.

export interface Word {
	text: string;
	/** Seconds. */
	start: number;
	end: number;
	/** Whisper's confidence 0…1 (full JSON output), when known. */
	p?: number;
}

export interface Span {
	start: number;
	end: number;
}

export const FRAME = 0.01;

/** RMS loudness of every 10 ms frame, in dB (silence ≈ -100). */
export function frameLevels(samples: Int16Array, sampleRate: number): Float32Array {
	const hop = Math.max(1, Math.round(sampleRate * FRAME));
	const n = Math.floor(samples.length / hop);
	const out = new Float32Array(n);
	for (let f = 0; f < n; f++) {
		let sum = 0;
		const base = f * hop;
		for (let i = 0; i < hop; i++) {
			const v = samples[base + i] / 32768;
			sum += v * v;
		}
		out[f] = 10 * Math.log10(sum / hop + 1e-10);
	}
	return out;
}

function percentile(values: Float32Array, p: number): number {
	if (values.length === 0) return -100;
	const sorted = Float32Array.from(values).sort();
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/**
 * Stretches of sound loud enough to be speech. Gaps shorter than `bridge` (stop consonants, breaths
 * inside a phrase) are bridged; blips shorter than `minIsland` (clicks) are dropped.
 */
export function speechIslands(
	levels: Float32Array,
	{ bridge = 0.12, minIsland = 0.06 }: { bridge?: number; minIsland?: number } = {},
): Span[] {
	if (levels.length === 0) return [];
	const floor = Math.max(-90, percentile(levels, 0.1));
	const loud = percentile(levels, 0.95);
	const threshold = Math.max(floor + 8, loud - 32);
	const raw: Span[] = [];
	let open = -1;
	for (let f = 0; f <= levels.length; f++) {
		const on = f < levels.length && levels[f] > threshold;
		if (on && open < 0) open = f;
		if (!on && open >= 0) {
			raw.push({ start: open * FRAME, end: f * FRAME });
			open = -1;
		}
	}
	const merged: Span[] = [];
	for (const s of raw) {
		const last = merged[merged.length - 1];
		if (last && s.start - last.end < bridge) last.end = s.end;
		else merged.push({ ...s });
	}
	return merged.filter((s) => s.end - s.start >= minIsland);
}

/** Island settings that keep the short gaps between words (for word-boundary matching). */
export const FINE = { bridge: 0.035, minIsland: 0.02 };

/** Index of the island containing t, or -1. Islands are sorted. */
function islandAt(islands: Span[], t: number): number {
	let lo = 0;
	let hi = islands.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (t < islands[mid].start) hi = mid - 1;
		else if (t >= islands[mid].end) lo = mid + 1;
		else return mid;
	}
	return -1;
}

/** First island starting at or after t. */
function nextIsland(islands: Span[], t: number): number {
	let lo = 0;
	let hi = islands.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (islands[mid].start < t) lo = mid + 1;
		else hi = mid;
	}
	return lo < islands.length ? lo : -1;
}


/** Silences long enough to be a pause between phrases. */
const MIN_GAP = 0.15;
/** Short silences between words (may also be a stop consonant inside a word, so they are cheap to ignore). */
const MIN_MICRO_GAP = 0.04;
/** How far Whisper's boundary may sit from the pause it belongs to. */
const SEARCH = 1.6;

const endsClause = (w: string) => /[.!?…;:,—–]["»”)]*$/.test(w.trim());
const weight = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").length + 2;
/**
 * A word's share of the time by what it takes to say: a digit is said in five letters or so («2026» — «две тысячи
 * двадцать шестом», «twenty twenty-six»), a per cent sign in eight. By letters alone a phone number got a fifth of its
 * time and the words before it were laid half a second late (11.11, the captions stick, numbers-ru).
 */
const spokenWeight = (w: string) => weight(w) + 5 * (w.match(/\p{N}/gu)?.length ?? 0) + 8 * (w.match(/%/g)?.length ?? 0);

/** How the words are laid when the speech detector told where the voice is (transcribe/server/listen.ts). */
export interface AlignOptions {
	/**
	 * A long pause (a second or more: music between two phrases) is taken at a clause end rather than inside a clause,
	 * whatever Whisper's times say there — with the detector Whisper hears the voiced stretches joined by a tenth of a
	 * second of silence, and a word at that seam gets a time anywhere in the music between («…socks hidden | inside.»,
	 * 12 s of music, «inside.» shown after the music). Numbers weigh what they take to say (spokenWeight). A stretch
	 * longer than LONG_SPAN is laid clause by clause (spread).
	 */
	detector?: boolean;
}


interface Anchor {
	/** Word index that starts right after the pause. */
	k: number;
	gap: Span;
}

/**
 * Which word boundary each pause belongs to. Whisper glues pauses onto neighbouring words (its words are
 * contiguous) and runs early, so every real pause is matched to the nearest plausible boundary — monotonic,
 * preferring boundaries after punctuation — with dynamic programming. A pause may stay unmatched
 * (a silence inside a word), at a price that grows with its length.
 */
function matchPauses(words: Word[], gaps: Span[], microReach: number, detector = false): Anchor[] {
	type State = { k: number; cost: number; prev: State | null; gap: Span | null };
	let states: State[] = [{ k: 0, cost: 0, prev: null, gap: null }];
	let lowK = 1;
	for (const gap of gaps) {
		const len = gap.end - gap.start;
		const skip = len >= MIN_GAP ? 0.35 + 1.5 * len : 0.06 + len;
		const reach = len >= MIN_GAP ? SEARCH : microReach;
		const next: State[] = states.map((s) => ({ ...s, cost: s.cost + skip }));
		while (lowK < words.length && Math.max(words[lowK - 1].end, words[lowK].start) < gap.start - SEARCH) lowK++;
		const micro = len < MIN_GAP;
		for (let k = lowK; k < words.length; k++) {
			const b0 = words[k - 1].end;
			const b1 = words[k].start;
			const lo = Math.min(b0, b1);
			const hi = Math.max(b0, b1);
			if (lo > gap.end + SEARCH) break;
			const dist = hi < gap.start ? gap.start - hi : lo > gap.end ? lo - gap.end : 0;
			if (dist > reach) continue;
			// Whisper runs early: a boundary after the pause is less likely than one before it.
			const late = lo > gap.end ? 0.15 : 0;
			const cost = dist + late + (endsClause(words[k - 1].text) ? 0 : micro ? 0.03 : detector && len >= 0.3 ? (len >= 1 ? 1 : 0.3) : 0.2);
			let best: State | null = null;
			for (const s of states) if (s.k < k && (!best || s.cost < best.cost)) best = s;
			if (best) next.push({ k, cost: best.cost + cost, prev: best, gap });
		}
		const byK = new Map<number, State>();
		for (const s of next) {
			const cur = byK.get(s.k);
			if (!cur || s.cost < cur.cost) byK.set(s.k, s);
		}
		states = [...byK.values()].sort((a, b) => a.cost - b.cost).slice(0, 64);
	}
	let best = states[0];
	for (const s of states) if (s.cost < best.cost) best = s;
	const anchors: Anchor[] = [];
	for (let s: State | null = best; s?.gap; s = s.prev) anchors.push({ k: s.k, gap: s.gap });
	return anchors.reverse();
}

/** Whisper's own word proportions are unreliable (they absorb pauses); word length carries most of the weight. */
const WHISPER_SHARE = 0.1;

/**
 * A stretch between two pauses longer than this, with the speech detector, is a voice under a bed that hides its
 * pauses (or a run of sentences with breaths too short to see): laid by word length the error grows with every
 * sentence — a second and more by the end of twenty seconds (11.11, the captions stick). Whisper's own times are good to
 * a few tenths of a second there once its lead is taken back (WHISPER_LEAD), so they are kept, inside the stretch.
 */
const LONG_SPAN = 6;
/** How early Whisper's own word times run (11.11, the captions stick, 26 clips: −0.18 … −0.34 s, median −0.28). */
const WHISPER_LEAD = 0.28;

/** Lays words [from, to) over [t0, t1] (see LONG_SPAN). */
function spread(out: Word[], words: Word[], from: number, to: number, t0: number, t1: number, detector = false, first = true) {
	if (to <= from) return;
	if (detector && t1 - t0 > LONG_SPAN && to - from > 2) {
		// (the later passes get words already laid: the lead is taken back once)
		const lead = first ? WHISPER_LEAD : 0;
		const at = (t: number) => Math.min(t1, Math.max(t0, t + lead));
		for (let i = from; i < to; i++) {
			const w = words[i];
			out[i] = { text: w.text, start: at(w.start), end: at(w.end), ...(w.p !== undefined ? { p: w.p } : {}) };
		}
		out[from].start = t0;
		return;
	}
	lay(out, words, from, to, t0, t1, detector ? spokenWeight : weight);
}

/** Lays words [from, to) over [t0, t1], mostly in proportion to word length. */
function lay(out: Word[], words: Word[], from: number, to: number, t0: number, t1: number, weigh: (w: string) => number) {
	if (to <= from) return;
	const span = Math.max(0.02 * (to - from), t1 - t0);
	const w0 = words[from].start;
	const w1 = words[to - 1].end;
	const wSpan = Math.max(1e-3, w1 - w0);
	let total = 0;
	for (let i = from; i < to; i++) total += weigh(words[i].text);
	let acc = 0;
	for (let i = from; i < to; i++) {
		const a = (words[i].start - w0) / wSpan;
		const b = (words[i].end - w0) / wSpan;
		const ca = acc / total;
		acc += weigh(words[i].text);
		const cb = acc / total;
		const m = WHISPER_SHARE;
		out[i] = { text: words[i].text, start: t0 + span * (a * m + ca * (1 - m)), end: t0 + span * (b * m + cb * (1 - m)), ...(words[i].p !== undefined ? { p: words[i].p } : {}) };
	}
}

/** Moves Whisper's words onto the speech that is actually in the audio. */
export function alignWords(input: Word[], islands: Span[], fine: Span[] = islands, { detector = false }: AlignOptions = {}): Word[] {
	const words = input.filter((w) => w.text.trim()).map((w) => ({ ...w }));
	if (words.length === 0 || islands.length === 0) return words;
	const gapsOf = (spans: Span[], min: number) => {
		const gaps: Span[] = [];
		for (let i = 1; i < spans.length; i++) {
			if (spans[i].start - spans[i - 1].end >= min) gaps.push({ start: spans[i - 1].end, end: spans[i].start });
		}
		return gaps;
	};
	// Pass 1: phrase pauses fix Whisper's big drift. Pass 2: from those better times, the short gaps
	// between words (searched close by only) pin the words inside phrases.
	const coarse = alignPass(words, islands, gapsOf(islands, MIN_GAP), 0, detector);
	const micro = gapsOf(fine, MIN_MICRO_GAP);
	let result = coarse;
	for (const reach of [0.3, 0.2, 0.15, 0.1]) result = alignPass(result, islands, micro, reach, detector);
	return result;
}

function alignPass(words: Word[], islands: Span[], gaps: Span[], microReach: number, detector = false): Word[] {
	const anchors = matchPauses(words, gaps, microReach, detector);
	const out: Word[] = new Array(words.length);
	const firstWord = words[0];
	const lastWord = words[words.length - 1];
	const first = islands.find((s) => s.end > firstWord.start - SEARCH) ?? islands[0];
	let last = islands[islands.length - 1];
	for (let i = islands.length - 1; i >= 0; i--) {
		if (islands[i].start < lastWord.end + SEARCH) {
			last = islands[i];
			break;
		}
	}
	let from = 0;
	let t0 = Math.abs(first.start - firstWord.start) < SEARCH ? first.start : firstWord.start;
	for (const a of anchors) {
		spread(out, words, from, a.k, t0, a.gap.start, detector, microReach === 0);
		from = a.k;
		t0 = a.gap.end;
	}
	const tEnd = Math.abs(last.end - lastWord.end) < SEARCH ? last.end : lastWord.end;
	spread(out, words, from, words.length, t0, Math.max(t0 + 0.05, tEnd), detector, microReach === 0);
	for (let i = 1; i < out.length; i++) {
		if (out[i].start < out[i - 1].start + 0.02) out[i].start = out[i - 1].start + 0.02;
		if (out[i - 1].end > out[i].start) out[i - 1].end = out[i].start;
	}
	for (const w of out) {
		w.start = Math.round(w.start * 1000) / 1000;
		w.end = Math.round(Math.max(w.start + 0.04, w.end) * 1000) / 1000;
	}
	return out;
}

/** Whisper's well-known inventions on silence or music (credits of subtitle groups, "продолжение следует"). */
const HALLUCINATIONS = [
	/субтитры (?:сделал|делал|создавал|подготовил|создал)[\p{L}]*(?: [\p{L}.]+)?/giu,
	/редактор субтитров(?: [\p{L}.]+){0,2}/giu,
	/корректор(?: [\p{L}.]+){0,2}/giu,
	/продолжение следует[.…]*/giu,
	/dimatorzok/giu,
	/amara\.org/giu,
];

function phantomIndexes(words: Word[]): Set<number> {
	const drop = new Set<number>();
	let text = "";
	const starts: number[] = [];
	for (const w of words) {
		starts.push(text.length);
		text += `${w.text.trim()} `;
	}
	for (const pattern of HALLUCINATIONS) {
		for (const m of text.matchAll(pattern)) {
			const from = m.index ?? 0;
			const to = from + m[0].length;
			for (let i = 0; i < words.length; i++) {
				const s = starts[i];
				const e = s + words[i].text.trim().length;
				if (e > from && s < to) drop.add(i);
			}
		}
	}
	return drop;
}

/** Drops words that sit entirely in silence and the stock phrases Whisper invents. */
export function dropPhantoms(words: Word[], islands: Span[]): Word[] {
	const phantoms = phantomIndexes(words);
	return words.filter((w, index) => {
		if (phantoms.has(index)) return false;
		if (islands.length === 0) return true;
		const k = nextIsland(islands, w.start - 0.5);
		if (k < 0) return islandAt(islands, w.start) >= 0;
		// Some speech within the word (±0.3 s tolerance for the timing error).
		for (let j = Math.max(0, k - 1); j < islands.length && islands[j].start < w.end + 0.3; j++) {
			if (islands[j].end > w.start - 0.3) return true;
		}
		return false;
	});
}
