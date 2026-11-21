// Settings → Services: one row per ability, and the services each can use — Gaziyav's own (the default, as 1.0.58 does
// it) first, then the services of OpenFilm's providers registry (openfilm/*.mjs, MIT), each with the key it needs.
// Shared by the page and the server (no Node imports here).

export type Ability = "tts" | "music" | "sfx" | "asr" | "cutout" | "image" | "image-search" | "video" | "video-search" | "translate" | "web-search";

export interface Row {
	id: Ability;
	ru: { name: string; note: string };
	en: { name: string; note: string };
}

export const ROWS: Row[] = [
	{ id: "tts", ru: { name: "Озвучка", note: "Голос за кадром из текста" }, en: { name: "Voice-over", note: "Speech from text" } },
	{ id: "music", ru: { name: "Генерация музыки", note: "Музыка по описанию" }, en: { name: "Music generation", note: "Music from a description" } },
	{ id: "sfx", ru: { name: "Генерация звуков", note: "Звуковые эффекты по описанию" }, en: { name: "Sound generation", note: "Sound effects from a description" } },
	{ id: "asr", ru: { name: "Транскрипция", note: "Слова и субтитры из речи" }, en: { name: "Transcription", note: "Words and captions from speech" } },
	{ id: "cutout", ru: { name: "Удаление фона (на этом Mac)", note: "Фон с картинки убирается без интернета" }, en: { name: "Background removal (on this Mac)", note: "A picture's background taken out offline" } },
	{ id: "image", ru: { name: "Генерация картинок", note: "Картинки по описанию" }, en: { name: "Image generation", note: "Pictures from a description" } },
	{ id: "image-search", ru: { name: "Поиск картинок", note: "Картинки из интернета, которые можно брать" }, en: { name: "Image search", note: "Pictures from the web you may use" } },
	{ id: "video", ru: { name: "Генерация видео", note: "Клипы по описанию и картинке" }, en: { name: "Video generation", note: "Clips from a description and a picture" } },
	{ id: "video-search", ru: { name: "Поиск видео", note: "Стоковые клипы из интернета" }, en: { name: "Video search", note: "Stock clips from the web" } },
	{ id: "translate", ru: { name: "Перевод субтитров", note: "Субтитры на другой язык" }, en: { name: "Caption translation", note: "Captions in another language" } },
	{ id: "web-search", ru: { name: "Поиск в интернете", note: "Факты для титров и сценариев" }, en: { name: "Web search", note: "Facts for titles and scripts" } },
];

/** A service with a key of its own (kept by the app like the fal.ai key; `gz` = the key the app keeps for it). */
export interface Service {
	id: string;
	name: string;
	keysUrl: string;
	/** Also works with no key (a key lifts its limits). */
	keyless?: boolean;
	/** Where its key is pasted when it isn't on this tab (fal.ai / kie.ai / ArgoLink: Settings → Services). */
	elsewhere?: "ai";
	/** How the key looks, said where it is pasted. */
	hint?: { ru: string; en: string };
}

