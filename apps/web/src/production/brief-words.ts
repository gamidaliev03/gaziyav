// A brief of a few words, Russian or English («рилс из этого», «ютуб на 8 минут про кофе», «промо для товара, дорого»)
// → recipe, look, platform, length and topic. What the words don't say comes from the taste profile. Pure; the same
// table is printed for the skill (BRIEF_TABLE) so Claude and the app read a brief the same way.
import type { PlatformId } from "@/platforms/table";
import type { PresetId } from "./presets";
import { type RecipeId, recipeOf } from "./recipes";
import type { TasteProfile } from "./taste";

export interface BriefIntent {
	recipe: RecipeId;
	preset: PresetId;
	platform: PlatformId;
	seconds: number;
	topic: string;
	language: "ru" | "en";
	/** Which of the above the words named (the rest came from the profile or the recipe). */
	said: Array<"recipe" | "preset" | "platform" | "seconds" | "topic">;
}

interface Rule<T> {
	re: RegExp;
	value: T;
}

// Order matters: the first match wins (podcast before reel, promo before reel).
const RECIPE_WORDS: Rule<RecipeId>[] = [
	{ re: /(клип|видео|ролик)\s+(на|под)\s+(\S+\s+)?(песн|трек|музык)|музыкальн\S*\s+клип|music video|под песню|на песню/i, value: "music-video" },
	{ re: /трейлер|тизер|trailer|teaser/i, value: "trailer" },
	{ re: /мультик|мультфильм|анимаци|cartoon|animated|animation/i, value: "cartoon" },
	{ re: /диалог|двое|два персонажа|dialogue|conversation between|two characters/i, value: "dialogue" },
	{ re: /оживи\s+(\S+\s+)?(фото|фотографи|картинк|портрет)|говорящ\S*\s+(фото|аватар)|аватар|монолог|talking photo|avatar|monologue|lip-?sync/i, value: "monologue-lipsync" },
	{ re: /ugc|реклам\S* с аватар|talking ad|юджиси/i, value: "talking-ad" },
	{ re: /инфографик|объясн|explainer|infographic|motion graphics/i, value: "explainer" },
	{ re: /документал|документ\S* фильм|documentary|commentary|разбор с нарезк/i, value: "documentary" },
	{ re: /слайдшоу|фотоистори|из фото|slideshow|photo story|from photos/i, value: "photo-story" },
	{ re: /запис\S*\s+(с\s+)?экрана|туториал\S*\s+с\s+экран|скринкаст|screen ?record|screencast|tutorial from (the )?screen/i, value: "screen-tutorial" },
	{ re: /подкаст|podcast|нарез|clips? from|интервью.*клип/i, value: "podcast-clips" },
	{ re: /промо|реклам|\bad\b|\bads\b|promo|товар|продукт|product|оффер|offer|продаж/i, value: "promo" },
	{ re: /сценари|script|\bии[ -]?(ролик|шортс|видео)|ai[ -]?(short|video)|нейросет/i, value: "ai-short" },
	{ re: /ютуб|youtube|ролик на \d|видео на \d|\d+\s*(мин|min)|длинн|long[- ]?form|влог|vlog|туториал|tutorial|обзор на|review video/i, value: "youtube-video" },
	{ re: /рилс|reels?|тикток|tik ?tok|шортс|shorts|клип|вертикал|vertical|сторис|stories/i, value: "reel-talking-head" },
];

const PLATFORM_WORDS: Rule<PlatformId>[] = [
	{ re: /тикток|tik ?tok/i, value: "tiktok" },
	{ re: /шортс|shorts/i, value: "shorts" },
	{ re: /рилс|reels?|инст|insta/i, value: "reels" },
	{ re: /вк|\bvk\b|вконтакт/i, value: "vk" },
	{ re: /телеграм|telegram/i, value: "telegram" },
	{ re: /дзен|dzen/i, value: "dzen" },
	{ re: /рутуб|rutube/i, value: "rutube" },
	{ re: /лент|feed|4:5/i, value: "feed" },
	{ re: /ютуб|youtube/i, value: "youtube" },
];

const PRESET_WORDS: Rule<PresetId>[] = [
	{ re: /люкс|роскош|премиальн|дорог|элегант|luxury|elegant|premium look|expensive/i, value: "luxury" },
	{ re: /документ|кино|истори|documentary|cinematic|story|трейлер|trailer/i, value: "documentary" },
	{ re: /техн|гаджет|обзор|tech|gadget|review|tutorial|туториал/i, value: "tech-review" },
	{ re: /динамич|энерг|бодр|хайп|быстр|energetic|hype|fast|dynamic/i, value: "energetic-reel" },
	{ re: /подкаст|podcast|интервью|interview/i, value: "podcast" },
	{ re: /чист|минимал|спокойн|clean|minimal|calm/i, value: "clean-premium" },
];

