// Where a video goes, in one table: the frame, the length, the safe zones the app's buttons cover, the loudness, the
// captions, the text and cover limits, the AI-content label, and what the review asks of an edit there. Export
// (export/defaults.ts), Share → Post and Claude's tools (analyze_material, apply_plan, review, export, post) all read
// this table, so a number changes in one place. Pure data, no imports beyond types.
import type { ExportQuality } from "@/export";

export type PlatformId = "tiktok" | "reels" | "shorts" | "vk" | "telegram" | "dzen" | "rutube" | "feed" | "youtube";
export type PlatformAspect = "9:16" | "16:9" | "4:5";

export interface PlatformSpec {
	id: PlatformId;
	label: string;
	/** The Share → Post / Late platform that publishes it (none: the user posts the file). */
	post?: "tiktok" | "instagram" | "youtube";
	aspect: PlatformAspect;
	size: { width: number; height: number };
	fps: number;
	minSeconds: number;
	/** What the export preset and the review allow in one video (null: no limit). */
	maxSeconds: number | null;
	/** What the platform takes in one upload (Share → Post): Instagram takes 15 min, its Reels preset stays at 3. */
	uploadMaxSeconds: number | null;
	export: { format: "mp4"; quality: ExportQuality; lufs: number; truePeak: number };
	/** Covered by the app's own buttons and text, px at `size`: titles, captions and faces stay inside. */
	safe: { top: number; bottom: number; left: number; right: number };
	captions: {
		/** Speech covered by captions (0 = captions optional). */
		minCoverage: number;
		maxWords: number;
		maxLines: number;
		/** Reading speed, characters per second at most. */
		maxCps: number;
		/** Vertical centre of the caption block, share of the height from the top. */
		y: number;
	};
	text: { title?: number; caption: number; hashtags?: number; tags?: number };
	cover: { width: number; height: number };
	/** The platform asks to mark realistic AI-made content. */
	aiLabel: boolean;
	review: {
		/** Motion, a face or a bold title within this many seconds. */
		hookSeconds: number;
		/** A shot without motion or a punch-in may last this long. */
		staticMaxSeconds: number;
		/** Share of the length covered by B-roll (inserts, pictures, graphics over the speaker). */
		broll: readonly [number, number];
		/** The length a video of this kind works best at, seconds. */
		ideal: readonly [number, number];
		/** The last seconds: a call to action / a loop (short), an end screen of 5–20 s (YouTube). */
		ending: "cta-or-loop" | "end-screen";
		chapters: boolean;
	};
}

const VERTICAL = { width: 1080, height: 1920 } as const;
const SHORT_REVIEW = { hookSeconds: 1.5, staticMaxSeconds: 4, broll: [0.15, 0.6], ideal: [15, 45], ending: "cta-or-loop", chapters: false } as const;
const SHORT_CAPTIONS = { minCoverage: 0.98, maxWords: 4, maxLines: 2, maxCps: 17, y: 0.62 } as const;
const LOUD = { lufs: -14, truePeak: -1 } as const;

