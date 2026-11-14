// Preview · markup: the guides now on screen for a canvas (the store + the captions' own default placement).
import { formatOf } from "@/preview/canvas-format";
import { resolveCaptionCenterY } from "@/subtitles/build-subtitle-text-element";
import { CAPTION_STYLES, captionStyleFor } from "@/subtitles/styles";
import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";
import { type Guide, guideSnapTargets, type MarkupAspect, markupGuides, type SubtitlePlacement } from "./markup-geometry";
import { markupAspect, markupFor, useMarkup } from "./markup-store";

interface Size {
	width: number;
	height: number;
}

/**
 * Where new captions land by default: resolveCaptionCenterY (0.59 H; 0.82 H in a wide frame) with the default style
 * of the UI language, and the block height the captions' own face check uses (two lines × 1.1 + 0.01 H each side).
 */
export function subtitlePlacement(canvas: Size, lang: "ru" | "en"): SubtitlePlacement {
	const style = CAPTION_STYLES.find((s) => s.id === captionStyleFor(lang)) ?? CAPTION_STYLES[0];
	const fontSize = Number(style?.params.fontSize) || 5;
	const half = ((fontSize / FONT_SIZE_SCALE_REFERENCE) * 1.1 * 2) / 2 + 0.01;
	return {
		centerY: resolveCaptionCenterY({ canvasHeight: canvas.height, canvasWidth: canvas.width, fontSize }),
		height: 2 * half * canvas.height,
	};
}

export function aspectOfCanvas(canvas: Size): MarkupAspect {
	return markupAspect(formatOf(canvas));
}

/** The visible guides for this canvas, or [] while the guides are off. */
export function liveMarkupGuides(canvas: Size, lang: "ru" | "en", state = useMarkup.getState()): Guide[] {
	const aspect = aspectOfCanvas(canvas);
	const m = markupFor(aspect, state);
	if (!m.on || m.layers.length === 0) return [];
	return markupGuides({ aspect, canvas, layers: m.layers, platform: m.platform, subtitle: subtitlePlacement(canvas, lang) });
}

/** For the player's snapping: the visible guides' edges and centres (px from the frame's centre). */
export function liveMarkupSnapTargets(canvas: Size, lang: "ru" | "en"): { x: number[]; y: number[] } {
	return guideSnapTargets(liveMarkupGuides(canvas, lang), canvas);
}
