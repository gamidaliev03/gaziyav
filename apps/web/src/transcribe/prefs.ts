// The Captions tab remembers the last chosen speech language (per Mac, not per project).
const KEY = "opencut.captions.language";

export function loadLanguage(): string {
	try {
		return localStorage.getItem(KEY) || "auto";
	} catch {
		return "auto";
	}
}

export function saveLanguage(code: string) {
	try {
		localStorage.setItem(KEY, code);
	} catch {}
}

// Words per caption line (1–6; 3 is the ad-style default): the panel's «Words per line».
const WORDS_KEY = "gaziyav.captions.wordsPerLine";
export const DEFAULT_WORDS_PER_LINE = 3;
export const MAX_WORDS_PER_LINE = 6;

export function loadWordsPerLine(): number {
	try {
		const n = Number(localStorage.getItem(WORDS_KEY));
		return Number.isInteger(n) && n >= 1 && n <= MAX_WORDS_PER_LINE ? n : DEFAULT_WORDS_PER_LINE;
	} catch {
		return DEFAULT_WORDS_PER_LINE;
	}
}

export function saveWordsPerLine(n: number) {
	try {
		localStorage.setItem(WORDS_KEY, String(n));
	} catch {}
}
