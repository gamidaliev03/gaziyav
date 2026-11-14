// Design system of AI layers: one style per composition. Every kit component draws with these tokens (type, colour,
// plates, motion), so a composition looks like one designer made it. Pure data: used by the editor, the server
// prompt and the Remotion kit.

export type StyleId = "clean" | "bold" | "hormozi" | "minimal" | "neon" | "luxury" | "playful";
export type FontKey = "Onest" | "Manrope" | "Montserrat" | "Unbounded" | "Rubik" | "PlayfairDisplay" | "GolosText";
export type CaptionLook = "box" | "pop" | "hormozi" | "minimal" | "glow" | "serif" | "bubble";

export interface MotionStyle {
	/** Spring for entrances (Remotion spring config). */
	spring: { damping: number; stiffness: number; mass: number };
	/** Frames at 30 fps for an entrance; exits take ~55 %. */
	enter: number;
	/** Overshoot allowed for pills/badges (0 = none). */
	overshoot: number;
}

export interface LayerStyle {
	id: StyleId;
	label: string;
	/** One line under the chip. */
	blurb: string;
	/** Art direction for DeepSeek. */
	direction: string;
	display: FontKey;
	displayWeight: number;
	displayItalic?: boolean;
	upper: boolean;
	/** Letter spacing of display text, em. */
	tracking: number;
	body: FontKey;
	bodyWeight: number;
	text: string;
	muted: string;
	accent: string;
	accent2: string;
	/** Text colour on an accent fill. */
	ink: string;
	/** Plates/cards: fill, border, backdrop blur (design px). */
	plate: string;
	plateBorder: string;
	blur: number;
	/** Corner radius in design px (1080-wide frame). */
	radius: number;
	/** Outline of text over video, em (0 = none, relies on shadow/plate). */
	stroke: number;
	shadow: string;
	glow: number;
	captions: CaptionLook;
	emoji: boolean;
	motion: MotionStyle;
	/** Chip swatch in the editor. */
	swatch: [string, string];
}

const SNAPPY: MotionStyle = { spring: { damping: 15, stiffness: 190, mass: 0.7 }, enter: 12, overshoot: 0.08 };
const SMOOTH: MotionStyle = { spring: { damping: 200, stiffness: 120, mass: 1 }, enter: 16, overshoot: 0 };
const PUNCHY: MotionStyle = { spring: { damping: 11, stiffness: 230, mass: 0.6 }, enter: 9, overshoot: 0.14 };
const SILK: MotionStyle = { spring: { damping: 200, stiffness: 70, mass: 1.2 }, enter: 22, overshoot: 0 };
const BOUNCY: MotionStyle = { spring: { damping: 8, stiffness: 170, mass: 0.7 }, enter: 12, overshoot: 0.18 };

