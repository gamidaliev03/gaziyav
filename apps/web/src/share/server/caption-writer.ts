// Share → Post → «Write with Gaziyav AI»: a title, a description and the hashtags (Instagram: 5 at most) for the ticked sites, from what the
// project says (its speech or captions, the text on screen, the clips' names). The same AI as Gaziyav AI and the other
// text features (DeepSeek, Claude, OpenAI… whichever is set up in Settings → Services); with none set up, the sheet says so
// and the fields stay the person's own.
import { StudioError } from "@/studio/server/errors";
import { LIMITS, type Platform, parseHashtags } from "../caption";

export interface WrittenCaption {
	title: string;
	description: string;
	hashtags: string;
}

const SYSTEM = `You write the post for a short vertical video (YouTube Shorts, Instagram Reels, TikTok), from what the video
contains.
- title: up to 70 characters. Name what the video is about in the words the audience would type or say; promise only
  what the video shows (YouTube shows it).
- description: 1–3 short sentences, at most {max} characters, no hashtags inside. Its first line carries the hook and
  stays within 125 characters (Instagram cuts the rest under «more»): say something about the subject itself — a feeling,
  a fact, a question — as a person would to their own followers. Never describe how the video is made or what to do
  with it («watch till the end», «in the first second»), never ask to like, follow, subscribe, share or gift (TikTok keeps
  such posts out of For You).
- hashtags: {tags} hashtags, each a word of this video (its topic, a name, the genre or format), never a trend it is not
  about; no spaces inside a hashtag.
Write all of it in {lang}, whatever language the material is in (names stay as they are). Don't invent prices, facts or
names that aren't in the material. No emoji in the title.
Answer with JSON only: {"title": "...", "description": "...", "hashtags": ["#...", "..."]}`;

/** How many hashtags the ticked sites take: Instagram caps a post at 5 (from December 2025); the others 3–8 is plenty. */
export const hashtagCount = (platforms: Platform[]) => (platforms.includes("instagram") ? 5 : 8);

/** Turns the model's JSON into the sheet's fields; throws a readable error when it is unusable. */
export function parseCaption(answer: string, platforms: Platform[]): WrittenCaption {
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1));
	} catch {
		throw new StudioError("Gaziyav AI didn't manage this — nothing was changed.");
	}
	const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+\n/g, "\n").trim() : "");
	const tags = parseHashtags(Array.isArray(data.hashtags) ? data.hashtags.map(String).join(" ") : text(data.hashtags)).slice(0, hashtagCount(platforms));
	const max = Math.min(...platforms.map((p) => LIMITS[p].caption)) - tags.join(" ").length - 2;
	let description = text(data.description).replace(/#[\p{L}\p{N}_]+/gu, "").trim();
	if (description.length > max) description = `${description.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
	const title = text(data.title).replace(/[<>]/g, "").slice(0, 100);
	if (!title && !description) throw new StudioError("Gaziyav AI didn't manage this — nothing was changed.");
	return { title, description, hashtags: tags.join(" ") };
}

export async function writeCaption({ material, platforms, lang, signal }: { material: string; platforms: Platform[]; lang: "ru" | "en"; signal?: AbortSignal }): Promise<WrittenCaption> {
	const sites = platforms.length ? platforms : (["youtube", "instagram", "tiktok"] as Platform[]);
	const body = material.replace(/\s+/g, " ").trim();
	if (body.length < 3) throw new StudioError("There's nothing in the project to write from yet: add speech, captions or text, or write it yourself.");
	// Self-tests only: a canned answer, so nothing is sent anywhere.
	const mock = process.env.STUDIO_TEST === "1" ? process.env.STUDIO_SHARE_CAPTION_MOCK : undefined;
	if (mock) return parseCaption(mock, sites);
	const { DeepSeek } = await import("@/studio/server/deepseek");
	const { loadSettings } = await import("@/studio/server/settings");
	const settings = loadSettings();
	const max = Math.min(...sites.map((p) => LIMITS[p].caption)) - 200;
	const answer = await new DeepSeek(settings.deepseekKey, settings.deepseekModel).chat({
		system: SYSTEM.replace("{max}", String(Math.min(600, max))).replace("{tags}", sites.includes("instagram") ? "3–5" : "3–8").replace("{lang}", lang === "ru" ? "Russian" : "English"),
		user: `Sites: ${sites.join(", ")}\n\nThe video:\n${body.length > 4000 ? `${body.slice(0, 3000)} … ${body.slice(-900)}` : body}`,
		json: true,
		temperature: 0.8,
		maxTokens: 600,
		thinking: false,
		signal,
		lang,
	});
	return parseCaption(answer, sites);
}
