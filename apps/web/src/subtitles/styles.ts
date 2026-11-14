/**
 * Caption styles for the Captions tab. A style is a set of text params plus
 * chunk limits; the active word is driven by `caption.words` timings through
 * the text renderer's highlight modes, so preview and export match.
 *
 * Stroke widths stay ≤ 5 % of the size: the stroke is painted outside the
 * glyphs only, and thicker strokes would fill the gaps in ж/ш/щ.
 */
import { create } from "zustand";
import { MOTION_LOOKS } from "./motion-looks";
import { findUserCaptionStyle } from "@/presets/user-presets";
import type { ChunkLimits } from "./chunk";
import { useLang } from "@/i18n";

export type CaptionStyleId =
	| "hormozi"
	| "karaoke"
	| "word-box"
	| "word-pop"
	| "clean"
	| "tiktok"
	| "neon"
	| "one-word"
	/** Ad captions for Cyrillic (docs/MARKETING.md): see AD_CAPTION_STYLES. */
	| `ad-${string}`
	/** Looks that fill CapCut's Templates groups (Classic, Glow, Aesthetic…): see TEMPLATE_LOOKS. */
	| `cc-${string}`
	/** The user's own, made by Gaziyav AI in the Captions tab (presets/user-presets.ts). */
	| `user-${string}`;

export interface CaptionStyle {
	id: CaptionStyleId;
	name: string;
	limits: ChunkLimits;
	/** Drop , . ; : at word ends (everything but Clean). */
	stripPunctuation: boolean;
	params: Record<string, string | number | boolean>;
}

/** What every caption style starts from (a style only lists what it changes). */
export const CAPTION_BASE = {
	textAlign: "center",
	"box.width": 84,
	"box.maxLines": 2,
	"box.autoFit": true,
	lineHeight: 1.1,
	"stroke.enabled": false,
	"shadow.enabled": false,
	"gradient.enabled": false,
	"background.enabled": false,
	"highlight.mode": "none",
	"highlight.scale": 1,
	"highlight.index": -1,
	textTransform: "none",
	letterSpacing: 0,
	"anim.in": "none",
	"anim.out": "none",
	"anim.loop": "none",
	// a look without emoji accents turns them off (params merge: an emoji look's flag would stay on)
	"caption.emoji": false,
} as const;

const stroke = (width: number) => ({
	"stroke.enabled": true,
	"stroke.color": "#000000",
	"stroke.width": width,
});

const shadow = (color: string, blur: number, offsetY: number) => ({
	"shadow.enabled": true,
	"shadow.color": color,
	"shadow.blur": blur,
	"shadow.offsetX": 0,
	"shadow.offsetY": offsetY,
});

