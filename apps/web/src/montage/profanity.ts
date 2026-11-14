// Swear words never go on screen as they are: the middle is masked (за••••и; "•", not "*", which marks accents). Applied to every text an AI layer
// shows (the model is asked to do it too, but this is the guarantee). Pure: used by the server and the editor.

const SWEAR = /(^|[^а-яё])((?:за|по|на|от|вы|у|при|раз|до|съ|под|недо|пере|ё|о)?(?:еб|ёб)[а-яё]*|бля[а-яё]*|[а-яё]*(?:хуй|хуе|хуё|хуя|пизд|мудак|мудил|гандон|залуп)[а-яё]*|сук[аи]|сучк[а-яё]*)(?=$|[^а-яё])/gi;
const SWEAR_EN = /\b(fuck\w*|shit\w*|bitch\w*)\b/gi;

function mask(word: string): string {
	if (word.length <= 3) return `${word[0]}${"•".repeat(word.length - 1)}`;
	return `${word.slice(0, 2)}${"•".repeat(word.length - 3)}${word.slice(-1)}`;
}

// Words that only look like a stem match (небо, хлеб, ребёнок…) are protected by requiring the stem at a word start.
const SAFE = /^(ебет|ебен)$/i;

export function maskSwears(text: string): string {
	return text
		.replace(SWEAR, (all, pre: string, word: string) => (SAFE.test(word) ? all : `${pre}${mask(word)}`))
		.replace(SWEAR_EN, (w) => mask(w));
}

/** Masks every string inside a value (strings, lists, objects). */
export function maskDeep<T>(v: T): T {
	if (typeof v === "string") return maskSwears(v) as T;
	if (Array.isArray(v)) return v.map(maskDeep) as T;
	if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)])) as T;
	return v;
}
