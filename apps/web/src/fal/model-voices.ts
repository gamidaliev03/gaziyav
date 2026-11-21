// Every speech model's own voices and languages, ONE list for the voice pickers and the connector (principle 2):
// - MiniMax (fal-ai/minimax/speech-*): its system voices — MiniMax's own table (platform.minimax.io/docs/faq/system-voice-id,
//   read 21.11: 332 voices in 24 languages, minimax-voices.json) plus the classic English set fal's schema names
//   (Wise_Woman, Determined_Man…); its languages are fal's `language_boost` enum (read 21.11).
// - Qwen3 TTS: its nine speakers (the app's ready voices) and its `language` enum.
// - ElevenLabs on fal: eleven-voices.ts (21 voices by name), any ISO language.
// A card id is `mm:<voice_id>` (MiniMax), a ready voice id (Qwen) or `fal-el:<Name>`. Shared by page and server.
import minimax from "./minimax-voices.json";
import { ELEVEN_FAL_VOICES, ELEVEN_PREFIX } from "./eleven-voices";

export interface Lang {
	/** ISO 639-1 where there is one (yue: Cantonese). */
	code: string;
	/** MiniMax's language_boost name. */
	boost: string;
	ru: string;
	en: string;
}

/** fal's language_boost enum (minimax speech-02 / 2.8), with ISO codes and names. */
export const LANGS: Lang[] = [
	{ code: "en", boost: "English", ru: "Английский", en: "English" },
	{ code: "ru", boost: "Russian", ru: "Русский", en: "Russian" },
	{ code: "zh", boost: "Chinese", ru: "Китайский", en: "Chinese" },
	{ code: "yue", boost: "Chinese,Yue", ru: "Кантонский", en: "Cantonese" },
	{ code: "es", boost: "Spanish", ru: "Испанский", en: "Spanish" },
	{ code: "pt", boost: "Portuguese", ru: "Португальский", en: "Portuguese" },
	{ code: "fr", boost: "French", ru: "Французский", en: "French" },
	{ code: "de", boost: "German", ru: "Немецкий", en: "German" },
	{ code: "it", boost: "Italian", ru: "Итальянский", en: "Italian" },
	{ code: "ja", boost: "Japanese", ru: "Японский", en: "Japanese" },
	{ code: "ko", boost: "Korean", ru: "Корейский", en: "Korean" },
	{ code: "ar", boost: "Arabic", ru: "Арабский", en: "Arabic" },
	{ code: "tr", boost: "Turkish", ru: "Турецкий", en: "Turkish" },
	{ code: "uk", boost: "Ukrainian", ru: "Украинский", en: "Ukrainian" },
	{ code: "vi", boost: "Vietnamese", ru: "Вьетнамский", en: "Vietnamese" },
	{ code: "id", boost: "Indonesian", ru: "Индонезийский", en: "Indonesian" },
	{ code: "th", boost: "Thai", ru: "Тайский", en: "Thai" },
	{ code: "hi", boost: "Hindi", ru: "Хинди", en: "Hindi" },
	{ code: "nl", boost: "Dutch", ru: "Нидерландский", en: "Dutch" },
	{ code: "pl", boost: "Polish", ru: "Польский", en: "Polish" },
	{ code: "ro", boost: "Romanian", ru: "Румынский", en: "Romanian" },
	{ code: "el", boost: "Greek", ru: "Греческий", en: "Greek" },
	{ code: "cs", boost: "Czech", ru: "Чешский", en: "Czech" },
	{ code: "fi", boost: "Finnish", ru: "Финский", en: "Finnish" },
	{ code: "bg", boost: "Bulgarian", ru: "Болгарский", en: "Bulgarian" },
	{ code: "da", boost: "Danish", ru: "Датский", en: "Danish" },
	{ code: "he", boost: "Hebrew", ru: "Иврит", en: "Hebrew" },
	{ code: "ms", boost: "Malay", ru: "Малайский", en: "Malay" },
	{ code: "sk", boost: "Slovak", ru: "Словацкий", en: "Slovak" },
	{ code: "sv", boost: "Swedish", ru: "Шведский", en: "Swedish" },
	{ code: "hr", boost: "Croatian", ru: "Хорватский", en: "Croatian" },
	{ code: "hu", boost: "Hungarian", ru: "Венгерский", en: "Hungarian" },
	{ code: "no", boost: "Norwegian", ru: "Норвежский", en: "Norwegian" },
	{ code: "sl", boost: "Slovenian", ru: "Словенский", en: "Slovenian" },
	{ code: "ca", boost: "Catalan", ru: "Каталанский", en: "Catalan" },
	{ code: "nn", boost: "Nynorsk", ru: "Норвежский (нюнорск)", en: "Norwegian Nynorsk" },
	{ code: "af", boost: "Afrikaans", ru: "Африкаанс", en: "Afrikaans" },
];

