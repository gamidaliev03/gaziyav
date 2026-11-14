// The audio map: what is where in a sound, as an editor hears it — words fitted to the sound, pauses and what fills
// them (silence, room tone, a breath, music), speech / music / noise stretches, sentence ends and stressed words, the
// speaker's rhythm. Pure: the server builds it from ffmpeg's samples and Whisper's words (studio/server/hear.ts).
import { endsSentence, isFiller, type Rhythm, rhythmOf, type TimedWord } from "./cuts";
import { type Frames, frameAt, frameTime, HOP, type Levels, median, SILENT_DB, semitones, type Span } from "./dsp";

export interface HeardWord extends TimedWord {
	/** Mean level over the word, dB. */
	db: number;
	/** Median pitch, Hz (0 = unvoiced). */
	f0: number;
	/** Pitch movement over the word's second half, semitones (negative = falling). */
	slope: number;
	stress: boolean;
	filler: boolean;
}

/**
 * Whisper's word edges pulled onto the sound: the start to the first frame above the speech threshold within
 * −100…+60 ms, the end to the last one within −60…+120 ms (soft endings, releases), never past a neighbour.
 */
/**
 * How far a recogniser's late start or early end is followed into the sound. Whisper puts some onsets well late — a
 * numeral after a long pause started 220 ms after its sound in claude-produce's test (09.11), and the cut placed 50 ms
 * before that late start clipped 70 ms of the word.
 */
const EDGE_REACH = 0.35;

export function refineWords(words: TimedWord[], frames: Frames, levels: Levels): TimedWord[] {
	const thr = Math.max(levels.floor + 8, levels.loud - 42, -70);
	const loud = (f: number) => f >= 0 && f < frames.n && frames.db[f] > thr;
	const out = words.map((w) => ({ ...w }));
	for (let i = 0; i < out.length; i++) {
		const w = out[i];
		const lo = i > 0 ? out[i - 1].end : -Infinity;
		const hi = i + 1 < out.length ? words[i + 1].start : Infinity;
		let s = -1;
		const first = frameAt(frames, Math.max(lo, w.start - 0.1));
		for (let f = first; f <= frameAt(frames, w.start + 0.06); f++) {
			if (loud(f) && loud(f + 1)) {
				s = f;
				break;
			}
		}
		// Already loud where the look began: the word starts earlier still — follow the sound back to its attack.
		if (s === first) {
			const stop = Math.max(0, frameAt(frames, Math.max(lo, w.start - EDGE_REACH)));
			while (s - 1 >= stop && loud(s - 1)) s--;
		}
		if (s >= 0) w.start = Math.max(lo, frameTime(frames, s));
		// The aligner may glue the breath before a phrase to its first word: unvoiced noise of 0.1–1 s, a quiet gap
		// of ≥ 60 ms, then the voice. The word starts after the gap.
		{
			const f0 = frameAt(frames, w.start);
			let f = f0;
			let unvoiced = 0;
			while (f < frames.n && loud(f) && f - f0 < 100) {
				if (frames.voicing[f] < 0.45) unvoiced++;
				f++;
			}
			const burst = f - f0;
			let gap = 0;
			while (f + gap < frames.n && !loud(f + gap) && gap < 60) gap++;
			const resume = f + gap;
			if (burst >= 10 && unvoiced >= 0.7 * burst && gap >= 6 && resume < frames.n && frameTime(frames, resume) < w.end - 0.05) w.start = frameTime(frames, resume);
		}
		let e = -1;
		const last = frameAt(frames, Math.min(hi, w.end + 0.12)) - 1;
		for (let f = last; f >= frameAt(frames, w.end - 0.06); f--) {
			if (loud(f)) {
				e = f;
				break;
			}
		}
		// Still loud where the look ended: the word rings on — follow it to where it goes quiet.
		if (e === last) {
			const stop = Math.min(frames.n - 1, frameAt(frames, Math.min(hi, w.end + EDGE_REACH)) - 1);
			while (e + 1 <= stop && loud(e + 1)) e++;
		}
		if (e >= 0) w.end = Math.min(hi, frameTime(frames, e + 1));
		if (w.end < w.start + 0.03) w.end = w.start + 0.03;
		w.start = Math.round(w.start * 1000) / 1000;
		w.end = Math.round(w.end * 1000) / 1000;
	}
	return out;
}

