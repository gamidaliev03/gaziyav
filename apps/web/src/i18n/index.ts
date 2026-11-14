// The UI language: English (the source text), Russian, or any language of ./languages.ts that has a dictionary; by
// default the system's.
//
// The English text IS the key. In a component: `const t = useT();` then `t("Export")` (the view re-renders when the
// language changes); elsewhere (toasts, menus built in code) plain `t("…")` reads the current language. Values go
// in braces: `t("{n} clips", { n })`; a translation may count with an ICU block, `{n, plural, one {# клип} other {…}}`.
// Add the Russian line for every new string to i18n/ru.ts (or your ru-<area>.ts); every other language falls back to
// Russian, then English, for a line it does not have yet — nothing ever breaks and a key is never shown.
// Constants (tab names, option labels) stay English and are wrapped where they are drawn: `t(tab.label)`.
//
// `lang` stays "en" | "ru" — the base the older code reads (dates, defaults): every language but English is "ru"
// there, its fallback. `code` is the language actually shown.
import { create } from "zustand";
import { restartDomTranslation } from "./dom";
import { LOADERS } from "./lang-loaders";
import { isKnownLang, langInfo } from "./languages";
import { type LangPack, setLookup, word } from "./lookup";

export type Lang = "en" | "ru";
/** What Settings → General → Language stores: a language code of ./languages.ts, or "system" (the Mac's language). */
export type LangChoice = string;

const STORAGE_KEY = "gaziyav.language";
const FIXES_KEY = "gaziyav.i18n.fixes";

/** Languages the pickers offer: English, Russian and every language with a dictionary. */
export function availableCodes(): string[] {
	return ["en", "ru", ...Object.keys(LOADERS)];
}

function systemCode(): string {
	if (typeof navigator === "undefined") return "en";
	const offered = new Set(availableCodes());
	for (const tag of navigator.languages ?? [navigator.language ?? "en"]) {
		const base = tag.toLowerCase().split("-")[0];
		if (offered.has(base)) return base;
	}
	return "en";
}

function storedChoice(): LangChoice {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v && isKnownLang(v)) return v;
	} catch {}
	return "system";
}

interface LangState {
	choice: LangChoice;
	/** The base for older code: "ru" for every language but English. */
	lang: Lang;
	/** The language shown. */
	code: string;
	/** Bumped whenever the words change (a language, its dictionary arriving, a correction). */
	rev: number;
}

// Starts in English on the server and in the first client render (no hydration mismatch); bootLanguage() switches
// to the stored or system language right after.
export const useLang = create<LangState>()(() => ({ choice: "system", lang: "en", code: "en", rev: 0 }));

const packs = new Map<string, LangPack>();

// ---------- the family's corrections («Suggest a translation»), kept on this Mac ----------

type Fixes = Record<string, Record<string, string>>;
function readFixes(): Fixes {
	try {
		const raw = JSON.parse(localStorage.getItem(FIXES_KEY) ?? "{}");
		return raw && typeof raw === "object" ? raw : {};
	} catch {
		return {};
	}
}
export function fixesOf(code: string): Record<string, string> {
	return readFixes()[code] ?? {};
}
/** Save (or, with an empty text, remove) one correction of the language shown; it is used at once. */
export function saveFix(en: string, text: string | null): void {
	const { code } = useLang.getState();
	if (code === "en" || code === "ru") return;
	const all = readFixes();
	const mine = { ...(all[code] ?? {}) };
	if (text === null || !text.trim()) delete mine[en];
	else mine[en] = text;
	all[code] = mine;
	try {
		localStorage.setItem(FIXES_KEY, JSON.stringify(all));
	} catch {}
	refresh();
}

function refresh() {
	const { code } = useLang.getState();
	setLookup(code, packs.get(code) ?? null, fixesOf(code));
	useLang.setState((s) => ({ rev: s.rev + 1 }));
	if (typeof document !== "undefined") restartDomTranslation(code !== "en");
}

// ---------- switching ----------

