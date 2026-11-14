import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";
import {
	getTextVisualRect,
	measureTextBlock,
	setCanvasLetterSpacing,
} from "@/text/layout";
import { DEFAULTS } from "@/timeline/defaults";
import { mediaTimeFromSeconds } from "@/wasm";
import type { CreateTextElement } from "@/timeline";
import type { TextBackground } from "@/text/background";
import type {
	TextAlign,
	TextDecoration,
	TextFontStyle,
	TextFontWeight,
} from "@/text/primitives";
import type { SubtitleCue, SubtitleStyleOverrides } from "./types";
import {
	CAPTION_CENTER_Y,
	stripCaptionPunctuation,
	type CaptionStyle,
} from "./styles";

const SUBTITLE_MAX_WIDTH_RATIO = 0.8;
const SUBTITLE_BOTTOM_MARGIN_RATIO = 0.05;
const SUBTITLE_FONT_SIZE = 5;
const MEASUREMENT_CANVAS_SIZE = 4096;

function quoteFontFamily({ fontFamily }: { fontFamily: string }): string {
	return `"${fontFamily.replace(/"/g, '\\"')}"`;
}

function createMeasurementContext(): CanvasRenderingContext2D | null {
	const canvas = document.createElement("canvas");
	canvas.width = MEASUREMENT_CANVAS_SIZE;
	canvas.height = MEASUREMENT_CANVAS_SIZE;
	return canvas.getContext("2d");
}

function measureLineWidth({
	ctx,
	text,
}: {
	ctx: CanvasRenderingContext2D;
	text: string;
}): number {
	return ctx.measureText(text).width;
}

function wrapSubtitleText({
	ctx,
	text,
	maxWidth,
}: {
	ctx: CanvasRenderingContext2D;
	text: string;
	maxWidth: number;
}): string {
	const normalized = text.trim().replace(/\r\n/g, "\n");
	const paragraphs = normalized.split("\n");
	const wrappedParagraphs: string[] = [];

	for (const paragraph of paragraphs) {
		const trimmedParagraph = paragraph.trim();
		if (!trimmedParagraph) {
			wrappedParagraphs.push("");
			continue;
		}

		const words = trimmedParagraph.split(/\s+/);
		let currentLine = words[0] ?? "";
		const lines: string[] = [];

		for (let i = 1; i < words.length; i++) {
			const nextLine = `${currentLine} ${words[i]}`;
			if (measureLineWidth({ ctx, text: nextLine }) <= maxWidth) {
				currentLine = nextLine;
				continue;
			}

			lines.push(currentLine);
			currentLine = words[i];
		}

		lines.push(currentLine);
		wrappedParagraphs.push(lines.join("\n"));
	}

	return wrappedParagraphs.join("\n");
}

function measureWrappedTextBlock({
	ctx,
	content,
	canvasHeight,
	textAlign,
	background,
	fontSize,
	lineHeight,
}: {
	ctx: CanvasRenderingContext2D;
	content: string;
	canvasHeight: number;
	textAlign: TextAlign;
	background: TextBackground;
	fontSize: number;
	lineHeight: number;
}) {
	const scaledFontSize = fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE);
	const lineHeightPx = lineHeight * scaledFontSize;
	const lines = content.split("\n");
	const lineMetrics = lines.map((line) => ctx.measureText(line));

	const block = measureTextBlock({
		lineMetrics,
		lineHeightPx,
	});
	const visualRect = getTextVisualRect({
		textAlign,
		block,
		background,
		fontSizeRatio: fontSize / 15,
	});

	return {
		block,
		visualRect,
	};
}

