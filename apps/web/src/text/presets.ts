/**
 * Text presets for the Text tab, in the groups a creator looks for: Trending, Titles, Subtitles, Lower thirds,
 * Social, Sale & ads, Cinematic, Neon, Retro, Minimal, Handwritten. Each is a designed piece — an OFL font with
 * Cyrillic bundled in the app, a colour pair, often a motion title's layers (text/design.ts: plates, bars, icons,
 * a second line, a cursor that presses the button) and a choreographed In / Out / Loop (per letter, per word,
 * behind a mask). Everything stays editable in the inspector: words, colours, second line, icon, durations.
 *
 * Every preset wraps inside its box (84 % of the frame width unless set) and shrinks to fit, so it never leaves a
 * 9:16 or 16:9 frame whatever the user types. Ids are kept: templates, AI titles and Gaziyav AI refer to them.
 * Each has a theme (gaming, wedding, travel…) the Text tab filters by, and its tile is shown on a scene to match.
 */
import { PACK_PRESETS } from "./preset-packs";
import { presetRecipe } from "./recipe";
import type { Scene, Theme } from "./theme-scenes";

export type TextPresetGroup =
	| "Trending"
	| "Titles"
	| "Subtitles"
	| "Lower thirds"
	| "Social"
	| "Sale & ads"
	| "Cinematic"
	| "Neon"
	| "Retro"
	| "Minimal"
	| "Handwritten";

export interface TextPreset {
	id: string;
	name: string;
	group: TextPresetGroup;
	content: string;
	/** Vertical centre as a share of the frame height from the middle (−0.5 top … 0.5 bottom). */
	y: number;
	/** Seconds. */
	duration: number;
	/** Where the clip lands: at the playhead, at the end of the video, or across the whole video. */
	place?: "playhead" | "end" | "whole";
	/** Plate padding in em (converted to the renderer's units on insert). */
	plate?: { color: string; padX: number; padY: number; radius: number };
	params: Record<string, string | number | boolean>;
	/** The theme the filter shows it under (packs carry their own; the others are in THEME_OF). */
	theme?: Theme;
	/** A pack preset\'s Russian name and sample words (i18n merges the offered ones). */
	ru?: { name: string; content: string; sub?: [string, string] };
}

type Params = Record<string, string | number | boolean>;

const FIT = {
	"box.width": 84,
	"box.autoFit": true,
	"box.maxLines": 3,
	textAlign: "center",
} as const;

/** Lower thirds: a 70 % box, lines from its left edge. */
const LEFT = { ...FIT, "box.width": 70, "box.maxLines": 2, textAlign: "left" } as const;

const stroke = (width: number, color = "#000000") => ({
	"stroke.enabled": true,
	"stroke.color": color,
	"stroke.width": width,
});

const glow = (color: string, blur: number) => ({
	"shadow.enabled": true,
	"shadow.color": color,
	"shadow.blur": blur,
	"shadow.offsetX": 0,
	"shadow.offsetY": 0,
});

const softShadow = {
	"shadow.enabled": true,
	"shadow.color": "#00000099",
	"shadow.blur": 14,
	"shadow.offsetX": 0,
	"shadow.offsetY": 5,
};

const gradient = (to: string) => ({ "gradient.enabled": true, "gradient.color": to });

const anim = (inKind: string, inDuration: number, outKind = "none", outDuration = 0.4, loop = "none", delay = 0): Params => ({
	"anim.in": inKind,
	"anim.inDuration": inDuration,
	"anim.out": outKind,
	"anim.outDuration": outDuration,
	"anim.loop": loop,
	"anim.inDelay": delay,
});

/** A motion title: its design, colours, second line and icon (all editable in the inspector's Design group). */
const design = (id: string, colors: { accent: string; plate?: string; sub?: string }, sub = "", icon = ""): Params => ({
	"design.id": id,
	"design.accent": colors.accent,
	"design.plate": colors.plate ?? "#111111",
	"design.subColor": colors.sub ?? "#ffffff",
	"design.sub": sub,
	"design.icon": icon,
});