export const STYLES: LayerStyle[] = [
	{
		id: "clean",
		label: "Clean",
		blurb: "Calm glass plates, sentence case",
		direction:
			"Clean: modern and calm. Sentence case, short lines, translucent dark glass plates, one cool accent. Smooth entrances, no shaking, no stickers.",
		display: "Onest",
		displayWeight: 800,
		upper: false,
		tracking: -0.01,
		body: "Onest",
		bodyWeight: 500,
		text: "#FFFFFF",
		muted: "rgba(255,255,255,0.72)",
		accent: "#5B8CFF",
		accent2: "#9FC2FF",
		ink: "#FFFFFF",
		plate: "rgba(16,18,26,0.58)",
		plateBorder: "rgba(255,255,255,0.14)",
		blur: 18,
		radius: 26,
		stroke: 0,
		shadow: "0 10px 30px rgba(0,0,0,0.35)",
		glow: 0,
		captions: "box",
		emoji: false,
		motion: SMOOTH,
		swatch: ["#1B2234", "#5B8CFF"],
	},
	{
		id: "bold",
		label: "Bold UGC",
		blurb: "Loud yellow, thick outlines",
		direction:
			"Bold UGC: native TikTok energy. Big uppercase words with thick black outlines, a loud yellow accent and pink second accent, punchy pops, an emoji sticker where it fits the speech.",
		display: "Rubik",
		displayWeight: 900,
		upper: true,
		tracking: -0.01,
		body: "Rubik",
		bodyWeight: 700,
		text: "#FFFFFF",
		muted: "rgba(255,255,255,0.85)",
		accent: "#FFE81A",
		accent2: "#FF3D8B",
		ink: "#111111",
		plate: "#111111",
		plateBorder: "rgba(255,255,255,0)",
		blur: 0,
		radius: 18,
		stroke: 0.14,
		shadow: "0 6px 0 rgba(0,0,0,0.35)",
		glow: 0,
		captions: "pop",
		emoji: true,
		motion: PUNCHY,
		swatch: ["#111111", "#FFE81A"],
	},
	{
		id: "hormozi",
		label: "Hormozi",
		blurb: "1–3 word captions, green highlight",
		direction:
			"Hormozi: retention captions are the hero — 1–3 uppercase words at a time, the spoken word highlighted, key words in green or yellow. Minimal other graphics: a short hook and a CTA.",
		display: "Montserrat",
		displayWeight: 900,
		upper: true,
		tracking: -0.015,
		body: "Montserrat",
		bodyWeight: 800,
		text: "#FFFFFF",
		muted: "rgba(255,255,255,0.9)",
		accent: "#2BF06B",
		accent2: "#FFD60A",
		ink: "#0A0A0A",
		plate: "#0A0A0A",
		plateBorder: "rgba(255,255,255,0)",
		blur: 0,
		radius: 14,
		stroke: 0.16,
		shadow: "0 8px 18px rgba(0,0,0,0.55)",
		glow: 0,
		captions: "hormozi",
		emoji: false,
		motion: PUNCHY,
		swatch: ["#0A0A0A", "#2BF06B"],
	},
	{
		id: "minimal",
		label: "Minimal",
		blurb: "Small type, lots of air",
		direction:
			"Minimal: quiet confidence. Small sentence-case type, white only, thin lines instead of plates, generous spacing, slow fades. Fewer layers; no emoji, no badges.",
		display: "Manrope",
		displayWeight: 700,
		upper: false,
		tracking: -0.02,
		body: "Manrope",
		bodyWeight: 500,
		text: "#FFFFFF",
		muted: "rgba(255,255,255,0.7)",
		accent: "#FFFFFF",
		accent2: "#D9D9D9",
		ink: "#0E0E0E",
		plate: "rgba(0,0,0,0)",
		plateBorder: "rgba(255,255,255,0.5)",
		blur: 0,
		radius: 4,
		stroke: 0,
		shadow: "0 2px 14px rgba(0,0,0,0.45)",
		glow: 0,
		captions: "minimal",
		emoji: false,
		motion: SILK,
		swatch: ["#2A2A2A", "#FFFFFF"],
	},
	{
		id: "neon",
		label: "Neon",
		blurb: "Glowing cyan and magenta",
		direction:
			"Neon: night-city tech. Wide display type, cyan and magenta glow, dark glass plates with luminous edges. Fast, precise motion; one glow per screen.",
		display: "Unbounded",
		displayWeight: 800,
		upper: true,
		tracking: 0.01,
		body: "GolosText",
		bodyWeight: 600,
		text: "#F4F2FF",
		muted: "rgba(230,228,255,0.75)",
		accent: "#21E6FF",
		accent2: "#FF3BD4",
		ink: "#05060C",
		plate: "rgba(8,10,24,0.62)",
		plateBorder: "rgba(33,230,255,0.55)",
		blur: 14,
		radius: 20,
		stroke: 0,
		shadow: "0 0 24px rgba(33,230,255,0.35)",
		glow: 1,
		captions: "glow",
		emoji: false,
		motion: SNAPPY,
		swatch: ["#08091A", "#21E6FF"],
	},
	{
		id: "luxury",
		label: "Luxury",
		blurb: "Serif, cream and gold",
		direction:
			"Luxury: editorial and slow. Serif display in sentence case, cream text, thin gold rules, no plates, no emoji, no shouting. Long silky entrances, one idea per screen.",
		display: "PlayfairDisplay",
		displayWeight: 600,
		displayItalic: false,
		upper: false,
		tracking: 0,
		body: "Manrope",
		bodyWeight: 500,
		text: "#F7F1E3",
		muted: "rgba(247,241,227,0.75)",
		accent: "#D9B56C",
		accent2: "#F3DCA7",
		ink: "#17130B",
		plate: "rgba(18,14,8,0.45)",
		plateBorder: "rgba(217,181,108,0.6)",
		blur: 10,
		radius: 2,
		stroke: 0,
		shadow: "0 6px 26px rgba(0,0,0,0.5)",
		glow: 0,
		captions: "serif",
		emoji: false,
		motion: SILK,
		swatch: ["#17130B", "#D9B56C"],
	},
	{
		id: "playful",
		label: "Playful",
		blurb: "Bubbly pastels, bouncy",
		direction:
			"Playful: friendly and bouncy. Rounded heavy type, candy pastel fills (pink, lilac, mint), bubble captions, springy pops, an emoji sticker that matches the speech.",
		display: "Rubik",
		displayWeight: 800,
		upper: false,
		tracking: -0.01,
		body: "Rubik",
		bodyWeight: 600,
		text: "#FFFFFF",
		muted: "rgba(255,255,255,0.85)",
		accent: "#FF7AC6",
		accent2: "#9B8CFF",
		ink: "#2A1033",
		plate: "#FFFFFF",
		plateBorder: "rgba(255,255,255,0)",
		blur: 0,
		radius: 40,
		stroke: 0,
		shadow: "0 10px 0 rgba(42,16,51,0.18)",
		glow: 0,
		captions: "bubble",
		emoji: true,
		motion: BOUNCY,
		swatch: ["#FF7AC6", "#9B8CFF"],
	},
];

export const DEFAULT_STYLE: StyleId = "clean";
const BY_ID = new Map(STYLES.map((s) => [s.id, s]));
export const styleOf = (id: unknown): LayerStyle => BY_ID.get(id as StyleId) ?? BY_ID.get(DEFAULT_STYLE)!;
