// Every interface language Gaziyav knows: its code, its own name in its own script, the direction of its writing and
// where a missing line comes from. A string with no line in a language falls back along `fallback` — Russian first
// (the family reads Russian), then English (the source text) — so a key is never shown.
//
// A language is offered in the pickers once it has a dictionary (src/i18n/<code>/, listed in ./lang-loaders.ts);
// English and Russian are always there.

export interface LangInfo {
	/** BCP 47 code (ISO 639): also the folder of its dictionary, src/i18n/<code>/. */
	code: string;
	/** The language's own name, in its own script (how the family finds it in the list). */
	name: string;
	/** Its name in English and in Russian (the second line in the list, search). */
	en: string;
	ru: string;
	script: "Latn" | "Cyrl" | "Armn" | "Geor" | "Arab" | "Deva" | "Hans" | "Jpan" | "Kore";
	dir: "ltr" | "rtl";
	/** Where a missing line comes from, in order (the English source text is always last). */
	fallback: string[];
	/** Machine translation into a language with little written material: «перевод проверяется» in the picker. */
	review?: boolean;
}

const RU_FIRST = ["ru", "en"];

export const LANGUAGES: LangInfo[] = [
	{ code: "en", name: "English", en: "English", ru: "Английский", script: "Latn", dir: "ltr", fallback: [] },
	{ code: "ru", name: "Русский", en: "Russian", ru: "Русский", script: "Cyrl", dir: "ltr", fallback: ["en"] },
	// the family's languages first
	{ code: "av", name: "Авар мацӀ", en: "Avar", ru: "Аварский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST, review: true },
	{ code: "ce", name: "Нохчийн мотт", en: "Chechen", ru: "Чеченский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST, review: true },
	{ code: "lbe", name: "Лакку маз", en: "Lak", ru: "Лакский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST, review: true },
	{ code: "dar", name: "Дарган мез", en: "Dargin", ru: "Даргинский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST, review: true },
	{ code: "kum", name: "Къумукъ тил", en: "Kumyk", ru: "Кумыкский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST, review: true },
	{ code: "lez", name: "Лезги чӀал", en: "Lezgian", ru: "Лезгинский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST, review: true },
	{ code: "tg", name: "Тоҷикӣ", en: "Tajik", ru: "Таджикский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST },
	{ code: "hy", name: "Հայերեն", en: "Armenian", ru: "Армянский", script: "Armn", dir: "ltr", fallback: RU_FIRST },
	{ code: "az", name: "Azərbaycanca", en: "Azerbaijani", ru: "Азербайджанский", script: "Latn", dir: "ltr", fallback: RU_FIRST },
	{ code: "ka", name: "ქართული", en: "Georgian", ru: "Грузинский", script: "Geor", dir: "ltr", fallback: RU_FIRST },
	{ code: "kk", name: "Қазақша", en: "Kazakh", ru: "Казахский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST },
	{ code: "uz", name: "Oʻzbekcha", en: "Uzbek", ru: "Узбекский", script: "Latn", dir: "ltr", fallback: RU_FIRST },
	{ code: "ky", name: "Кыргызча", en: "Kyrgyz", ru: "Киргизский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST },
	{ code: "tr", name: "Türkçe", en: "Turkish", ru: "Турецкий", script: "Latn", dir: "ltr", fallback: RU_FIRST },
	{ code: "ar", name: "العربية", en: "Arabic", ru: "Арабский", script: "Arab", dir: "rtl", fallback: RU_FIRST },
	{ code: "fa", name: "فارسی", en: "Persian", ru: "Персидский", script: "Arab", dir: "rtl", fallback: RU_FIRST },
	{ code: "uk", name: "Українська", en: "Ukrainian", ru: "Украинский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST },
	{ code: "be", name: "Беларуская", en: "Belarusian", ru: "Белорусский", script: "Cyrl", dir: "ltr", fallback: RU_FIRST },
	{ code: "de", name: "Deutsch", en: "German", ru: "Немецкий", script: "Latn", dir: "ltr", fallback: RU_FIRST },
	{ code: "fr", name: "Français", en: "French", ru: "Французский", script: "Latn", dir: "ltr", fallback: RU_FIRST },
	{ code: "es", name: "Español", en: "Spanish", ru: "Испанский", script: "Latn", dir: "ltr", fallback: RU_FIRST },
	{ code: "it", name: "Italiano", en: "Italian", ru: "Итальянский", script: "Latn", dir: "ltr", fallback: RU_FIRST },
	{ code: "pt", name: "Português", en: "Portuguese", ru: "Португальский", script: "Latn", dir: "ltr", fallback: RU_FIRST },
	{ code: "zh", name: "简体中文", en: "Chinese", ru: "Китайский", script: "Hans", dir: "ltr", fallback: RU_FIRST },
	{ code: "ja", name: "日本語", en: "Japanese", ru: "Японский", script: "Jpan", dir: "ltr", fallback: RU_FIRST },
	{ code: "ko", name: "한국어", en: "Korean", ru: "Корейский", script: "Kore", dir: "ltr", fallback: RU_FIRST },
	{ code: "hi", name: "हिन्दी", en: "Hindi", ru: "Хинди", script: "Deva", dir: "ltr", fallback: RU_FIRST },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function langInfo(code: string): LangInfo {
	return BY_CODE.get(code) ?? BY_CODE.get("en")!;
}

export function isKnownLang(code: unknown): code is string {
	return typeof code === "string" && BY_CODE.has(code);
}
