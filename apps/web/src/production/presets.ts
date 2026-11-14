// Looks for Claude's edits: each one an editor's set of decisions (two fonts with tuned spacing, two or three colours,
// one caption design, the title / lower-third / stat / ending templates, one transition or none, the sounds, the
// grade and its finishing, the music mood, the pace). Everything is the app's own content: bundled fonts, Text
// presets, motion templates, transitions, looks, library sounds — nothing to download, nothing new on screen.
// apply_plan builds with a preset, review checks the edit against it, the user's brand kit (taste profile) overrides it.
import type { CaptionStyleId } from "@/subtitles/styles";

export type PresetId = "clean-premium" | "documentary" | "tech-review" | "luxury" | "energetic-reel" | "podcast";

export interface Preset {
	id: PresetId;
	name: string;
	/** What it suits, in a line (Claude reads it to choose). */
	suits: string;
	/** One display face for titles, one text face for captions and lower thirds; tracking in px at 1080 p, leading ×. */
	fonts: { display: string; displayWeight: string; text: string; textWeight: string; tracking: number; leading: number };
	/** Two or three colours: ink (text), accent (highlights, bars), plate (boxes behind text). */
	palette: { ink: string; accent: string; plate: string };
	captions: { style: CaptionStyleId; uppercase: boolean; maxWords: number };
	/** Text presets (src/text/presets.ts ids) restyled with the fonts and palette above. */
	text: { hook: string; title: string; lowerThird: string; cta: string };
	/** Motion templates (src/montage/mograph.ts kinds). */
	motion: { stat: string; endScreen: string; ctaShort: string; chapter: string | null };
	/** Text in / out: eased, never linear, 0.2–0.4 s; one direction for the whole video. */
	moves: { in: string; out: string; inSeconds: number; outSeconds: number };
	/** One transition style at most (null: straight cuts only) and where it may go. */
	transition: { type: string | null; seconds: number; where: "sections" | "never" };
	/** Library sounds by words; level in dB under the library's own level (it sits at −14 LUFS). */
	sfx: { hit: string; whoosh: string; riser: string; levelDb: number };
	/** Colour: a look (effects/luts/looks.ts) at a strength, finishing only where the preset calls for it. */
	grade: { look: string; intensity: number; grain: number; vignette: number };
	music: { mood: string; levelDb: number };
	/** Shot lengths in seconds (reel and long-form) and the punch-in scale that hides a jump cut. */
	pace: { reel: [number, number]; long: [number, number]; punchIn: number };
	/** Wipes, whips and spins only here. */
	energetic: boolean;
}