const FONT_STYLE_ID = "gz-i18n-fonts";
/** Scripts Golos Text does not draw: the Mac's own fonts that do, named before the system's last resort. */
const SCRIPT_FONTS: Record<string, string> = {
	Armn: `"SF Armenian", "Noto Sans Armenian", "Mshtakan"`,
	Geor: `"SF Georgian", "Noto Sans Georgian", "Helvetica Neue"`,
	Arab: `"SF Arabic", "Geeza Pro", "Noto Sans Arabic"`,
	Deva: `"Kohinoor Devanagari", "ITF Devanagari", "Devanagari Sangam MN"`,
	Hans: `"PingFang SC", "Hiragino Sans GB"`,
	Jpan: `"Hiragino Sans", "Hiragino Kaku Gothic ProN"`,
	Kore: `"Apple SD Gothic Neo"`,
};
function fontStyle() {
	if (typeof document === "undefined" || document.getElementById(FONT_STYLE_ID)) return;
	const rules = Object.entries(SCRIPT_FONTS).map(([script, fonts]) => `html[data-script="${script}"] body{font-family:var(--font-golos),${fonts},system-ui,sans-serif}`);
	const style = document.createElement("style");
	style.id = FONT_STYLE_ID;
	style.textContent = rules.join("\n");
	document.head.appendChild(style);
}

let switching = 0;
function apply(choice: LangChoice) {
	const code = choice === "system" || !isKnownLang(choice) ? systemCode() : choice;
	const info = langInfo(code);
	const lang: Lang = code === "en" ? "en" : "ru";
	const turn = ++switching;
	setLookup(code, packs.get(code) ?? null, fixesOf(code));
	useLang.setState((s) => ({ choice, lang, code, rev: s.rev + 1 }));
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	root.lang = code;
	root.dir = info.dir;
	root.dataset.script = info.script;
	fontStyle();
	restartDomTranslation(code !== "en");
	// the Mac app's own menus follow the same language
	(window as unknown as { studioApp?: { setLanguage?: (lang: string) => void } }).studioApp?.setLanguage?.(code);
	// a language with its own dictionary: Russian at once (its fallback), its own words as soon as they are loaded
	const load = LOADERS[code];
	if (!load || packs.has(code)) return;
	load()
		.then((pack) => {
			packs.set(code, pack);
			if (turn === switching) refresh();
		})
		.catch(() => {});
}

/** Once, from the app shell after the first render. */
export function bootLanguage() {
	apply(storedChoice());
}

export function setLanguage(choice: LangChoice) {
	try {
		if (choice === "system") localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, choice);
	} catch {}
	apply(choice);
}

// ---------- the words ----------

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralOf(code: string, n: number): string {
	let rules = pluralRules.get(code);
	if (!rules) {
		let tag = code;
		try {
			if (!Intl.PluralRules.supportedLocalesOf([code]).length) tag = "en";
		} catch {
			tag = "en";
		}
		rules = new Intl.PluralRules(tag);
		pluralRules.set(code, rules);
	}
	return rules.select(n);
}

/** `{n, plural, =0 {…} one {# …} few {…} other {…}}` blocks: the form for the number, `#` the number itself. */
function plurals(text: string, vars: Record<string, string | number>): string {
	if (!text.includes(", plural,")) return text;
	let out = "";
	let i = 0;
	while (i < text.length) {
		const start = text.indexOf("{", i);
		const head = start < 0 ? null : text.slice(start).match(/^\{(\w+), plural,\s*/);
		if (start < 0 || !head) {
			if (start < 0) {
				out += text.slice(i);
				break;
			}
			out += text.slice(i, start + 1);
			i = start + 1;
			continue;
		}
		out += text.slice(i, start);
		// the forms: «key {text}» pairs up to the block's closing brace
		let j = start + head[0].length;
		const forms: Record<string, string> = {};
		while (j < text.length && text[j] !== "}") {
			const key = text.slice(j).match(/^\s*(=\d+|zero|one|two|few|many|other)\s*\{/);
			if (!key) break;
			j += key[0].length;
			let depth = 1;
			let k = j;
			while (k < text.length && depth > 0) {
				if (text[k] === "{") depth++;
				else if (text[k] === "}") depth--;
				k++;
			}
			forms[key[1]] = text.slice(j, k - 1);
			j = k;
			while (text[j] === " ") j++;
		}
		const n = Number(vars[head[1]]);
		const form = forms[`=${n}`] ?? forms[Number.isFinite(n) ? pluralOf(useLang.getState().code, n) : "other"] ?? forms.other ?? "";
		out += form.replace(/#/g, String(vars[head[1]] ?? ""));
		i = j + 1;
	}
	return out;
}

export function t(en: string, vars?: Record<string, string | number>): string {
	const text = word(en) ?? en;
	if (!vars) return text;
	return plurals(text, vars).replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));
}

/** `t` for components: subscribes to the language, so the component re-renders when it (or its words) change. */
export function useT(): typeof t {
	useLang((s) => s.rev);
	return t;
}
