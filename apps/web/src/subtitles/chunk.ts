/**
 * Russian-aware caption chunking (creative-trends §4.5):
 * - a chunk never ends with a preposition, conjunction or particle — it is
 *   glued to the next word («в доме», «не знал»);
 * - numbers stay with their unit or noun: «500 ₽», «40 %», «2 часа», «10 000»;
 * - chunks break at sentence ends, long pauses and (once half full) commas;
 * - each style sets its own size (Hormozi 1–3 words, Karaoke 3–6).
 */
import { buildGlueGroups } from "@/text/line-break";
import type { CaptionChunk, CaptionWord } from "@/transcription/types";

export interface ChunkLimits {
	maxWords: number;
	maxChars: number;
	/** A pause longer than this always starts a new chunk (s). */
	pause?: number;
	/** Longest chunk on screen (s). */
	maxDuration?: number;
}

const NUMBER = /^[−-]?\d+([.,]\d+)?$/;
const SENTENCE_END = /[.!?…]["»”)]*$/;
const SOFT_END = /[,;:—–]["»”)]*$/;
const hasLetters = (word: string) => /[\p{L}\p{N}]/u.test(word);
/** «Доставка», "Жми" — a new sentence in punctuation-free transcripts (not «ООО», «МРТ»). */
const SENTENCE_START = /^[«"„(]?\p{Lu}\p{Ll}/u;

/** Glues punctuation-only tokens («—», «,») to the previous word. */
function tidy(words: CaptionWord[]): CaptionWord[] {
	const out: CaptionWord[] = [];
	for (const word of words) {
		const text = word.text.trim();
		if (!text) continue;
		const previous = out[out.length - 1];
		if (previous && !hasLetters(text) && !/^[₽%$€]$/.test(text)) {
			out[out.length - 1] = {
				...previous,
				text: `${previous.text}${/^[—–-]$/.test(text) ? ` ${text}` : text}`,
				endTime: Math.max(previous.endTime, word.endTime),
			};
			continue;
		}
		out.push({ ...word, text });
	}
	return out;
}

/** Words that must stay together, as runs of timed words. */
function glueGroups(words: CaptionWord[]): CaptionWord[][] {
	const textGroups = buildGlueGroups(words.map((word) => word.text));
	const groups: CaptionWord[][] = [];
	let index = 0;
	for (const group of textGroups) {
		groups.push(words.slice(index, index + group.length));
		index += group.length;
	}
	// A number keeps its noun: «2 часа», «3 дня», «24/7 поддержка» stays split only at punctuation.
	const merged: CaptionWord[][] = [];
	for (const group of groups) {
		const previous = merged[merged.length - 1];
		const last = previous?.[previous.length - 1];
		if (last && NUMBER.test(last.text) && hasLetters(group[0].text)) {
			previous.push(...group);
		} else {
			merged.push([...group]);
		}
	}
	return merged;
}

const charCount = (words: CaptionWord[]) =>
	words.reduce((sum, word) => sum + Array.from(word.text).length, 0) +
	Math.max(0, words.length - 1);

/** Splits timed words into caption chunks; every chunk carries its words. */
export function chunkCaptionWords({
	words,
	limits,
}: {
	words: CaptionWord[];
	limits: ChunkLimits;
}): CaptionChunk[] {
	const pause = limits.pause ?? 0.6;
	const maxDuration = limits.maxDuration ?? 2.6;
	const tidied = tidy(words);
	const groups = glueGroups(tidied);
	// Capitals mark sentences only in punctuation-free transcripts; otherwise
	// brands and names mid-sentence («на Ozon», «у Ивана») stay in their chunk.
	const unpunctuated = !tidied.some((word) => SENTENCE_END.test(word.text));
	const chunks: CaptionWord[][] = [];
	let current: CaptionWord[] = [];

	const flush = () => {
		if (current.length) chunks.push(current);
		current = [];
	};

	for (const group of groups) {
		const last = current[current.length - 1];
		const longWord = group.length === 1 && Array.from(group[0].text).length > 14;
		if (last) {
			const tooMany = current.length + group.length > limits.maxWords;
			const tooLong = charCount([...current, ...group]) > limits.maxChars;
			const gap = group[0].startTime - last.endTime > pause;
			const sentence =
				SENTENCE_END.test(last.text) || (unpunctuated && SENTENCE_START.test(group[0].text));
			const comma =
				SOFT_END.test(last.text) &&
				current.length >= Math.max(2, Math.ceil(limits.maxWords / 2));
			const slow = group[group.length - 1].endTime - current[0].startTime > maxDuration;
			if (tooMany || tooLong || gap || sentence || comma || slow || longWord) flush();
		}
		current.push(...group);
		if (longWord) flush();
	}
	flush();

	const captions = chunks.map((chunkWords, index) => {
		const first = chunkWords[0];
		const lastWord = chunkWords[chunkWords.length - 1];
		const previousEnd = index > 0 ? chunks[index - 1][chunks[index - 1].length - 1].endTime : 0;
		// Appear 2 frames before the first word (perceived sync), never before the previous chunk ends.
		const startTime = Math.max(0, Math.min(first.startTime, Math.max(previousEnd, first.startTime - 2 / 30)));
		const nextStart = chunks[index + 1]?.[0].startTime;
		// Small gaps are bridged so captions don't flicker; otherwise linger 0.25 s.
		let end = lastWord.endTime + 0.25;
		if (nextStart != null) {
			const nextAppear = Math.max(lastWord.endTime, nextStart - 2 / 30);
			end = nextStart - lastWord.endTime < 0.35 ? nextAppear : Math.min(end, nextAppear);
		}
		return {
			text: chunkWords.map((word) => word.text).join(" "),
			startTime,
			duration: Math.max(0.3, end - startTime),
			words: chunkWords,
		};
	});
	// The 0.3 s minimum can outlast the next caption's early start in fast speech: end each caption where the
	// next one begins, so two captions are never on screen (or in the project) at once.
	for (let index = 1; index < captions.length; index++) {
		const previous = captions[index - 1];
		const room = captions[index].startTime - previous.startTime;
		if (room < previous.duration) {
			previous.duration = Math.max(0, room);
		}
	}
	// Two words stamped at one instant would leave a zero-length caption after the trim: drop it instead of
	// inserting a text element that no frame can show (and that the timeline's duration rule rejects).
	return captions.filter((caption) => caption.duration > 0);
}

/**
 * Word timings for captions that only have phrase timings (SRT, in-browser
 * Whisper): words are spread over the phrase in proportion to their length.
 */
export function spreadPhraseWords({
	text,
	startTime,
	duration,
}: {
	text: string;
	startTime: number;
	duration: number;
}): CaptionWord[] {
	const tokens = text.split(/\s+/).filter(Boolean);
	const weights = tokens.map((token) => Math.max(2, Array.from(token).length) + 1);
	const total = weights.reduce((sum, value) => sum + value, 0) || 1;
	const words: CaptionWord[] = [];
	let at = startTime;
	tokens.forEach((token, index) => {
		const length = (weights[index] / total) * duration;
		words.push({ text: token, startTime: at, endTime: at + length });
		at += length;
	});
	return words;
}