const OWN_PRESETS: TextPreset[] = [
	// ── Trending ──────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "bold-pop",
		name: "Bold Pop",
		group: "Trending",
		content: "Bold pop",
		y: -0.2,
		duration: 3,
		params: { ...FIT, fontFamily: "Montserrat", fontWeight: "900", textTransform: "uppercase", fontSize: 7.5, color: "#ffffff", ...stroke(8), ...anim("lettersPop", 0.55, "lettersOut", 0.35) },
	},
	{
		id: "stack",
		name: "Stack",
		group: "Trending",
		content: "No limits",
		y: -0.15,
		duration: 3,
		params: { ...FIT, fontFamily: "Unbounded", fontWeight: "900", textTransform: "uppercase", fontSize: 6.2, color: "#ffffff", ...softShadow, ...design("stack", { accent: "#ffffff" }), ...anim("maskRise", 0.6, "maskSink", 0.4) },
	},
	{
		id: "marker",
		name: "Marker",
		group: "Trending",
		content: "The secret is here",
		y: -0.18,
		duration: 3,
		params: { ...FIT, fontFamily: "Golos Text", fontWeight: "800", fontSize: 5.2, color: "#111111", ...design("marker", { accent: "#ffe14d" }), ...anim("wipe", 0.6, "fade", 0.3, "none", 0.15) },
	},
	{
		id: "word-pop",
		name: "Word Pop",
		group: "Trending",
		content: "one word at a time",
		y: -0.12,
		duration: 3,
		params: { ...FIT, fontFamily: "Montserrat", fontWeight: "900", textTransform: "uppercase", fontSize: 6, color: "#ffffff", ...stroke(7), "highlight.mode": "pop", "highlight.color": "#ffd60a", ...anim("fade", 0.15, "fade", 0.2) },
	},
	{
		id: "shimmer",
		name: "Shimmer Gold",
		group: "Trending",
		content: "Premium",
		y: -0.18,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Rubik", fontWeight: "900", textTransform: "uppercase", fontSize: 7.5, color: "#ffe29a", ...gradient("#e8892b"), ...softShadow, ...anim("flip", 0.6, "fade", 0.3, "shimmer") },
	},
	{
		id: "kinetic-zoom",
		name: "Kinetic Zoom",
		group: "Trending",
		content: "Wait for it",
		y: -0.2,
		duration: 3,
		params: { ...FIT, fontFamily: "Unbounded", fontWeight: "900", textTransform: "uppercase", fontSize: 7, color: "#ffffff", ...softShadow, ...anim("scaleDown", 0.6, "blurOut", 0.4) },
	},
	{
		id: "wave-gradient",
		name: "Wave Gradient",
		group: "Trending",
		content: "Summer vibes",
		y: -0.2,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Rubik", fontWeight: "900", fontSize: 7, color: "#ffd94d", ...gradient("#ff4d8c"), ...softShadow, ...anim("letters", 0.7, "lettersOut", 0.35, "lettersWave") },
	},

	// ── Titles ────────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "title-sub",
		name: "Title + Subtitle",
		group: "Titles",
		content: "Episode one",
		y: -0.1,
		duration: 4,
		params: { ...FIT, fontFamily: "Manrope", fontWeight: "800", fontSize: 6.5, color: "#ffffff", ...softShadow, ...design("title-sub", { accent: "#ffd60a", sub: "#ffffffcc" }, "The beginning"), ...anim("wordsUp", 0.8, "maskSink", 0.45, "none", 0.1) },
	},
	{
		id: "chapter",
		name: "Chapter",
		group: "Titles",
		content: "Getting started",
		y: -0.1,
		duration: 4,
		params: { ...FIT, fontFamily: "Unbounded", fontWeight: "700", fontSize: 5.2, color: "#ffffff", ...softShadow, ...design("chapter", { accent: "#3dffb5" }, "Chapter 01"), ...anim("maskRise", 0.8, "maskSink", 0.4, "none", 0.25) },
	},
	{
		id: "box-reveal",
		name: "Box Reveal",
		group: "Titles",
		content: "Breaking",
		y: -0.2,
		duration: 3,
		params: { ...FIT, fontFamily: "Oswald", fontWeight: "700", textTransform: "uppercase", letterSpacing: 4, fontSize: 7.5, color: "#111111", ...design("box-reveal", { accent: "#ffd60a" }), ...anim("maskRise", 0.7, "wipeOut", 0.35, "none", 0.25) },
	},
	{
		id: "underline-title",
		name: "Underline",
		group: "Titles",
		content: "Main idea",
		y: -0.2,
		duration: 3,
		params: { ...FIT, fontFamily: "Montserrat", fontWeight: "800", fontSize: 6.2, color: "#ffffff", ...softShadow, ...design("underline", { accent: "#ff2d95" }), ...anim("letters", 0.6, "lettersOut", 0.35) },
	},
	{
		id: "typewriter",
		name: "Typewriter",
		group: "Titles",
		content: "Once upon a time…",
		y: -0.2,
		duration: 4,
		params: { ...FIT, textAlign: "left", fontFamily: "PT Serif", fontWeight: "normal", fontSize: 4, color: "#ffffff", ...softShadow, ...anim("typewriter", 1.4, "fade", 0.3) },
	},
	{
		id: "glitch",
		name: "Glitch Title",
		group: "Titles",
		content: "System error",
		y: -0.2,
		duration: 3,
		params: { ...FIT, fontFamily: "Tektur", fontWeight: "800", textTransform: "uppercase", fontSize: 6.5, color: "#ffffff", ...stroke(4, "#ff006e"), ...anim("glitch", 0.6, "fade", 0.2, "shake") },
	},
	{
		id: "bounce-plate",
		name: "Bounce Plate",
		group: "Titles",
		content: "Big news",
		y: -0.2,
		duration: 3,
		plate: { color: "#ffffff", padX: 0.4, padY: 0.2, radius: 35 },
		params: { ...FIT, fontFamily: "Montserrat", fontWeight: "800", fontSize: 5, color: "#111111", ...anim("bounce", 0.5, "drop", 0.35) },
	},

	// ── Subtitles ─────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "caption",
		name: "Caption",
		group: "Subtitles",
		content: "this is how\ncaptions look",
		y: 0.09,
		duration: 3,
		params: { ...FIT, "box.maxLines": 2, fontFamily: "Montserrat", fontWeight: "800", fontSize: 5, color: "#ffffff", ...stroke(7) },
	},
	{
		id: "sub-karaoke",
		name: "Karaoke",
		group: "Subtitles",
		content: "sing along word by word",
		y: 0.22,
		duration: 3,
		params: { ...FIT, "box.maxLines": 2, fontFamily: "Montserrat", fontWeight: "800", fontSize: 4.6, color: "#ffffff", ...stroke(6), "highlight.mode": "karaoke", "highlight.color": "#ffd60a" },
	},
	{
		id: "sub-word-box",
		name: "Word Box",
		group: "Subtitles",
		content: "each word in its box",
		y: 0.22,
		duration: 3,
		params: { ...FIT, "box.maxLines": 2, fontFamily: "Montserrat", fontWeight: "800", textTransform: "uppercase", fontSize: 4.6, color: "#ffffff", ...softShadow, "highlight.mode": "box", "highlight.color": "#7c4dff" },
	},
	{
		id: "sub-yellow",
		name: "Yellow",
		group: "Subtitles",
		content: "classic yellow subtitles",
		y: 0.28,
		duration: 3,
		params: { ...FIT, "box.maxLines": 2, fontFamily: "Golos Text", fontWeight: "800", fontSize: 4.4, color: "#ffe14d", ...stroke(6, "#111111") },
	},
	{
		id: "sub-box",
		name: "Boxed",
		group: "Subtitles",
		content: "calm subtitles on a box",
		y: 0.3,
		duration: 3,
		plate: { color: "#000000b3", padX: 0.35, padY: 0.16, radius: 18 },
		params: { ...FIT, "box.maxLines": 2, fontFamily: "Golos Text", fontWeight: "600", fontSize: 3.6, color: "#ffffff", ...anim("fade", 0.2, "fade", 0.2) },
	},

	// ── Lower thirds and callouts ─────────────────────────────────────────────────────────────────────────────
	{
		id: "lower-third",
		name: "Lower Third",
		group: "Lower thirds",
		content: "Anna Petrova",
		y: 0.26,
		duration: 4,
		params: { ...LEFT, fontFamily: "Manrope", fontWeight: "800", fontSize: 3.6, color: "#ffffff", ...design("lt-bar", { accent: "#ffd60a", plate: "#0e0f13e6", sub: "#c7cad1" }, "Product expert"), ...anim("wordsUp", 0.7, "maskSink", 0.4, "none", 0.18) },
	},
	{
		id: "lt-pill",
		name: "Two Pills",
		group: "Lower thirds",
		content: "Max Ivanov",
		y: 0.26,
		duration: 4,
		params: { ...LEFT, fontFamily: "Golos Text", fontWeight: "800", fontSize: 3.5, color: "#111111", ...design("lt-pill", { accent: "#ff4d6d", plate: "#ffffff", sub: "#ffffff" }, "Founder, Studio North"), ...anim("maskRise", 0.7, "maskSink", 0.4, "none", 0.12) },
	},
	{
		id: "lt-line",
		name: "Minimal Line",
		group: "Lower thirds",
		content: "Elena Sokolova",
		y: 0.26,
		duration: 4,
		params: { ...LEFT, fontFamily: "Inter", fontWeight: "600", fontSize: 3.8, color: "#ffffff", ...softShadow, ...design("lt-line", { accent: "#3dffb5", sub: "#ffffffd9" }, "Art director"), ...anim("letters", 0.7, "lettersOut", 0.35, "none", 0.15) },
	},
	{
		id: "lt-glass",
		name: "Glass Card",
		group: "Lower thirds",
		content: "Dmitry Orlov",
		y: 0.26,
		duration: 4,
		params: { ...LEFT, fontFamily: "Onest", fontWeight: "700", fontSize: 3.4, color: "#ffffff", ...design("lt-glass", { accent: "#3d8bff", plate: "#ffffff26", sub: "#ffffffcc" }, "Live from Moscow", "mic"), ...anim("wordsUp", 0.7, "maskSink", 0.4, "none", 0.2) },
	},
	{
		id: "lt-split",
		name: "Split Block",
		group: "Lower thirds",
		content: "Olga Smirnova",
		y: 0.26,
		duration: 4,
		params: { ...LEFT, fontFamily: "Montserrat", fontWeight: "800", textTransform: "uppercase", fontSize: 3.4, color: "#ffffff", ...design("lt-split", { accent: "#ff2d95", plate: "#111111e6", sub: "#ffffff" }, "Nutritionist"), ...anim("maskRise", 0.7, "maskSink", 0.4, "none", 0.12) },
	},
	{
		id: "callout",
		name: "Callout",
		group: "Lower thirds",
		content: "New feature",
		y: -0.05,
		duration: 3.5,
		params: { ...LEFT, "box.width": 56, fontFamily: "Manrope", fontWeight: "800", fontSize: 4, color: "#ffffff", ...softShadow, ...design("callout-line", { accent: "#ffd60a", sub: "#ffffffcc" }, "Tap to try it"), ...anim("wipe", 0.5, "fade", 0.3, "none", 0.45) },
	},
	{
		id: "callout-box",
		name: "Callout Box",
		group: "Lower thirds",
		content: "Look here",
		y: -0.1,
		duration: 3,
		params: { ...FIT, fontFamily: "Golos Text", fontWeight: "800", fontSize: 4.4, color: "#ffffff", ...design("callout-box", { accent: "#ffd60a", plate: "#000000a6" }), ...anim("letters", 0.5, "fade", 0.3, "none", 0.2) },
	},

	// ── Social ────────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "subscribe",
		name: "Subscribe",
		group: "Social",
		content: "Subscribe",
		y: 0.18,
		duration: 3,
		params: { ...FIT, fontFamily: "Montserrat", fontWeight: "800", textTransform: "uppercase", fontSize: 4, color: "#ffffff", ...design("subscribe", { accent: "#ff2d2d" }), ...anim("lettersPop", 0.5, "fade", 0.3, "none", 0.08) },
	},
	{
		id: "like",
		name: "Like",
		group: "Social",
		content: "Like if you agree",
		y: 0.18,
		duration: 3,
		params: { ...FIT, fontFamily: "Golos Text", fontWeight: "700", fontSize: 3.6, color: "#111111", ...design("like", { accent: "#ff3b5c", plate: "#ffffff" }), ...anim("letters", 0.5, "fade", 0.3, "none", 0.15) },
	},
	{
		id: "link-bio",
		name: "Link in Bio",
		group: "Social",
		content: "Link in bio",
		y: 0.12,
		duration: 3,
		params: { ...FIT, fontFamily: "Montserrat", fontWeight: "800", fontSize: 3.8, color: "#ffffff", ...design("link-bio", { accent: "#3dffb5", plate: "#111111" }), ...anim("lettersPop", 0.5, "fade", 0.3, "none", 0.1) },
	},
	{
		id: "follow",
		name: "Follow",
		group: "Social",
		content: "@your.channel",
		y: 0.18,
		duration: 3,
		params: { ...FIT, fontFamily: "Manrope", fontWeight: "800", fontSize: 3.8, color: "#ffffff", ...design("follow", { accent: "#ff2d95", plate: "#ffffff22" }), ...anim("letters", 0.5, "fade", 0.3, "none", 0.1) },
	},
	{
		id: "comment",
		name: "Comment",
		group: "Social",
		content: "What do you think?",
		y: 0.12,
		duration: 3,
		params: { ...FIT, fontFamily: "Golos Text", fontWeight: "700", fontSize: 3.8, color: "#111111", ...design("comment", { accent: "#7c4dff", plate: "#ffffff" }), ...anim("letters", 0.5, "fade", 0.3, "none", 0.15) },
	},
	{
		id: "counter",
		name: "Counter",
		group: "Social",
		content: "1 000 000",
		y: -0.12,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Unbounded", fontWeight: "800", fontSize: 7, color: "#ffffff", ...softShadow, ...design("counter", { accent: "#ffd60a", sub: "#ffffffcc" }, "views"), ...anim("letters", 0.6, "fade", 0.3) },
	},

	// ── Sale & ads ────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "hook",
		name: "Hook",
		group: "Sale & ads",
		content: "You're doing\nthis wrong",
		y: -0.27,
		duration: 2.5,
		params: { ...FIT, fontFamily: "Montserrat", fontWeight: "900", fontSize: 6, color: "#ffffff", ...stroke(7), ...softShadow, ...anim("lettersPop", 0.45, "fade", 0.25) },
	},
	{
		id: "cta",
		name: "CTA",
		group: "Sale & ads",
		content: "Tap the link",
		y: 0.12,
		duration: 2.5,
		place: "end",
		params: { ...FIT, fontFamily: "Montserrat", fontWeight: "800", fontSize: 4.4, color: "#ffffff", ...design("cta-button", { accent: "#ff2d95", plate: "#7c4dff" }), ...anim("lettersPop", 0.5, "fade", 0.3, "pulse", 0.1) },
	},
	{
		id: "price",
		name: "Price",
		group: "Sale & ads",
		content: "−50%",
		y: -0.12,
		duration: 3,
		params: { ...FIT, fontFamily: "Rubik", fontWeight: "900", fontSize: 7.5, color: "#111111", ...design("price-burst", { accent: "#ffd60a", sub: "#111111" }, "today only"), ...anim("lettersPop", 0.5, "fade", 0.25, "none", 0.2) },
	},
	{
		id: "price-tag",
		name: "Price Tag",
		group: "Sale & ads",
		content: "1 990 ₽",
		y: -0.1,
		duration: 3,
		params: { ...FIT, fontFamily: "Montserrat", fontWeight: "900", fontSize: 5.6, color: "#ffffff", ...design("price-tag", { accent: "#ff3b30", sub: "#ffffffb3" }, "2 990 ₽"), ...anim("letters", 0.5, "fade", 0.25, "none", 0.25) },
	},
	{
		id: "sale-ribbon",
		name: "Ribbon",
		group: "Sale & ads",
		content: "Black Friday",
		y: -0.15,
		duration: 3,
		params: { ...FIT, fontFamily: "Oswald", fontWeight: "700", textTransform: "uppercase", letterSpacing: 3, fontSize: 5.4, color: "#ffffff", ...design("sale-ribbon", { accent: "#ff2d95", plate: "#7c4dff" }), ...anim("maskRise", 0.55, "wipeOut", 0.3, "none", 0.2) },
	},
	{
		id: "badge-circle",
		name: "Round Badge",
		group: "Sale & ads",
		content: "New\ndrop",
		y: -0.15,
		duration: 3,
		params: { ...FIT, fontFamily: "Unbounded", fontWeight: "900", textTransform: "uppercase", fontSize: 3.8, lineHeight: 1.05, color: "#ffffff", ...design("badge-circle", { accent: "#00b3ff" }), ...anim("lettersPop", 0.6, "fade", 0.25, "none", 0.2) },
	},
	{
		id: "ad-label",
		name: "Ad label",
		group: "Sale & ads",
		// An ad disclosure; the brand is edited in place (local ad-marking rules, e.g. an erid, go in the same line).
		content: "Ad · Sponsored by Brand",
		y: -0.37,
		duration: 5,
		place: "whole",
		plate: { color: "#00000080", padX: 0.5, padY: 0.25, radius: 30 },
		params: { ...FIT, "box.maxLines": 2, fontFamily: "Golos Text", fontWeight: "500", fontSize: 2, color: "#ffffff" },
	},

	// ── Cinematic ─────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "cinematic",
		name: "Cinematic",
		group: "Cinematic",
		content: "The beginning",
		y: 0,
		duration: 4,
		params: { ...FIT, fontFamily: "Playfair Display", fontWeight: "normal", textTransform: "uppercase", letterSpacing: 18, fontSize: 4, color: "#f4efe6", ...softShadow, ...design("flank", { accent: "#d4af37" }), ...anim("tracking", 1.8, "fade", 0.6) },
	},
	{
		id: "cine-serif",
		name: "Film Title",
		group: "Cinematic",
		content: "The Last Summer",
		y: -0.05,
		duration: 4.5,
		params: { ...FIT, fontFamily: "Playfair Display", fontWeight: "500", fontStyle: "italic", fontSize: 6, color: "#f5f0e6", ...softShadow, ...design("title-sub", { accent: "#d4af37", sub: "#f5f0e6cc" }, "A story about us"), ...anim("maskRise", 0.9, "fade", 0.6, "none", 0.1) },
	},
	{
		id: "brackets",
		name: "Brackets",
		group: "Cinematic",
		content: "In theaters",
		y: 0,
		duration: 4,
		params: { ...FIT, fontFamily: "Oswald", fontWeight: "400", textTransform: "uppercase", letterSpacing: 14, fontSize: 4.4, color: "#ffffff", ...softShadow, ...design("brackets", { accent: "#ffffff" }), ...anim("wipe", 0.8, "fade", 0.5, "none", 0.3) },
	},
	{
		id: "credits",
		name: "Credits",
		group: "Cinematic",
		content: "Anna Petrova",
		y: 0,
		duration: 4,
		params: { ...FIT, fontFamily: "Yeseva One", fontWeight: "normal", fontSize: 5.6, color: "#f5f0e6", ...softShadow, ...design("chapter", { accent: "#d4af37" }, "Directed by"), ...anim("letters", 1, "fade", 0.6, "none", 0.25) },
	},
	{
		id: "epic",
		name: "Epic",
		group: "Cinematic",
		content: "Legends never die",
		y: -0.05,
		duration: 4,
		params: { ...FIT, fontFamily: "Philosopher", fontWeight: "700", textTransform: "uppercase", letterSpacing: 8, fontSize: 5, color: "#ffffff", ...gradient("#8f96a3"), ...softShadow, ...anim("blurIn", 1.2, "fade", 0.6, "shimmer") },
	},

	// ── Neon ──────────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "neon",
		name: "Neon Flicker",
		group: "Neon",
		content: "Neon nights",
		y: -0.2,
		duration: 3,
		params: { ...FIT, fontFamily: "Unbounded", fontWeight: "600", fontSize: 6, color: "#c8fbff", ...glow("#00e5ffcc", 45), ...anim("neon", 0.8, "fade", 0.3, "glowPulse") },
	},
	{
		id: "neon-frame",
		name: "Neon Sign",
		group: "Neon",
		content: "Open 24/7",
		y: -0.15,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Comfortaa", fontWeight: "700", textTransform: "uppercase", fontSize: 5, color: "#ffe6f2", ...glow("#ff2d95dd", 40), ...design("neon-frame", { accent: "#ff2d95" }), ...anim("neon", 0.8, "fade", 0.3, "glowPulse", 0.2) },
	},
	{
		id: "neon-line",
		name: "Night Drive",
		group: "Neon",
		content: "Night drive",
		y: -0.18,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Exo 2", fontWeight: "800", fontStyle: "italic", fontSize: 6.2, color: "#e6fffb", ...glow("#00e5ffcc", 38), ...design("neon-line", { accent: "#00e5ff" }), ...anim("letters", 0.8, "lettersOut", 0.35, "glowPulse") },
	},
	{
		id: "neon-lime",
		name: "Game On",
		group: "Neon",
		content: "Game on",
		y: -0.18,
		duration: 3,
		params: { ...FIT, fontFamily: "Tektur", fontWeight: "800", textTransform: "uppercase", fontSize: 6.6, color: "#f4ffe0", ...glow("#b6ff3bcc", 40), ...anim("flip", 0.6, "scatterOut", 0.45, "flicker") },
	},

	// ── Retro ─────────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "retro-gradient",
		name: "Retro Wave",
		group: "Retro",
		content: "Retro wave",
		y: -0.2,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Exo 2", fontWeight: "800", fontStyle: "italic", textTransform: "uppercase", fontSize: 7, color: "#22d3ee", ...gradient("#e040fb"), ...glow("#e040fb99", 25), ...design("retro-sun", { accent: "#ff6ec7", plate: "#ffd36e" }), ...anim("slideLeft", 0.5, "fade", 0.3, "float", 0.25) },
	},
	{
		id: "retro-echo",
		name: "Groovy",
		group: "Retro",
		content: "Groovy",
		y: -0.18,
		duration: 3,
		params: { ...FIT, fontFamily: "Rubik Mono One", fontWeight: "normal", textTransform: "uppercase", fontSize: 6.4, color: "#fff3d6", ...design("retro-echo", { accent: "#ff3d7f" }), ...anim("letters", 0.6, "lettersOut", 0.35) },
	},
	{
		id: "pixel",
		name: "Pixel",
		group: "Retro",
		content: "Level up",
		y: -0.18,
		duration: 3,
		params: { ...FIT, fontFamily: "Press Start 2P", fontWeight: "normal", textTransform: "uppercase", fontSize: 4, lineHeight: 1.4, color: "#ffffff", ...design("pixel-shadow", { accent: "#ff2d95" }), ...anim("typewriter", 0.8, "fade", 0.2) },
	},
	{
		id: "retro-chrome",
		name: "Chrome 80s",
		group: "Retro",
		content: "Turbo",
		y: -0.18,
		duration: 3,
		params: { ...FIT, fontFamily: "Seymour One", fontWeight: "normal", textTransform: "uppercase", fontSize: 6.6, color: "#e8f7ff", ...gradient("#4d7cff"), ...stroke(4, "#ff2d95"), ...softShadow, ...anim("scaleDown", 0.6, "blurOut", 0.4, "shimmer") },
	},

	// ── Minimal ───────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "plain",
		name: "Plain",
		group: "Minimal",
		content: "Text",
		y: 0,
		duration: 3,
		params: { ...FIT, fontFamily: "Golos Text", fontWeight: "600", fontSize: 5, color: "#ffffff", ...softShadow },
	},
	{
		id: "minimal-label",
		name: "Label",
		group: "Minimal",
		content: "New collection",
		y: -0.2,
		duration: 3,
		params: { ...FIT, fontFamily: "Inter", fontWeight: "600", textTransform: "uppercase", letterSpacing: 10, fontSize: 2.8, color: "#ffffff", ...softShadow, ...design("label-dot", { accent: "#3dffb5" }), ...anim("wipe", 0.6, "wipeOut", 0.35, "none", 0.1) },
	},
	{
		id: "thin-frame",
		name: "Thin Frame",
		group: "Minimal",
		content: "Less is more",
		y: -0.12,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Manrope", fontWeight: "300", fontSize: 4.8, color: "#ffffff", ...softShadow, ...design("thin-frame", { accent: "#ffffff" }), ...anim("letters", 0.8, "fade", 0.4, "none", 0.2) },
	},
	{
		id: "quote",
		name: "Review",
		group: "Minimal",
		content: "“Worked in a week”",
		y: -0.12,
		duration: 3.5,
		params: { ...LEFT, fontFamily: "Playfair Display", fontWeight: "600", fontStyle: "italic", fontSize: 4.6, color: "#ffffff", ...softShadow, ...design("quote-mark", { accent: "#ffd60a", sub: "#ffffffcc" }, "Maria K., customer"), ...anim("wordsUp", 0.7, "fade", 0.3, "none", 0.2) },
	},

	// ── Handwritten ───────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "hand-note",
		name: "Note",
		group: "Handwritten",
		content: "my favourite part",
		y: -0.15,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Caveat", fontWeight: "700", fontSize: 6.4, color: "#ffffff", ...softShadow, ...design("scribble", { accent: "#ffd60a" }), ...anim("wipe", 0.8, "fade", 0.3) },
	},
	{
		id: "signature",
		name: "Signature",
		group: "Handwritten",
		content: "Anna",
		y: 0.1,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Marck Script", fontWeight: "normal", fontSize: 8.5, color: "#ffffff", ...softShadow, ...design("scribble", { accent: "#ffffff" }), ...anim("wipe", 1.2, "fade", 0.4) },
	},
	{
		id: "sticker-note",
		name: "Sticky Note",
		group: "Handwritten",
		content: "remember\nthis one",
		y: -0.15,
		duration: 3,
		params: { ...FIT, fontFamily: "Caveat", fontWeight: "700", fontSize: 5.5, color: "#1d1d1d", "transform.rotate": -4, ...design("sticker", { accent: "#ffd60a", plate: "#fff27a" }), ...anim("letters", 0.6, "fade", 0.3, "none", 0.15) },
	},
	{
		id: "thanks",
		name: "Thank You",
		group: "Handwritten",
		content: "thank you for watching",
		y: 0,
		duration: 3.5,
		params: { ...FIT, fontFamily: "Bad Script", fontWeight: "normal", fontSize: 5, color: "#ffffff", ...softShadow, ...anim("letters", 1.1, "lettersOut", 0.5) },
	},
	{
		id: "plan",
		name: "Today's Plan",
		group: "Handwritten",
		content: "Today's plan",
		y: -0.2,
		duration: 3,
		params: { ...FIT, fontFamily: "Amatic SC", fontWeight: "700", fontSize: 8, color: "#111111", ...design("marker", { accent: "#ff8fab" }), ...anim("wipe", 0.6, "fade", 0.3, "none", 0.15) },
	},

	// ── Made for a theme ──────────────────────────────────────────────────────────────────────────────────────
	{
		id: "wedding",
		name: "Wedding",
		group: "Titles",
		content: "Anna & Max",
		y: -0.08,
		duration: 4.5,
		params: { ...FIT, fontFamily: "Marck Script", fontWeight: "normal", fontSize: 8, color: "#ffffff", ...softShadow, ...design("title-sub", { accent: "#e8c77a", sub: "#ffffffe6" }, "12 . 06 . 2026"), ...anim("wipe", 1.1, "fade", 0.6, "none", 0.1) },
	},
	{
		id: "goal",
		name: "Goal",
		group: "Trending",
		content: "Goal!",
		y: -0.12,
		duration: 3,
		params: { ...FIT, fontFamily: "Russo One", fontWeight: "normal", textTransform: "uppercase", fontSize: 9, color: "#ffffff", ...stroke(6), ...design("stack", { accent: "#ffffff" }), ...anim("lettersPop", 0.5, "scatterOut", 0.4) },
	},
	{
		id: "workout",
		name: "Challenge",
		group: "Trending",
		content: "30-day challenge",
		y: -0.15,
		duration: 3,
		params: { ...FIT, fontFamily: "Oswald", fontWeight: "700", textTransform: "uppercase", letterSpacing: 3, fontSize: 6, color: "#111111", ...design("box-reveal", { accent: "#c6ff3b" }), ...anim("maskRise", 0.7, "wipeOut", 0.35, "none", 0.25) },
	},
	{
		id: "menu",
		name: "Menu",
		group: "Titles",
		content: "Today's menu",
		y: -0.18,
		duration: 3,
		params: { ...FIT, fontFamily: "Rubik", fontWeight: "900", textTransform: "uppercase", fontSize: 6.4, color: "#ffffff", ...design("box-reveal", { accent: "#ff7b3d" }), ...anim("maskRise", 0.7, "maskSink", 0.35, "none", 0.25) },
	},
	{
		id: "location",
		name: "Location",
		group: "Lower thirds",
		content: "Bali, Indonesia",
		y: 0.26,
		duration: 4,
		params: { ...LEFT, fontFamily: "Onest", fontWeight: "700", fontSize: 3.4, color: "#ffffff", ...design("lt-glass", { accent: "#ff7b3d", plate: "#ffffff26", sub: "#ffffffcc" }, "Day 3 of 14", "pin"), ...anim("wordsUp", 0.7, "maskSink", 0.4, "none", 0.2) },
	},
	{
		id: "realty",
		name: "Listing",
		group: "Sale & ads",
		content: "3-room apartment",
		y: 0.26,
		duration: 4,
		params: { ...LEFT, fontFamily: "Manrope", fontWeight: "800", fontSize: 3.6, color: "#ffffff", ...design("lt-bar", { accent: "#3dffb5", plate: "#0e0f13e6", sub: "#3dffb5" }, "from 12.5 M ₽"), ...anim("wordsUp", 0.7, "maskSink", 0.4, "none", 0.18) },
	},
];

