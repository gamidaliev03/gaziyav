// Fifty caption looks at the level of today's trends, each moving word by word: bold Hormozi / MrBeast outlines,
// the spoken word highlighted, karaoke, words popping up, jumping or flying in, neon and gradients, a plate under
// the line, gaming, minimal, emoji accents, a typewriter, and shadowed captions that read on any background.
// Bundled Cyrillic fonts, drawn by the caption renderer (preview = export). Each has a theme for the filter and its
// tile's backdrop (a podcast, a vlog, a game, business, a recipe…).
import type { Scene } from "@/text/theme-scenes";
import type { CaptionStyle } from "./styles";

export type CaptionTheme = "podcast" | "vlog" | "gaming" | "business" | "food" | "music" | "fitness" | "beauty" | "education" | "news" | "sports" | "travel" | "tech" | "kids" | "fashion" | "wedding";

export const CAPTION_THEMES: { id: CaptionTheme; label: string; scene: Scene }[] = [
	{ id: "podcast", label: "Podcast", scene: "interview" },
	{ id: "vlog", label: "Vlog", scene: "stories" },
	{ id: "gaming", label: "Gaming", scene: "gaming" },
	{ id: "business", label: "Business", scene: "business" },
	{ id: "food", label: "Recipes", scene: "food" },
	{ id: "music", label: "Music", scene: "music" },
	{ id: "fitness", label: "Fitness", scene: "fitness" },
	{ id: "beauty", label: "Beauty", scene: "beauty" },
	{ id: "education", label: "Education", scene: "education" },
	{ id: "news", label: "News", scene: "news" },
	{ id: "sports", label: "Sports", scene: "sports" },
	{ id: "travel", label: "Travel", scene: "travel" },
	{ id: "tech", label: "Tech", scene: "tech" },
	{ id: "kids", label: "Kids", scene: "kids" },
	{ id: "fashion", label: "Fashion", scene: "fashion" },
	{ id: "wedding", label: "Wedding", scene: "wedding" },
];

type Params = CaptionStyle["params"];

/** What every look starts from (the caption base: one centred box, nothing on until a look turns it on). */
const BASE: Params = {
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
	"anim.in": "fade",
	"anim.inDuration": 0.12,
	"anim.out": "none",
	"anim.loop": "none",
	"caption.emoji": false,
};

const stroke = (width: number, color = "#000000"): Params => ({ "stroke.enabled": true, "stroke.color": color, "stroke.width": width });
const shadow = (color: string, blur: number, offsetY: number): Params => ({ "shadow.enabled": true, "shadow.color": color, "shadow.blur": blur, "shadow.offsetX": 0, "shadow.offsetY": offsetY });
const glow = (color: string, blur = 26): Params => shadow(color, blur, 0);
const plate = (color: string, radius: number): Params => ({ "background.enabled": true, "background.color": color, "background.cornerRadius": radius, "background.paddingX": 28, "background.paddingY": 14 });
const word = (mode: string, color: string, scale = 1): Params => ({ "highlight.mode": mode, "highlight.color": color, "highlight.scale": scale });
const enter = (kind: string, duration = 0.2): Params => ({ "anim.in": kind, "anim.inDuration": duration });
const font = (family: string, weight: string, size: number, color = "#ffffff", upper = false): Params => ({ fontFamily: family, fontWeight: weight, fontSize: size, color, textTransform: upper ? "uppercase" : "none" });

function look(id: string, name: string, theme: CaptionTheme, maxWords: number, params: Params): CaptionStyle & { theme: CaptionTheme } {
	return {
		id: `cc-x-${id}`,
		name,
		theme,
		limits: { maxWords, maxChars: Math.min(64, 6 + maxWords * 7) },
		stripPunctuation: maxWords < 7,
		params: { ...BASE, ...params },
	};
}