export const CAPTION_STYLES: CaptionStyle[] = [
	{
		id: "hormozi",
		name: "Hormozi",
		limits: { maxWords: 3, maxChars: 18 },
		stripPunctuation: true,
		params: {
			...CAPTION_BASE,
			fontFamily: "Montserrat",
			fontWeight: "900",
			textTransform: "uppercase",
			fontSize: 5,
			color: "#ffffff",
			...stroke(4.5),
			...shadow("#00000099", 10, 5),
			"highlight.mode": "color",
			"highlight.color": "#ffd60a",
			"highlight.scale": 1.1,
			"anim.in": "pop",
			"anim.inDuration": 0.2,
		},
	},
	{
		id: "karaoke",
		name: "Karaoke",
		limits: { maxWords: 6, maxChars: 32 },
		stripPunctuation: true,
		params: {
			...CAPTION_BASE,
			fontFamily: "Montserrat",
			fontWeight: "800",
			fontSize: 4,
			color: "#ffffff",
			...stroke(3.5),
			...shadow("#00000080", 8, 4),
			"highlight.mode": "karaoke",
			"highlight.color": "#ffe14d",
			"anim.in": "fade",
			"anim.inDuration": 0.12,
		},
	},
	{
		id: "word-box",
		name: "Word box",
		limits: { maxWords: 4, maxChars: 24 },
		stripPunctuation: true,
		params: {
			...CAPTION_BASE,
			fontFamily: "Montserrat",
			fontWeight: "800",
			fontSize: 4.4,
			color: "#ffffff",
			...shadow("#000000aa", 10, 4),
			"highlight.mode": "box",
			"highlight.color": "#a3ff12",
			"highlight.scale": 1,
			"anim.in": "pop",
			"anim.inDuration": 0.2,
		},
	},
	{
		id: "word-pop",
		name: "Word pop",
		limits: { maxWords: 3, maxChars: 16 },
		stripPunctuation: true,
		params: {
			...CAPTION_BASE,
			fontFamily: "Rubik",
			fontWeight: "900",
			textTransform: "uppercase",
			fontSize: 5.4,
			color: "#ffffff",
			...stroke(4.5),
			...shadow("#000000d9", 0, 7),
			"highlight.mode": "pop",
			"highlight.color": "#3bf55b",
		},
	},
	{
		id: "clean",
		name: "Clean",
		limits: { maxWords: 7, maxChars: 38 },
		stripPunctuation: false,
		params: {
			...CAPTION_BASE,
			fontFamily: "Inter",
			fontWeight: "600",
			fontSize: 3.6,
			color: "#ffffff",
			...shadow("#000000d9", 12, 3),
			"anim.in": "fade",
			"anim.inDuration": 0.15,
		},
	},
	{
		id: "tiktok",
		name: "TikTok",
		limits: { maxWords: 5, maxChars: 28 },
		stripPunctuation: true,
		params: {
			...CAPTION_BASE,
			fontFamily: "Golos Text",
			fontWeight: "700",
			fontSize: 4,
			color: "#111111",
			"background.enabled": true,
			"background.color": "#ffffff",
			"background.cornerRadius": 30,
			"anim.in": "pop",
			"anim.inDuration": 0.2,
		},
	},
	{
		id: "neon",
		name: "Neon",
		limits: { maxWords: 3, maxChars: 18 },
		stripPunctuation: true,
		params: {
			...CAPTION_BASE,
			fontFamily: "Russo One",
			fontWeight: "normal",
			textTransform: "uppercase",
			fontSize: 4.6,
			color: "#ffffff",
			...shadow("#00e5ff", 30, 0),
			"highlight.mode": "color",
			"highlight.color": "#ff3bd4",
			"highlight.scale": 1.08,
			"anim.in": "fade",
			"anim.inDuration": 0.15,
		},
	},
	{
		id: "one-word",
		name: "One word",
		limits: { maxWords: 1, maxChars: 14 },
		stripPunctuation: true,
		params: {
			...CAPTION_BASE,
			fontFamily: "Montserrat",
			fontWeight: "900",
			textTransform: "uppercase",
			fontSize: 6.5,
			color: "#ffffff",
			...stroke(5),
			...shadow("#00000099", 10, 5),
			"anim.in": "pop",
			"anim.inDuration": 0.2,
		},
	},
];

/** Canvas height the ad sizes are given for (9:16, 1080×1920); other sizes scale with it. */
const AD_REFERENCE_HEIGHT = 1920;
/** Font px at 1920 → the text's fontSize (FONT_SIZE_SCALE_REFERENCE = 90). */
const adFontSize = (px: number) => Math.round(((px * 90) / AD_REFERENCE_HEIGHT) * 100) / 100;

/**
 * An ad caption: ExtraBold, white, a black stroke of `strokePx` (stroke.width is a % of the font size). The ad
 * look wants 6–8 px on 64–80 px letters (8–12 %), past the 5 % above: the gaps of ж/ш/щ fill with black but the
 * white letters stay clear on it — that is the look of these captions.
 */
function adCaption({
	id,
	name,
	fontFamily,
	px,
	strokePx,
	maxWords,
	highlight,
	uppercase = false,
}: {
	id: `ad-${string}`;
	name: string;
	fontFamily: string;
	px: number;
	strokePx: number;
	maxWords: 1 | 2 | 3;
	highlight: { mode: "color" | "karaoke" | "box" | "pop"; color: string; scale?: number };
	uppercase?: boolean;
}): CaptionStyle {
	return {
		id,
		name,
		// Russian words are long: about 9 letters a line at this size, two lines at most.
		limits: { maxWords, maxChars: maxWords === 1 ? 14 : maxWords === 2 ? 18 : 22 },
		stripPunctuation: true,
		params: {
			...CAPTION_BASE,
			fontFamily,
			fontWeight: "800",
			textTransform: uppercase ? "uppercase" : "none",
			fontSize: adFontSize(px),
			color: "#ffffff",
			...stroke(Math.round((strokePx / px) * 1000) / 10),
			...shadow("#00000080", 6, 3),
			"highlight.mode": highlight.mode,
			"highlight.color": highlight.color,
			"highlight.scale": highlight.scale ?? 1,
			"anim.in": "pop",
			"anim.inDuration": 0.15,
		},
	};
}

