// Where a sound editor would cut: inside a pause, never in a word or a breath, on the quietest frame boundary, with
// the speaker's natural pause kept around the join; music on a beat or a bar end. Pure (seconds in, seconds out):
// remove_pauses, cut_out, split and trim (agent/hear-tools.ts) and the cut-point tool all decide here.
import { type Frames, frameAt, HOP, type Levels, type Span } from "./dsp";

export interface TimedWord {
	text: string;
	start: number;
	end: number;
	/** Recognizer's confidence 0…1, when known. */
	p?: number;
}

export interface CutContext {
	frames: Frames;
	levels: Levels;
	/** Words in time order (the same seconds as the frames). */
	words: TimedWord[];
	breaths: Span[];
	fps: number;
	beats?: number[];
	downbeats?: number[];
}

/**
 * The cut rules every editing path shares (cut_out, remove_pauses, split, trim, the cut-point finder, claude-produce's
 * apply_plan): cut only into silences of 400 ms or more (150–400 ms ranked lower, under 150 ms never chosen if
 * anything better is near), 80 ms of air kept after the last word, 50 ms before the next, 30 ms fades on every cut,
 * 400–600 ms of air when another speaker / clip takes over, music cut on bar starts.
 */
export const CUT_RULES = {
	cleanSilence: 0.4,
	checkSilence: 0.15,
	padAfterWord: 0.08,
	padBeforeWord: 0.05,
	fade: 0.03,
	handoff: [0.4, 0.6] as const,
} as const;
/** Air left after a word's end before a cut may start (its release and the room's tail). */
export const TAIL_GUARD = CUT_RULES.padAfterWord;
/** Air left before the next word's start (its onset, a plosive's closure). */
export const HEAD_GUARD = CUT_RULES.padBeforeWord;
/** The audio fade put on both sides of every seam the tools make (equal-power, seconds). */
export const SEAM_FADE = CUT_RULES.fade;

const EPS = 1e-6;
export const toFrame = (t: number, fps: number) => Math.round(t * fps - EPS) / fps;
export const frameCeil = (t: number, fps: number) => Math.ceil(t * fps - 1e-6) / fps;
export const frameFloor = (t: number, fps: number) => Math.floor(t * fps + 1e-6) / fps;

/** The loudest 10 ms frame touching ±12 ms around t: what a cut at t would land on. */
export function levelAt(frames: Frames, t: number): number {
	const a = Math.max(0, frameAt(frames, t - 0.012));
	const b = Math.min(frames.n - 1, frameAt(frames, t + 0.012));
	let m = -100;
	for (let f = a; f <= b; f++) if (frames.db[f] > m) m = frames.db[f];
	return m;
}

const inSpan = (t: number, spans: Span[], pad = 0) => spans.some((s) => t > s.start - pad && t < s.end + pad);

/** Where two words run together: the quietest frame boundary within ±`reach` of their boundary (the dip between them). */
export function quietBoundary(ctx: CutContext, edge: number, reach = 0.025): number {
	let at = toFrame(edge, ctx.fps);
	let best = Infinity;
	for (let k = Math.ceil((edge - reach) * ctx.fps - 1e-6); k <= Math.floor((edge + reach) * ctx.fps + 1e-6); k++) {
		const c = k / ctx.fps;
		const score = levelAt(ctx.frames, c) + Math.abs(c - edge) / 0.01;
		if (score < best) {
			best = score;
			at = c;
		}
	}
	return at;
}

export interface CutAt {
	at: number;
	/** Level at the cut, dB. */
	db: number;
	/** 0…1: 1 = deep in room tone with the guards kept. */
	quality: number;
	tight: boolean;
}

/**
 * The best frame-exact cut inside the pause [lo, hi] (lo = the end of the word before, hi = the start of the next one):
 * the quietest frame boundary that keeps the guards and is outside any breath, nearest `prefer` among equally quiet ones.
 */