/**
 * Breaths: unvoiced, noise-like bursts of 0.1–1 s between words, clearly above the room tone. Fricatives («с», «ш»)
 * are as noisy but belong to a word; a breath sits in the gap.
 */
export function findBreaths(frames: Frames, levels: Levels, words: TimedWord[], from = frames.t0, to = frames.t0 + frames.n * HOP): Span[] {
	const out: Span[] = [];
	const gaps: Span[] = [];
	let cursor = from;
	for (const w of words) {
		if (w.start - cursor > 0.12) gaps.push({ start: cursor + 0.02, end: w.start - 0.01 });
		cursor = Math.max(cursor, w.end);
	}
	if (to - cursor > 0.12) gaps.push({ start: cursor + 0.02, end: to });
	const thr = Math.max(levels.floor + 7, -72);
	for (const g of gaps) {
		const f0 = Math.max(0, frameAt(frames, g.start));
		const f1 = Math.min(frames.n, frameAt(frames, g.end));
		let open = -1;
		const close = (f: number) => {
			if (open < 0) return;
			const len = (f - open) * HOP;
			let unvoiced = 0;
			let noisy = 0;
			let peak = -100;
			for (let k = open; k < f; k++) {
				if (frames.voicing[k] < 0.45) unvoiced++;
				if (frames.flat[k] > 0.06) noisy++;
				if (frames.db[k] > peak) peak = frames.db[k];
			}
			const n = f - open;
			if (len >= 0.1 && len <= 1.0 && unvoiced >= 0.7 * n && noisy >= 0.6 * n && peak > thr + 3) {
				out.push({ start: Math.round(frameTime(frames, open) * 1000) / 1000, end: Math.round(frameTime(frames, f) * 1000) / 1000 });
			}
			open = -1;
		};
		for (let f = f0; f < f1; f++) {
			const on = frames.db[f] > thr;
			if (on && open < 0) open = f;
			// A breath may dip for a frame or two.
			if (!on && open >= 0 && !(frames.db[f + 1] > thr || frames.db[f + 2] > thr)) close(f);
		}
		close(f1);
	}
	return out;
}

/**
 * Breaths found without the words: unvoiced, noise-like islands of 0.1–1 s with quiet (≥ 60 ms) on both sides and at
 * least 10 dB under the loud speech. A word's fricative is glued to its vowel (no quiet between), so it never qualifies.
 */
export function breathIslands(frames: Frames, levels: Levels): Span[] {
	const out: Span[] = [];
	const thr = Math.max(levels.floor + 7, -72);
	const loud = (f: number) => f >= 0 && f < frames.n && frames.db[f] > thr;
	let f = 0;
	while (f < frames.n) {
		if (!loud(f)) {
			f++;
			continue;
		}
		const a = f;
		// The island: loud frames, bridging one- or two-frame dips.
		while (f < frames.n && (loud(f) || loud(f + 1) || loud(f + 2))) f++;
		const b = f;
		let quietBefore = 0;
		while (a - quietBefore - 1 >= 0 && !loud(a - quietBefore - 1) && quietBefore < 6) quietBefore++;
		let quietAfter = 0;
		while (b + quietAfter < frames.n && !loud(b + quietAfter) && quietAfter < 6) quietAfter++;
		const n = b - a;
		if (n < 10 || n > 100 || quietBefore < 6 || quietAfter < 6) continue;
		let unvoiced = 0;
		let noisy = 0;
		let peak = -100;
		for (let k = a; k < b; k++) {
			if (frames.voicing[k] < 0.45) unvoiced++;
			if (frames.flat[k] > 0.06) noisy++;
			peak = Math.max(peak, frames.db[k]);
		}
		if (unvoiced >= 0.8 * n && noisy >= 0.6 * n && peak <= levels.loud - 10 && peak > thr + 3) out.push({ start: Math.round(frameTime(frames, a) * 1000) / 1000, end: Math.round(frameTime(frames, b) * 1000) / 1000 });
	}
	return out;
}