/**
 * Ten ad caption presets for Cyrillic (docs/MARKETING.md: 1–3 words a screen, the spoken word highlighted, Montserrat /
 * Inter / Manrope / Rubik / Golos ExtraBold, white with a 6–8 px stroke, 64–80 px at 1080×1920, centre y≈1000–1200 =
 * CAPTION_CENTER_Y). The highlighted word follows the word timings like the other styles, in preview and export.
 */
export const AD_CAPTION_STYLES: CaptionStyle[] = [
	adCaption({ id: "ad-montserrat-yellow", name: "Ad · Montserrat yellow", fontFamily: "Montserrat", px: 76, strokePx: 7, maxWords: 3, uppercase: true, highlight: { mode: "color", color: "#ffd60a", scale: 1.1 } }),
	adCaption({ id: "ad-montserrat-one", name: "Ad · Montserrat one word", fontFamily: "Montserrat", px: 80, strokePx: 8, maxWords: 1, uppercase: true, highlight: { mode: "pop", color: "#ffffff", scale: 1.12 } }),
	adCaption({ id: "ad-inter-green", name: "Ad · Inter green", fontFamily: "Inter", px: 72, strokePx: 7, maxWords: 2, highlight: { mode: "color", color: "#3bf55b", scale: 1.08 } }),
	adCaption({ id: "ad-inter-box", name: "Ad · Inter red box", fontFamily: "Inter", px: 68, strokePx: 6, maxWords: 3, highlight: { mode: "box", color: "#ff2d55" } }),
	adCaption({ id: "ad-manrope-karaoke", name: "Ad · Manrope karaoke", fontFamily: "Manrope", px: 72, strokePx: 7, maxWords: 3, highlight: { mode: "karaoke", color: "#ffe14d" } }),
	adCaption({ id: "ad-manrope-cyan", name: "Ad · Manrope cyan", fontFamily: "Manrope", px: 76, strokePx: 7, maxWords: 2, highlight: { mode: "color", color: "#00e5ff", scale: 1.08 } }),
	adCaption({ id: "ad-rubik-pop", name: "Ad · Rubik pop", fontFamily: "Rubik", px: 76, strokePx: 8, maxWords: 3, uppercase: true, highlight: { mode: "pop", color: "#ff9f0a", scale: 1.15 } }),
	adCaption({ id: "ad-rubik-lime", name: "Ad · Rubik lime box", fontFamily: "Rubik", px: 72, strokePx: 6, maxWords: 2, highlight: { mode: "box", color: "#a3ff12" } }),
	adCaption({ id: "ad-golos-yellow", name: "Ad · Golos yellow", fontFamily: "Golos Text", px: 72, strokePx: 7, maxWords: 3, highlight: { mode: "color", color: "#ffd60a", scale: 1.08 } }),
	adCaption({ id: "ad-golos-red", name: "Ad · Golos red", fontFamily: "Golos Text", px: 64, strokePx: 6, maxWords: 2, uppercase: true, highlight: { mode: "color", color: "#ff3b30", scale: 1.1 } }),
];

CAPTION_STYLES.push(...AD_CAPTION_STYLES);

/** A template look: CAPTION_BASE + its own params, `maxWords` words a screen. */
function look(id: `cc-${string}`, name: string, maxWords: number, params: CaptionStyle["params"]): CaptionStyle {
	return {
		id,
		name,
		limits: { maxWords, maxChars: Math.min(64, 6 + maxWords * 6) },
		stripPunctuation: maxWords < 7,
		params: { ...CAPTION_BASE, "anim.in": "fade", "anim.inDuration": 0.15, ...params },
	};
}

const box = (color: string, radius: number) => ({ "background.enabled": true, "background.color": color, "background.cornerRadius": radius });

/**
 * The looks behind CapCut's Templates groups that the styles above don't cover (Classic, Glow, Lyrics, Aesthetic,
 * Monoline, Multiline, B&W, Boxed): bundled Cyrillic fonts, drawn by the same text renderer as every caption.
 */