/** The designed presets, then the packs coloured with designer palettes (text/preset-packs.ts), one of each recipe (text/recipe.ts). */
export { presetRecipe };

const seenRecipes = new Set<string>();
export const TEXT_PRESETS: TextPreset[] = [...OWN_PRESETS, ...PACK_PRESETS].filter((preset) => {
	const recipe = presetRecipe(preset);
	if (seenRecipes.has(recipe)) return false;
	seenRecipes.add(recipe);
	return true;
});

/** Russian names and sample words of the pack presets that are offered (the dictionary merges them). */
export const PACK_RU: Record<string, string> = Object.fromEntries(
	TEXT_PRESETS.flatMap((preset) => (preset.ru ? [[preset.name, preset.ru.name], [preset.content, preset.ru.content], ...(preset.ru.sub ? [preset.ru.sub] : [])] : [])),
);

/** Every preset's theme (the Text tab's filter). */
const THEME_OF: Record<string, Theme> = {
	"bold-pop": "gaming", stack: "fitness", marker: "education", "word-pop": "business", shimmer: "beauty", "kinetic-zoom": "sports", "wave-gradient": "travel", goal: "sports", workout: "fitness",
	"title-sub": "travel", chapter: "education", "box-reveal": "news", "underline-title": "business", typewriter: "kids", glitch: "gaming", "bounce-plate": "kids", wedding: "wedding", menu: "food",
	caption: "news", "sub-karaoke": "music", "sub-word-box": "business", "sub-yellow": "education", "sub-box": "news",
	"lower-third": "business", "lt-pill": "tech", "lt-line": "fashion", "lt-glass": "news", "lt-split": "food", callout: "tech", "callout-box": "education", location: "travel",
	subscribe: "gaming", like: "beauty", "link-bio": "fashion", follow: "music", comment: "kids", counter: "business",
	hook: "business", cta: "fashion", price: "food", "price-tag": "beauty", "sale-ribbon": "fashion", "badge-circle": "tech", "ad-label": "business", realty: "realEstate",
	cinematic: "travel", "cine-serif": "wedding", brackets: "music", credits: "wedding", epic: "sports",
	neon: "music", "neon-frame": "food", "neon-line": "travel", "neon-lime": "gaming",
	"retro-gradient": "music", "retro-echo": "music", pixel: "gaming", "retro-chrome": "sports",
	plain: "business", "minimal-label": "fashion", "thin-frame": "realEstate", quote: "beauty",
	"hand-note": "travel", signature: "wedding", "sticker-note": "education", thanks: "kids", plan: "fitness",
};