export function bestCutIn(ctx: CutContext, lo: number, hi: number, prefer = (lo + hi) / 2): CutAt | null {
	const { frames, levels, fps, breaths } = ctx;
	const tries: Array<[number, number, boolean]> = [
		[lo + TAIL_GUARD, hi - HEAD_GUARD, false],
		[lo + 0.015, hi - 0.012, true],
	];
	for (const [a, b, tight] of tries) {
		if (b < a) continue;
		let best: CutAt | null = null;
		let bestScore = Infinity;
		const k0 = Math.ceil(a * fps - 1e-6);
		const k1 = Math.floor(b * fps + 1e-6);
		for (let k = k0; k <= k1; k++) {
			const t = k / fps;
			if (inSpan(t, breaths, 0.015)) continue;
			const db = levelAt(frames, t);
			// 1 dB of level is worth 30 ms of distance from where the cut is wanted.
			const score = db + Math.abs(t - prefer) / 0.03;
			if (score < bestScore) {
				bestScore = score;
				const over = db - levels.floor;
				best = { at: t, db, quality: Math.max(0, Math.min(1, 1 - over / 24)) * (tight ? 0.6 : 1), tight };
			}
		}
		if (best) return best;
	}
	return null;
}

export interface Gap extends Span {
	/** Index of the word before (−1 = the range start). */
	before: number;
}

/** The pauses between the words (and before the first / after the last one), as spans of the given sound. */
export function gapsOf(words: TimedWord[], from: number, to: number, min = 0.03): Gap[] {
	const out: Gap[] = [];
	let cursor = from;
	for (let i = 0; i <= words.length; i++) {
		const next = i < words.length ? words[i].start : to;
		if (next - cursor >= min) out.push({ start: cursor, end: next, before: i - 1 });
		if (i < words.length) cursor = Math.max(cursor, words[i].end);
	}
	return out;
}

