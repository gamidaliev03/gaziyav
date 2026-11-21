// A caption style Gaziyav AI designs from the user's words (Captions tab "+"): the prompt, and the check that turns
// its JSON into a style the caption renderer can draw. Only known keys pass, within the ranges the built-in styles
// use, with a bundled font, so a made-up answer can never break captions. Pure: used by the server route and tests.
import { TEXT_ANIM_IN } from "@/animation/anim-kinds";
import { BUNDLED_FONTS } from "@/fonts/bundled";
import type { UserCaptionStyle } from "@/presets/user-presets";
import { CAPTION_BASE } from "./styles";

const FONTS = BUNDLED_FONTS.map((font) => font.family);
const ANIM_IN = TEXT_ANIM_IN.map((kind) => kind.value as string).filter((kind) => kind !== "typewriter");
const HIGHLIGHT = ["none", "color", "karaoke", "box", "pop"];
const WEIGHTS = ["300", "400", "500", "600", "700", "800", "900"];

export const CAPTION_STYLE_SYSTEM = `You design word-by-word captions for short vertical videos (Reels, TikTok, Shorts).
From the user's description, make ONE caption style. Answer only JSON:
{
 "name": "1–2 words, the look's name in the language of the description",
 "maxWords": 1–7 words on screen at once, "maxChars": 10–40,
 "stripPunctuation": true|false,
 "fontFamily": one of ${FONTS.map((f) => `"${f}"`).join(", ")},
 "fontWeight": one of ${WEIGHTS.map((w) => `"${w}"`).join(", ")},
 "fontStyle": "normal"|"italic", "textTransform": "none"|"uppercase"|"lowercase",
 "fontSize": 3–6.5 (share of the frame: 3.6 calm, 5 bold), "color": "#rrggbb",
 "stroke": null or {"color": "#rrggbb", "width": 1–5},
 "shadow": null or {"color": "#rrggbbaa", "blur": 0–40, "offsetY": 0–8},
 "plate": null or {"color": "#rrggbbaa", "radius": 0–100} (a box behind the whole line),
 "highlight": {"mode": "none"|"color"|"karaoke"|"box"|"pop", "color": "#rrggbb", "scale": 1–1.25} (the word being spoken: color = recolour it, karaoke = fill as it is said, box = a coloured box behind it, pop = words appear one by one),
 "animIn": one of ${ANIM_IN.map((a) => `"${a}"`).join(", ")}, "animInDuration": 0.08–0.4
}
Make it readable on any video: light text gets a dark stroke or shadow, dark text a light plate.`;

const isHex = (value: unknown, alpha = false): value is string =>
	typeof value === "string" && (alpha ? /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i : /^#([0-9a-f]{3}|[0-9a-f]{6})$/i).test(value.trim());
const num = (value: unknown, min: number, max: number, fallback: number) => {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T =>
	typeof value === "string" && list.includes(value as T) ? (value as T) : fallback;
const obj = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** The style from Gaziyav AI's answer (already parsed); the description names it when the answer has no name. */
export function captionStyleFromAnswer({
	answer,
	id,
	description,
	now = Date.now(),
}: {
	answer: unknown;
	id: `user-${string}`;
	description: string;
	now?: number;
}): UserCaptionStyle {
	const a = obj(answer) ?? {};
	const fontSize = num(a.fontSize, 3, 6.5, 4.6);
	const params: Record<string, string | number | boolean> = {
		...CAPTION_BASE,
		fontFamily: oneOf(a.fontFamily, FONTS, "Montserrat"),
		fontWeight: oneOf(String(a.fontWeight ?? ""), WEIGHTS, "800"),
		fontStyle: oneOf(a.fontStyle, ["normal", "italic"] as const, "normal"),
		textTransform: oneOf(a.textTransform, ["none", "uppercase", "lowercase"] as const, "none"),
		fontSize,
		color: isHex(a.color) ? a.color.trim() : "#ffffff",
	};
	const stroke = obj(a.stroke);
	if (stroke) {
		Object.assign(params, {
			"stroke.enabled": true,
			"stroke.color": isHex(stroke.color) ? String(stroke.color).trim() : "#000000",
			"stroke.width": num(stroke.width, 1, 5, 4),
		});
	}
	const shadow = obj(a.shadow);
	if (shadow) {
		Object.assign(params, {
			"shadow.enabled": true,
			"shadow.color": isHex(shadow.color, true) ? String(shadow.color).trim() : "#00000099",
			"shadow.blur": num(shadow.blur, 0, 40, 10),
			"shadow.offsetX": 0,
			"shadow.offsetY": num(shadow.offsetY, 0, 8, 4),
		});
	}
	const plate = obj(a.plate);
	if (plate) {
		Object.assign(params, {
			"background.enabled": true,
			"background.color": isHex(plate.color, true) ? String(plate.color).trim() : "#000000b3",
			"background.cornerRadius": num(plate.radius, 0, 100, 30),
		});
	}
	const highlight = obj(a.highlight);
	const mode = oneOf(highlight?.mode, HIGHLIGHT, "none");
	if (mode !== "none") {
		Object.assign(params, {
			"highlight.mode": mode,
			"highlight.color": isHex(highlight?.color) ? String(highlight?.color).trim() : "#ffd60a",
			"highlight.scale": num(highlight?.scale, 1, 1.25, 1),
		});
	}
	const animIn = oneOf(a.animIn, ANIM_IN, "none");
	if (animIn !== "none") Object.assign(params, { "anim.in": animIn, "anim.inDuration": num(a.animInDuration, 0.08, 0.4, 0.2) });

	const maxWords = Math.round(num(a.maxWords, 1, 7, 3));
	const fallbackName = description.replace(/\s+/g, " ").trim().split(" ").slice(0, 2).join(" ");
	const name = (typeof a.name === "string" ? a.name : "").replace(/[\n\r"«»]/g, "").trim().slice(0, 18) || fallbackName.slice(0, 18) || "My style";
	return {
		id,
		name,
		createdAt: now,
		limits: { maxWords, maxChars: Math.round(num(a.maxChars, Math.max(10, maxWords * 5), 40, Math.min(40, maxWords * 6))) },
		stripPunctuation: a.stripPunctuation !== false,
		params,
	};
}

/** The JSON inside a model answer (it may wrap it in prose or a code fence). */
export function parseModelJson(answer: string): unknown {
	const start = answer.indexOf("{");
	const end = answer.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("Gaziyav AI didn't manage this one: nothing was changed. Press the button once more.");
	try {
		return JSON.parse(answer.slice(start, end + 1));
	} catch {
		throw new Error("Gaziyav AI didn't manage this one: nothing was changed. Press the button once more.");
	}
}