/**
 * Whisper's aligner may put the first words of a phrase on the breath before it (the breath is loud enough to look like
 * speech): the words sitting on a breath and the next one are laid again over the speech that follows it.
 */
export function wordsOffBreaths(words: TimedWord[], breaths: Span[], frames: Frames, levels: Levels): TimedWord[] {
	const out = words.map((w) => ({ ...w }));
	const thr = Math.max(levels.floor + 7, -72);
	const weight = (w: TimedWord) => w.text.replace(/[^\p{L}\p{N}]/gu, "").length + 2;
	for (const b of breaths) {
		const k0 = out.findIndex((w) => w.start >= b.start - 0.03 && w.start < b.end);
		if (k0 < 0) continue;
		let k1 = k0;
		while (k1 + 1 < out.length && out[k1 + 1].end <= b.end + 0.05) k1++;
		if (out[k1].end > b.end + 0.05) continue;
		const next = out[k1 + 1];
		if (!next) continue;
		let f = frameAt(frames, b.end + 0.06);
		while (f < frames.n && frames.db[f] <= thr) f++;
		const S = frameTime(frames, f);
		const E = next.end;
		if (!(E - S > 0.1)) continue;
		const list = out.slice(k0, k1 + 2);
		const total = list.reduce((s, w) => s + weight(w), 0);
		let t = S;
		for (const w of list) {
			const len = ((E - S) * weight(w)) / total;
			w.start = Math.round(t * 1000) / 1000;
			w.end = Math.round((t + len) * 1000) / 1000;
			t += len;
		}
	}
	return out;
}

export type PauseKind = "silence" | "room" | "music" | "noise";

export interface Pause extends Span {
	length: number;
	kind: PauseKind;
	breath?: Span;
	/** Index of the word before (−1 = the start). */
	before: number;
	sentenceEnd: boolean;
}

function kindOf(frames: Frames, levels: Levels, start: number, end: number): PauseKind {
	const f0 = Math.max(0, frameAt(frames, start));
	const f1 = Math.min(frames.n, Math.max(f0 + 1, frameAt(frames, end)));
	let silent = 0;
	let room = 0;
	let tonal = 0;
	for (let f = f0; f < f1; f++) {
		const db = frames.db[f];
		if (db <= SILENT_DB) silent++;
		else if (db <= levels.floor + 7 && (db < levels.loud - 20 || db < -50)) room++;
		else if (frames.voicing[f] > 0.55 || frames.flat[f] < 0.05) tonal++;
	}
	const n = f1 - f0;
	if (silent >= 0.5 * n) return "silence";
	if (room + silent >= 0.6 * n) return "room";
	if (tonal >= 0.5 * n) return "music";
	return "noise";
}

export function pausesOf(words: TimedWord[], frames: Frames, levels: Levels, breaths: Span[], from: number, to: number, min = 0.12): Pause[] {
	const out: Pause[] = [];
	let cursor = from;
	for (let i = 0; i <= words.length; i++) {
		const next = i < words.length ? words[i].start : to;
		if (next - cursor >= min) {
			const breath = breaths.find((b) => b.start >= cursor - 0.02 && b.end <= next + 0.02);
			out.push({
				start: cursor,
				end: next,
				length: next - cursor,
				kind: kindOf(frames, levels, cursor, next),
				breath,
				before: i - 1,
				sentenceEnd: i > 0 && endsSentence(words[i - 1].text),
			});
		}
		if (i < words.length) cursor = Math.max(cursor, words[i].end);
	}
	return out;
}

