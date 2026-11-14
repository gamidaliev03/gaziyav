// The platform presets Claude's export and post use, read from the app's own tables (Export → Platform, Share → Post
// limits). One adapter: when the platform table (docs/CLAUDE-PRODUCTION.md §6, claude-produce) lands, only this file
// changes. Pure.
import { EXPORT_PLATFORMS } from "@/export/defaults";
import type { ExportQuality } from "@/export";
import { LIMITS, type Platform } from "@/share/caption";

export interface ClaudePlatform {
	id: string;
	label: string;
	aspect: "9:16" | "16:9" | "4:5" | "1:1";
	maxSeconds: number | null;
	quality: ExportQuality;
	/** Integrated loudness the export is brought to. */
	lufs: number;
	/** The Share → Post platform it goes to, when it has one. */
	post?: Platform;
}

const POST: Record<string, Platform> = { tiktok: "tiktok", reels: "instagram", shorts: "youtube" };

export const CLAUDE_PLATFORMS: ClaudePlatform[] = EXPORT_PLATFORMS.map((p) => ({
	id: p.id,
	label: p.label,
	aspect: p.aspect,
	maxSeconds: POST[p.id] ? Math.min(p.maxSeconds ?? Number.POSITIVE_INFINITY, LIMITS[POST[p.id]].maxSeconds) : p.maxSeconds,
	quality: p.quality,
	lufs: -14,
	...(POST[p.id] ? { post: POST[p.id] } : {}),
}));

/** «tiktok», «TikTok», «instagram» (= reels), «youtube shorts»… → the preset; null when unknown. */
export function platformOf(name: unknown): ClaudePlatform | null {
	const key = String(name ?? "").toLowerCase().replace(/[^a-z]/g, "");
	if (!key) return null;
	const alias: Record<string, string> = { instagram: "reels", ig: "reels", instagramreels: "reels", youtubeshorts: "shorts", yt: "youtube", tt: "tiktok", vkclips: "vk" };
	const id = alias[key] ?? key;
	return CLAUDE_PLATFORMS.find((p) => p.id === id) ?? null;
}

export const aspectOf = (size: { width: number; height: number }) => {
	const r = size.width / size.height;
	return Math.abs(r - 9 / 16) < 0.02 ? "9:16" : Math.abs(r - 16 / 9) < 0.02 ? "16:9" : Math.abs(r - 4 / 5) < 0.02 ? "4:5" : Math.abs(r - 1) < 0.02 ? "1:1" : `${size.width}:${size.height}`;
};
