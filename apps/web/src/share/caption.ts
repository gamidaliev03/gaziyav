// Share → Post: one description and one hashtag line for every platform, each platform's own limits and the text it
// gets. Pure (the sheet's counters and the server's upload use the same rules).

export type Platform = "youtube" | "instagram" | "tiktok";

export const PLATFORM_LABEL: Record<Platform, string> = { youtube: "YouTube Shorts", instagram: "Instagram Reels", tiktok: "TikTok" };

/** What each platform takes (characters, hashtags, seconds of video). */
export const LIMITS: Record<Platform, { caption: number; title?: number; hashtags?: number; maxSeconds: number; minSeconds: number }> = {
	youtube: { caption: 5000, title: 100, maxSeconds: 180, minSeconds: 1 },
	instagram: { caption: 2200, hashtags: 30, maxSeconds: 900, minSeconds: 3 },
	tiktok: { caption: 2200, maxSeconds: 600, minSeconds: 3 },
};

/** «sale, #Summer  #summer, travel-tips» → ["#sale", "#Summer", "#traveltips"]: one # each, no repeats (case-insensitive). */
export function parseHashtags(raw: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(/[\s,;]+/)) {
		const word = part.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
		if (!word) continue;
		const key = word.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(`#${word}`);
	}
	return out;
}

export interface PostText {
	title: string;
	description: string;
	hashtags: string;
}

/** The text a platform gets: the description, then the hashtags on their own line. */
export function captionFor(text: PostText): string {
	const tags = parseHashtags(text.hashtags).join(" ");
	const body = text.description.trim();
	return [body, tags].filter(Boolean).join(body && tags ? "\n\n" : "");
}

/** YouTube's title: the Title field, else the description's first line; at most 100 characters, no < or >. */
export function youtubeTitle(text: PostText, fallback: string): string {
	const first = text.title.trim() || text.description.trim().split("\n")[0]?.trim() || fallback;
	const clean = first.replace(/[<>]/g, "").trim() || "Video";
	return clean.length > 100 ? `${clean.slice(0, 99).trimEnd()}…` : clean;
}

/** YouTube tags: the hashtags without # (500 characters in all, as YouTube counts them). */
export function youtubeTags(text: PostText): string[] {
	const tags: string[] = [];
	let total = 0;
	for (const tag of parseHashtags(text.hashtags).map((t) => t.slice(1))) {
		total += tag.length + (tags.length ? 1 : 0);
		if (total > 500) break;
		tags.push(tag);
	}
	return tags;
}

export interface TextIssue {
	platform: Platform;
	/** The English line with {placeholders} (the i18n key) and its values: the sheet shows t(message, vars). */
	message: string;
	vars: Record<string, string | number>;
	/** True when the platform would refuse the post. */
	blocking: boolean;
}

/** What is over a platform's limits (the sheet shows it; a blocking one keeps that platform from posting). */
export function textIssues(platforms: Platform[], text: PostText, seconds: number): TextIssue[] {
	const issues: TextIssue[] = [];
	const caption = captionFor(text);
	const tags = parseHashtags(text.hashtags).length;
	for (const p of platforms) {
		const L = LIMITS[p];
		const name = PLATFORM_LABEL[p];
		if (caption.length > L.caption) issues.push({ platform: p, message: "{name}: the text is {n} characters, {max} at most.", vars: { name, n: caption.length, max: L.caption }, blocking: true });
		if (L.hashtags && tags > L.hashtags) issues.push({ platform: p, message: "{name}: {n} hashtags, {max} at most.", vars: { name, n: tags, max: L.hashtags }, blocking: true });
		if (seconds > L.maxSeconds) issues.push({ platform: p, message: "{name}: the video is {n} s, {max} s at most.", vars: { name, n: Math.round(seconds), max: L.maxSeconds }, blocking: true });
		if (seconds > 0 && seconds < L.minSeconds) issues.push({ platform: p, message: "{name}: the video is shorter than {min} s.", vars: { name, min: L.minSeconds }, blocking: true });
		if (p === "youtube" && text.title.trim().length > 100) issues.push({ platform: p, message: "YouTube: the title is cut to 100 characters.", vars: {}, blocking: false });
	}
	return issues;
}

/** Whether a canvas is vertical enough for Shorts / Reels / TikTok (9:16 within a few pixels). */
export function isVertical(size: { width: number; height: number }): boolean {
	return size.height > size.width && Math.abs(size.width / size.height - 9 / 16) < 0.02;
}