/** Level, pitch and pitch movement of each word; stressed = clearly louder or higher than the words around it. */
export function heardWords(words: TimedWord[], frames: Frames): HeardWord[] {
	const out: HeardWord[] = words.map((w) => {
		const f0 = Math.max(0, frameAt(frames, w.start));
		const f1 = Math.min(frames.n, Math.max(f0 + 1, frameAt(frames, w.end)));
		let sum = 0;
		const pitches: number[] = [];
		const first: number[] = [];
		const second: number[] = [];
		const mid = (f0 + f1) / 2;
		for (let f = f0; f < f1; f++) {
			sum += 10 ** (frames.db[f] / 10);
			if (frames.f0[f] > 60 && frames.voicing[f] > 0.5) {
				pitches.push(frames.f0[f]);
				(f < mid ? first : second).push(frames.f0[f]);
			}
		}
		const db = 10 * Math.log10(sum / (f1 - f0) + 1e-10);
		const slope = first.length >= 2 && second.length >= 2 ? semitones(median(second), median(first)) : 0;
		return { ...w, db, f0: pitches.length ? median(pitches) : 0, slope, stress: false, filler: isFiller(w.text) };
	});
	// Stress: against the median of the 8 words around (a phrase), by level and by pitch.
	for (let i = 0; i < out.length; i++) {
		const around = out.slice(Math.max(0, i - 4), i + 5).filter((x) => x !== out[i]);
		if (around.length < 3 || out[i].filler) continue;
		const dbMed = median(around.map((x) => x.db));
		const voiced = around.filter((x) => x.f0 > 0).map((x) => x.f0);
		const louder = out[i].db - dbMed >= 3.5;
		const higher = out[i].f0 > 0 && voiced.length >= 2 && semitones(out[i].f0, median(voiced)) >= 2.5;
		const letters = out[i].text.replace(/[^\p{L}]/gu, "").length;
		out[i].stress = letters >= 2 && (louder || higher);
	}
	return out;
}

export interface Sentence extends Span {
	/** Word indexes, first and last (0-based). */
	first: number;
	last: number;
	text: string;
	/** Ends with . ! ? and starts after a sentence end (or at the start): a quote that stands alone. */
	complete: boolean;
	/** Stressed words in it. */
	stress: number;
	pauseAfter: number;
	/** The voice falls at the end (a finished statement, not a list or a question). */
	falling: boolean;
	/** Mean recognizer confidence (1 when unknown). */
	conf: number;
}