function resolveSubtitleStyle({
	style,
}: {
	style: SubtitleStyleOverrides | undefined;
}): {
	fontFamily: string;
	fontSize: number;
	color: string;
	textAlign: TextAlign;
	fontWeight: TextFontWeight;
	fontStyle: TextFontStyle;
	textDecoration: TextDecoration;
	letterSpacing: number;
	lineHeight: number;
	background: TextBackground;
	placement: NonNullable<SubtitleStyleOverrides["placement"]>;
} {
	const fontSize =
		style?.fontSizeRatioOfPlayHeight != null
			? style.fontSizeRatioOfPlayHeight * FONT_SIZE_SCALE_REFERENCE
			: (style?.fontSize ?? SUBTITLE_FONT_SIZE);

	return {
		fontFamily: style?.fontFamily ?? "Arial",
		fontSize,
		color: style?.color ?? "#ffffff",
		textAlign: style?.textAlign ?? "center",
		fontWeight: style?.fontWeight ?? "bold",
		fontStyle: style?.fontStyle ?? "normal",
		textDecoration: style?.textDecoration ?? "none",
		letterSpacing: style?.letterSpacing ?? DEFAULTS.text.letterSpacing,
		lineHeight: style?.lineHeight ?? DEFAULTS.text.lineHeight,
		background: {
			...DEFAULTS.text.background,
			enabled: false,
			...(style?.background ?? {}),
		},
		placement: {
			verticalAlign: style?.placement?.verticalAlign ?? "bottom",
			marginLeftRatio: style?.placement?.marginLeftRatio,
			marginRightRatio: style?.placement?.marginRightRatio,
			marginVerticalRatio: style?.placement?.marginVerticalRatio,
		},
	};
}

function resolveTargetWidth({
	canvasWidth,
	placement,
}: {
	canvasWidth: number;
	placement: ReturnType<typeof resolveSubtitleStyle>["placement"];
}): number {
	const leftRatio = placement.marginLeftRatio ?? 0;
	const rightRatio = placement.marginRightRatio ?? 0;
	const hasExplicitMargins = leftRatio > 0 || rightRatio > 0;
	if (!hasExplicitMargins) {
		return canvasWidth * SUBTITLE_MAX_WIDTH_RATIO;
	}

	const availableWidth = canvasWidth * (1 - leftRatio - rightRatio);
	return Math.max(0, availableWidth);
}

function resolvePositionX({
	canvasWidth,
	textAlign,
	placement,
	visualRect,
}: {
	canvasWidth: number;
	textAlign: TextAlign;
	placement: ReturnType<typeof resolveSubtitleStyle>["placement"];
	visualRect: { left: number; width: number };
}): number {
	const leftMargin = canvasWidth * (placement.marginLeftRatio ?? 0);
	const rightMargin = canvasWidth * (placement.marginRightRatio ?? 0);
	const canvasCenterX = canvasWidth / 2;

	if (textAlign === "left") {
		return leftMargin - visualRect.left - canvasCenterX;
	}

	if (textAlign === "right") {
		return (
			canvasWidth -
			rightMargin -
			(visualRect.left + visualRect.width) -
			canvasCenterX
		);
	}

	const availableWidth = canvasWidth - leftMargin - rightMargin;
	const targetCenterX = leftMargin + availableWidth / 2;
	return (
		targetCenterX - (visualRect.left + visualRect.width / 2) - canvasCenterX
	);
}

function resolvePositionY({
	canvasHeight,
	placement,
	visualRect,
}: {
	canvasHeight: number;
	placement: ReturnType<typeof resolveSubtitleStyle>["placement"];
	visualRect: { top: number; height: number };
}): number {
	const margin =
		canvasHeight *
		(placement.marginVerticalRatio ?? SUBTITLE_BOTTOM_MARGIN_RATIO);
	const canvasCenterY = canvasHeight / 2;

	if (placement.verticalAlign === "top") {
		return margin - visualRect.top - canvasCenterY;
	}

	if (placement.verticalAlign === "middle") {
		const targetCenterY = canvasHeight / 2;
		return (
			targetCenterY - (visualRect.top + visualRect.height / 2) - canvasCenterY
		);
	}

	return (
		canvasHeight - margin - (visualRect.top + visualRect.height) - canvasCenterY
	);
}

