/**
 * Russian-aware line breaking for titles and captions.
 *
 * Prepositions, conjunctions and the negation particle must never be left at
 * the end of a line ("в", "и", "не", …) — they are glued to the next word.
 * Postpositive particles ("же", "ли", "бы") and dashes never start a line.
 */

const HANGING_WORDS = new Set([
	"а", "без", "в", "во", "да", "для", "до", "за", "и", "из", "изо", "или",
	"к", "ко", "как", "ли", "на", "над", "не", "ни", "но", "о", "об", "обо",
	"от", "ото", "по", "под", "при", "про", "с", "со", "у", "что", "чтобы",
	"через", "the", "a", "an", "to", "of", "and", "in", "on",
]);

const LEADING_GLUE = new Set(["же", "ж", "ли", "ль", "бы", "б", "—", "–", "-"]);
const UNIT_GLUE = /^(₽|руб\.?|р\.?|%|\$|€|шт\.?|кг|г|мл|л|см|мм|м|км|мин\.?|сек\.?|ч\.?)$/i;

function normalizeWord(word: string): string {
	return word.toLowerCase().replace(/^[«"'(\[]+|[»"'.,!?:;)\]…]+$/g, "");
}

export function isHangingWord(word: string): boolean {
	return HANGING_WORDS.has(normalizeWord(word));
}

/** Groups words that must stay on one line ("в доме", "500 ₽", "он же"). */
export function buildGlueGroups(words: string[]): string[][] {
	const groups: string[][] = [];
	let current: string[] = [];
	for (let index = 0; index < words.length; index++) {
		const word = words[index];
		const previous = current[current.length - 1];
		const shouldAttachToPrevious =
			current.length > 0 &&
			(isHangingWord(previous) ||
				LEADING_GLUE.has(normalizeWord(word)) ||
				UNIT_GLUE.test(word) ||
				(/^\d+$/.test(previous) && /^\d{3}$/.test(word)));
		if (current.length > 0 && !shouldAttachToPrevious) {
			groups.push(current);
			current = [];
		}
		current.push(word);
	}
	if (current.length > 0) groups.push(current);
	return groups;
}

/**
 * Wraps one paragraph into lines no wider than `maxWidth` (as measured by
 * `measure`). When the result has 2–3 lines the breaks are balanced so lines
 * have similar width (looks better for captions and titles).
 */
export function wrapParagraph({
	text,
	maxWidth,
	measure,
	balance = true,
}: {
	text: string;
	maxWidth: number;
	measure: (text: string) => number;
	balance?: boolean;
}): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [""];
	if (!(maxWidth > 0)) return [words.join(" ")];

	// Groups wider than the box are split back into words.
	const groups: string[] = [];
	for (const group of buildGlueGroups(words)) {
		const joined = group.join(" ");
		if (group.length > 1 && measure(joined) > maxWidth) {
			groups.push(...group);
		} else {
			groups.push(joined);
		}
	}

	const greedy: string[] = [];
	let line = groups[0];
	for (let index = 1; index < groups.length; index++) {
		const candidate = `${line} ${groups[index]}`;
		if (measure(candidate) <= maxWidth) {
			line = candidate;
		} else {
			greedy.push(line);
			line = groups[index];
		}
	}
	greedy.push(line);

	if (!balance || greedy.length < 2 || greedy.length > 3 || groups.length > 40) {
		return greedy;
	}
	return balanceLines({ groups, lineCount: greedy.length, measure }) ?? greedy;
}

function balanceLines({
	groups,
	lineCount,
	measure,
}: {
	groups: string[];
	lineCount: number;
	measure: (text: string) => number;
}): string[] | null {
	const n = groups.length;
	const widthCache = new Map<string, number>();
	const width = (from: number, to: number) => {
		const key = `${from}:${to}`;
		let value = widthCache.get(key);
		if (value === undefined) {
			value = measure(groups.slice(from, to).join(" "));
			widthCache.set(key, value);
		}
		return value;
	};
	// best[k][i] = minimal max-width splitting groups[0..i) into k lines
	const best: number[][] = [];
	const cut: number[][] = [];
	for (let k = 0; k <= lineCount; k++) {
		best.push(new Array(n + 1).fill(Number.POSITIVE_INFINITY));
		cut.push(new Array(n + 1).fill(-1));
	}
	best[0][0] = 0;
	for (let k = 1; k <= lineCount; k++) {
		for (let i = 1; i <= n; i++) {
			for (let j = k - 1; j < i; j++) {
				if (!Number.isFinite(best[k - 1][j])) continue;
				const value = Math.max(best[k - 1][j], width(j, i));
				if (value < best[k][i]) {
					best[k][i] = value;
					cut[k][i] = j;
				}
			}
		}
	}
	if (!Number.isFinite(best[lineCount][n])) return null;
	const lines: string[] = [];
	let end = n;
	for (let k = lineCount; k > 0; k--) {
		const start = cut[k][end];
		if (start < 0) return null;
		lines.unshift(groups.slice(start, end).join(" "));
		end = start;
	}
	return lines;
}

export function applyTextTransform({
	text,
	transform,
}: {
	text: string;
	transform: string | undefined;
}): string {
	switch (transform) {
		case "uppercase":
			return text.toLocaleUpperCase("ru-RU");
		case "lowercase":
			return text.toLocaleLowerCase("ru-RU");
		case "capitalize":
			return text.replace(
				/(^|[\s«"(—-])(\p{L})/gu,
				(_match, before: string, letter: string) =>
					`${before}${letter.toLocaleUpperCase("ru-RU")}`,
			);
		default:
			return text;
	}
}