export function sentencesOf(words: HeardWord[], to: number): Sentence[] {
	const out: Sentence[] = [];
	let first = 0;
	for (let i = 0; i < words.length; i++) {
		const gap = (i + 1 < words.length ? words[i + 1].start : to) - words[i].end;
		const end = endsSentence(words[i].text) || gap >= 1.2 || i === words.length - 1;
		if (!end) continue;
		const list = words.slice(first, i + 1);
		const text = list.map((w) => w.text).join(" ").replace(/\s+([,.!?…:;])/g, "$1");
		const startsClean = first === 0 ? /^[\p{Lu}«"]/u.test(list[0].text) : endsSentence(words[first - 1].text);
		const ps = list.map((w) => w.p).filter((p): p is number => p !== undefined);
		out.push({
			start: list[0].start,
			end: list[list.length - 1].end,
			first,
			last: i,
			text,
			complete: endsSentence(words[i].text) && startsClean,
			stress: list.filter((w) => w.stress).length,
			pauseAfter: Math.max(0, gap),
			falling: words[i].slope <= -1 || /[.!…]$/.test(words[i].text.trim()),
			conf: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 1,
		});
		first = i + 1;
	}
	return out;
}

export type SegmentKind = "speech" | "speech+music" | "music" | "noise" | "room" | "silence";

export interface Segment extends Span {
	kind: SegmentKind;
}

/** Half-second blocks classified, then merged: what kind of sound is where. */
export function segmentsOf(frames: Frames, levels: Levels, words: TimedWord[], from: number, to: number): Segment[] {
	const block = 0.5;
	const raw: Segment[] = [];
	let wi = 0;
	for (let t = from; t < to - 1e-6; t += block) {
		const e = Math.min(to, t + block);
		while (wi < words.length && words[wi].end <= t) wi++;
		let wordTime = 0;
		for (let j = wi; j < words.length && words[j].start < e; j++) wordTime += Math.max(0, Math.min(e, words[j].end) - Math.max(t, words[j].start));
		const f0 = Math.max(0, frameAt(frames, t));
		const f1 = Math.min(frames.n, Math.max(f0 + 1, frameAt(frames, e)));
		let silent = 0;
		let quiet = 0;
		let tonal = 0;
		let voiced = 0;
		let sum = 0;
		let lowEnergy = 0;
		const n = f1 - f0;
		for (let f = f0; f < f1; f++) sum += 10 ** (frames.db[f] / 10);
		const mean = sum / Math.max(1, n);
		for (let f = f0; f < f1; f++) {
			const db = frames.db[f];
			if (db <= SILENT_DB) silent++;
			else if (db <= levels.floor + 6 && (db < levels.loud - 20 || db < -50)) quiet++;
			if (frames.voicing[f] > 0.55) voiced++;
			if (frames.flat[f] < 0.08 && (db > levels.floor + 8 || db > -40)) tonal++;
			if (10 ** (db / 10) < 0.5 * mean) lowEnergy++;
		}
		let kind: SegmentKind;
		if (silent >= 0.7 * n) kind = "silence";
		else if (silent + quiet >= 0.7 * n) kind = "room";
		else if (wordTime >= 0.15 * (e - t)) {
			// Speech over a bed: the gaps between syllables stay tonal and loud.
			kind = tonal >= 0.5 * n && lowEnergy < 0.2 * n ? "speech+music" : "speech";
		} else if ((tonal + voiced) / 2 >= 0.45 * n && lowEnergy < 0.35 * n) kind = "music";
		else kind = "noise";
		raw.push({ start: t, end: e, kind });
	}
	const merged: Segment[] = [];
	for (const s of raw) {
		const last = merged[merged.length - 1];
		if (last && last.kind === s.kind) last.end = s.end;
		else merged.push({ ...s });
	}
	// Single half-second blips between two stretches of the same kind join them.
	for (let i = 1; i < merged.length - 1; i++) {
		if (merged[i].end - merged[i].start <= block + 1e-6 && merged[i - 1].kind === merged[i + 1].kind) {
			merged[i - 1].end = merged[i + 1].end;
			merged.splice(i, 2);
			i--;
		}
	}
	return merged.map((s) => ({ ...s, start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100 }));
}

export interface MusicGrid {
	/** How clearly the beat is heard: onset strength on the beats over the average (≥ 1.5 = a steady beat). */
	pulse: number;
	bpm: number;
	beats: number[];
	/** Bar starts (4/4). */
	downbeats: number[];
	sections: Array<Span & { db: number }>;
}

/**
 * Bars and sections from the beats: the downbeat is the beat phase (of 4) with the most low-end punch; a section
 * starts where the level of 4-bar blocks steps by 3 dB or more.
 */
export function musicGrid(beats: number[], bpm: number, frames: Frames, bars?: number[]): MusicGrid | null {
	if (beats.length < 8 || !(bpm > 0)) return null;
	// A tempo is only a beat when the onsets line up with it (a pad's slow swell gives a tempo too, but no pulse).
	const rise = (f: number) => Math.max(0, frames.db[f] - frames.db[Math.max(0, f - 2)]);
	let all = 0;
	let n = 0;
	for (let f = 2; f < frames.n; f++) {
		if (frames.db[f] <= SILENT_DB) continue;
		all += rise(f);
		n++;
	}
	let on = 0;
	for (const b of beats) {
		const f = frameAt(frames, b);
		let m = 0;
		for (let k = Math.max(2, f - 3); k <= Math.min(frames.n - 1, f + 3); k++) m = Math.max(m, rise(k));
		on += m;
	}
	const pulse = all > 0 && n ? on / beats.length / (all / n) : 0;
	if (pulse < 4) return null;
	const at = (t: number) => {
		const f = frameAt(frames, t);
		let m = -100;
		for (let k = Math.max(0, f - 2); k <= Math.min(frames.n - 1, f + 3); k++) m = Math.max(m, frames.low[k]);
		return m;
	};
	let phase = 0;
	let best = -Infinity;
	for (let p = 0; p < 4; p++) {
		let s = 0;
		let c = 0;
		for (let i = p; i < beats.length; i += 4) {
			s += at(beats[i]);
			c++;
		}
		if (c && s / c > best) {
			best = s / c;
			phase = p;
		}
	}
	// bar starts given (the song's refereed grid, hear/score.ts): those over the beats, not the guess above
	const downbeats = bars ? bars.filter((b) => b >= beats[0] - 0.05 && b <= beats[beats.length - 1] + 0.05) : beats.filter((_, i) => i >= phase && (i - phase) % 4 === 0);
	const barDb = (a: number, b: number) => {
		let sum = 0;
		let n = 0;
		for (let f = Math.max(0, frameAt(frames, a)); f < Math.min(frames.n, frameAt(frames, b)); f++) {
			sum += 10 ** (frames.db[f] / 10);
			n++;
		}
		return n ? 10 * Math.log10(sum / n + 1e-10) : -100;
	};
	const sections: Array<Span & { db: number }> = [];
	const blocks: Array<Span & { db: number }> = [];
	for (let i = 0; i + 4 < downbeats.length; i += 4) blocks.push({ start: downbeats[i], end: downbeats[i + 4], db: barDb(downbeats[i], downbeats[i + 4]) });
	for (const b of blocks) {
		const last = sections[sections.length - 1];
		if (last && Math.abs(b.db - last.db) < 3) {
			last.end = b.end;
			last.db = (last.db + b.db) / 2;
		} else sections.push({ ...b });
	}
	return { pulse: Math.round(pulse * 10) / 10, bpm, beats, downbeats, sections };
}

export interface Shape {
	words: HeardWord[];
	breaths: Span[];
	pauses: Pause[];
	sentences: Sentence[];
	segments: Segment[];
	rhythm: Rhythm;
}

/** Everything word-shaped about a sound, from Whisper's words and the frames. */
export function shapeOf(rawWords: TimedWord[], frames: Frames, levels: Levels, from: number, to: number): Shape {
	const islands = breathIslands(frames, levels);
	const refined = refineWords(wordsOffBreaths(rawWords, islands, frames, levels), frames, levels);
	const inGaps = findBreaths(frames, levels, refined, from, to);
	// Both finders: in the gaps between the words, and the islands of their own (merged, in time order).
	const breaths = [...inGaps, ...islands.filter((b) => !inGaps.some((x) => x.start < b.end && x.end > b.start) && !refined.some((w) => w.start < b.end - 0.03 && w.end > b.start + 0.03))].sort((x, y) => x.start - y.start);
	const words = heardWords(refined, frames);
	const real = words.filter((w) => !w.filler);
	return {
		words,
		breaths,
		pauses: pausesOf(words, frames, levels, breaths, from, to),
		sentences: sentencesOf(words, to),
		segments: segmentsOf(frames, levels, words, from, to),
		rhythm: rhythmOf(real),
	};
}
