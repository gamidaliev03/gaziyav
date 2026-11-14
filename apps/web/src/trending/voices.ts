// Trending voices: one-click voice-over and dub looks built from the ready voices this Mac already has (made-up
// speakers of the voice model, nobody real) — a speaker, a speaking style, then a sound treatment (pitch, pace, EQ,
// room) and loudness to −14 LUFS. Shared by the Generate panel, the dub and the server (no Node imports here).
// Why these: docs/aicontent9.md (what creators use on TikTok / Reels / VK Clips in 2025–2026).

export type ReadySpeaker = "ryan" | "aiden" | "eric" | "dylan" | "uncle_fu" | "vivian" | "serena" | "ono_anna" | "sohee";

export interface TrendVoice {
	id: string;
	name: string;
	/** One line under the name: what it is for. */
	use: string;
	/** The name and line in the Russian interface. */
	ru: { name: string; use: string };
	speaker: ReadySpeaker;
	/** The recording style the voice model speaks from (ready-voices.ts styleOf words). */
	style: "neutral" | "energetic" | "calm" | "serious";
	/** Semitones up (+) or down (−); changes the timbre too, like the effect creators use. */
	pitch?: number;
	/** Pace: 1.1 = 10 % faster. */
	tempo?: number;
	/** ffmpeg audio filters after pitch and pace, before loudness. */
	fx?: string;
}

// Room tail (aecho): a hall for trailers and monsters.
const HALL = "aecho=0.8:0.75:70|130|190:0.28|0.18|0.1";
// Speech compression: steady level for ads and hosts.
const COMP = "acompressor=threshold=0.08:ratio=3.5:attack=8:release=120:makeup=1.6";

export const TREND_VOICES: readonly TrendVoice[] = [
	{ id: "narrator", name: "Viral narrator", use: "Bright storytime voice", ru: { name: "Рассказчик", use: "Яркий голос для сторис" }, speaker: "vivian", style: "energetic", tempo: 1.06, fx: `highpass=f=90,equalizer=f=3200:t=q:w=1:g=3,${COMP}` },
	{ id: "ugc", name: "UGC ad", use: "Friendly product talk", ru: { name: "Реклама UGC", use: "Дружелюбно о товаре" }, speaker: "aiden", style: "energetic", tempo: 1.08, fx: `highpass=f=80,equalizer=f=2800:t=q:w=1:g=2.5,${COMP}` },
	{ id: "trailer", name: "Movie trailer", use: "Deep epic announcer", ru: { name: "Как в трейлере", use: "Низкий эпичный голос" }, speaker: "uncle_fu", style: "serious", pitch: -3, tempo: 0.93, fx: `lowshelf=f=140:g=5,equalizer=f=3000:t=q:w=1:g=2,${COMP},${HALL}` },
	{ id: "news", name: "News anchor", use: "Clear, confident host", ru: { name: "Диктор новостей", use: "Чётко и уверенно" }, speaker: "ryan", style: "serious", fx: `highpass=f=90,equalizer=f=180:t=q:w=1:g=2,equalizer=f=3500:t=q:w=1:g=3,${COMP}` },
	{
		id: "asmr",
		name: "ASMR whisper",
		use: "Soft breathy whisper",
		ru: { name: "Шёпот ASMR", use: "Мягкий шёпот" },
		speaker: "serena",
		style: "calm",
		tempo: 0.92,
		// Whisper: the voice's spectrum keeps its shape but every bin gets a random phase (no pitch left = breath).
		fx: "afftfilt=real='hypot(re,im)*cos((random(0)*2-1)*2*3.14)':imag='hypot(re,im)*sin((random(1)*2-1)*2*3.14)':win_size=256:overlap=0.75,highpass=f=200,lowshelf=f=300:g=4,highshelf=f=7000:g=3",
	},
	{ id: "chipmunk", name: "Chipmunk", use: "Fast squeaky meme voice", ru: { name: "Бурундук", use: "Быстрый писклявый мем" }, speaker: "dylan", style: "energetic", pitch: 7, tempo: 1.12, fx: "highpass=f=150" },
	{
		id: "robot",
		name: "Robot AI",
		use: "Flat synthetic machine",
		ru: { name: "Робот", use: "Ровный машинный голос" },
		speaker: "ryan",
		style: "neutral",
		tempo: 0.97,
		// Robot: every bin's phase zeroed (a buzzing monotone), then a short metallic comb.
		fx: "afftfilt=real='hypot(re,im)':imag='0':win_size=512:overlap=0.75,aecho=0.8:0.88:6:0.4,highpass=f=120,equalizer=f=1500:t=q:w=1:g=3",
	},
	{ id: "demon", name: "Halloween demon", use: "Low scary monster", ru: { name: "Демон", use: "Низкий страшный монстр" }, speaker: "uncle_fu", style: "serious", pitch: -7, tempo: 0.94, fx: `lowshelf=f=120:g=4,${HALL}` },
];

export const trendVoice = (id: unknown): TrendVoice | null => TREND_VOICES.find((v) => v.id === id) ?? null;

/**
 * The row as each market sees it: Russian Reels / VK Clips / TikTok lean on the storyteller, the trailer and the
 * news-anchor voice; English short video on the narrator and the UGC ad read (docs/aicontent9.md). Names follow the UI.
 */
const ORDER = {
	en: ["narrator", "ugc", "trailer", "news", "asmr", "chipmunk", "robot", "demon"],
	ru: ["narrator", "trailer", "news", "ugc", "asmr", "chipmunk", "robot", "demon"],
} as const;

export function trendVoicesFor(lang: "en" | "ru"): Array<TrendVoice & { label: string; line: string }> {
	const rank = (id: string) => (ORDER[lang] as readonly string[]).indexOf(id);
	return [...TREND_VOICES]
		.sort((a, b) => rank(a.id) - rank(b.id))
		.map((v) => ({ ...v, label: lang === "ru" ? v.ru.name : v.name, line: lang === "ru" ? v.ru.use : v.use }));
}

export const trendSampleUrl = (id: string, lang: "en" | "ru") => `/trending/voices/${id}.${lang}.m4a`;

/** The ffmpeg filter chain of a preset at a sample rate, loudness not included. */
export function trendFilter(v: TrendVoice, rate: number): string {
	const parts: string[] = [];
	if (v.pitch) {
		const r = 2 ** (v.pitch / 12);
		parts.push(`asetrate=${Math.round(rate * r)}`, `aresample=${rate}`, `atempo=${(1 / r).toFixed(4)}`);
	}
	if (v.tempo && v.tempo !== 1) parts.push(`atempo=${v.tempo}`);
	if (v.fx) parts.push(v.fx);
	return parts.join(",") || "anull";
}