export const PLATFORMS = [
	{
		id: "tiktok",
		label: "TikTok",
		post: "tiktok",
		aspect: "9:16",
		size: VERTICAL,
		fps: 30,
		minSeconds: 3,
		maxSeconds: 600,
		uploadMaxSeconds: 600,
		export: { format: "mp4", quality: "high", ...LOUD },
		safe: { top: 150, bottom: 440, left: 60, right: 140 },
		captions: SHORT_CAPTIONS,
		text: { caption: 2200 },
		cover: VERTICAL,
		aiLabel: true,
		review: SHORT_REVIEW,
	},
	{
		id: "reels",
		label: "Reels",
		post: "instagram",
		aspect: "9:16",
		size: VERTICAL,
		fps: 30,
		minSeconds: 3,
		maxSeconds: 180,
		uploadMaxSeconds: 900,
		export: { format: "mp4", quality: "high", ...LOUD },
		safe: { top: 250, bottom: 420, left: 60, right: 120 },
		captions: SHORT_CAPTIONS,
		text: { caption: 2200, hashtags: 30 },
		cover: VERTICAL,
		aiLabel: true,
		review: SHORT_REVIEW,
	},
	{
		id: "shorts",
		label: "Shorts",
		post: "youtube",
		aspect: "9:16",
		size: VERTICAL,
		fps: 30,
		minSeconds: 1,
		maxSeconds: 180,
		uploadMaxSeconds: 180,
		export: { format: "mp4", quality: "high", ...LOUD },
		safe: { top: 200, bottom: 380, left: 60, right: 140 },
		captions: SHORT_CAPTIONS,
		text: { title: 100, caption: 5000, tags: 500 },
		cover: VERTICAL,
		aiLabel: true,
		review: SHORT_REVIEW,
	},
	// VK Clips: H.264 at 12+ Mbps (docs/MARKETING.md export spec), so the 12 Mbps of Max.
	{
		id: "vk",
		label: "VK Clips",
		aspect: "9:16",
		size: VERTICAL,
		fps: 30,
		minSeconds: 1,
		maxSeconds: 180,
		uploadMaxSeconds: 180,
		export: { format: "mp4", quality: "very_high", ...LOUD },
		safe: { top: 180, bottom: 420, left: 60, right: 130 },
		captions: SHORT_CAPTIONS,
		text: { caption: 2200 },
		cover: VERTICAL,
		aiLabel: false,
		review: SHORT_REVIEW,
	},
	{
		id: "telegram",
		label: "Telegram",
		aspect: "9:16",
		size: VERTICAL,
		fps: 30,
		minSeconds: 1,
		maxSeconds: null,
		uploadMaxSeconds: null,
		export: { format: "mp4", quality: "high", ...LOUD },
		safe: { top: 120, bottom: 300, left: 60, right: 60 },
		captions: SHORT_CAPTIONS,
		text: { caption: 1024 },
		cover: VERTICAL,
		aiLabel: false,
		review: SHORT_REVIEW,
	},
	// Dzen and RuTube short videos: vertical, up to 3 minutes
	{
		id: "dzen",
		label: "Dzen",
		aspect: "9:16",
		size: VERTICAL,
		fps: 30,
		minSeconds: 1,
		maxSeconds: 180,
		uploadMaxSeconds: 180,
		export: { format: "mp4", quality: "high", ...LOUD },
		safe: { top: 180, bottom: 400, left: 60, right: 130 },
		captions: SHORT_CAPTIONS,
		text: { title: 140, caption: 5000 },
		cover: VERTICAL,
		aiLabel: false,
		review: SHORT_REVIEW,
	},
	{
		id: "rutube",
		label: "RuTube",
		aspect: "9:16",
		size: VERTICAL,
		fps: 30,
		minSeconds: 1,
		maxSeconds: 180,
		uploadMaxSeconds: 180,
		export: { format: "mp4", quality: "high", ...LOUD },
		safe: { top: 180, bottom: 400, left: 60, right: 130 },
		captions: SHORT_CAPTIONS,
		text: { title: 100, caption: 5000 },
		cover: VERTICAL,
		aiLabel: false,
		review: SHORT_REVIEW,
	},
	// Instagram / VK feed posts: 4:5 takes the most room in a scrolling feed.
	{
		id: "feed",
		label: "Feed",
		post: "instagram",
		aspect: "4:5",
		size: { width: 1080, height: 1350 },
		fps: 30,
		minSeconds: 3,
		maxSeconds: null,
		uploadMaxSeconds: 900,
		export: { format: "mp4", quality: "high", ...LOUD },
		safe: { top: 80, bottom: 120, left: 60, right: 60 },
		captions: { ...SHORT_CAPTIONS, y: 0.74 },
		text: { caption: 2200, hashtags: 30 },
		cover: { width: 1080, height: 1350 },
		aiLabel: true,
		review: { ...SHORT_REVIEW, hookSeconds: 2, ideal: [15, 60] },
	},
	{
		id: "youtube",
		label: "YouTube",
		post: "youtube",
		aspect: "16:9",
		size: { width: 1920, height: 1080 },
		fps: 30,
		minSeconds: 1,
		maxSeconds: null,
		uploadMaxSeconds: null,
		export: { format: "mp4", quality: "very_high", ...LOUD },
		// Title-safe 5 % on each side; the player's bar covers the bottom when paused.
		safe: { top: 54, bottom: 110, left: 96, right: 96 },
		captions: { minCoverage: 0, maxWords: 8, maxLines: 2, maxCps: 20, y: 0.84 },
		text: { title: 100, caption: 5000, tags: 500 },
		cover: { width: 1280, height: 720 },
		aiLabel: true,
		review: { hookSeconds: 5, staticMaxSeconds: 8, broll: [0.3, 0.6], ideal: [120, 900], ending: "end-screen", chapters: true },
	},
] as const satisfies readonly PlatformSpec[];

/** The row for an id (or a few common words for it); undefined when nothing matches. */
export function platformSpec(id: string | null | undefined): PlatformSpec | undefined {
	const key = String(id ?? "").trim().toLowerCase();
	const alias: Record<string, PlatformId> = {
		instagram: "reels",
		insta: "reels",
		ig: "reels",
		"youtube shorts": "shorts",
		yt: "youtube",
		vk: "vk",
		"vk clips": "vk",
		tg: "telegram",
	};
	const found = (PLATFORMS as readonly PlatformSpec[]).find((p) => p.id === key || p.label.toLowerCase() === key);
	return found ?? (alias[key] ? (PLATFORMS as readonly PlatformSpec[]).find((p) => p.id === alias[key]) : undefined);
}

/** A row by id, for code that knows the id is right (falls back to Reels). */
export const platformOf = (id: string | null | undefined): PlatformSpec => platformSpec(id) ?? (PLATFORMS[1] as PlatformSpec);

/** The safe rectangle in canvas px for a canvas of any size (the table's px scaled to it). */
export function safeRect(spec: PlatformSpec, canvas: { width: number; height: number }): { left: number; top: number; right: number; bottom: number } {
	const sx = canvas.width / spec.size.width;
	const sy = canvas.height / spec.size.height;
	return {
		left: spec.safe.left * sx,
		top: spec.safe.top * sy,
		right: canvas.width - spec.safe.right * sx,
		bottom: canvas.height - spec.safe.bottom * sy,
	};
}
