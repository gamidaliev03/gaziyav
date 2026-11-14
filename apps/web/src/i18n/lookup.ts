// The words of the current interface language, with its fallback: the family's own corrections first (Settings →
// Language → «Suggest a translation»), then the language's dictionary, then Russian (ru.ts and its parts), then the
// English source text itself. Shared by t() (./index.ts) and the window-wide translator (./dom.ts).
import { RU, RU_PATTERNS } from "./ru";

/** One language's dictionary: English → text, and the pattern strings (the English regex's source → template). */
export interface LangPack {
	dict: Record<string, string>;
	patterns?: Record<string, string>;
}

type Replace = string | ((match: string, ...groups: string[]) => string);

let code = "en";
let pack: LangPack | null = null;
let fixes: Record<string, string> = {};

export function currentCode(): string {
	return code;
}

/** Called by ./index.ts when the language changes or a correction is saved. */
export function setLookup(next: string, nextPack: LangPack | null, nextFixes: Record<string, string>): void {
	code = next;
	pack = next === "en" || next === "ru" ? null : nextPack;
	fixes = next === "en" || next === "ru" ? {} : nextFixes;
}

/** The text for an English string in the current language, or undefined when nothing covers it (English stays). */
export function word(en: string): string | undefined {
	if (code === "en") return undefined;
	return fixes[en] ?? pack?.dict[en] ?? RU[en];
}

/** Which layer a string comes from, for the correction card: "fix" | "lang" | "ru" | undefined. */
export function wordSource(en: string): "fix" | "lang" | "ru" | undefined {
	if (code === "en") return undefined;
	if (fixes[en] !== undefined) return "fix";
	if (pack?.dict[en] !== undefined) return "lang";
	if (RU[en] !== undefined) return "ru";
	return undefined;
}

const tr = (s: string) => word(s) ?? s;

/** The two generic patterns («Name — what it does», «Man · calm») are joined only when one of their parts is known. */
const JOINS = new Set([String.raw`^(.+?) — (.+)$`, String.raw`^(.+?) · (.+)$`]);

/** Fill a language's pattern template: $1 … the part as it is, $t1 … the part translated. */
function fill(template: string, groups: string[]): string {
	return template.replace(/\$t(\d)/g, (_m, i: string) => tr(groups[Number(i) - 1] ?? "")).replace(/\$(\d)/g, (_m, i: string) => groups[Number(i) - 1] ?? "");
}

function viaPattern(key: string): string | null {
	for (const [re, ru] of RU_PATTERNS as Array<[RegExp, Replace]>) {
		const m = key.match(re);
		if (!m) continue;
		const groups = m.slice(1).map((g) => g ?? "");
		if (JOINS.has(re.source)) {
			const [a, b] = groups;
			if (word(a) === undefined && word(b) === undefined) return null;
			const sep = re.source.includes("—") ? " — " : " · ";
			return `${tr(a)}${sep}${tr(b)}`;
		}
		const own = pack?.patterns?.[re.source];
		if (own !== undefined) return fill(own, groups);
		const out = typeof ru === "string" ? key.replace(re, ru) : key.replace(re, ru);
		return out === key ? null : out;
	}
	return null;
}

/** The window-wide translation of one text node or attribute (null: leave it). Spaces around the text are kept. */
export function translateText(text: string): string | null {
	if (code === "en") return null;
	const key = text.trim();
	if (!key || key.length > 400) return null;
	const direct = word(key);
	if (direct !== undefined) return direct === key ? null : text.replace(key, direct);
	const out = viaPattern(key);
	return out === null || out === key ? null : text.replace(key, out);
}
