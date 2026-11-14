import { CORNER_RADIUS_MIN } from "@/text/background";
import { DEFAULTS } from "@/timeline/defaults";
import type { TextElement } from "@/timeline";
import type { TextBackground } from "@/text/background";
import { resolveNumberAtTime } from "@/animation/values";
import { resolveAnimationPathValueAtTime } from "@/animation/resolve";
import { resolveGlyphState, resolveTextAnimFrame, wordPopScale, type TextAnimFrame } from "@/animation/presets";
import { countProgress, countUp, designExtent, layoutDesign, resolveDesignState, union } from "./design";
import { addEmojiAccents } from "./emoji-accents";
import { TICKS_PER_SECOND } from "@/wasm";
import { FONT_SIZE_SCALE_REFERENCE } from "./typography";
import {
	getTextVisualRect,
} from "./layout";
import {
	isTextFontWeight,
	measureTextLayout,
	type MeasuredTextLayout,
	type TextAlign,
	type TextDecoration,
	type TextHighlightMode,
	type TextFontStyle,
	type TextFontWeight,
	type TextLayoutParams,
	type TextPaintStyle,
	type TextTransform,
} from "./primitives";

export interface ResolvedTextBackground extends TextBackground {
	paddingX: number;
	paddingY: number;
	offsetX: number;
	offsetY: number;
	cornerRadius: number;
}

export interface MeasuredTextElement extends MeasuredTextLayout {
	resolvedBackground: ResolvedTextBackground;
	visualRect: { left: number; top: number; width: number; height: number };
}

let textMeasurementContext:
	| CanvasRenderingContext2D
	| OffscreenCanvasRenderingContext2D
	| null = null;

export function getTextMeasurementContext():
	| CanvasRenderingContext2D
	| OffscreenCanvasRenderingContext2D {
	if (textMeasurementContext) {
		return textMeasurementContext;
	}

	if (typeof OffscreenCanvas !== "undefined") {
		const canvas = new OffscreenCanvas(1, 1);
		const context = canvas.getContext("2d");
		if (context) {
			textMeasurementContext = context;
			return context;
		}
	}

	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (context) {
			textMeasurementContext = context;
			return context;
		}
	}

	throw new Error("Failed to create text measurement context");
}

export function measureTextElement({
	element,
	canvasHeight,
	canvasWidth,
	localTime,
	ctx,
	animFrame,
}: {
	element: TextElement;
	canvasHeight: number;
	/** Needed for «Ширина блока» (% of the frame); defaults to a 9:16 frame. */
	canvasWidth?: number;
	localTime: number;
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	/** Pass the frame when the caller already resolved it (avoids recomputing). */
	animFrame?: TextAnimFrame;
}): MeasuredTextElement {
	const text = buildTextLayoutParamsFromElement({ element, canvasWidth, canvasHeight });
	const design = resolveDesignState({ element, localTime, textColor: "#ffffff" });
	// a counter: the numbers in the text run up from 0 during the entrance
	if (design?.spec.count) text.content = countUp(text.content, countProgress(design));
	// caption styles with emoji accents: a keyword gets its emoji (glued on: the word timings stay)
	if (element.params["caption.emoji"] === true) text.content = addEmojiAccents(text.content);
	const frame =
		animFrame ??
		resolveTextAnimFrame({
			params: element.params,
			animations: element.animations,
			duration: element.duration,
			localTime,
			canvasWidth: canvasWidth ?? (canvasHeight * 9) / 16,
			canvasHeight,
		});
	if (frame.tracking !== 0) {
		// Tracking is a share of the font size; letterSpacing is in canvas px
		// at the reference size, so convert through the scaled font size.
		const scaled = (text.fontSize * canvasHeight) / FONT_SIZE_SCALE_REFERENCE;
		text.letterSpacing = (text.letterSpacing ?? 0) + frame.tracking * scaled;
	}
	const measuredLayout = measureTextLayout({
		text,
		canvasHeight,
		ctx,
	});

	const bg = buildTextBackgroundFromElement({ element });
	const resolvedBackground: ResolvedTextBackground = {
		...bg,
		paddingX: resolveNumberAtTime({
			baseValue: bg.paddingX ?? DEFAULTS.text.background.paddingX,
			animations: element.animations,
			propertyPath: "background.paddingX",
			localTime,
		}),
		paddingY: resolveNumberAtTime({
			baseValue: bg.paddingY ?? DEFAULTS.text.background.paddingY,
			animations: element.animations,
			propertyPath: "background.paddingY",
			localTime,
		}),
		offsetX: resolveNumberAtTime({
			baseValue: bg.offsetX ?? DEFAULTS.text.background.offsetX,
			animations: element.animations,
			propertyPath: "background.offsetX",
			localTime,
		}),
		offsetY: resolveNumberAtTime({
			baseValue: bg.offsetY ?? DEFAULTS.text.background.offsetY,
			animations: element.animations,
			propertyPath: "background.offsetY",
			localTime,
		}),
		cornerRadius: resolveNumberAtTime({
			baseValue: bg.cornerRadius ?? CORNER_RADIUS_MIN,
			animations: element.animations,
			propertyPath: "background.cornerRadius",
			localTime,
		}),
	};

	let visualRect = getTextVisualRect({
		textAlign: text.textAlign,
		block: measuredLayout.block,
		background: resolvedBackground,
		fontSizeRatio: measuredLayout.fontSizeRatio,
	});
	// the selection box holds the whole motion title (plate, bar, icon, second line), not just the letters
	if (design && measuredLayout.lines.length > 0) {
		visualRect = union(visualRect, designExtent(layoutDesign({ ctx, layout: measuredLayout, state: design }), design));
	}

	return {
		...measuredLayout,
		resolvedBackground,
		visualRect,
	};
}