export const PRESETS: Preset[] = [
	{
		id: "clean-premium",
		name: "Clean premium",
		suits: "talking heads, experts, brands: calm, white space, straight cuts",
		fonts: { display: "Manrope", displayWeight: "800", text: "Inter", textWeight: "600", tracking: -0.5, leading: 1.08 },
		palette: { ink: "#FFFFFF", accent: "#F5C451", plate: "#111317" },
		captions: { style: "karaoke", uppercase: false, maxWords: 4 },
		text: { hook: "hook", title: "title-sub", lowerThird: "lower-third", cta: "cta" },
		motion: { stat: "MgBigCounter", endScreen: "MgEndScreen", ctaShort: "MgFollowButton", chapter: null },
		moves: { in: "fade", out: "fade", inSeconds: 0.3, outSeconds: 0.25 },
		transition: { type: null, seconds: 0, where: "never" },
		sfx: { hit: "pop click soft", whoosh: "whoosh soft", riser: "riser", levelDb: -10 },
		grade: { look: "softContrast", intensity: 0.55, grain: 0, vignette: 0.08 },
		music: { mood: "calm corporate piano ambient", levelDb: -9 },
		pace: { reel: [1.2, 3], long: [3, 7], punchIn: 1.12 },
		energetic: false,
	},
	{
		id: "documentary",
		name: "Documentary",
		suits: "stories, interviews, travel, history: serif titles, slow pace, film finish",
		fonts: { display: "Playfair Display", displayWeight: "500", text: "Inter", textWeight: "500", tracking: 1, leading: 1.12 },
		palette: { ink: "#F4EFE6", accent: "#C9A45C", plate: "#0B0B0C" },
		captions: { style: "clean", uppercase: false, maxWords: 7 },
		text: { hook: "cine-serif", title: "cine-serif", lowerThird: "lt-line", cta: "minimal-label" },
		motion: { stat: "MgBigCounter", endScreen: "MgEndScreen", ctaShort: "MgLinkInBio", chapter: null },
		moves: { in: "fade", out: "fade", inSeconds: 0.4, outSeconds: 0.35 },
		transition: { type: "studio.transition.dissolve", seconds: 0.5, where: "sections" },
		sfx: { hit: "soft impact", whoosh: "air whoosh", riser: "cinematic riser", levelDb: -12 },
		grade: { look: "g.cineNeg", intensity: 0.5, grain: 0.15, vignette: 0.18 },
		music: { mood: "cinematic ambient documentary", levelDb: -10 },
		pace: { reel: [1.8, 4], long: [4, 9], punchIn: 1.08 },
		energetic: false,
	},
	{
		id: "tech-review",
		name: "Tech review",
		suits: "gadgets, apps, tutorials, numbers: crisp sans, mint accent, stats as charts",
		fonts: { display: "Unbounded", displayWeight: "700", text: "Onest", textWeight: "500", tracking: 0, leading: 1.05 },
		palette: { ink: "#FFFFFF", accent: "#3DFFB5", plate: "#0D1117" },
		captions: { style: "word-box", uppercase: false, maxWords: 4 },
		text: { hook: "hook", title: "chapter", lowerThird: "lt-glass", cta: "cta" },
		motion: { stat: "MgStatTrio", endScreen: "MgEndScreen", ctaShort: "MgFollowButton", chapter: "MgSplitBumper" },
		moves: { in: "slideUp", out: "fade", inSeconds: 0.3, outSeconds: 0.25 },
		transition: { type: null, seconds: 0, where: "never" },
		sfx: { hit: "click tech", whoosh: "whoosh", riser: "riser", levelDb: -10 },
		grade: { look: "coolTech", intensity: 0.45, grain: 0, vignette: 0.05 },
		music: { mood: "electronic tech minimal", levelDb: -9 },
		pace: { reel: [1, 2.5], long: [2.5, 6], punchIn: 1.12 },
		energetic: false,
	},
	{
		id: "luxury",
		name: "Luxury",
		suits: "fashion, real estate, jewellery, premium products: serif, gold, slow and quiet",
		fonts: { display: "Cormorant Garamond", displayWeight: "500", text: "Raleway", textWeight: "400", tracking: 3, leading: 1.15 },
		palette: { ink: "#F5F0E6", accent: "#D4AF37", plate: "#0A0A0A" },
		captions: { style: "clean", uppercase: true, maxWords: 5 },
		text: { hook: "cinematic", title: "cinematic", lowerThird: "lt-line", cta: "minimal-label" },
		motion: { stat: "MgBigCounter", endScreen: "MgEndScreen", ctaShort: "MgLinkInBio", chapter: null },
		moves: { in: "fade", out: "fade", inSeconds: 0.4, outSeconds: 0.4 },
		transition: { type: "studio.transition.dissolve", seconds: 0.6, where: "sections" },
		sfx: { hit: "soft chime", whoosh: "silk whoosh", riser: "swell", levelDb: -14 },
		grade: { look: "g.goldenStock", intensity: 0.45, grain: 0.1, vignette: 0.22 },
		music: { mood: "elegant piano strings luxury", levelDb: -10 },
		pace: { reel: [2, 4], long: [4, 9], punchIn: 1.06 },
		energetic: false,
	},
	{
		id: "energetic-reel",
		name: "Energetic reel",
		suits: "hype, fitness, sales, trends: bold words, fast cuts, whips allowed",
		fonts: { display: "Montserrat", displayWeight: "900", text: "Montserrat", textWeight: "800", tracking: 0, leading: 1.0 },
		palette: { ink: "#FFFFFF", accent: "#FFD23F", plate: "#111111" },
		captions: { style: "hormozi", uppercase: true, maxWords: 3 },
		text: { hook: "hook", title: "box-reveal", lowerThird: "lt-pill", cta: "cta" },
		motion: { stat: "MgBigCounter", endScreen: "MgEndScreen", ctaShort: "MgFollowButton", chapter: "MgSplitBumper" },
		moves: { in: "pop", out: "fade", inSeconds: 0.25, outSeconds: 0.2 },
		transition: { type: "studio.transition.whip", seconds: 0.25, where: "sections" },
		sfx: { hit: "pop", whoosh: "whoosh fast", riser: "riser", levelDb: -8 },
		grade: { look: "juicy", intensity: 0.5, grain: 0, vignette: 0.05 },
		music: { mood: "upbeat energetic pop", levelDb: -8 },
		pace: { reel: [0.8, 2], long: [2, 5], punchIn: 1.15 },
		energetic: true,
	},
	{
		id: "podcast",
		name: "Podcast",
		suits: "podcasts and conversations: speaker framed, names in lower thirds, captions in two lines",
		fonts: { display: "Manrope", displayWeight: "800", text: "Inter", textWeight: "600", tracking: -0.3, leading: 1.08 },
		palette: { ink: "#FFFFFF", accent: "#7C9CFF", plate: "#101114" },
		captions: { style: "karaoke", uppercase: false, maxWords: 5 },
		text: { hook: "hook", title: "title-sub", lowerThird: "lower-third", cta: "cta" },
		motion: { stat: "MgBigCounter", endScreen: "MgEndScreen", ctaShort: "MgFollowButton", chapter: null },
		moves: { in: "fade", out: "fade", inSeconds: 0.3, outSeconds: 0.25 },
		transition: { type: null, seconds: 0, where: "never" },
		sfx: { hit: "pop soft", whoosh: "whoosh soft", riser: "riser", levelDb: -12 },
		grade: { look: "softContrast", intensity: 0.4, grain: 0, vignette: 0.06 },
		music: { mood: "lofi chill podcast", levelDb: -12 },
		pace: { reel: [1.5, 3.5], long: [4, 10], punchIn: 1.1 },
		energetic: false,
	},
];