export const langByCode = (code: string | undefined): Lang | undefined => LANGS.find((l) => l.code === code);
export const langByBoost = (boost: string | undefined): Lang | undefined => LANGS.find((l) => l.boost === boost);

export type SpeechFamily = "minimax" | "qwen" | "eleven" | "kie";
export const familyOf = (modelId: string): SpeechFamily =>
	modelId.includes("minimax/speech") ? "minimax" : modelId.includes("qwen-3-tts") ? "qwen" : modelId.includes("elevenlabs/tts") ? "eleven" : "kie";

export interface ModelVoice {
	/** The picker's card id. */
	id: string;
	/** What the model is sent. */
	voice: string;
	name: string;
	/** ISO code (Lang.code). */
	lang: string;
	family: SpeechFamily;
}

/** fal's classic MiniMax voices (its schema's examples): English. */
const MINIMAX_CLASSIC = ["Wise_Woman", "Friendly_Person", "Inspirational_girl", "Deep_Voice_Man", "Calm_Woman", "Casual_Guy", "Lively_Girl", "Patient_Man", "Young_Knight", "Determined_Man", "Lovely_Girl", "Decent_Boy", "Imposing_Manner", "Elegant_Man", "Abbess", "Sweet_Girl_2", "Exuberant_Girl"];

export const MM_PREFIX = "mm:";
/** The MiniMax model a MiniMax voice switches to when another speech model is picked. */
export const MINIMAX_DEFAULT = "fal-ai/minimax/speech-02-hd";

export const MINIMAX_VOICE_LIST: ModelVoice[] = [
	...(minimax as Array<{ id: string; name: string; lang: string }>).map((v) => ({ id: `${MM_PREFIX}${v.id}`, voice: v.id, name: v.name, lang: langByBoost(v.lang)?.code ?? "en", family: "minimax" as const })),
	...MINIMAX_CLASSIC.map((v) => ({ id: `${MM_PREFIX}${v}`, voice: v, name: v.replace(/_/g, " ").replace(/ 2$/, " II"), lang: "en", family: "minimax" as const })),
];

export const isMinimaxVoice = (id: string | undefined) => !!id && id.startsWith(MM_PREFIX) && MINIMAX_VOICE_LIST.some((v) => v.id === id);
export const minimaxVoiceId = (id: string | undefined) => (isMinimaxVoice(id) ? (id as string).slice(MM_PREFIX.length) : null);

/** The languages a model takes (Auto is always offered beside them). */
export function languagesOf(modelId: string): Lang[] {
	const f = familyOf(modelId);
	if (f === "qwen") return LANGS.filter((l) => ["en", "zh", "es", "fr", "de", "it", "ja", "ko", "pt", "ru"].includes(l.code));
	if (f === "minimax") return LANGS;
	// ElevenLabs (fal and kie): any ISO language its models know
	return LANGS.filter((l) => l.code !== "yue" && l.code !== "nn");
}

/** The voices a model offers itself (the ready voices and his clones are on top in every picker). */
export function voicesOf(modelId: string): ModelVoice[] {
	const f = familyOf(modelId);
	if (f === "minimax") return MINIMAX_VOICE_LIST;
	if (f === "eleven" || f === "kie") return ELEVEN_FAL_VOICES.map((v) => ({ id: `${ELEVEN_PREFIX}${v.name}`, voice: v.name, name: v.name, lang: "en", family: f }));
	return [];
}

/** A speech language to send: ISO code → what the model takes (MiniMax: language_boost names; Qwen: its words). */
export const boostOf = (code: string | undefined): string | undefined => langByCode(code)?.boost;
