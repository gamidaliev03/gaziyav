// Cyrillic-capable OFL fonts, loaded the same way in the Player and in the renderer (latin + cyrillic, files of the app).
// Emoji: Noto Color Emoji (OFL) — identical in the preview and the export, never the system Apple Color Emoji.
import "./local-fonts";
import { loadFont as unbounded } from "@remotion/google-fonts/Unbounded";
import { loadFont as onest } from "@remotion/google-fonts/Onest";
import { loadFont as montserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as manrope } from "@remotion/google-fonts/Manrope";
import { loadFont as notoEmoji } from "@remotion/google-fonts/NotoColorEmoji";
import { loadFont as rubik } from "@remotion/google-fonts/Rubik";
import { loadFont as playfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as golos } from "@remotion/google-fonts/GolosText";

const SUBSETS: ("latin" | "cyrillic")[] = ["latin", "cyrillic"];

const FONTS = {
	Unbounded: () => unbounded("normal", { weights: ["700", "800", "900"], subsets: SUBSETS }),
	Onest: () => onest("normal", { weights: ["500", "700", "800", "900"], subsets: SUBSETS }),
	Montserrat: () => montserrat("normal", { weights: ["700", "800", "900"], subsets: SUBSETS }),
	Manrope: () => manrope("normal", { weights: ["500", "600", "700", "800"], subsets: SUBSETS }),
	Rubik: () => rubik("normal", { weights: ["600", "700", "800", "900"], subsets: SUBSETS }),
	PlayfairDisplay: () => playfair("normal", { weights: ["500", "600", "700"], subsets: SUBSETS }),
	GolosText: () => golos("normal", { weights: ["500", "600", "700"], subsets: SUBSETS }),
} as const;

let playfairItalic: string | null = null;
/** Playfair Display italic (luxury accents). */
export function serifItalic(): string {
	if (!playfairItalic) {
		try {
			playfairItalic = playfair("italic", { weights: ["500", "600"], subsets: SUBSETS }).fontFamily;
		} catch {
			playfairItalic = "serif";
		}
	}
	return `${playfairItalic}, serif`;
}

export type FontKey = keyof typeof FONTS;

const loaded = new Map<FontKey, string>();

/** CSS font-family for a font key (loads it once). Unknown keys fall back to Unbounded. */
export function font(key: string): string {
	const k = (key in FONTS ? key : "Unbounded") as FontKey;
	let family = loaded.get(k);
	if (!family) {
		try {
			family = FONTS[k]().fontFamily;
		} catch {
			family = "system-ui";
		}
		loaded.set(k, family);
	}
	return `${family}, system-ui, sans-serif`;
}

let emojiFamily: string | null = null;
function emoji(): string {
	if (!emojiFamily) {
		try {
			emojiFamily = notoEmoji("normal", { weights: ["400"] }).fontFamily;
		} catch {
			emojiFamily = "Noto Color Emoji";
		}
	}
	return emojiFamily;
}

/** Emoji font stack: open-licensed Noto Color Emoji first. Call inside render so it loads lazily. */
export const emojiFont = () => `"${emoji()}", "Noto Color Emoji", sans-serif`;