export function buildTextLayoutParamsFromElement({
	element,
	canvasWidth,
	canvasHeight,
}: {
	element: TextElement;
	canvasWidth?: number;
	canvasHeight?: number;
}): TextLayoutParams {
	const boxPercent = readNumberParam({
		params: element.params,
		key: "box.width",
		fallback: DEFAULTS.text.style.box.width,
	});
	const frameWidth =
		canvasWidth ?? (canvasHeight != null ? (canvasHeight * 9) / 16 : 0);
	return {
		boxWidth: boxPercent > 0 && frameWidth > 0 ? (frameWidth * boxPercent) / 100 : 0,
		maxLines: Math.max(
			0,
			Math.round(
				readNumberParam({
					params: element.params,
					key: "box.maxLines",
					fallback: DEFAULTS.text.style.box.maxLines,
				}),
			),
		),
		autoFit: readBooleanParam({
			params: element.params,
			key: "box.autoFit",
			fallback: DEFAULTS.text.style.box.autoFit,
		}),
		content: readStringParam({
			params: element.params,
			key: "content",
			fallback: "Default text",
		}),
		fontSize: readNumberParam({
			params: element.params,
			key: "fontSize",
			fallback: 15,
		}),
		fontFamily: readStringParam({
			params: element.params,
			key: "fontFamily",
			fallback: "Arial",
		}),
		fontWeight: readFontWeight({
			value: element.params.fontWeight,
			fallback: "normal",
		}),
		fontStyle: readFontStyle({
			value: element.params.fontStyle,
			fallback: "normal",
		}),
		textAlign: readTextAlign({
			value: element.params.textAlign,
			fallback: "center",
		}),
		textDecoration: readTextDecoration({
			value: element.params.textDecoration,
			fallback: "none",
		}),
		letterSpacing: readNumberParam({
			params: element.params,
			key: "letterSpacing",
			fallback: DEFAULTS.text.letterSpacing,
		}),
		lineHeight: readNumberParam({
			params: element.params,
			key: "lineHeight",
			fallback: DEFAULTS.text.lineHeight,
		}),
		textTransform: readTextTransform({ value: element.params.textTransform }),
		strokeWidthPercent: readBooleanParam({
			params: element.params,
			key: "stroke.enabled",
			fallback: false,
		})
			? readNumberParam({
					params: element.params,
					key: "stroke.width",
					fallback: DEFAULTS.text.style.stroke.width,
				})
			: 0,
	};
}