export const MOTION_LOOKS = [
	// Bold outlines (Hormozi, MrBeast)
	look("hormozi-green", "Hormozi green", "business", 3, { ...font("Montserrat", "900", 5.4, "#ffffff", true), ...stroke(6), ...shadow("#00000099", 10, 5), ...word("color", "#3bf55b", 1.12), ...enter("pop", 0.18) }),
	look("beast", "Beast yellow", "gaming", 2, { ...font("Russo One", "normal", 5.8, "#ffffff", true), ...stroke(9), ...shadow("#000000", 0, 6), ...word("jump", "#ffd60a", 1.08), ...enter("pop", 0.16) }),
	look("beast-red", "Beast red", "gaming", 2, { ...font("Rubik", "900", 5.8, "#ffffff", true), ...stroke(8), ...shadow("#00000099", 8, 5), ...word("pop", "#ff2d2d", 1.15) }),
	look("hormozi-jump", "Hormozi jump", "business", 3, { ...font("Montserrat", "900", 5.2, "#ffffff", true), ...stroke(6), ...shadow("#00000099", 10, 5), ...word("jump", "#ffd60a", 1.1) }),
	look("thick-white", "Thick outline", "vlog", 2, { ...font("Dela Gothic One", "normal", 5, "#ffffff"), ...stroke(10), ...word("color", "#ff9f0a", 1.06), ...enter("pop", 0.18) }),
	look("violet-pop", "Violet pop", "podcast", 3, { ...font("Inter", "900", 5, "#ffffff", true), ...stroke(5), ...shadow("#00000080", 10, 4), ...word("color", "#b26bff", 1.15), ...enter("pop", 0.18) }),

	// The spoken word: colour, karaoke, underline
	look("karaoke-pink", "Pink karaoke", "music", 5, { ...font("Montserrat", "800", 4.4), ...stroke(4), ...word("karaoke", "#ff4ecd") }),
	look("karaoke-gold", "Gold karaoke", "music", 5, { ...font("Golos Text", "800", 4.4), ...stroke(3, "#2a1600"), ...glow("#ffb84d99", 18), ...word("karaoke", "#ffd36e") }),
	look("cyan-word", "Cyan word", "tech", 3, { ...font("Manrope", "800", 4.6), ...stroke(5), ...word("color", "#00e5ff", 1.06), ...enter("wordsUp", 0.22) }),
	look("lime-word", "Lime word", "fitness", 3, { ...font("Rubik", "800", 4.8, "#ffffff", true), ...stroke(5), ...word("color", "#c6ff3b", 1.08), ...enter("pop", 0.16) }),
	look("underline-yellow", "Yellow underline", "education", 4, { ...font("Inter", "800", 4.4), ...stroke(3), ...shadow("#000000b3", 12, 3), ...word("underline", "#ffd60a") }),
	look("underline-pink", "Pink underline", "beauty", 4, { ...font("Montserrat", "800", 4.4), ...stroke(3), ...shadow("#00000099", 12, 3), ...word("underline", "#ff2d95") }),
	look("karaoke-soft", "Soft karaoke", "vlog", 6, { ...font("Nunito", "800", 4.2), ...shadow("#00000099", 10, 3), ...word("karaoke", "#9ee7ff") }),

	// Word by word: pop up, rise, fly in, jump
	look("pop-up", "Pop-up caps", "vlog", 3, { ...font("Montserrat", "900", 5, "#ffffff", true), ...stroke(5), ...word("pop", "#ffd60a", 1.12) }),
	look("rise", "Rising words", "podcast", 4, { ...font("Golos Text", "800", 4.8), ...stroke(5), ...word("rise", "#ffe14d") }),
	look("fly-in", "Fly-in words", "tech", 4, { ...font("Manrope", "800", 4.6), ...stroke(4), ...word("slide", "#3dffb5") }),
	look("bounce", "Bouncy", "kids", 3, { ...font("Rubik", "900", 5, "#ffffff", true), ...stroke(6), ...word("jump", "#ff9f0a", 1.1) }),
	look("jump-neon", "Neon jump", "gaming", 3, { ...font("Unbounded", "800", 4.4), ...stroke(2.5, "#001f26"), ...glow("#00e5ffcc", 24), ...word("jump", "#00e5ff") }),
	look("rise-serif", "Serif rise", "wedding", 4, { ...font("Playfair Display", "600", 4.6, "#fff8e7"), fontStyle: "italic", ...shadow("#00000099", 14, 2), ...word("rise", "#e8c77a") }),
	look("fly-caps", "Fly-in caps", "sports", 3, { ...font("Oswald", "600", 5, "#ffffff", true), ...stroke(4), ...word("slide", "#ff4d6d", 1.05) }),
	look("pop-box", "Box pop", "business", 3, { ...font("Inter", "900", 4.8, "#ffffff", true), ...shadow("#00000080", 10, 3), ...word("box", "#7c4dff"), ...enter("pop", 0.18) }),

	// Neon, glow, gradient
	look("neon-pink", "Neon pink", "music", 4, { ...font("Comfortaa", "700", 4.6, "#ffffff"), ...stroke(2.5, "#3a0020"), ...glow("#ff2d95cc"), ...word("glow", "#ff2d95") }),
	look("neon-cyan", "Neon cyan", "gaming", 3, { ...font("Exo 2", "800", 4.8, "#ffffff"), fontStyle: "italic", ...stroke(2.5, "#001f26"), ...glow("#00e5ffcc"), ...word("glow", "#00e5ff") }),
	look("neon-lime", "Neon lime", "gaming", 3, { ...font("Tektur", "700", 4.6, "#f4ffe0", true), ...glow("#b6ff3bcc"), ...word("color", "#b6ff3b", 1.08), ...enter("flip", 0.25) }),
	look("sunset", "Sunset gradient", "travel", 3, { ...font("Montserrat", "900", 4.8, "#ffd94d"), "gradient.enabled": true, "gradient.color": "#ff4d8c", ...stroke(3, "#2b0a1a"), ...word("jump", "#ffffff") }),
	look("ice", "Ice gradient", "tech", 3, { ...font("Unbounded", "800", 4.4, "#e0f7ff"), "gradient.enabled": true, "gradient.color": "#7aa7ff", ...shadow("#00000099", 10, 3), ...word("rise", "#ffffff") }),
	look("gold-glow", "Gold serif glow", "wedding", 4, { ...font("Playfair Display", "700", 4.6, "#fff3d6"), ...stroke(2, "#2a1600"), ...glow("#ffb84daa", 22), ...word("glow", "#ffd36e") }),
	look("purple-glow", "Purple glow", "music", 5, { ...font("Montserrat", "800", 4.6), ...stroke(2.5, "#1a0033"), ...glow("#a855f7cc", 24), ...word("karaoke", "#d6b4ff"), "anim.loop": "glowPulse" }),

	// A plate under the line
	look("plate-black", "Black plate", "news", 5, { ...font("Inter", "700", 4), ...plate("#000000cc", 12), ...word("color", "#ffd60a") }),
	look("plate-white", "White plate", "vlog", 4, { ...font("Inter", "800", 4, "#111111"), ...plate("#ffffff", 14), ...word("color", "#ff2d55") }),
	look("plate-yellow", "Yellow plate", "food", 3, { ...font("Montserrat", "900", 4.2, "#111111", true), ...plate("#ffd60a", 10), ...word("underline", "#111111") }),
	look("plate-glass", "Glass plate", "podcast", 4, { ...font("Onest", "700", 4), ...plate("#0b0b0fa6", 30), ...word("rise", "#3dffb5") }),
	look("plate-red", "News red", "news", 4, { ...font("Oswald", "600", 4.4, "#ffffff", true), ...plate("#e5252a", 4), ...word("color", "#ffd60a") }),
	look("plate-purple", "Purple pill", "kids", 3, { ...font("Golos Text", "800", 4, "#ffffff"), ...plate("#7c4dff", 40), ...word("jump", "#ffe14d") }),

	// Gaming
	look("pixel", "Pixel", "gaming", 3, { ...font("Press Start 2P", "normal", 3.2, "#ffffff", true), lineHeight: 1.4, ...stroke(3), ...word("pop", "#3bf55b", 1.1) }),
	look("glitch", "Glitch", "gaming", 2, { ...font("Rubik Glitch", "normal", 5, "#ffffff", true), ...word("color", "#ff2d95"), ...enter("glitch", 0.25) }),
	look("arcade", "Arcade", "gaming", 3, { ...font("Tektur", "800", 5, "#ffe14d", true), ...stroke(5, "#2b0b4a"), ...word("jump", "#00e5ff") }),

	// Minimal
	look("thin", "Thin", "business", 5, { ...font("Inter", "400", 3.6), ...shadow("#000000b3", 12, 2), ...enter("wordsUp", 0.3) }),
	look("dim-bright", "Dim and bright", "podcast", 5, { ...font("Manrope", "600", 3.8, "#ffffff80"), ...shadow("#00000099", 10, 2), ...word("color", "#ffffff") }),
	look("caps-line", "Caps underline", "fashion", 4, { ...font("Sofia Sans", "600", 3.4, "#ffffff", true), letterSpacing: 6, ...shadow("#00000099", 10, 2), ...word("underline", "#ffffff") }),
	look("serif-quiet", "Quiet serif", "education", 5, { ...font("PT Serif", "normal", 4, "#fff8e7"), fontStyle: "italic", ...shadow("#00000099", 12, 2), ...enter("letters", 0.35) }),

	// Emoji accents
	look("emoji-bold", "Emoji bold", "vlog", 3, { ...font("Montserrat", "900", 5, "#ffffff", true), ...stroke(6), ...word("color", "#ffd60a", 1.08), "caption.emoji": true, ...enter("pop", 0.16) }),
	look("emoji-pop", "Emoji pop", "beauty", 3, { ...font("Rubik", "900", 4.8), ...stroke(5), ...word("pop", "#ff4ecd", 1.12), "caption.emoji": true }),
	look("emoji-clean", "Emoji clean", "food", 4, { ...font("Golos Text", "700", 4.2), ...stroke(3), ...shadow("#000000b3", 12, 3), "caption.emoji": true, ...enter("lettersPop", 0.3) }),

	// Typewriter
	look("typewriter", "Typewriter", "education", 5, { ...font("Jura", "700", 4), ...shadow("#000000b3", 10, 2), ...enter("typewriter", 0.35) }),
	look("typewriter-box", "Typed on a card", "news", 5, { ...font("Inter", "700", 4, "#111111"), ...plate("#ffffff", 6), ...enter("typewriter", 0.3) }),

	// Shadows that read on any background
	look("shadow-soft", "Soft shadow", "vlog", 4, { ...font("Golos Text", "800", 4.6), ...shadow("#000000cc", 18, 4), ...word("color", "#ffe14d") }),
	look("shadow-hard", "Hard shadow", "sports", 3, { ...font("Montserrat", "900", 4.8, "#ffffff", true), ...shadow("#000000", 0, 6), ...word("color", "#3dffb5", 1.06) }),
	look("shadow-pink", "Pink drop", "fitness", 3, { ...font("Rubik", "900", 4.8, "#ffffff", true), ...shadow("#ff2d95", 0, 7), ...word("jump", "#ffd60a") }),
	look("shadow-double", "Outline and shadow", "podcast", 4, { ...font("Unbounded", "800", 4.2), ...stroke(3), ...shadow("#000000", 12, 4), ...word("rise", "#ff9f0a") }),
];

const THEME_OF = new Map<string, CaptionTheme>(MOTION_LOOKS.map((style) => [style.id, style.theme]));

/** A caption style's theme: its own, or one by family for the older looks. */
export function captionTheme(id: string): CaptionTheme {
	const own = THEME_OF.get(id);
	if (own) return own;
	if (id.startsWith("ad-") || id === "hormozi" || id === "word-box") return "business";
	if (/karaoke|lyrics|neon|glow/.test(id)) return "music";
	if (/aesthetic|serif|script/.test(id)) return "wedding";
	if (/mono|multi/.test(id)) return "podcast";
	if (/bw|boxed|classic/.test(id)) return "news";
	return "vlog";
}

export const captionScene = (id: string): Scene => CAPTION_THEMES.find((theme) => theme.id === captionTheme(id))?.scene ?? "stories";