export const SERVICES: Service[] = [
	{ id: "fal", name: "fal.ai", keysUrl: "https://fal.ai/dashboard/keys", elsewhere: "ai" },
	{ id: "kie", name: "kie.ai", keysUrl: "https://kie.ai/api-key", elsewhere: "ai" },
	{ id: "argo", name: "ArgoLink", keysUrl: "https://argolink.ai", elsewhere: "ai" },
	{ id: "elevenlabs", name: "ElevenLabs", keysUrl: "https://elevenlabs.io/app/settings/api-keys" },
	{ id: "inworld", name: "Inworld", keysUrl: "https://platform.inworld.ai/api-keys" },
	{ id: "cartesia", name: "Cartesia", keysUrl: "https://play.cartesia.ai/keys" },
	{ id: "openai", name: "OpenAI", keysUrl: "https://platform.openai.com/api-keys" },
	{ id: "google", name: "Google (Gemini API)", keysUrl: "https://aistudio.google.com/apikey" },
	{ id: "openrouter", name: "OpenRouter", keysUrl: "https://openrouter.ai/settings/keys" },
	{ id: "groq", name: "Groq", keysUrl: "https://console.groq.com/keys" },
	{ id: "azure", name: "Microsoft Azure", keysUrl: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/SpeechServices", hint: { ru: "регион:ключ, например eastus:a1b2…", en: "region:key, e.g. eastus:a1b2…" } },
	{ id: "doubao", name: "Doubao", keysUrl: "https://console.volcengine.com/speech/app" },
	{ id: "mimo", name: "Xiaomi MiMo", keysUrl: "https://platform.xiaomimimo.com/console/api-keys" },
	{ id: "pexels", name: "Pexels", keysUrl: "https://www.pexels.com/api/" },
	{ id: "pixabay", name: "Pixabay", keysUrl: "https://pixabay.com/api/docs/" },
	{ id: "brave", name: "Brave Search", keysUrl: "https://api-dashboard.search.brave.com/app/keys" },
	{ id: "tavily", name: "Tavily", keysUrl: "https://app.tavily.com/home" },
	{ id: "keenable", name: "Keenable", keysUrl: "https://app.keenable.ai/console", keyless: true },
];

/** The keys this tab keeps (the others are Settings → Services's, already there). */
export const OWN_KEYS = SERVICES.filter((s) => !s.elsewhere).map((s) => s.id);

export interface Option {
	/** "gaziyav" (Gaziyav's own way), a provider id, or "<provider>:<model>". */
	id: string;
	ru: string;
	en: string;
	/** The keys it needs, any of them (none: «без ключа»). */
	keys: string[];
	/** OpenFilm's provider id that runs it, and its model. */
	provider?: string;
	model?: string;
	/** It works with no key at all. */
	free?: boolean;
	/** Chosen, it is used by the panels and the chat's tools now (false: shown, not yet run by Gaziyav 1). */
	wired: boolean;
}

/** OpenFilm's models of each ability, by provider (openfilm/*.mjs `models`, read 21.11). */
const MODELS: Record<string, Partial<Record<Ability, Array<[string, string]>>>> = {
	elevenlabs: { tts: [["eleven_v4", "Eleven v4"], ["eleven_v4_turbo", "Eleven v4 Turbo"]], sfx: [["eleven_text_to_sound_v2", "Sound Effects v2"]], music: [["music_v2_5", "Music v2.5"], ["music_v2", "Music v2"]], asr: [["scribe_v2", "Scribe v2"]] },
	inworld: { tts: [["inworld-tts-2", "TTS-2"], ["inworld-tts-2-flash", "TTS-2 Flash"]] },
	cartesia: { tts: [["sonic-3.6", "Sonic 3.6"]] },
	openai: {
		tts: [["gpt-4o-mini-tts", "GPT-4o mini TTS"]],
		image: [["gpt-image-2.6-flare", "GPT Image 2.6 Flare"], ["gpt-image-2.6-sunburst", "GPT Image 2.6 Sunburst"], ["gpt-image-2.5-flare", "GPT Image 2.5 Flare"], ["gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"]],
		asr: [["whisper-1", "Whisper"]],
		translate: [["gpt-6-luna", "GPT-6 Luna"], ["gpt-6.1-sol", "GPT-6.1 Sol"], ["gpt-6-astra", "GPT-6 Astra"]],
	},
	google: {
		tts: [["gemini-3.8-flash-tts", "Gemini 3.8 Flash TTS"], ["gemini-3.8-flash-lite-tts", "Gemini 3.8 Flash-Lite TTS"]],
		asr: [["gemini-3.5-transcribe", "Gemini 3.5 Transcribe"]],
		image: [["gemini-3.1-flash-image", "Gemini 3.1 Flash Image"], ["gemini-3-pro-image", "Nano Banana Pro"], ["gemini-3.1-flash-lite-image", "Gemini 3.1 Flash-Lite Image"]],
		video: [["gemini-omni-1.2-flash", "Gemini Omni 1.2 Flash"]],
		translate: [["gemini-3.8-flash", "Gemini 3.8 Flash"], ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"], ["gemini-3.1-pro-preview", "Gemini 3.1 Pro"]],
	},
	fal: {
		image: [["fal-ai/flux-2-pro", "FLUX.2 [pro]"], ["fal-ai/flux-2-max", "FLUX.2 [max]"]],
		video: [["seedance-2.0", "Seedance 2.0"], ["seedance-2.0-fast", "Seedance 2.0 Fast"], ["kling-3.0-pro", "Kling 3.0 Pro"], ["kling-3.0-standard", "Kling 3.0 Standard"]],
		music: [["fal-ai/stable-audio-25/text-to-audio", "Stable Audio 2.5"], ["fal-ai/lyria2", "Lyria 2"]],
		sfx: [["fal-ai/elevenlabs/sound-effects/v2", "ElevenLabs Sound Effects v2"], ["fal-ai/stable-audio-25/text-to-audio", "Stable Audio 2.5"]],
	},
	openrouter: {
		image: [["openai/gpt-image-2.6-flare", "GPT Image 2.6 Flare"], ["openai/gpt-image-2.6-sunburst", "GPT Image 2.6 Sunburst"], ["openai/gpt-image-2.5-flare", "GPT Image 2.5 Flare"], ["openai/gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"], ["google/gemini-nano-banana-2.1", "Nano Banana 2.1"], ["google/gemini-3-pro-image", "Nano Banana Pro"], ["bytedance-seed/seedream-5-0-pro", "Seedream 5.0 Pro"], ["black-forest-labs/flux-3-image", "FLUX.3"]],
		video: [["bytedance/seedance-2.0-fast", "Seedance 2.0 Fast"], ["bytedance/seedance-2.0-mini", "Seedance 2.0 Mini"], ["bytedance/seedance-2.0", "Seedance 2.0"], ["bytedance/seedance-2.5", "Seedance 2.5"], ["alibaba/wan-3.0", "Wan 3.0"], ["alibaba/wan-3.0-prime", "Wan 3.0 Prime"], ["minimax/hailuo-3", "MiniMax Hailuo 3"], ["minimax/hailuo-3-max", "MiniMax Hailuo 3 Max"], ["heygen/heygen-video-1", "HeyGen Video"], ["kwaivgi/kling-v3.0-std", "Kling 3.0 Standard"], ["kwaivgi/kling-v3.0-pro", "Kling 3.0 Pro"], ["google/gemini-omni-1.2-flash", "Gemini Omni 1.2 Flash"], ["tbc/mischief-1", "TBC mischief 1"], ["x-ai/grok-imagine-video-1.5-lite", "Grok Imagine Video 1.5 Lite"]],
	},
	pexels: { "image-search": [["photos", "Photos"]], "video-search": [["videos", "Videos"]] },
	pixabay: { "image-search": [["photo", "Photos"], ["illustration", "Illustrations"], ["all", "Photos and illustrations"]], "video-search": [["film", "Footage"], ["animation", "Animation"], ["all", "Footage and animation"]] },
	brave: { "web-search": [["web", "Web Search"]] },
	tavily: { "web-search": [["basic", "Search"], ["advanced", "Advanced Search"]] },
	groq: { asr: [["whisper-large-v3-turbo", "Whisper Large v3 Turbo"], ["whisper-large-v3", "Whisper Large v3"]], tts: [["canopylabs/orpheus-v1-english", "Orpheus English"], ["canopylabs/orpheus-arabic-saudi", "Orpheus Arabic (Saudi)"]] },
	azure: { tts: [["neural", "Neural voices"]] },
	doubao: { asr: [["volc.bigasr.auc_turbo", "Big ASR Turbo"]] },
	mimo: { asr: [["mimo-v2.5-asr", "MiMo-V2.5-ASR"]], tts: [["mimo-v2.5-tts", "MiMo-V2.5-TTS"]] },
	keenable: { "web-search": [["web", "Web Search"]] },
};

/** The model names in Russian where they are words, not names. */
const RU_MODEL: Record<string, string> = { Photos: "Фото", Illustrations: "Иллюстрации", "Photos and illustrations": "Фото и иллюстрации", Videos: "Видео", Footage: "Съёмка", Animation: "Анимация", "Footage and animation": "Съёмка и анимация", "Web Search": "Веб-поиск", Search: "Поиск", "Advanced Search": "Расширенный поиск", "Neural voices": "Нейроголоса" };

/** What Gaziyav 1 itself does for each ability (1.0.58), the default of its row. */
const OWN: Record<Ability, Omit<Option, "id" | "wired"> | null> = {
	tts: { ru: "Газияв: fal.ai / kie.ai (модель — выше)", en: "Gaziyav: fal.ai / kie.ai (model above)", keys: ["fal", "kie"] },
	music: { ru: "Газияв: музыка из библиотеки", en: "Gaziyav: music from the library", keys: [], free: true },
	sfx: { ru: "Газияв: звуки из библиотеки", en: "Gaziyav: sounds from the library", keys: [], free: true },
	asr: { ru: "Газияв: на этом Mac (Whisper)", en: "Gaziyav: on this Mac (Whisper)", keys: [], free: true },
	cutout: { ru: "Газияв: на этом Mac", en: "Gaziyav: on this Mac", keys: [], free: true },
	image: { ru: "Газияв: fal.ai / kie.ai / ArgoLink (модель — выше)", en: "Gaziyav: fal.ai / kie.ai / ArgoLink (model above)", keys: ["fal", "kie", "argo"] },
	"image-search": { ru: "Wikimedia Commons", en: "Wikimedia Commons", keys: [], free: true },
	video: { ru: "Газияв: fal.ai / kie.ai / ArgoLink (модель — выше)", en: "Gaziyav: fal.ai / kie.ai / ArgoLink (model above)", keys: ["fal", "kie", "argo"] },
	"video-search": { ru: "Газияв: Pexels, Pixabay и Wikimedia", en: "Gaziyav: Pexels, Pixabay and Wikimedia", keys: [], free: true },
	translate: { ru: "Gaziyav AI", en: "Gaziyav AI", keys: [], free: true },
	"web-search": { ru: "Википедия", en: "Wikipedia", keys: [], free: true },
};

/** Free services of every kind that need no key (Gaziyav 2's free media, the same calls). */
const FREE: Partial<Record<Ability, Option[]>> = {
	"image-search": [{ id: "free-media", ru: "Openverse, NASA и Commons", en: "Openverse, NASA and Commons", keys: [], free: true, wired: true }],
	"video-search": [{ id: "archive", ru: "Internet Archive", en: "Internet Archive", keys: [], free: true, wired: true }],
};

/** What Gaziyav 1 runs through the ported providers now (the rest is listed and waits). */
const WIRED = new Set<Ability>(["tts", "image", "video", "image-search", "video-search", "web-search"]);

const SERVICE_NAME = (id: string) => SERVICES.find((s) => s.id === id)?.name ?? id;

/** Every option of a row: Gaziyav's own first, the free ones, then each service's models by name. */
export function optionsOf(ability: Ability): Option[] {
	const own = OWN[ability];
	const out: Option[] = own ? [{ id: "gaziyav", ...own, wired: true }] : [];
	out.push(...(FREE[ability] ?? []));
	for (const [provider, kinds] of Object.entries(MODELS)) {
		for (const [model, name] of kinds[ability] ?? []) {
			const service = SERVICES.find((s) => s.id === provider);
			out.push({
				id: `${provider}:${model}`,
				ru: `${SERVICE_NAME(provider)} · ${RU_MODEL[name] ?? name}`,
				en: `${SERVICE_NAME(provider)} · ${name}`,
				keys: [provider],
				provider,
				model,
				...(service?.keyless ? { free: true } : {}),
				wired: WIRED.has(ability),
			});
		}
	}
	return out;
}

export const optionOf = (ability: Ability, id: string | undefined): Option | undefined => optionsOf(ability).find((o) => o.id === id);

export const isAbility = (v: unknown): v is Ability => ROWS.some((r) => r.id === v);

/** The line when a service's key isn't in yet, naming the service (one exact string per service: i18n has each). */
export const needsKeyLine = (id: string, voice = false) => {
	const name = SERVICES.find((s) => s.id === id)?.name ?? id;
	const a = /^[aeiou]/i.test(name) ? "an" : "a";
	return voice ? `The ${name} voice needs ${a} ${name} key: Settings → Services.` : `This needs ${a} ${name} key: Settings → Services.`;
};
export const needsKeyLineRu = (id: string, voice = false) => {
	const name = SERVICES.find((s) => s.id === id)?.name ?? id;
	return voice ? `Для голоса ${name} нужен ключ ${name}: Настройки → Сервисы.` : `Для этого нужен ключ ${name}: Настройки → Сервисы.`;
};