export const PRESET_IDS = PRESETS.map((p) => p.id);

export const presetOf = (id: string | null | undefined): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** A motion template's font field takes these only (src/montage/mograph.ts MOGRAPH_FONTS): the nearest one. */
export function mographFont(family: string): string {
	const map: Record<string, string> = {
		Manrope: "Manrope",
		Inter: "Manrope",
		Raleway: "Manrope",
		Onest: "Onest",
		Unbounded: "Unbounded",
		Montserrat: "Montserrat",
		"Playfair Display": "PlayfairDisplay",
		"Cormorant Garamond": "PlayfairDisplay",
		"Golos Text": "GolosText",
		Rubik: "Rubik",
	};
	return map[family] ?? "Montserrat";
}

/** A preset with the brand kit on top (fonts and colours the user keeps). */
export function withBrand(preset: Preset, brand?: { display?: string; text?: string; ink?: string; accent?: string; plate?: string; captionStyle?: string }): Preset {
	if (!brand) return preset;
	return {
		...preset,
		fonts: { ...preset.fonts, ...(brand.display ? { display: brand.display } : {}), ...(brand.text ? { text: brand.text } : {}) },
		palette: { ...preset.palette, ...(brand.ink ? { ink: brand.ink } : {}), ...(brand.accent ? { accent: brand.accent } : {}), ...(brand.plate ? { plate: brand.plate } : {}) },
		captions: { ...preset.captions, ...(brand.captionStyle ? { style: brand.captionStyle as CaptionStyleId } : {}) },
	};
}