export function buildSubtitleTextElement({
	index,
	caption,
	canvasSize,
}: {
	index: number;
	caption: SubtitleCue;
	canvasSize: { width: number; height: number };
}): CreateTextElement {
	const ctx = createMeasurementContext();
	const style = resolveSubtitleStyle({
		style: caption.style,
	});
	const fontFamily = quoteFontFamily({
		fontFamily: style.fontFamily,
	});
	const fontWeight = style.fontWeight;
	const fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
	const scaledFontSize =
		style.fontSize * (canvasSize.height / FONT_SIZE_SCALE_REFERENCE);
	const fontString = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${fontFamily}, sans-serif`;
	const maxWidth = resolveTargetWidth({
		canvasWidth: canvasSize.width,
		placement: style.placement,
	});

	let content = caption.text;
	let positionX = 0;
	let positionY = 0;

	if (ctx) {
		ctx.font = fontString;
		setCanvasLetterSpacing({ ctx, letterSpacingPx: style.letterSpacing });
		content = wrapSubtitleText({
			ctx,
			text: caption.text,
			maxWidth,
		});
		const measurement = measureWrappedTextBlock({
			ctx,
			content,
			canvasHeight: canvasSize.height,
			textAlign: style.textAlign,
			background: style.background,
			fontSize: style.fontSize,
			lineHeight: style.lineHeight,
		});
		positionX = resolvePositionX({
			canvasWidth: canvasSize.width,
			textAlign: style.textAlign,
			placement: style.placement,
			visualRect: measurement.visualRect,
		});
		positionY = resolvePositionY({
			canvasHeight: canvasSize.height,
			placement: style.placement,
			visualRect: measurement.visualRect,
		});
	}

	return {
		...DEFAULTS.text.element,
		name: `Caption ${index + 1}`,
		duration: mediaTimeFromSeconds({ seconds: caption.duration }),
		startTime: mediaTimeFromSeconds({ seconds: caption.startTime }),
		params: {
			...DEFAULTS.text.element.params,
			content,
			fontSize: style.fontSize,
			fontFamily: style.fontFamily,
			color: style.color,
			textAlign: style.textAlign,
			fontWeight: style.fontWeight,
			fontStyle: style.fontStyle,
			textDecoration: style.textDecoration,
			letterSpacing: style.letterSpacing,
			lineHeight: style.lineHeight,
			// Readable on any footage, like short-form captions: white text with a black outline.
			"stroke.enabled": true,
			"stroke.color": "#000000",
			"stroke.width": 14,
			"background.enabled": style.background.enabled,
			"background.color": style.background.color,
			"background.cornerRadius":
				style.background.cornerRadius ?? DEFAULTS.text.background.cornerRadius,
			"background.paddingX":
				style.background.paddingX ?? DEFAULTS.text.background.paddingX,
			"background.paddingY":
				style.background.paddingY ?? DEFAULTS.text.background.paddingY,
			"background.offsetX":
				style.background.offsetX ?? DEFAULTS.text.background.offsetX,
			"background.offsetY":
				style.background.offsetY ?? DEFAULTS.text.background.offsetY,
			"transform.positionX": positionX,
			"transform.positionY": positionY,
		},
	};
}

/** Normalised face box (0…1 of the frame); captions keep out of it. */
export interface CaptionFaceBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Captions of a wide frame sit in the lower third, as CapCut's 16:9 default (0.82 H); the exam 03.11 exported a
 * documentary with every caption across the middle of its pictures. A tall frame keeps 0.59 H: the feed's safe zone,
 * above the phone's buttons and under the face. */
export const CAPTION_CENTER_Y_WIDE = 0.32;

/**
 * Vertical centre (px from the frame middle) for a caption block: 0.59 H by
 * default (0.82 H in a wide frame); moved under the face (or above it) when a
 * known face box would cover the mouth zone.
 */
export function resolveCaptionCenterY({
	canvasHeight,
	canvasWidth,
	fontSize,
	faceBox,
}: {
	canvasHeight: number;
	canvasWidth?: number;
	fontSize: number;
	faceBox?: CaptionFaceBox | null;
}): number {
	const wide = canvasWidth !== undefined && canvasWidth > canvasHeight;
	let center = 0.5 + (wide ? CAPTION_CENTER_Y_WIDE : CAPTION_CENTER_Y);
	if (faceBox) {
		const half = ((fontSize / FONT_SIZE_SCALE_REFERENCE) * 1.1 * 2) / 2 + 0.01;
		const faceTop = faceBox.y;
		const faceBottom = faceBox.y + faceBox.height;
		if (center - half < faceBottom && center + half > faceTop) {
			const below = faceBottom + half + 0.01;
			const above = faceTop - half - 0.01;
			// Stay above the bottom UI band (0.80 H; a wide frame has none, 0.92 H); otherwise go above the face.
			center = below + half <= (wide ? 0.92 : 0.8) ? below : Math.max(0.2, above);
		}
	}
	return Math.round((center - 0.5) * canvasHeight);
}

/** Text params of a caption style for a frame of the given height (no content/timing). */
export function captionStyleParams({
	style,
	canvasHeight,
}: {
	style: CaptionStyle;
	canvasHeight: number;
}): Record<string, string | number | boolean> {
	const params: Record<string, string | number | boolean> = {
		...style.params,
		"caption.style": style.id,
	};
	if (params["background.enabled"] === true) {
		// Plate padding in em → renderer units (canvas px × size / 15).
		params["background.paddingX"] = Math.round((0.32 * canvasHeight) / 6);
		params["background.paddingY"] = Math.round((0.14 * canvasHeight) / 6);
	}
	return params;
}

/** Caption content and word starts (s from the caption start) in a style. */
export function styledCaptionText({
	caption,
	style,
}: {
	caption: SubtitleCue;
	style: CaptionStyle;
}): { content: string; wordStarts: string } {
	const words =
		caption.words && caption.words.length > 0
			? caption.words
			: caption.text
					.replace(/\s+/g, " ")
					.trim()
					.split(" ")
					.filter(Boolean)
					.map((text) => ({ text, startTime: Number.NaN, endTime: Number.NaN }));
	// One token per rendered word (a word like "так —" becomes two tokens that
	// share a start time), so timings line up with the renderer's words.
	const tokens: Array<{ text: string; start: number }> = [];
	for (const word of words) {
		for (const part of word.text.trim().split(/\s+/).filter(Boolean)) {
			const text = style.stripPunctuation ? stripCaptionPunctuation(part) : part;
			tokens.push({ text, start: word.startTime });
		}
	}
	const timed = tokens.every((token) => Number.isFinite(token.start));
	return {
		content: tokens.map((token) => token.text).join(" "),
		wordStarts: timed
			? tokens
					.map((token) => Math.max(0, token.start - caption.startTime).toFixed(3))
					.join(" ")
			: "",
	};
}

/** A caption element in one of the Captions tab styles. */
export function buildStyledCaptionElement({
	index,
	caption,
	canvasSize,
	style,
	faceBox,
}: {
	index: number;
	caption: SubtitleCue;
	canvasSize: { width: number; height: number };
	style: CaptionStyle;
	faceBox?: CaptionFaceBox | null;
}): CreateTextElement {
	const { content, wordStarts } = styledCaptionText({ caption, style });
	const params = captionStyleParams({ style, canvasHeight: canvasSize.height });
	return {
		...DEFAULTS.text.element,
		name: `Caption ${index + 1}`,
		duration: mediaTimeFromSeconds({ seconds: caption.duration }),
		startTime: mediaTimeFromSeconds({ seconds: caption.startTime }),
		params: {
			...DEFAULTS.text.element.params,
			...params,
			content,
			"caption.words": wordStarts,
			"transform.positionX": 0,
			"transform.positionY": resolveCaptionCenterY({
				canvasHeight: canvasSize.height,
				canvasWidth: canvasSize.width,
				fontSize: Number(params.fontSize) || 5,
				faceBox,
			}),
		},
	};
}
