/**
 * Smart search: one ranked lexical matcher for every search field
 * (port of Kadr `SmartSearch.swift`, no embeddings).
 *
 * Survives:
 *  - case / accents / ё;
 *  - typos (optimal-string-alignment Damerau–Levenshtein);
 *  - the wrong keyboard layout ("цщщыр" → "woosh", "ghbdtn" → "привет");
 *  - Russian transliteration ("глитч" → "glitch");
 *  - a RU → EN editing vocabulary ("переход" → transition, "вжух" → whoosh);
 *  - joined words ("lo fi" ↔ "lofi").
 *
 * Every typed word has to match something; results are ranked, ties keep the
 * original order.
 */
import { VOCABULARY } from "./vocabulary";

interface Word {
	text: string;
	units: number[];
	cyrillic: boolean;
}

type Alternative = { word: Word; weight: number };

function makeWord(text: string): Word {
	const units: number[] = [];
	let cyrillic = false;
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		units.push(code);
		if (code >= 0x400 && code <= 0x4ff) cyrillic = true;
	}
	return { text, units, cyrillic };
}

const NON_WORD = /[^\p{L}\p{N}]+/u;
const COMBINING_MARKS = /[̀-ͯ]/g;

export function tokenize(value: string): string[] {
	let folded = value.toLowerCase();
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII fast path.
	if (/[^\x00-\x7f]/.test(folded)) {
		folded = folded
			.replaceAll("ё", "е")
			.normalize("NFKD")
			.replace(COMBINING_MARKS, "")
			// NFKD splits "й" into "и" + breve; restore it.
			.replaceAll("й", "й");
	}
	return folded.split(NON_WORD).filter((token) => token.length > 0);
}

const LATIN_KEYS = Array.from("qwertyuiop[]asdfghjkl;'zxcvbnm,.`");
const CYRILLIC_KEYS = Array.from("йцукенгшщзхъфывапролджэячсмитьбюё");
const LATIN_TO_CYR = new Map(LATIN_KEYS.map((ch, i) => [ch, CYRILLIC_KEYS[i]]));
const CYR_TO_LATIN = new Map(CYRILLIC_KEYS.map((ch, i) => [ch, LATIN_KEYS[i]]));

/** The same keystrokes on the other keyboard layout (RU ↔ EN). */
export function swapLayout(value: string): string {
	const lower = value.toLowerCase();
	const chars = Array.from(lower);
	const hasCyrillic = chars.some((ch) => CYR_TO_LATIN.has(ch));
	const table = hasCyrillic ? CYR_TO_LATIN : LATIN_TO_CYR;
	return chars.map((ch) => table.get(ch) ?? ch).join("");
}

const TRANSLIT: Record<string, string> = {
	а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i",
	й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
	т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
	ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Russian letters spelled in Latin ("глитч" → "glitch"). */
export function translit(value: string): string {
	const chars = Array.from(value);
	if (!chars.some((ch) => ch in TRANSLIT)) return value;
	return chars.map((ch) => TRANSLIT[ch] ?? ch).join("");
}

/** Optimal-string-alignment distance; stops early once past `limit`. */
export function osaDistance<T>(a: T[], b: T[], limit: number): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	let prev2 = new Array<number>(b.length + 1).fill(0);
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	let cur = new Array<number>(b.length + 1).fill(0);
	for (let i = 1; i <= a.length; i++) {
		cur[0] = i;
		let rowMin = cur[0];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				v = Math.min(v, prev2[j - 2] + 1);
			}
			cur[j] = v;
			if (v < rowMin) rowMin = v;
		}
		if (rowMin > limit) return limit + 1;
		const nextCur = prev2;
		prev2 = prev;
		prev = cur;
		cur = nextCur;
	}
	return prev[b.length];
}

/** Vocabulary words this word stands for; also matches word beginnings and one-letter typos. */
export function synonyms(word: string): readonly string[] {
	const direct = VOCABULARY.get(word);
	if (direct) return direct;
	if (Array.from(word).length < 4) return [];
	const wordChars = Array.from(word);
	let best: { key: string; distance: number } | null = null;
	for (const key of VOCABULARY.keys()) {
		if (Array.from(key).length < 4) continue;
		if (key.startsWith(word) || word.startsWith(key)) {
			return VOCABULARY.get(key) ?? [];
		}
		const d = osaDistance(wordChars, Array.from(key), 1);
		if (d <= 1 && d < (best?.distance ?? 9)) best = { key, distance: d };
	}
	return best ? (VOCABULARY.get(best.key) ?? []) : [];
}

function startsWithUnits(haystack: number[], needle: number[]): boolean {
	if (needle.length > haystack.length) return false;
	for (let i = 0; i < needle.length; i++) {
		if (haystack[i] !== needle[i]) return false;
	}
	return true;
}

function containsUnits(haystack: number[], needle: number[]): boolean {
	const n = needle.length;
	const h = haystack.length;
	if (n > h) return false;
	const first = needle[0];
	for (let i = 0; i <= h - n; i++) {
		if (haystack[i] !== first) continue;
		let j = 1;
		while (j < n && haystack[i + j] === needle[j]) j++;
		if (j === n) return true;
	}
	return false;
}