/** The groups CapCut users know by their backdrop: a film still, a product, stories, a night city, an interview. */
const GROUP_SCENE: Partial<Record<TextPresetGroup, Scene>> = {
	Cinematic: "film",
	"Sale & ads": "product",
	Social: "stories",
	Neon: "nightCity",
	"Lower thirds": "interview",
};

/** Presets whose own theme says more than their group (a game title on a game, a listing on a house). */
const OWN_SCENE = new Set(["location", "realty", "neon-lime"]);

export const presetTheme = (preset: TextPreset): Theme => preset.theme ?? THEME_OF[preset.id] ?? "business";
export function presetScene(preset: TextPreset): Scene {
	const theme = presetTheme(preset);
	if (OWN_SCENE.has(preset.id)) return theme;
	return GROUP_SCENE[preset.group] ?? theme;
}

export const TEXT_PRESET_GROUPS: TextPresetGroup[] = ["Trending", "Titles", "Subtitles", "Lower thirds", "Social", "Sale & ads", "Cinematic", "Neon", "Retro", "Minimal", "Handwritten"];

/**
 * Element params for a preset on a frame of the given height. Plate padding is
 * authored in em and converted to the renderer's units (canvas px × size / 15).
 */
export function buildPresetParams({
	preset,
	canvasHeight,
}: {
	preset: TextPreset;
	canvasHeight: number;
}): Record<string, string | number | boolean> {
	const params: Record<string, string | number | boolean> = {
		...preset.params,
		content: preset.content,
		"transform.positionY": Math.round(preset.y * canvasHeight),
	};
	if (preset.plate) {
		const units = (em: number) => Math.round((em * canvasHeight) / 6);
		Object.assign(params, {
			"background.enabled": true,
			"background.color": preset.plate.color,
			"background.paddingX": units(preset.plate.padX),
			"background.paddingY": units(preset.plate.padY),
			"background.cornerRadius": preset.plate.radius,
		});
	}
	return params;
}