export const TEMPLATE_LOOKS: CaptionStyle[] = [
	look("cc-classic-yellow", "Classic yellow", 4, { fontFamily: "Montserrat", fontWeight: "800", fontSize: 4.4, color: "#ffe14d", ...stroke(4) }),
	look("cc-classic-serif", "Classic serif", 5, { fontFamily: "Playfair Display", fontWeight: "700", fontSize: 4.2, color: "#ffffff", ...shadow("#000000cc", 12, 3) }),
	look("cc-classic-outline", "Classic outline", 4, { fontFamily: "Oswald", fontWeight: "600", textTransform: "uppercase", fontSize: 4.8, color: "#ffffff", ...stroke(5) }),
	look("cc-basic-white", "White", 5, { fontFamily: "Inter", fontWeight: "700", fontSize: 4, color: "#ffffff", ...shadow("#000000d9", 10, 3) }),
	look("cc-basic-caps", "Caps", 4, { fontFamily: "Montserrat", fontWeight: "700", textTransform: "uppercase", fontSize: 4, color: "#ffffff", ...stroke(2.5) }),
	look("cc-glow-pink", "Pink glow", 3, { fontFamily: "Unbounded", fontWeight: "700", fontSize: 4.2, color: "#ffffff", ...shadow("#ff3bd4", 28, 0) }),
	look("cc-glow-blue", "Blue glow", 3, { fontFamily: "Montserrat", fontWeight: "800", fontSize: 4.6, color: "#e6faff", ...shadow("#00b3ff", 26, 0) }),
	look("cc-glow-gold", "Gold glow", 3, { fontFamily: "Russo One", fontWeight: "normal", textTransform: "uppercase", fontSize: 4.6, color: "#fff3c4", ...shadow("#ffb300", 24, 0) }),
	look("cc-word-box", "Word in a box", 1, { fontFamily: "Montserrat", fontWeight: "900", textTransform: "uppercase", fontSize: 6, color: "#ffffff", ...box("#ff2d55", 18), "anim.in": "pop", "anim.inDuration": 0.2 }),
	look("cc-word-glow", "Glowing word", 1, { fontFamily: "Unbounded", fontWeight: "800", textTransform: "uppercase", fontSize: 6, color: "#ffffff", ...shadow("#a3ff12", 24, 0), "anim.in": "pop", "anim.inDuration": 0.2 }),
	look("cc-lyrics-soft", "Soft lyrics", 6, { fontFamily: "Comfortaa", fontWeight: "700", fontSize: 3.8, color: "#ffffff", ...shadow("#00000099", 10, 3), "highlight.mode": "karaoke", "highlight.color": "#ffc2ec" }),
	look("cc-lyrics-gradient", "Gradient lyrics", 5, { fontFamily: "Montserrat", fontWeight: "800", fontSize: 4.2, color: "#ffd94d", "gradient.enabled": true, "gradient.color": "#ff4d8c", ...shadow("#00000080", 8, 3) }),
	look("cc-aesthetic-serif", "Serif italic", 5, { fontFamily: "Playfair Display", fontWeight: "600", fontStyle: "italic", fontSize: 4.2, color: "#fff8e7", ...shadow("#00000099", 14, 2) }),
	look("cc-aesthetic-script", "Handwritten", 5, { fontFamily: "Caveat", fontWeight: "700", fontSize: 5.4, color: "#ffffff", ...shadow("#00000099", 10, 2) }),
	look("cc-aesthetic-thin", "Thin caps", 4, { fontFamily: "Raleway", fontWeight: "300", textTransform: "uppercase", letterSpacing: 0.15, fontSize: 3.8, color: "#ffffff", ...shadow("#000000b3", 10, 2) }),
	// Motion captions (text/glyph-anim.ts): every chunk's words or letters come in on their own.
	look("cc-words-rise", "Words rise", 3, { fontFamily: "Montserrat", fontWeight: "900", textTransform: "uppercase", fontSize: 5.2, color: "#ffffff", ...stroke(4), ...shadow("#00000099", 10, 4), "highlight.mode": "color", "highlight.color": "#ffd60a", "anim.in": "wordsUp", "anim.inDuration": 0.3 }),
	look("cc-letters-pop", "Letters pop", 1, { fontFamily: "Unbounded", fontWeight: "900", textTransform: "uppercase", fontSize: 6, color: "#ffffff", ...stroke(3.5), ...shadow("#00000099", 12, 5), "anim.in": "lettersPop", "anim.inDuration": 0.3 }),
	look("cc-karaoke-glow", "Glow karaoke", 5, { fontFamily: "Montserrat", fontWeight: "800", fontSize: 4.4, color: "#ffffff", ...stroke(3), ...shadow("#00e5ffaa", 22, 0), "highlight.mode": "karaoke", "highlight.color": "#00e5ff", "anim.loop": "glowPulse" }),
	look("cc-pop-up", "Pop-up words", 4, { fontFamily: "Rubik", fontWeight: "900", fontSize: 5, color: "#ffffff", ...stroke(4.5), "highlight.mode": "pop", "highlight.color": "#ff4d6d" }),
	look("cc-scatter", "Scatter in", 2, { fontFamily: "Rubik Mono One", fontWeight: "normal", textTransform: "uppercase", fontSize: 4.6, color: "#fff3d6", ...shadow("#ff3d7f", 0, 6), "anim.in": "scatter", "anim.inDuration": 0.35 }),
	look("cc-mono-line", "One line", 4, { fontFamily: "Inter", fontWeight: "700", fontSize: 4, color: "#ffffff", ...stroke(3), "box.maxLines": 1 }),
	look("cc-mono-caps", "One line caps", 3, { fontFamily: "Oswald", fontWeight: "600", textTransform: "uppercase", fontSize: 4.6, color: "#ffffff", ...shadow("#000000cc", 10, 3), "box.maxLines": 1 }),
	look("cc-multi-two", "Two lines", 9, { fontFamily: "Manrope", fontWeight: "700", fontSize: 3.6, color: "#ffffff", ...shadow("#000000d9", 10, 3), "box.maxLines": 2 }),
	look("cc-multi-three", "Three lines", 12, { fontFamily: "Nunito", fontWeight: "700", fontSize: 3.4, color: "#ffffff", ...stroke(3), "box.maxLines": 3 }),
	look("cc-bw-white", "White on black", 4, { fontFamily: "Montserrat", fontWeight: "900", textTransform: "uppercase", fontSize: 4.6, color: "#ffffff", ...stroke(5) }),
	look("cc-bw-black", "Black on white", 4, { fontFamily: "Montserrat", fontWeight: "900", textTransform: "uppercase", fontSize: 4.6, color: "#111111", "stroke.enabled": true, "stroke.color": "#ffffff", "stroke.width": 5 }),
	look("cc-boxed-black", "Black box", 5, { fontFamily: "Inter", fontWeight: "700", fontSize: 3.8, color: "#ffffff", ...box("#000000cc", 12) }),
	look("cc-boxed-white", "White box", 5, { fontFamily: "Inter", fontWeight: "700", fontSize: 3.8, color: "#111111", ...box("#ffffff", 8) }),
];