/** 1 exact · 0.9 prefix · 0.7 inside · 0.6 typo (1 edit up to 6 letters, 2 beyond). */
function matchWord(a: Word, t: Word): number {
	if (a.cyrillic !== t.cyrillic) return 0;
	const au = a.units;
	const tu = t.units;
	if (startsWithUnits(tu, au)) {
		if (au.length === tu.length) return 1;
		return au.length >= 2 || tu.length <= 3 ? 0.9 : 0.5;
	}
	if (au.length >= 3 && tu.length > au.length && containsUnits(tu, au)) return 0.7;
	if (au.length < 4 || tu.length < 3) return 0;
	// Typos keep the first letter (or swap the first two).
	if (!(au[0] === tu[0] || (au[1] === tu[0] && au[0] === tu[1]))) return 0;
	const limit = au.length >= 7 ? 2 : 1;
	for (const len of [tu.length, au.length - 1, au.length, au.length + 1]) {
		if (len < 3 || len > tu.length) continue;
		if (osaDistance(au, tu.slice(0, len), limit) <= limit) return 0.6;
	}
	return 0;
}

// Field strings rarely change (asset names): tokenise each once.
const fieldCache = new Map<string, Word[]>();
const FIELD_CACHE_LIMIT = 50_000;

function fieldWordsOf(field: string): Word[] {
	const cached = fieldCache.get(field);
	if (cached) return cached;
	const tokens = tokenize(field);
	const words = tokens.map(makeWord);
	// Joined pairs where a part is short ("lo fi" → lofi, "hip hop" → hiphop).
	for (let j = 0; j < tokens.length - 1; j++) {
		if (Math.min(tokens[j].length, tokens[j + 1].length) <= 3) {
			words.push(makeWord(tokens[j] + tokens[j + 1]));
		}
	}
	if (fieldCache.size > FIELD_CACHE_LIMIT) fieldCache.clear();
	fieldCache.set(field, words);
	return words;
}

export class SmartQuery {
	/** Per typed word: its alternatives with a weight. */
	private readonly words: Alternative[][];

	constructor(raw: string) {
		const base = tokenize(raw);
		const swapped = tokenize(swapLayout(raw));
		this.words = base.map((token, i) => {
			const alternatives: Array<[string, number]> = [[token, 1]];
			if (i < swapped.length && swapped[i] !== token) {
				alternatives.push([swapped[i], 0.95]);
			}
			const transliterated = translit(token);
			if (transliterated !== token) alternatives.push([transliterated, 0.8]);
			for (const [alternative] of [...alternatives]) {
				for (const synonym of synonyms(alternative)) {
					alternatives.push([synonym, 0.85]);
				}
			}
			const best = new Map<string, number>();
			for (const [text, weight] of alternatives) {
				if (!text) continue;
				best.set(text, Math.max(best.get(text) ?? 0, weight));
			}
			return [...best].map(([text, weight]) => ({
				word: makeWord(text),
				weight,
			}));
		});
	}

	get isEmpty(): boolean {
		return this.words.length === 0;
	}

	/** 0 = no match. Words of the first field (the name) rank ×1.15. */
	score(fields: readonly string[]): number {
		const fieldWords: Word[] = [];
		let nameCount = 0;
		for (let k = 0; k < fields.length; k++) {
			const words = fieldWordsOf(fields[k] ?? "");
			for (const word of words) fieldWords.push(word);
			if (k === 0) nameCount = words.length;
		}
		if (fieldWords.length === 0) return 0;
		let total = 0;
		for (const alternatives of this.words) {
			let best = 0;
			for (const { word, weight } of alternatives) {
				for (let k = 0; k < fieldWords.length; k++) {
					const raw = matchWord(word, fieldWords[k]);
					if (raw <= 0) continue;
					const value = raw * weight * (k < nameCount ? 1.15 : 1);
					if (value > best) best = value;
				}
			}
			if (best === 0) return 0;
			total += best;
		}
		return total;
	}
}

/** Items matching `query`, best first (stable for equal scores). An empty query returns everything. */
export function smartFilter<T>({
	items,
	query,
	fields,
}: {
	items: readonly T[];
	query: string;
	fields: (item: T) => readonly string[];
}): T[] {
	const smartQuery = new SmartQuery(query);
	if (smartQuery.isEmpty) return [...items];
	const scored: Array<{ index: number; score: number; item: T }> = [];
	items.forEach((item, index) => {
		const score = smartQuery.score(fields(item));
		if (score > 0) scored.push({ index, score, item });
	});
	scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.index - b.index));
	return scored.map((entry) => entry.item);
}

export function smartScore({
	query,
	fields,
}: {
	query: string;
	fields: readonly string[];
}): number {
	return new SmartQuery(query).score(fields);
}

export function smartMatches({
	query,
	fields,
}: {
	query: string;
	fields: readonly string[];
}): boolean {
	return smartScore({ query, fields }) > 0;
}
