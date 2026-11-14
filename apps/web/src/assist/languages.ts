// Languages for Translate & dub. `voice` = MiniMax's language_boost name; `local` = the free on-device voice
// (Qwen3-TTS) speaks it too.
export interface DubLanguage {
	code: string;
	name: string;
	voice: string;
	local: boolean;
}

export const DUB_LANGUAGES: DubLanguage[] = [
	{ code: "en", name: "English", voice: "English", local: true },
	{ code: "es", name: "Spanish", voice: "Spanish", local: true },
	{ code: "pt", name: "Portuguese", voice: "Portuguese", local: true },
	{ code: "de", name: "German", voice: "German", local: true },
	{ code: "fr", name: "French", voice: "French", local: true },
	{ code: "it", name: "Italian", voice: "Italian", local: true },
	{ code: "ru", name: "Russian", voice: "Russian", local: true },
	{ code: "zh", name: "Chinese", voice: "Chinese", local: true },
	{ code: "ja", name: "Japanese", voice: "Japanese", local: true },
	{ code: "ko", name: "Korean", voice: "Korean", local: true },
	{ code: "uk", name: "Ukrainian", voice: "Ukrainian", local: false },
	{ code: "tr", name: "Turkish", voice: "Turkish", local: false },
	{ code: "pl", name: "Polish", voice: "Polish", local: false },
	{ code: "nl", name: "Dutch", voice: "Dutch", local: false },
	{ code: "ar", name: "Arabic", voice: "Arabic", local: false },
	{ code: "hi", name: "Hindi", voice: "Hindi", local: false },
	{ code: "id", name: "Indonesian", voice: "Indonesian", local: false },
	{ code: "vi", name: "Vietnamese", voice: "Vietnamese", local: false },
];

export function dubLanguage(code: string | undefined): DubLanguage | undefined {
	return DUB_LANGUAGES.find((l) => l.code === code);
}