export const endsSentence = (w: string | undefined) => !!w && /[.!?…]["»”)]*$/.test(w.trim());
export const endsClause = (w: string | undefined) => !!w && /[,;:—–-]["»”)]*$/.test(w.trim());

export interface Rhythm {
	/** The speaker's natural pause, seconds (median of their pauses of 0.12–1.5 s). */
	pause: number;
	/** …after a sentence. */
	sentencePause: number;
	/** …inside a sentence. */
	phrasePause: number;
}

const med = (v: number[]) => {
	if (!v.length) return 0;
	const s = [...v].sort((a, b) => a - b);
	return s[Math.floor((s.length - 1) / 2)];
};

export function rhythmOf(words: TimedWord[]): Rhythm {
	const all: number[] = [];
	const sentence: number[] = [];
	const phrase: number[] = [];
	for (let i = 1; i < words.length; i++) {
		const g = words[i].start - words[i - 1].end;
		if (g < 0.12 || g > 1.5) continue;
		all.push(g);
		(endsSentence(words[i - 1].text) ? sentence : phrase).push(g);
	}
	const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
	const pause = clamp(med(all) || 0.3, 0.15, 0.8);
	return {
		pause,
		sentencePause: clamp(med(sentence) || pause * 1.3, 0.2, 1.0),
		phrasePause: clamp(med(phrase) || pause * 0.8, 0.12, 0.6),
	};
}

/**
 * How long a pause should be after shortening (a tightened, still natural rhythm): the speaker's own pause, a bit
 * longer after a sentence, never shorter than a breath's worth of air.
 */
export function targetPause(rhythm: Rhythm, sentenceEnd: boolean): number {
	return sentenceEnd ? Math.max(0.28, Math.min(0.5, rhythm.sentencePause * 0.85)) : Math.max(0.16, Math.min(0.32, rhythm.phrasePause * 0.85));
}

export interface PlannedCut extends Span {
	kind: "pause" | "filler";
	text?: string;
	/** The pause left at the join, seconds. */
	kept: number;
}

/**
 * The piece to take out of the pause [g0, g1] so `target` seconds stay (≈45 % before the join, the rest before the
 * next word). A breath right before the next word stays whole with it when that fits; otherwise it goes whole.
 * Edges land on frame boundaries inside the pause, never in a word or a breath. Null when nothing worth cutting.
 */
export function cutInPause(ctx: CutContext, g0: number, g1: number, target: number, cover?: Span): PlannedCut | null {
	const { fps, breaths } = ctx;
	const length = g1 - g0;
	if (length - target < Math.max(0.08, 2 / fps) && !cover) return null;
	let before = Math.max(TAIL_GUARD + 0.02, target * 0.45);
	let after = Math.max(HEAD_GUARD + 0.03, target - before);
	const breath = breaths.find((b) => b.start >= g0 - 0.01 && b.end <= g1 + 0.01);
	if (breath) {
		const keepWithBreath = g1 - breath.start + 0.03;
		if (before + keepWithBreath <= target * 1.4 || breath.end - breath.start < 0.12) after = Math.max(after, keepWithBreath);
		else if (g1 - (breath.end + 0.02) >= HEAD_GUARD) after = Math.min(after, g1 - (breath.end + 0.02));
		else after = Math.max(after, keepWithBreath);
	}
	if (cover) {
		// A filler inside the pause must go whole: shrink the air on its sides if needed.
		before = Math.min(before, Math.max(TAIL_GUARD, cover.start - 0.02 - g0));
		after = Math.min(after, Math.max(HEAD_GUARD, g1 - (cover.end + 0.02)));
	}
	let start = frameCeil(g0 + before, fps);
	let end = frameFloor(g1 - after, fps);
	// Edges never inside a breath: the start steps past it; the end takes the breath out whole when there is room
	// before the next word, else keeps it whole.
	for (const b of breaths) {
		if (start > b.start - 0.015 && start < b.end + 0.015) start = frameCeil(b.end + 0.015, fps);
		if (end > b.start - 0.015 && end < b.end + 0.015) {
			const past = frameCeil(b.end + 0.015, fps);
			end = past <= g1 - HEAD_GUARD + 1e-6 ? past : frameFloor(b.start - 0.015, fps);
		}
	}
	if (cover && (start > cover.start + 1e-6 || end < cover.end - 1e-6)) return null;
	if (end - start < 1 / fps - 1e-6) return null;
	if (start < g0 + 0.015 || end > g1 - 0.012) return null;
	return { start, end, kind: cover ? "filler" : "pause", kept: g1 - g0 - (end - start) };
}

/** Hesitations only: words that never carry meaning («ну», «типа» are left to the editor). */
const FILLERS = new Set([
	"э", "ээ", "эээ", "ээээ", "эм", "эмм", "эммм", "мм", "ммм", "мммм", "хм", "хмм", "а-а", "э-э", "э-э-э", "м-м",
	"uh", "uhh", "um", "umm", "erm", "hmm", "mm", "mmm", "ah", "eh",
]);
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, "").replace(/^-+|-+$/g, "");
export const isFiller = (w: string) => FILLERS.has(bare(w));

/**
 * «Remove pauses», the seamless way: every pause longer than `minPause` is shortened to the speaker's natural length
 * (not to a fixed sliver), fillers go with the air around them, edges are frame-exact and inside the silence.
 * `from`/`to`: the sound's own edges (its start and end lose their dead air entirely, a little lead-in kept).
 */
export function planPauseCuts(ctx: CutContext, from: number, to: number, { minPause = CUT_RULES.cleanSilence, fillers = true }: { minPause?: number; fillers?: boolean } = {}): PlannedCut[] {
	const fillerWords = fillers ? ctx.words.filter((w) => isFiller(w.text)) : [];
	const real = ctx.words.filter((w) => !fillerWords.includes(w));
	const rhythm = rhythmOf(real);
	const sub: CutContext = { ...ctx, words: real };
	const out: PlannedCut[] = [];
	const gaps = gapsOf(real, from, to, 0.05);
	for (const g of gaps) {
		const inside = fillerWords.filter((w) => w.start >= g.start - 0.01 && w.end <= g.end + 0.01);
		const cover = inside.length ? { start: inside[0].start, end: inside[inside.length - 1].end } : undefined;
		const length = g.end - g.start;
		if (!cover && length <= minPause) continue;
		const atStart = g.before < 0;
		const atEnd = g.before === real.length - 1;
		if (atStart || atEnd) {
			// Dead air before the first / after the last word: keep a short lead-in / tail only.
			const keep = atStart ? 0.15 : 0.25;
			if (length - keep < Math.max(0.1, minPause / 2)) continue;
			const start = atStart ? frameCeil(from, ctx.fps) : frameCeil(g.start + keep, ctx.fps);
			const end = atStart ? frameFloor(g.end - keep, ctx.fps) : frameFloor(to, ctx.fps);
			if (end - start >= 1 / ctx.fps) out.push({ start, end, kind: "pause", kept: keep });
			continue;
		}
		const sentence = endsSentence(real[g.before]?.text);
		const target = targetPause(rhythm, sentence);
		const cut = cutInPause(sub, g.start, g.end, target, cover);
		if (cut) out.push(cover ? { ...cut, text: inside.map((w) => w.text).join(" ") } : cut);
	}
	return out;
}

export interface Snapped {
	from: number;
	to: number;
	/** Why each edge moved, for the answer. */
	notes: string[];
}

const quote = (w: TimedWord | undefined) => (w ? `«${w.text.replace(/[«»"]/g, "")}»` : "the start");

/**
 * A range to cut out, made seamless: a word more than half inside goes whole, one less than half inside stays whole;
 * both edges then sit in the pauses around the removed words so the join keeps the speaker's natural pause; frame-exact.
 * Without words near an edge it only moves to the quietest frame boundary within 50 ms (or to the nearest beat ±0.25 s
 * on music).
 */
export function snapRange(ctx: CutContext, from: number, to: number): Snapped {
	const { words, fps } = ctx;
	const notes: string[] = [];
	const near = (t: number) => words.some((w) => w.end > t - 1.2 && w.start < t + 1.2);
	if (!words.length || (!near(from) && !near(to))) {
		return { ...snapPlain(ctx, from, to), notes };
	}
	const rhythm = rhythmOf(words);
	const removed = (w: TimedWord) => {
		const overlap = Math.min(w.end, to) - Math.max(w.start, from);
		return overlap > 0.5 * (w.end - w.start);
	};
	let first = -1;
	let last = -1;
	words.forEach((w, i) => {
		if (removed(w)) {
			if (first < 0) first = i;
			last = i;
		}
	});
	if (first < 0) {
		// No word is mostly inside: the cut is inside one pause (or covers only word edges): keep every word.
		const before = words.filter((w) => w.start < from).pop();
		const after = words.find((w) => w.end > to && !(w.start < from));
		const lo = before ? Math.max(before.end, Math.min(from, before.end)) : from;
		const hi = after ? Math.min(after.start, Math.max(to, after.start)) : to;
		const s = frameCeil(Math.max(from, lo + TAIL_GUARD), fps);
		const e = frameFloor(Math.min(to, hi - HEAD_GUARD), fps);
		if (e - s >= 1 / fps) return { from: s, to: e, notes: ["no word was mostly inside the range: only the pause between them is cut"] };
		return { from: frameCeil(from, fps), to: frameFloor(to, fps), notes };
	}
	const prev = words[first - 1];
	const next = words[last + 1];
	const sentence = endsSentence(prev?.text) || endsSentence(words[last].text);
	const target = targetPause(rhythm, sentence);
	// Left edge: in the pause between the last kept word and the first removed one.
	const l0 = prev ? prev.end : Math.min(from, words[first].start - 0.3);
	const l1 = words[first].start;
	const r0 = words[last].end;
	const r1 = next ? next.start : Math.max(to, words[last].end + 0.3);
	const lGap = l1 - l0;
	const rGap = r1 - r0;
	const wantBefore = Math.min(lGap - HEAD_GUARD, Math.max(TAIL_GUARD + 0.02, target * 0.45));
	const wantAfter = Math.min(rGap - TAIL_GUARD, Math.max(HEAD_GUARD + 0.03, target - Math.max(0, wantBefore)));
	let a: number;
	let b: number;
	const lCut = bestCutIn(ctx, l0, l1, prev ? l0 + Math.max(TAIL_GUARD, wantBefore) : Math.max(l0, Math.min(from, l1 - HEAD_GUARD)));
	const rCut = bestCutIn(ctx, r0, r1, next ? r1 - Math.max(HEAD_GUARD, wantAfter) : Math.min(r1, Math.max(to, r0 + TAIL_GUARD)));
	a = lCut ? lCut.at : prev ? quietBoundary(ctx, (l0 + l1) / 2) : frameCeil(from, fps);
	b = rCut ? rCut.at : next ? quietBoundary(ctx, (r0 + r1) / 2) : frameFloor(to, fps);
	if (b - a < 1 / fps) {
		a = frameCeil(from, fps);
		b = frameFloor(to, fps);
	}
	if (Math.abs(a - from) > 0.02) notes.push(`start ${from.toFixed(2)} → ${a.toFixed(3)} (${removed(words[first]) && words[first].start < from - 0.02 ? `${quote(words[first])} goes whole` : `in the pause after ${quote(prev)}`})`);
	if (Math.abs(b - to) > 0.02) notes.push(`end ${to.toFixed(2)} → ${b.toFixed(3)} (${words[last].end > to + 0.02 ? `${quote(words[last])} goes whole` : `in the pause before ${quote(next)}`})`);
	if (lCut?.tight || rCut?.tight) notes.push("tight join: the words around it are close together");
	return { from: a, to: b, notes };
}

/** No speech around: the quietest frame boundary within 50 ms of each edge, or the nearest beat on music. */
function snapPlain(ctx: CutContext, from: number, to: number): { from: number; to: number } {
	const { fps, beats } = ctx;
	const onBeat = (t: number) => {
		if (!beats?.length) return null;
		let best = null as number | null;
		for (const b of beats) if (Math.abs(b - t) <= 0.25 && (best === null || Math.abs(b - t) < Math.abs(best - t))) best = b;
		return best === null ? null : toFrame(best, fps);
	};
	const quiet = (t: number) => {
		let best = toFrame(t, fps);
		let bestDb = Infinity;
		for (let k = Math.ceil((t - 0.05) * fps); k <= Math.floor((t + 0.05) * fps); k++) {
			const c = k / fps;
			const db = levelAt(ctx.frames, c) + Math.abs(c - t) / 0.02;
			if (db < bestDb) {
				bestDb = db;
				best = c;
			}
		}
		return best;
	};
	const a = onBeat(from) ?? quiet(from);
	const b = onBeat(to) ?? quiet(to);
	return b - a >= 1 / fps ? { from: a, to: b } : { from: toFrame(from, fps), to: toFrame(to, fps) };
}

export interface CutPoint {
	at: number;
	/** 0…1 */
	score: number;
	stars: 1 | 2 | 3;
	/** Word index (0-based) before the cut, −1 at the start. */
	after: number;
	reason: string;
	/** The pause it sits in. */
	pause?: Span;
	db: number;
}

const starsOf = (s: number): 1 | 2 | 3 => (s >= 0.72 ? 3 : s >= 0.48 ? 2 : 1);

/** Scored cut in each pause between words: the input of the ranked list and of the cut-point finder. */
export function pauseCutPoints(ctx: CutContext, from: number, to: number): CutPoint[] {
	const { words } = ctx;
	const out: CutPoint[] = [];
	for (const g of gapsOf(words, from, to, 0.04)) {
		const cut = bestCutIn(ctx, g.start, g.end, g.start + Math.min(0.12, (g.end - g.start) * 0.4));
		if (!cut) continue;
		const prev = words[g.before];
		const length = g.end - g.start;
		// Silence classes: ≥ 400 ms clean, 150–400 ms only after a check, under 150 ms unsafe.
		const cls = length >= CUT_RULES.cleanSilence ? 1 : length >= CUT_RULES.checkSilence ? 0.55 : 0.15;
		let score = 0.35 * cls + 0.35 * cut.quality;
		const why: string[] = [];
		if (endsSentence(prev?.text)) {
			score += 0.3;
			why.push("sentence end");
		} else if (endsClause(prev?.text)) {
			score += 0.15;
			why.push("clause end");
		} else if (g.before >= 0 && g.before < words.length - 1) why.push("between words");
		if (g.before < 0) why.push("before the first word");
		if (g.before === words.length - 1) why.push("after the last word");
		const lowConf = [prev, words[g.before + 1]].some((w) => w?.p !== undefined && w.p < 0.5);
		if (lowConf) score -= 0.1;
		why.push(`pause ${length.toFixed(2)} s${length < CUT_RULES.checkSilence ? " (too short to cut safely)" : length < CUT_RULES.cleanSilence ? " (short: check it)" : ""}`);
		if (cut.tight) why.push("tight");
		if (ctx.breaths.some((b) => b.start >= g.start && b.end <= g.end)) why.push("breath kept with the next words");
		score = Math.max(0, Math.min(1, score));
		out.push({ at: cut.at, score, stars: starsOf(score), after: g.before, reason: why.join(", "), pause: { start: g.start, end: g.end }, db: cut.db });
	}
	return out;
}

/**
 * The best cuts near `at` (±window): every pause in reach gets its best frame boundary, scored by quietness, pause
 * length, sentence end and distance from `at`; a time inside a word never wins. With beats (music) the beats and bar
 * starts compete too.
 */
export function cutPointsNear(ctx: CutContext, at: number, window = 0.5, { music = false }: { music?: boolean } = {}): CutPoint[] {
	const lo = at - window;
	const hi = at + window;
	const out: CutPoint[] = [];
	if (!music) {
		for (const c of pauseCutPoints(ctx, lo - 2, hi + 2)) {
			if (c.at < lo - 1e-6 || c.at > hi + 1e-6) continue;
			const inPause = c.pause && at >= c.pause.start && at <= c.pause.end;
			const dist = Math.abs(c.at - at) / Math.max(0.05, window);
			const score = Math.max(0, Math.min(1, c.score * 0.75 + (inPause ? 0.25 : 0) - dist * 0.3));
			out.push({ ...c, score, stars: starsOf(score) });
		}
	}
	if (ctx.beats?.length) {
		const down = new Set((ctx.downbeats ?? []).map((t) => Math.round(t * 1000)));
		for (const b of ctx.beats) {
			if (b < lo || b > hi) continue;
			const t = toFrame(b, ctx.fps);
			const bar = down.has(Math.round(b * 1000));
			const dist = Math.abs(t - at) / Math.max(0.05, window);
			const score = Math.max(0, Math.min(1, (music ? 0.75 : 0.45) + (bar ? 0.25 : 0) - dist * 0.3));
			out.push({ at: t, score, stars: starsOf(score), after: -1, reason: bar ? "bar start (downbeat)" : "on the beat", db: levelAt(ctx.frames, t) });
		}
	}
	return out.sort((a, b) => b.score - a.score);
}

/**
 * A single cut (split, trim edge) near `t`: inside a word or breath it moves to the best pause within ±`reach`; in a
 * pause it goes to that pause's quietest frame boundary nearby; always frame-exact. Music: the nearest beat within ±0.12 s.
 */
export function snapTime(ctx: CutContext, t: number, reach = 0.35): { at: number; note?: string } {
	const { words, fps } = ctx;
	const inWord = words.find((w) => t > w.start + 0.01 && t < w.end - 0.01);
	const inBreath = ctx.breaths.find((b) => t > b.start && t < b.end);
	if (!inWord && !inBreath) {
		const hasSpeech = words.some((w) => Math.abs(w.start - t) < 1.5 || Math.abs(w.end - t) < 1.5);
		if (!hasSpeech && ctx.beats?.length) {
			const b = ctx.beats.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), ctx.beats[0]);
			if (Math.abs(b - t) <= 0.12) return { at: toFrame(b, fps), note: "on the beat" };
		}
		const prev = words.filter((w) => w.end <= t + 0.01).pop();
		const next = words.find((w) => w.start >= t - 0.01);
		if (prev || next) {
			const lo = prev ? prev.end : t - reach;
			const hi = next ? next.start : t + reach;
			const c = bestCutIn(ctx, Math.max(lo, t - reach), Math.min(hi, t + reach), t);
			if (c && (Math.abs(c.at - t) <= 0.08 || c.db < levelAt(ctx.frames, toFrame(t, fps)) - 3)) return { at: c.at, note: Math.abs(c.at - t) > 0.02 ? "quietest point of the pause" : undefined };
		}
		return { at: toFrame(t, fps) };
	}
	if (inWord) {
		// Out of the word by the nearer side: into the pause before it (close to its start) or after it (close to its end).
		const i = words.indexOf(inWord);
		const prev = words[i - 1];
		const next = words[i + 1];
		const options: Array<{ at: number; side: "before" | "after" }> = [];
		// Only within ±reach of the asked time: a long pause before or after the word is no reason to move a cut seconds away.
		const near = (x: number) => Math.abs(x - t) <= reach + 1e-6;
		const beforeLo = Math.max(prev ? prev.end : inWord.start - 1, t - reach);
		const before = beforeLo < inWord.start ? bestCutIn(ctx, beforeLo, inWord.start, inWord.start - HEAD_GUARD - 0.01) : null;
		if (before && before.at <= inWord.start + 1e-6 && near(before.at)) options.push({ at: before.at, side: "before" });
		const afterHi = Math.min(next ? next.start : inWord.end + 1, t + reach);
		const after = afterHi > inWord.end ? bestCutIn(ctx, inWord.end, afterHi, inWord.end + TAIL_GUARD + 0.01) : null;
		if (after && after.at >= inWord.end - 1e-6 && near(after.at)) options.push({ at: after.at, side: "after" });
		if (!options.length) {
			// Words run on: the frame boundary at the word's nearer edge, outside it — when it is within reach.
			const toStart = t - inWord.start <= inWord.end - t;
			const edge = quietBoundary(ctx, toStart ? inWord.start : inWord.end);
			if (!near(edge)) return { at: toFrame(t, fps), note: `cut inside «${inWord.text}» where asked: no pause within ±${reach.toFixed(2)} s` };
			return { at: edge, note: `«${inWord.text}» stays whole: moved ${edge > t ? "+" : ""}${(edge - t).toFixed(2)} s to its ${toStart ? "start" : "end"} (no pause there: the words run on)` };
		}
		const best = options.sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t))[0];
		return { at: best.at, note: `«${inWord.text}» stays whole: moved ${best.at > t ? "+" : ""}${(best.at - t).toFixed(2)} s into the pause ${best.side} it` };
	}
	const best = cutPointsNear(ctx, t, reach)[0];
	if (best) return { at: best.at, note: `the breath stays whole: moved ${best.at > t ? "+" : ""}${(best.at - t).toFixed(2)} s` };
	return { at: toFrame(t, fps) };
}

/** Frames of 10 ms per second, for callers that convert. */
export const FRAMES_PER_SECOND = 1 / HOP;
