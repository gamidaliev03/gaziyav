import type { CSSProperties } from "react";

/**
 * Approximates a text style (element params) in CSS for gallery cards, so a
 * card looks like what the canvas renderer will draw. `px` is the card font
 * size; stroke/shadow/padding are scaled from the same %-of-size units.
 */
export function textParamsToCss({
	params,
	px,
}: {
	params: Record<string, unknown>;
	px: number;
}): CSSProperties {
	const str = (key: string, fallback = "") =>
		typeof params[key] === "string" ? (params[key] as string) : fallback;
	const num = (key: string, fallback = 0) =>
		typeof params[key] === "number" ? (params[key] as number) : fallback;
	const on = (key: string) => params[key] === true;

	const color = str("color", "#ffffff");
	const css: CSSProperties = {
		fontFamily: `"${str("fontFamily", "Arial")}", "Golos Text", sans-serif`,
		fontWeight: str("fontWeight", "normal") as CSSProperties["fontWeight"],
		fontStyle: str("fontStyle", "normal") as CSSProperties["fontStyle"],
		textTransform: str("textTransform", "none") as CSSProperties["textTransform"],
		fontSize: px,
		lineHeight: 1.1,
		color,
		letterSpacing: num("letterSpacing") ? `${Math.min(0.3, num("letterSpacing") / 100)}em` : undefined,
	};
	if (on("stroke.enabled")) {
		// Outside-only stroke like the renderer: the stroke is painted under the fill.
		css.WebkitTextStroke = `${((num("stroke.width", 12) / 100) * px * 2).toFixed(2)}px ${str("stroke.color", "#000")}`;
		css.paintOrder = "stroke fill";
	}
	if (on("shadow.enabled")) {
		css.textShadow = `${(num("shadow.offsetX") / 100) * px}px ${(num("shadow.offsetY", 6) / 100) * px}px ${(num("shadow.blur", 12) / 100) * px}px ${str("shadow.color", "#00000099")}`;
	}
	if (on("gradient.enabled")) {
		css.backgroundImage = `linear-gradient(${color}, ${str("gradient.color", "#ffd60a")})`;
		css.WebkitBackgroundClip = "text";
		css.backgroundClip = "text";
		css.color = "transparent";
	}
	if (on("background.enabled")) {
		// Padding units are canvas px × size/15; presets are authored for a
		// 1920 px tall frame, where 1 em of padding = 320 units.
		const em = (units: number) => `${(units / 320).toFixed(3)}em`;
		css.background = str("background.color", "#000000");
		css.padding = `${em(num("background.paddingY", 42))} ${em(num("background.paddingX", 30))}`;
		css.borderRadius = `${(num("background.cornerRadius") / 200).toFixed(2)}em`;
	}
	return css;
}