export function buildTextBackgroundFromElement({
	element,
}: {
	element: TextElement;
}): TextBackground {
	return {
		enabled: readBooleanParam({
			params: element.params,
			key: "background.enabled",
			fallback: DEFAULTS.text.background.enabled,
		}),
		color: readStringParam({
			params: element.params,
			key: "background.color",
			fallback: DEFAULTS.text.background.color,
		}),
		cornerRadius: readNumberParam({
			params: element.params,
			key: "background.cornerRadius",
			fallback: DEFAULTS.text.background.cornerRadius,
		}),
		paddingX: readNumberParam({
			params: element.params,
			key: "background.paddingX",
			fallback: DEFAULTS.text.background.paddingX,
		}),
		paddingY: readNumberParam({
			params: element.params,
			key: "background.paddingY",
			fallback: DEFAULTS.text.background.paddingY,
		}),
		offsetX: readNumberParam({
			params: element.params,
			key: "background.offsetX",
			fallback: DEFAULTS.text.background.offsetX,
		}),
		offsetY: readNumberParam({
			params: element.params,
			key: "background.offsetY",
			fallback: DEFAULTS.text.background.offsetY,
		}),
	};
}

function readStringParam({
	params,
	key,
	fallback,
}: {
	params: TextElement["params"];
	key: string;
	fallback: string;
}): string {
	const value = params[key];
	return typeof value === "string" ? value : fallback;
}

function readNumberParam({
	params,
	key,
	fallback,
}: {
	params: TextElement["params"];
	key: string;
	fallback: number;
}): number {
	const value = params[key];
	return typeof value === "number" ? value : fallback;
}

function readBooleanParam({
	params,
	key,
	fallback,
}: {
	params: TextElement["params"];
	key: string;
	fallback: boolean;
}): boolean {
	const value = params[key];
	return typeof value === "boolean" ? value : fallback;
}

function readTextAlign({
	value,
	fallback,
}: {
	value: unknown;
	fallback: TextAlign;
}): TextAlign {
	return value === "left" || value === "center" || value === "right"
		? value
		: fallback;
}

function readFontWeight({
	value,
	fallback,
}: {
	value: unknown;
	fallback: TextFontWeight;
}): TextFontWeight {
	return isTextFontWeight(value) ? value : fallback;
}

function readFontStyle({
	value,
	fallback,
}: {
	value: unknown;
	fallback: TextFontStyle;
}): TextFontStyle {
	return value === "italic" || value === "normal" ? value : fallback;
}

function readTextDecoration({
	value,
	fallback,
}: {
	value: unknown;
	fallback: TextDecoration;
}): TextDecoration {
	return value === "none" || value === "underline" || value === "line-through"
		? value
		: fallback;
}

function readTextTransform({ value }: { value: unknown }): TextTransform {
	return value === "uppercase" || value === "lowercase" || value === "capitalize"
		? value
		: "none";
}

const HIGHLIGHT_MODES = new Set<TextHighlightMode>([
	"none",
	"color",
	"karaoke",
	"box",
	"reveal",
	"pop",
	"jump",
	"rise",
	"slide",
	"glow",
	"underline",
]);

function readHighlightMode(value: unknown): TextHighlightMode {
	return typeof value === "string" && HIGHLIGHT_MODES.has(value as TextHighlightMode)
		? (value as TextHighlightMode)
		: "none";
}

/**
 * Word start times (seconds from the clip start) for the active-word
 * highlight. Captions store real timings in `caption.words`; anything else
 * spreads the words over the clip in proportion to their length.
 */
export function getTextWordStarts({
	element,
	wordCount,
}: {
	element: TextElement;
	wordCount: number;
}): number[] {
	const stored = element.params["caption.words"];
	if (typeof stored === "string" && stored.trim()) {
		const starts = stored
			.trim()
			.split(/\s+/)
			.map(Number)
			.filter((value) => Number.isFinite(value));
		if (starts.length === wordCount) return starts;
	}
	const content = readStringParam({ params: element.params, key: "content", fallback: "" });
	const words = content.split(/\s+/).filter(Boolean);
	const total = Math.max(0, element.duration) / TICKS_PER_SECOND;
	const span = total * 0.9;
	const weights = words.map((word) => Math.max(2, Array.from(word).length) + 1);
	const sum = weights.reduce((acc, value) => acc + value, 0) || 1;
	const starts: number[] = [];
	let acc = 0;
	for (let index = 0; index < wordCount; index++) {
		starts.push((acc / sum) * span);
		acc += weights[index] ?? 0;
	}
	return starts;
}

