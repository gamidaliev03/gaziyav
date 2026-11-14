import type { ExportOptions } from "./index";
import { PLATFORMS } from "@/platforms/table";

// Even loudness is off until the user turns it on: what is heard while editing is what is exported (the renderer's own
// default is off too; a fresh profile raised every first export by 4.7 dB with the switch hidden — check-export E1).
export const DEFAULT_EXPORT_OPTIONS = {
	format: "mp4",
	quality: "high",
	includeAudio: true,
	normalizeLoudness: false,
} satisfies ExportOptions;

/**
 * Where the video goes. A platform sets MP4, its quality and −14 LUFS; the window then checks the video's shape
 * and length against it. Lengths are what each app takes in one upload. The rows come from the one platform table
 * (src/platforms/table.ts) that Share → Post and Claude's tools read too.
 */
export const EXPORT_PLATFORMS = PLATFORMS.map((p) => ({
	id: p.id,
	label: p.label,
	aspect: p.aspect,
	maxSeconds: p.maxSeconds,
	quality: p.export.quality,
}));

export type ExportPlatform = (typeof EXPORT_PLATFORMS)[number];
export type ExportPlatformId = ExportPlatform["id"];

/** The platforms offered, in order, for each UI language: Russian → VK, Telegram, Dzen, RuTube, YouTube; English → TikTok,
 * Reels, Shorts, YouTube (feed posts in both). They switch with Settings → General → Language. */
export const PLATFORMS_BY_LANGUAGE = {
	ru: ["vk", "telegram", "dzen", "rutube", "youtube", "feed"],
	en: ["tiktok", "reels", "shorts", "youtube", "feed"],
} as const satisfies Record<"ru" | "en", readonly ExportPlatformId[]>;

/** The language's platforms; one chosen earlier that isn't in that list stays at the end (never lost). */
export function platformsFor(lang: "ru" | "en", keep?: string | null): ExportPlatform[] {
	const ids: readonly string[] = PLATFORMS_BY_LANGUAGE[lang];
	const list = ids.map((id) => EXPORT_PLATFORMS.find((p) => p.id === id)).filter((p): p is ExportPlatform => !!p);
	const kept = keep && !ids.includes(keep) ? EXPORT_PLATFORMS.find((p) => p.id === keep) : undefined;
	return kept ? [...list, kept] : list;
}
