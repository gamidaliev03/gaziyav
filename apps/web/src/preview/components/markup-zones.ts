// Preview · markup: every number the «Разметка» guides draw, in ONE place (fractions of the frame). Correct a zone

/** Covered bands of a frame, as fractions of its width (left / right) and height (top / bottom). */
export interface Margins {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

export interface SocialPlatform extends Margins {
	id: string;
	/** Shown in the menu and on the frame («≈» = a measured convention, not a published number). */
	label: string;
	/** The name in «Under {ui} UI». */
	ui: string;
}

/** 9:16 — the parts the Reels / TikTok / Shorts / VK Clips interfaces cover. */
export const VERTICAL_PLATFORMS: readonly SocialPlatform[] = [
	// TikTok for Business, ad creative safe zone (1080 × 1920: left 60, right 140, top 220, bottom 480 px)
	{ id: "tiktok", label: "TikTok", ui: "TikTok", top: 0.115, bottom: 0.25, left: 0.056, right: 0.13 },
	// Meta, Reels ads safe zone: keep 14 % at the top, 35 % at the bottom and 6 % at the sides free
	{ id: "reels", label: "Reels", ui: "Reels", top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 },
	// measured convention (YouTube publishes no numbers): the wider button column on the right
	{ id: "shorts", label: "Shorts ≈", ui: "Shorts", top: 0.15, bottom: 0.35, left: 0.044, right: 0.18 },
	// measured convention
	{ id: "vk", label: "VK Clips ≈", ui: "VK Clips", top: 0.14, bottom: 0.35, left: 0.06, right: 0.13 },
];

/** The platforms offered per UI language; «all» (the union) is always first. */
export const PLATFORMS_BY_LANGUAGE: Record<"ru" | "en", readonly string[]> = {
	ru: ["all", "vk", "shorts", "reels", "tiktok"],
	en: ["all", "tiktok", "reels", "shorts", "vk"],
};

/** 16:9 — YouTube's player: the control bar with the progress line, the title row shown on pause, the end screen. */
export const YOUTUBE_WIDE = {
	// measured convention: 48 px of controls (with the scrubber) on a 405 px tall 720 px player, rounded up
	controls: 0.12,
	// measured convention: the title and the buttons that appear on pause / hover
	titleBar: 0.12,
	// measured convention: where YouTube Studio's end-screen templates put the video and subscribe elements
	endScreen: { top: 0.22, bottom: 0.22, left: 0.06, right: 0.06 } as Margins,
} as const;

/** 1:1 and 4:5 — the feed: the profile grid shows a 3:4 centre crop; video posts carry mute / tag icons at the bottom. */
export const FEED = {
	// Instagram's profile grid (since January 2025): 3:4 tiles, the centre of the post
	gridAspect: 3 / 4,
	// measured convention: the mute and the tagged-people icons in the bottom corners of a feed video
	icons: 0.1,
} as const;

/** Broadcast safe areas (SMPTE RP 2046-1 / EBU R 95): action 93 %, title 90 % of each side, centred. */
export const BROADCAST = { action: 0.93, title: 0.9, cross: 0.04 } as const;

/** Text zones, inside the title-safe width (the subtitle zone comes from the captions' own default placement). */
export const TEXT_ZONES = {
	// a lower third: the band from 2/3 of the height down to the title-safe edge
	lowerThird: { top: 2 / 3, bottom: 0.95 },
	// a big title: the middle band
	bigTitle: { top: 0.35, bottom: 0.65 },
} as const;

/** Thirds and the centre lines. */
export const THIRDS = [1 / 3, 2 / 3] as const;