function resolveActiveWord({
	element,
	localTime,
	manualIndex,
}: {
	element: TextElement;
	localTime: number;
	manualIndex: number;
}): { index: number; age: number; progress: number } {
	if (manualIndex >= 0) return { index: Math.round(manualIndex), age: 1, progress: 1 };
	const content = readStringParam({ params: element.params, key: "content", fallback: "" });
	const wordCount = content.split(/\s+/).filter(Boolean).length;
	if (wordCount === 0) return { index: -1, age: 0, progress: 0 };
	const starts = getTextWordStarts({ element, wordCount });
	const t = Math.max(0, localTime) / TICKS_PER_SECOND;
	let index = 0;
	for (let i = 0; i < starts.length; i++) {
		if (starts[i] <= t + 1e-6) index = i;
	}
	const start = starts[index] ?? 0;
	const clipEnd = Math.max(0, element.duration) / TICKS_PER_SECOND;
	const end = starts[index + 1] ?? Math.max(start + 0.2, clipEnd * 0.95);
	const age = t - start;
	return { index, age, progress: Math.min(1, Math.max(0, age / Math.max(0.05, end - start))) };
}

/** Stroke / shadow / gradient / highlight paint settings stored in text element params. */
export function buildTextPaintFromElement({
	element,
	textColor,
	localTime = 0,
	animFrame,
}: {
	element: TextElement;
	textColor: string;
	/** Ticks from the clip start (drives the active-word highlight). */
	localTime?: number;
	animFrame?: TextAnimFrame;
}): TextPaintStyle {
	const params = element.params;
	const style = DEFAULTS.text.style;
	const highlightMode = readHighlightMode(params["highlight.mode"]);
	let highlight: TextPaintStyle["highlight"] = null;
	if (highlightMode !== "none") {
		const manualIndex = resolveAnimationPathValueAtTime({
			animations: element.animations,
			propertyPath: "highlight.index",
			localTime: Math.max(0, localTime),
			fallbackValue: readNumberParam({ params, key: "highlight.index", fallback: -1 }),
		});
		const active = resolveActiveWord({ element, localTime, manualIndex });
		highlight = {
			mode: highlightMode,
			color: resolveAnimationPathValueAtTime({
				animations: element.animations,
				propertyPath: "highlight.color",
				localTime: Math.max(0, localTime),
				fallbackValue: readStringParam({ params, key: "highlight.color", fallback: style.highlight.color }),
			}),
			index: active.index,
			scale:
				highlightMode === "pop"
					? wordPopScale({ age: active.age })
					: resolveAnimationPathValueAtTime({
							animations: element.animations,
							propertyPath: "highlight.scale",
							localTime: Math.max(0, localTime),
							fallbackValue: readNumberParam({ params, key: "highlight.scale", fallback: style.highlight.scale }),
						}),
			age: active.age,
			progress: active.progress,
		};
	}
	return {
		textColor,
		stroke: readBooleanParam({ params, key: "stroke.enabled", fallback: false })
			? {
					color: readStringParam({ params, key: "stroke.color", fallback: style.stroke.color }),
					widthPercent: readNumberParam({ params, key: "stroke.width", fallback: style.stroke.width }),
				}
			: null,
		shadow: readBooleanParam({ params, key: "shadow.enabled", fallback: false })
			? {
					color: readStringParam({ params, key: "shadow.color", fallback: style.shadow.color }),
					blurPercent: readNumberParam({ params, key: "shadow.blur", fallback: style.shadow.blur }),
					offsetXPercent: readNumberParam({ params, key: "shadow.offsetX", fallback: style.shadow.offsetX }),
					offsetYPercent: readNumberParam({ params, key: "shadow.offsetY", fallback: style.shadow.offsetY }),
				}
			: null,
		gradientColor: readBooleanParam({ params, key: "gradient.enabled", fallback: false })
			? readStringParam({ params, key: "gradient.color", fallback: style.gradient.color })
			: null,
		highlight,
		reveal: animFrame ? animFrame.reveal : 1,
		blur: animFrame ? animFrame.blur : 0,
		design: resolveDesignState({ element, localTime, textColor }),
		glyphs: resolveGlyphState({ params, duration: element.duration, localTime }),
	};
}