CAPTION_STYLES.push(...TEMPLATE_LOOKS);
// Fifty motion looks (subtitles/motion-looks.ts): word-by-word trends with a theme each.
CAPTION_STYLES.push(...MOTION_LOOKS);

export const DEFAULT_CAPTION_STYLE_ID: CaptionStyleId = "hormozi";

export function getCaptionStyle(id: string | undefined | null): CaptionStyle {
	return CAPTION_STYLES.find((style) => style.id === id) ?? findUserCaptionStyle(id) ?? CAPTION_STYLES[0];
}

/**
 * Block centre at 0.59 H: inside the universal 9:16 safe zone, above the
 * TikTok/Reels bottom UI band and below a centred face's mouth.
 */
export const CAPTION_CENTER_Y = 0.09;

const STORAGE_KEY = "opencut.captionStyle";

/** Until the user picks one, captions take the language's style: a Cyrillic ad style in Russian, Hormozi in English. */
export const captionStyleFor = (lang: "ru" | "en"): CaptionStyleId => (lang === "ru" ? "ad-montserrat-yellow" : DEFAULT_CAPTION_STYLE_ID);

function storedStyle(): string | null {
	try {
		return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
	} catch {
		return null;
	}
}

function readStoredStyle(): CaptionStyleId {
	const value = storedStyle();
	return value ? getCaptionStyle(value).id : captionStyleFor(useLang.getState().lang);
}

/** Russian first: the ten Cyrillic ad styles lead; English keeps the original order (ad styles last). */
export function captionStylesFor(lang: "ru" | "en"): CaptionStyle[] {
	if (lang !== "ru") return CAPTION_STYLES;
	const ad = CAPTION_STYLES.filter((s) => s.id.startsWith("ad-"));
	return [...ad, ...CAPTION_STYLES.filter((s) => !s.id.startsWith("ad-"))];
}

/** The style new captions get (chosen in the Captions tab before generating). */
export const useCaptionStyleStore = create<{
	styleId: CaptionStyleId;
	setStyleId: (id: CaptionStyleId) => void;
}>((set) => ({
	styleId: readStoredStyle(),
	setStyleId: (styleId) => {
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, styleId);
		} catch {}
		set({ styleId });
	},
}));

// The language arrives after the first render: a style the user never chose follows it.
useLang.subscribe((state, prev) => {
	if (state.lang !== prev.lang && !storedStyle()) useCaptionStyleStore.setState({ styleId: captionStyleFor(state.lang) });
});

export function getDefaultCaptionStyleId(): CaptionStyleId {
	return useCaptionStyleStore.getState().styleId;
}

export function stripCaptionPunctuation(word: string): string {
	const stripped = word.replace(/[,.;:]+(["»”)]*)$/u, "$1");
	return stripped || word;
}