/** The table the skill prints: brief words → recipe + preset + length + platform. */
export const BRIEF_TABLE = [
	["рилс из этого / reel from this", "reel-talking-head", "profile (clean-premium)", "30 s", "reels"],
	["тикток / tiktok, шортс / shorts", "reel-talking-head", "profile", "30 s", "tiktok / shorts"],
	["ютуб на 8 минут про X / 8-min YouTube about X", "youtube-video", "profile", "8 min", "youtube"],
	["нарезка из подкаста / podcast clips", "podcast-clips", "podcast", "40 s", "reels"],
	["промо для товара / promo for a product", "promo", "profile (luxury if «дорого»)", "20 s", "reels"],
	["ИИ-ролик по сценарию / AI short from a script", "ai-short", "energetic-reel", "30 s", "profile (reels)"],
	["клип на песню / music video", "music-video", "energetic-reel", "60 s", "reels"],
	["говорящее фото, монолог / talking photo, avatar", "monologue-lipsync", "profile", "30 s", "reels"],
	["диалог двух героев / dialogue scene", "dialogue", "documentary", "40 s", "reels"],
	["мультик / cartoon", "cartoon", "energetic-reel", "45 s", "shorts"],
	["объясняющее видео, инфографика / explainer", "explainer", "tech-review", "2 min", "youtube"],
	["документалка с нарезкой с ютуба / documentary", "documentary", "documentary", "5 min", "youtube"],
	["слайдшоу из фото / photo story", "photo-story", "documentary", "30 s", "reels"],
	["трейлер / trailer", "trailer", "documentary", "60 s", "youtube"],
	["туториал с записи экрана / screen tutorial", "screen-tutorial", "tech-review", "5 min", "youtube"],
	["UGC-реклама с аватаром / talking ad", "talking-ad", "profile", "30 s", "reels"],
	["+ дорого·люкс / luxury · кино·документ / documentary · обзор·техно / tech · динамично / energetic", "—", "that preset", "—", "—"],
	["+ N сек / N s · N мин / N min", "—", "—", "N", "—"],
] as const;

const pick = <T>(rules: Rule<T>[], text: string): T | undefined => rules.find((r) => r.re.test(text))?.value;

/** Seconds named in the words: «45 сек», «8 минут», «1.5 min», «полторы минуты». */
export function secondsIn(text: string): number | null {
	const t = text.toLowerCase().replace(",", ".");
	if (/полтор[аы]\s*мин/.test(t)) return 90;
	const m = /(\d+(?:\.\d+)?)[\s-]*(минут|мин|min|minutes?|m\b|секунд|сек|sec|seconds?|s\b|час|hour|h\b)/.exec(t);
	if (!m) return null;
	const n = Number(m[1]);
	const unit = m[2];
	if (/^(час|hour|h)/.test(unit)) return Math.round(n * 3600);
	if (/^(минут|мин|min|m)/.test(unit)) return Math.round(n * 60);
	return Math.round(n);
}

/** «про кофе», «about coffee», «for the new sneakers» → the topic words (no trailing look/length words). */
export function topicIn(text: string): string {
	const m = /(?:^|\s)(?:про|о|об|about|on|для|for)\s+(.+)$/iu.exec(text.trim());
	if (!m) return "";
	return m[1]
		.replace(/[,.;].*$/, "")
		.replace(/\s+(на|in|for)\s+\d+.*$/i, "")
		.trim()
		.slice(0, 80);
}

export const isRussian = (text: string) => /[а-яё]/i.test(text);

/** The brief read with the profile under it: the words win, then the profile, then the recipe's defaults. */
export function readBrief(text: string, taste: TasteProfile, available?: { mediaSeconds?: number }): BriefIntent {
	const words = String(text ?? "");
	const said: BriefIntent["said"] = [];
	const recipeWord = pick(RECIPE_WORDS, words);
	if (recipeWord) said.push("recipe");
	const platformWord = pick(PLATFORM_WORDS, words);
	if (platformWord) said.push("platform");
	const presetWord = pick(PRESET_WORDS, words);
	if (presetWord) said.push("preset");
	const secondsWord = secondsIn(words);
	if (secondsWord) said.push("seconds");
	const topic = topicIn(words);
	if (topic) said.push("topic");

	// A platform alone decides the shape: «на ютуб» is a long video, «в тикток» a reel.
	let recipeId: RecipeId = recipeWord ?? (platformWord === "youtube" ? "youtube-video" : platformWord ? "reel-talking-head" : taste.recipe);
	if (!recipeWord && secondsWord && secondsWord >= 90 && !platformWord) recipeId = "youtube-video";
	const recipe = recipeOf(recipeId);
	const longForm = recipe.platform === "youtube";
	const platform: PlatformId = platformWord ?? (longForm ? "youtube" : recipe.platform === "youtube" ? taste.platform : taste.platform === "youtube" ? recipe.platform : taste.platform);
	const own: RecipeId[] = ["podcast-clips", "ai-short", "music-video", "dialogue", "cartoon", "explainer", "documentary", "photo-story", "trailer", "screen-tutorial"];
	const preset: PresetId = presetWord ?? (own.includes(recipe.id) ? recipe.preset : taste.preset);
	const fallback = recipe.id === "youtube-video" ? taste.seconds.long : recipe.id === "reel-talking-head" ? taste.seconds.short : recipe.seconds[1];
	let seconds = secondsWord ?? fallback;
	seconds = Math.max(recipe.seconds[0], Math.min(longForm ? 7200 : recipe.seconds[2], seconds));
	if (available?.mediaSeconds && available.mediaSeconds > 0) seconds = Math.min(seconds, Math.max(recipe.seconds[0], available.mediaSeconds));
	const language = taste.language === "auto" ? (isRussian(words) ? "ru" : "en") : taste.language;
	return { recipe: recipe.id, preset, platform, seconds: Math.round(seconds), topic, language, said };
}
