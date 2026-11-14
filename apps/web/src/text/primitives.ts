import { onFontReady } from "@/fonts/bundled";
import type { TextCanvasContext, TextBlockMeasurement } from "@/text/layout";
import { DEFAULTS } from "@/timeline/defaults";
import { clamp } from "@/utils/math";
import { CORNER_RADIUS_MAX, CORNER_RADIUS_MIN } from "./background";
import {
	drawTextDecoration,
	getTextBackgroundRect,
	getTextRect,
	measureTextBlock,
	setCanvasLetterSpacing,
} from "./layout";
import { applyTextTransform, wrapParagraph } from "./line-break";
import { FONT_SIZE_SCALE_REFERENCE } from "./typography";
import { type DesignState, layoutDesign } from "./design";
import { drawDesignLayers, drawSubText, echoCopies, pressScale } from "./design-draw";
import { type GlyphState, glowPulse, glyphMotion, glyphsActive, glyphUnit, shimmerAt } from "./glyph-anim";

export type TextAlign = "left" | "center" | "right";
/** CSS font-weight keyword or numeric weight (300–900). */
export type TextFontWeight =
	| "normal"
	| "bold"
	| "100"
	| "200"
	| "300"
	| "400"
	| "500"
	| "600"
	| "700"
	| "800"
	| "900";
export type TextFontStyle = "normal" | "italic";
export type TextDecoration = "none" | "underline" | "line-through";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";
export type TextHighlightMode =
	| "none"
	| "color"
	| "karaoke"
	| "box"
	| "reveal"
	| "pop"
	| "jump"
	| "rise"
	| "slide"
	| "glow"
	| "underline";

const FONT_WEIGHTS = new Set<string>([
	"normal",
	"bold",
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900",
]);

export function isTextFontWeight(value: unknown): value is TextFontWeight {
	return typeof value === "string" && FONT_WEIGHTS.has(value);
}

/**
 * Fallbacks appended to every text font stack: the bundled Golos Text covers
 * Cyrillic and ₽ that some display fonts lack, then the bundled emoji.
 */
export const TEXT_FONT_FALLBACKS = `"Golos Text", "Noto Color Emoji", sans-serif`;

export interface TextLayoutParams {
	content: string;
	fontSize: number;
	fontFamily: string;
	fontWeight: TextFontWeight;
	fontStyle: TextFontStyle;
	textAlign: TextAlign;
	textDecoration?: TextDecoration;
	letterSpacing?: number;
	lineHeight?: number;
	textTransform?: TextTransform;
	/** Wrap width in canvas px (0 = only manual line breaks). */
	boxWidth?: number;
	/** Maximum number of lines used by auto-fit (0 = unlimited). */
	maxLines?: number;
	/** Shrink the font until the text fits `boxWidth` / `maxLines`. */
	autoFit?: boolean;
	/** Stroke width in % of the font size, only used to keep fits inside the box. */
	strokeWidthPercent?: number;
}

export interface ResolvedTextLayout {
	scaledFontSize: number;
	fontString: string;
	letterSpacing: number;
	lineHeightPx: number;
	fontSizeRatio: number;
	textAlign: TextAlign;
	textDecoration: TextDecoration;
}

export interface MeasuredTextWord {
	line: number;
	/** Left edge relative to the line start, px. */
	x: number;
	width: number;
	text: string;
	/** Character offset of the word inside its line. */
	start: number;
}

export interface MeasuredTextLayout extends ResolvedTextLayout {
	lines: string[];
	lineMetrics: TextMetrics[];
	lineWidths: number[];
	block: TextBlockMeasurement;
	words: MeasuredTextWord[];
	/** Total number of characters across all lines (for typewriter reveal). */
	charCount: number;
}

export interface ResolvedTextBackgroundLike {
	enabled: boolean;
	color: string;
	paddingX: number;
	paddingY: number;
	offsetX: number;
	offsetY: number;
	cornerRadius: number;
}

export interface TextPaintStyle {
	textColor: string;
	stroke?: { color: string; widthPercent: number } | null;
	shadow?: {
		color: string;
		blurPercent: number;
		offsetXPercent: number;
		offsetYPercent: number;
	} | null;
	gradientColor?: string | null;
	highlight?: {
		mode: TextHighlightMode;
		color: string;
		index: number;
		scale: number;
		/** Seconds since the active word started (drives the plate grow). */
		age?: number;
		/** 0…1 progress through the active word (karaoke fill). */
		progress?: number;
	} | null;
	/** 0…1 fraction of characters that are visible (typewriter). */
	reveal?: number;
	/** Blur radius as a share of the font size (blur-in / blur-out). */
	blur?: number;
	/** A motion title's layers around the text (text/design.ts). */
	design?: DesignState | null;
	/** Per-letter / per-word / per-line animation on this frame (text/glyph-anim.ts). */
	glyphs?: GlyphState | null;
}

export function quoteFontFamily({ fontFamily }: { fontFamily: string }): string {
	return `"${fontFamily.replace(/"/g, '\\"')}"`;
}

export function buildTextFontString({
	fontFamily,
	fontWeight,
	fontStyle,
	scaledFontSize,
}: {
	fontFamily: string;
	fontWeight: TextFontWeight;
	fontStyle: TextFontStyle;
	scaledFontSize: number;
}): string {
	return `${fontStyle} ${fontWeight} ${scaledFontSize}px ${quoteFontFamily({ fontFamily })}, ${TEXT_FONT_FALLBACKS}`;
}

export function resolveTextLayout({
	text,
	canvasHeight,
	fontScale = 1,
}: {
	text: TextLayoutParams;
	canvasHeight: number;
	fontScale?: number;
}): ResolvedTextLayout {
	const scaledFontSize =
		text.fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE) * fontScale;
	const fontWeight = isTextFontWeight(text.fontWeight)
		? text.fontWeight
		: "normal";
	const fontStyle = text.fontStyle === "italic" ? "italic" : "normal";
	const letterSpacing =
		(text.letterSpacing ?? DEFAULTS.text.letterSpacing) * fontScale;
	const lineHeightPx =
		scaledFontSize * (text.lineHeight ?? DEFAULTS.text.lineHeight);
	const fontSizeRatio = (text.fontSize * fontScale) / 15;

	return {
		scaledFontSize,
		fontString: buildTextFontString({
			fontFamily: text.fontFamily,
			fontWeight,
			fontStyle,
			scaledFontSize,
		}),
		letterSpacing,
		lineHeightPx,
		fontSizeRatio,
		textAlign: text.textAlign,
		textDecoration: text.textDecoration ?? "none",
	};
}

function layoutLines({
	content,
	boxWidth,
	measure,
}: {
	content: string;
	boxWidth: number;
	measure: (text: string) => number;
}): string[] {
	const paragraphs = content.split("\n");
	if (!(boxWidth > 0)) return paragraphs;
	return paragraphs.flatMap((paragraph) =>
		paragraph.trim() === ""
			? [""]
			: wrapParagraph({ text: paragraph, maxWidth: boxWidth, measure }),
	);
}

function measureWithFontScale({
	text,
	content,
	canvasHeight,
	ctx,
	fontScale,
}: {
	text: TextLayoutParams;
	content: string;
	canvasHeight: number;
	ctx: TextCanvasContext;
	fontScale: number;
}): { resolved: ResolvedTextLayout; lines: string[]; widths: number[] } {
	const resolved = resolveTextLayout({ text, canvasHeight, fontScale });
	ctx.font = resolved.fontString;
	setCanvasLetterSpacing({ ctx, letterSpacingPx: resolved.letterSpacing });
	const measure = (value: string) => ctx.measureText(value).width;
	const strokeAllowance =
		((text.strokeWidthPercent ?? 0) / 100) * resolved.scaledFontSize * 2;
	const lines = layoutLines({
		content,
		boxWidth: (text.boxWidth ?? 0) - strokeAllowance,
		measure,
	});
	return { resolved, lines, widths: lines.map(measure) };
}

export function measureTextLayout({
	text,
	canvasHeight,
	ctx,
}: {
	text: TextLayoutParams;
	canvasHeight: number;
	ctx: TextCanvasContext;
}): MeasuredTextLayout {
	const content = applyTextTransform({
		text: text.content,
		transform: text.textTransform,
	});

	ctx.save();
	ctx.textBaseline = "middle";
	let fit = measureWithFontScale({
		text,
		content,
		canvasHeight,
		ctx,
		fontScale: 1,
	});
	const boxWidth = text.boxWidth ?? 0;
	const maxLines = text.maxLines ?? 0;
	const fits = (candidate: typeof fit) => {
		const strokeAllowance =
			((text.strokeWidthPercent ?? 0) / 100) *
			candidate.resolved.scaledFontSize *
			2;
		const widthOk =
			!(boxWidth > 0) ||
			candidate.widths.every((width) => width + strokeAllowance <= boxWidth + 0.5);
		const linesOk = !(maxLines > 0) || candidate.lines.length <= maxLines;
		return widthOk && linesOk;
	};
	if (text.autoFit && (boxWidth > 0 || maxLines > 0) && !fits(fit)) {
		let low = 0.05;
		let high = 1;
		let best: typeof fit | null = null;
		for (let iteration = 0; iteration < 12; iteration++) {
			const mid = (low + high) / 2;
			const candidate = measureWithFontScale({
				text,
				content,
				canvasHeight,
				ctx,
				fontScale: mid,
			});
			if (fits(candidate)) {
				best = candidate;
				low = mid;
			} else {
				high = mid;
			}
		}
		fit =
			best ??
			measureWithFontScale({ text, content, canvasHeight, ctx, fontScale: low });
	}

	ctx.font = fit.resolved.fontString;
	setCanvasLetterSpacing({ ctx, letterSpacingPx: fit.resolved.letterSpacing });
	const lineMetrics = fit.lines.map((line) => ctx.measureText(line));
	const words: MeasuredTextWord[] = [];
	let charCount = 0;
	fit.lines.forEach((line, lineIndex) => {
		charCount += Array.from(line).length;
		const pattern = /\S+/g;
		let match = pattern.exec(line);
		while (match) {
			const prefix = line.slice(0, match.index);
			words.push({
				line: lineIndex,
				x: prefix ? ctx.measureText(prefix).width : 0,
				width: ctx.measureText(match[0]).width,
				text: match[0],
				start: match.index,
			});
			match = pattern.exec(line);
		}
	});
	ctx.restore();

	const block = measureTextBlock({
		lineMetrics,
		lineHeightPx: fit.resolved.lineHeightPx,
		alignWidth: boxWidth,
	});

	return {
		...fit.resolved,
		lines: fit.lines,
		lineMetrics,
		lineWidths: lineMetrics.map((metrics) => metrics.width),
		block,
		words,
		charCount,
	};
}

/** A line's left edge relative to the anchor: inside the wrap box when there is one (see TextBlockMeasurement). */
function getLineLeft({
	textAlign,
	lineWidth,
	alignWidth = 0,
}: {
	textAlign: TextAlign;
	lineWidth: number;
	alignWidth?: number;
}): number {
	if (textAlign === "left") return alignWidth > 0 ? -alignWidth / 2 : 0;
	if (textAlign === "right") return alignWidth > 0 ? alignWidth / 2 - lineWidth : -lineWidth;
	return -lineWidth / 2;
}

function drawBackground({
	ctx,
	layout,
	background,
	backgroundColor,
}: {
	ctx: TextCanvasContext;
	layout: MeasuredTextLayout;
	background: ResolvedTextBackgroundLike;
	backgroundColor: string;
}): void {
	const backgroundRect = getTextBackgroundRect({
		textAlign: layout.textAlign,
		block: layout.block,
		background: {
			...background,
			color: backgroundColor,
		},
		fontSizeRatio: layout.fontSizeRatio,
	});
	if (!backgroundRect) return;
	const p =
		clamp({
			value: background.cornerRadius,
			min: CORNER_RADIUS_MIN,
			max: CORNER_RADIUS_MAX,
		}) / 100;
	const radius = (Math.min(backgroundRect.width, backgroundRect.height) / 2) * p;
	ctx.fillStyle = backgroundColor;
	ctx.beginPath();
	ctx.roundRect(
		backgroundRect.left,
		backgroundRect.top,
		backgroundRect.width,
		backgroundRect.height,
		radius,
	);
	ctx.fill();
}

export interface TextRun {
	line: number;
	x: number;
	text: string;
	color: string | CanvasGradient;
	scale: number;
	width: number;
	/** Karaoke: share of the run (from the left) painted in `splitColor`. */
	split?: number;
	splitColor?: string;
	/** The active word's own glow (Glow highlight). */
	glow?: string;
	/** Per-letter animation: px offset, degrees, vertical squash, opacity, and the line box it is masked to. */
	dx?: number;
	dy?: number;
	rotate?: number;
	scaleY?: number;
	alpha?: number;
	clip?: { top: number; height: number };
}

/** Dark text on a light plate, white on a dark one. */
function contrastTextColor(background: string): string {
	const hex = background.replace("#", "");
	const full =
		hex.length === 3 || hex.length === 4
			? hex
					.slice(0, 3)
					.split("")
					.map((c) => c + c)
					.join("")
			: hex.slice(0, 6);
	const r = Number.parseInt(full.slice(0, 2), 16) / 255;
	const g = Number.parseInt(full.slice(2, 4), 16) / 255;
	const b = Number.parseInt(full.slice(4, 6), 16) / 255;
	if ([r, g, b].some(Number.isNaN)) return "#ffffff";
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#111111" : "#ffffff";
}

/**
 * Splits the layout into drawable runs. Without highlight/reveal every line is
 * one run; with them each word is its own run so it can be recolored, scaled
 * or hidden without moving any other glyph.
 */
/** Exported for tests. */
export function buildRuns({
	layout,
	style,
	baseFill,
}: {
	layout: MeasuredTextLayout;
	style: TextPaintStyle;
	baseFill: string | CanvasGradient;
}): TextRun[] {
	const highlight = style.highlight;
	const mode = highlight?.mode ?? "none";
	const reveal = style.reveal ?? 1;
	const revealLimit =
		reveal >= 1 ? Number.POSITIVE_INFINITY : Math.floor(layout.charCount * reveal);
	const perWord = mode !== "none" || revealLimit !== Number.POSITIVE_INFINITY;

	if (!perWord) {
		return layout.lines.map((line, index) => ({
			line: index,
			x: getLineLeft({
				textAlign: layout.textAlign,
				alignWidth: layout.block.alignWidth,
				lineWidth: layout.lineWidths[index],
			}),
			text: line,
			color: baseFill,
			scale: 1,
			width: layout.lineWidths[index],
		}));
	}

	const runs: TextRun[] = [];
	const activeIndex = Math.round(highlight?.index ?? -1);
	let charsBefore = 0;
	let currentLine = -1;
	let lineCharStart = 0;
	layout.words.forEach((word, wordIndex) => {
		if (word.line !== currentLine) {
			currentLine = word.line;
			lineCharStart = charsBefore;
			charsBefore += Array.from(layout.lines[word.line]).length;
		}
		// word-by-word modes: the words not spoken yet are not there
		if (
			(mode === "reveal" || mode === "pop" || mode === "rise" || mode === "slide") &&
			activeIndex >= 0 &&
			wordIndex > activeIndex
		) {
			return;
		}
		let text = word.text;
		const wordStartChar =
			lineCharStart + Array.from(layout.lines[word.line].slice(0, word.start)).length;
		if (wordStartChar >= revealLimit) return;
		const visibleChars = revealLimit - wordStartChar;
		const wordChars = Array.from(text);
		if (visibleChars < wordChars.length) {
			text = wordChars.slice(0, visibleChars).join("");
		}
		const isActive = wordIndex === activeIndex;
		const isHighlighted =
			(mode === "color" && isActive) ||
			(mode === "reveal" && isActive) ||
			(mode === "pop" && isActive) ||
			((mode === "jump" || mode === "rise" || mode === "slide" || mode === "glow" || mode === "underline") && isActive) ||
			(mode === "karaoke" && activeIndex >= 0 && wordIndex < activeIndex);
		const karaokeActive = mode === "karaoke" && isActive && highlight;
		const onPlate = mode === "box" && isActive && highlight;
		runs.push({
			...(karaokeActive
				? { split: Math.min(1, Math.max(0, highlight.progress ?? 1)), splitColor: highlight.color }
				: {}),
			line: word.line,
			x:
				getLineLeft({
					textAlign: layout.textAlign,
					alignWidth: layout.block.alignWidth,
					lineWidth: layout.lineWidths[word.line],
				}) + word.x,
			text,
			color: onPlate
				? contrastTextColor(highlight.color)
				: isHighlighted && highlight
					? highlight.color
					: baseFill,
			scale: isActive && highlight && mode !== "karaoke" ? highlight.scale : 1,
			width: word.width,
			...(isActive && highlight ? wordEntrance({ mode, age: highlight.age ?? 1, fontPx: layout.scaledFontSize, color: highlight.color }) : {}),
		});
	});
	// A word drawn larger grows over its neighbours' spaces («ECOSYSTEM OR» read «ECOSYSTEMOR» in Hormozi):
	// the words beside it on its line move out by half the extra width each way.
	const grown = runs.findIndex((run) => run.scale > 1);
	if (grown >= 0) {
		const { line, scale, width } = runs[grown];
		const push = ((scale - 1) * width) / 2;
		for (let i = 0; i < runs.length; i++) {
			if (i === grown || runs[i].line !== line) continue;
			runs[i] = { ...runs[i], x: runs[i].x + (i < grown ? -push : push) };
		}
	}
	return runs;
}

/** The spoken word's own motion: a jump, a rise from below, a fly-in from the side, a glow. */
function wordEntrance({ mode, age, fontPx, color }: { mode: TextHighlightMode; age: number; fontPx: number; color: string }): Partial<TextRun> {
	if (mode === "glow") return { glow: color };
	if (mode === "jump") return age < 0.32 ? { dy: -0.26 * fontPx * Math.sin((Math.PI * age) / 0.32) } : {};
	if ((mode === "rise" || mode === "slide") && age < 0.22) {
		const e = 1 - (1 - age / 0.22) ** 3;
		return mode === "rise" ? { dy: (1 - e) * 0.45 * fontPx, alpha: e } : { dx: (1 - e) * 0.9 * fontPx, alpha: e };
	}
	return {};
}

function getLineY({
	layout,
	line,
}: {
	layout: MeasuredTextLayout;
	line: number;
}): number {
	return line * layout.lineHeightPx - layout.block.visualCenterOffset;
}

function withRunTransform({
	ctx,
	run,
	lineY,
	draw,
}: {
	ctx: TextCanvasContext;
	run: TextRun;
	lineY: number;
	draw: () => void;
}): void {
	const animated = run.dx || run.dy || run.rotate || (run.scaleY != null && run.scaleY !== 1) || (run.alpha != null && run.alpha < 1) || run.clip;
	if (run.scale === 1 && !animated) {
		draw();
		return;
	}
	if (run.alpha != null && run.alpha <= 0.002) return;
	const centerX = run.x + run.width / 2;
	ctx.save();
	if (run.clip) {
		// a mask kind: the piece shows only inside its own line's box
		ctx.beginPath();
		ctx.rect(-1e5, run.clip.top, 2e5, run.clip.height);
		ctx.clip();
	}
	if (run.alpha != null && run.alpha < 1) ctx.globalAlpha *= run.alpha;
	ctx.translate(centerX + (run.dx ?? 0), lineY + (run.dy ?? 0));
	if (run.rotate) ctx.rotate((run.rotate * Math.PI) / 180);
	ctx.scale(run.scale, run.scale * (run.scaleY ?? 1));
	ctx.translate(-centerX, -lineY);
	draw();
	ctx.restore();
}

const offsetCache = new Map<string, { chars: string[]; x: number[]; w: number[] }>();
// a downloaded font that replaces its stand-in keeps the family name (the same ctx.font) but not the letter widths
onFontReady(() => offsetCache.clear());

/**
 * Where each letter of a word starts (the width of what comes before it, kerning and letter spacing included) and its
 * width, for the font set on `ctx`. Measured once per word, font and spacing: an entrance draws the same words every
 * frame, and measuring every prefix again was O(n²) measureText calls per word per frame. Exported for tests.
 */
export function charOffsets(ctx: TextCanvasContext, text: string): { chars: string[]; x: number[]; w: number[] } {
	const key = `${ctx.font}|${(ctx as { letterSpacing?: string }).letterSpacing ?? ""}|${text}`;
	const hit = offsetCache.get(key);
	if (hit) return hit;
	const chars = Array.from(text);
	const x: number[] = [];
	const w: number[] = [];
	let prefix = "";
	for (const char of chars) {
		x.push(prefix ? ctx.measureText(prefix).width : 0);
		w.push(ctx.measureText(char).width);
		prefix += char;
	}
	if (offsetCache.size > 2000) offsetCache.clear();
	const entry = { chars, x, w };
	offsetCache.set(key, entry);
	return entry;
}

/** The text cut into letters, words or lines, each placed where the whole line puts it and moved by its animator. */
function buildGlyphRuns({
	ctx,
	layout,
	baseFill,
	state,
	highlight,
}: {
	ctx: TextCanvasContext;
	layout: MeasuredTextLayout;
	baseFill: string | CanvasGradient;
	state: GlyphState;
	highlight?: TextPaintStyle["highlight"];
}): TextRun[] {
	const unit = glyphUnit(state);
	const fontPx = layout.scaledFontSize;
	const lineLeft = (line: number) =>
		getLineLeft({ textAlign: layout.textAlign, alignWidth: layout.block.alignWidth, lineWidth: layout.lineWidths[line] });
	const pieces: { line: number; x: number; text: string; width: number; word: number }[] = [];
	if (unit === "line") {
		layout.lines.forEach((text, line) => {
			pieces.push({ line, x: lineLeft(line), text, width: layout.lineWidths[line], word: -1 });
		});
	} else {
		layout.words.forEach((word, wordIndex) => {
			const left = lineLeft(word.line) + word.x;
			if (unit === "word") {
				pieces.push({ line: word.line, x: left, text: word.text, width: word.width, word: wordIndex });
				return;
			}
			const { chars, x, w } = charOffsets(ctx, word.text);
			chars.forEach((char, i) => {
				pieces.push({ line: word.line, x: left + x[i], text: char, width: w[i], word: wordIndex });
			});
		});
	}
	if (pieces.length === 0) return [];
	let blockLeft = Number.POSITIVE_INFINITY;
	let blockRight = Number.NEGATIVE_INFINITY;
	for (const piece of pieces) {
		blockLeft = Math.min(blockLeft, piece.x);
		blockRight = Math.max(blockRight, piece.x + piece.width);
	}
	const span = Math.max(1, blockRight - blockLeft);
	// the spoken word keeps its highlight colour while letters come in (karaoke: the words already sung)
	const active = Math.round(highlight?.index ?? -1);
	const wordColor = (word: number): string | CanvasGradient => {
		if (!highlight || highlight.mode === "none" || highlight.mode === "box" || word < 0 || active < 0) return baseFill;
		if (highlight.mode === "karaoke") return word < active ? highlight.color : baseFill;
		return word === active ? highlight.color : baseFill;
	};
	const lineEm = layout.lineHeightPx / Math.max(1, fontPx);
	return pieces.map((piece, i) => {
		const motion = glyphMotion({ state, i, n: pieces.length, x: (piece.x + piece.width / 2 - blockLeft) / span, lineEm, unit });
		const lineY = getLineY({ layout, line: piece.line });
		return {
			line: piece.line,
			x: piece.x,
			text: piece.text,
			color: wordColor(piece.word),
			scale: motion.scale,
			width: piece.width,
			dx: motion.dx * fontPx,
			dy: motion.dy * fontPx,
			rotate: motion.rotate,
			scaleY: motion.scaleY,
			alpha: motion.alpha,
			clip: motion.masked ? { top: lineY - layout.lineHeightPx * 0.62, height: layout.lineHeightPx * 1.24 } : undefined,
		};
	});
}

export function drawStyledTextLayout({
	ctx,
	layout,
	style,
	background,
	backgroundColor,
	textBaseline = "middle",
	pixelScale = 1,
}: {
	ctx: TextCanvasContext;
	layout: MeasuredTextLayout;
	style: TextPaintStyle;
	background?: ResolvedTextBackgroundLike | null;
	backgroundColor?: string;
	textBaseline?: CanvasTextBaseline;
	/** Current transform scale; canvas shadows ignore the CTM so we apply it. */
	pixelScale?: number;
}): void {
	ctx.font = layout.fontString;
	ctx.textAlign = "left";
	ctx.textBaseline = textBaseline;
	setCanvasLetterSpacing({ ctx, letterSpacingPx: layout.letterSpacing });

	const design = style.design ?? null;
	const geometry = design && layout.lines.length > 0 ? layoutDesign({ ctx, layout, state: design }) : null;
	if (design && geometry) {
		// the press of a button (Subscribe) gives the whole design, letters included
		ctx.save();
		const press = pressScale(design);
		if (press !== 1) {
			const cx = geometry.all.left + geometry.all.width / 2;
			const cy = geometry.all.top + geometry.all.height / 2;
			ctx.translate(cx, cy);
			ctx.scale(press, press);
			ctx.translate(-cx, -cy);
		}
	}

	if (
		background?.enabled &&
		backgroundColor &&
		backgroundColor !== "transparent" &&
		layout.lines.length > 0
	) {
		drawBackground({ ctx, layout, background, backgroundColor });
	}
	if (design && geometry) {
		drawDesignLayers({ ctx, geometry, state: design, over: false, align: layout.textAlign, pixelScale });
		ctx.font = layout.fontString;
		ctx.textAlign = "left";
		ctx.textBaseline = textBaseline;
		setCanvasLetterSpacing({ ctx, letterSpacingPx: layout.letterSpacing });
	}

	const fontPx = layout.scaledFontSize;
	let baseFill: string | CanvasGradient = style.textColor;
	if (style.gradientColor) {
		const top = -layout.block.height / 2;
		const gradient = ctx.createLinearGradient(0, top, 0, top + layout.block.height);
		gradient.addColorStop(0, style.textColor);
		gradient.addColorStop(1, style.gradientColor);
		baseFill = gradient;
	}

	const glyphs = glyphsActive(style.glyphs) ? (style.glyphs as GlyphState) : null;
	const runs = glyphs ? buildGlyphRuns({ ctx, layout, baseFill, state: glyphs, highlight: style.highlight }) : buildRuns({ layout, style, baseFill });
	const highlight = style.highlight;
	const blurPx = (style.blur ?? 0) * fontPx * pixelScale;
	if (blurPx > 0.05) {
		ctx.save();
		ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
	}

	// Active-word plate sits under every glyph.
	if (highlight?.mode === "box" && highlight.index >= 0) {
		const activeIndex = Math.round(highlight.index);
		const active = layout.words[activeIndex];
		if (active) {
			const padX = fontPx * 0.18;
			const padY = fontPx * 0.1;
			const wordBox = (word: MeasuredTextWord) => ({
				centerX:
					getLineLeft({
						textAlign: layout.textAlign,
						alignWidth: layout.block.alignWidth,
						lineWidth: layout.lineWidths[word.line],
					}) +
					word.x +
					word.width / 2,
				lineY: getLineY({ layout, line: word.line }),
				width: word.width + padX * 2,
			});
			const target = wordBox(active);
			const height = layout.lineHeightPx * 0.92 + padY * 2 - fontPx * 0.2;
			// The plate slides from the previous word (6 frames), or springs
			// open (0.9 → 1) on the first word — creative-trends §4.4.
			const age = highlight.age ?? 1;
			const k = Math.min(1, Math.max(0, age / 0.2));
			const ease = 1 - (1 - k) ** 3;
			const previous = activeIndex > 0 ? layout.words[activeIndex - 1] : undefined;
			const from = previous ? wordBox(previous) : target;
			const centerX = from.centerX + (target.centerX - from.centerX) * ease;
			const lineY = from.lineY + (target.lineY - from.lineY) * ease;
			const width = from.width + (target.width - from.width) * ease;
			const grow = previous ? 1 : 0.9 + 0.1 * ease;
			ctx.save();
			ctx.translate(centerX, lineY);
			ctx.scale(highlight.scale * grow, highlight.scale * grow);
			ctx.fillStyle = highlight.color;
			ctx.beginPath();
			ctx.roundRect(-width / 2, -height / 2, width, height, fontPx * 0.18);
			ctx.fill();
			ctx.restore();
		}
	}

	const shadow = style.shadow;
	const applyShadow = () => {
		if (!shadow) return;
		ctx.shadowColor = shadow.color;
		ctx.shadowBlur = (shadow.blurPercent / 100) * fontPx * pixelScale * glowPulse(style.glyphs);
		ctx.shadowOffsetX = (shadow.offsetXPercent / 100) * fontPx * pixelScale;
		ctx.shadowOffsetY = (shadow.offsetYPercent / 100) * fontPx * pixelScale;
	};
	const clearShadow = () => {
		ctx.shadowColor = "transparent";
		ctx.shadowBlur = 0;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;
	};

	if (design && geometry) {
		// copies of the letters behind them: a retro echo, an outlined stack, a hard pixel shadow
		for (const copy of echoCopies(geometry, design)) {
			ctx.save();
			ctx.translate(copy.dx, copy.dy);
			ctx.globalAlpha *= copy.alpha;
			ctx.fillStyle = copy.color;
			ctx.strokeStyle = copy.color;
			ctx.lineWidth = Math.max(1, fontPx * 0.035);
			ctx.lineJoin = "round";
			for (const run of runs) {
				const lineY = getLineY({ layout, line: run.line });
				withRunTransform({ ctx, run, lineY, draw: () => (copy.outline ? ctx.strokeText(run.text, run.x, lineY) : ctx.fillText(run.text, run.x, lineY)) });
			}
			ctx.restore();
		}
	}

	const stroke = style.stroke && style.stroke.widthPercent > 0 ? style.stroke : null;
	if (stroke) {
		ctx.save();
		applyShadow();
		ctx.strokeStyle = stroke.color;
		// Stroke is centred on the outline; the inner half is covered by the fill.
		ctx.lineWidth = (stroke.widthPercent / 100) * fontPx * 2;
		ctx.lineJoin = "round";
		ctx.miterLimit = 2;
		for (const run of runs) {
			const lineY = getLineY({ layout, line: run.line });
			withRunTransform({
				ctx,
				run,
				lineY,
				draw: () => ctx.strokeText(run.text, run.x, lineY),
			});
		}
		ctx.restore();
	}

	ctx.save();
	if (!stroke) applyShadow();
	for (const run of runs) {
		const lineY = getLineY({ layout, line: run.line });
		ctx.fillStyle = run.color;
		if (run.glow) {
			ctx.save();
			ctx.shadowColor = run.glow;
			ctx.shadowBlur = fontPx * 0.6 * pixelScale;
			ctx.shadowOffsetX = 0;
			ctx.shadowOffsetY = 0;
		}
		withRunTransform({
			ctx,
			run,
			lineY,
			draw: () => ctx.fillText(run.text, run.x, lineY),
		});
		if (run.glow) ctx.restore();
		if (run.split && run.split > 0 && run.splitColor) {
			// Karaoke: the sung part of the active word is filled left to right.
			const splitColor = run.splitColor;
			ctx.save();
			clearShadow();
			ctx.beginPath();
			ctx.rect(run.x, lineY - fontPx * 1.5, run.width * run.split, fontPx * 3);
			ctx.clip();
			ctx.fillStyle = splitColor;
			ctx.fillText(run.text, run.x, lineY);
			ctx.restore();
		}
	}
	clearShadow();
	ctx.restore();

	if (highlight?.mode === "underline" && highlight.index >= 0) {
		const word = layout.words[Math.round(highlight.index)];
		if (word) {
			// the bar runs under the spoken word in its first 0.15 s
			const grow = Math.min(1, Math.max(0, (highlight.age ?? 1) / 0.15));
			const left = getLineLeft({ textAlign: layout.textAlign, alignWidth: layout.block.alignWidth, lineWidth: layout.lineWidths[word.line] }) + word.x;
			const y = getLineY({ layout, line: word.line }) + fontPx * 0.52;
			ctx.save();
			clearShadow();
			ctx.fillStyle = highlight.color;
			ctx.beginPath();
			ctx.roundRect(left, y, word.width * (1 - (1 - grow) ** 3), fontPx * 0.1, fontPx * 0.05);
			ctx.fill();
			ctx.restore();
		}
	}

	const shine = shimmerAt(style.glyphs);
	if (shine != null) {
		// a light band sweeping across the letters
		const box = getTextRect({ textAlign: layout.textAlign, block: layout.block });
		const x = box.left + box.width * shine;
		const half = fontPx * 0.45;
		const slant = fontPx * 0.5;
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(x - half + slant, box.top - fontPx);
		ctx.lineTo(x + half + slant, box.top - fontPx);
		ctx.lineTo(x + half - slant, box.top + box.height + fontPx);
		ctx.lineTo(x - half - slant, box.top + box.height + fontPx);
		ctx.closePath();
		ctx.clip();
		ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
		for (const run of runs) {
			const lineY = getLineY({ layout, line: run.line });
			withRunTransform({ ctx, run, lineY, draw: () => ctx.fillText(run.text, run.x, lineY) });
		}
		ctx.restore();
	}

	if (layout.textDecoration !== "none") {
		ctx.fillStyle = baseFill;
		for (let index = 0; index < layout.lines.length; index++) {
			drawTextDecoration({
				ctx,
				textDecoration: layout.textDecoration,
				lineWidth: layout.lineWidths[index],
				lineY: getLineY({ layout, line: index }),
				metrics: layout.lineMetrics[index],
				scaledFontSize: layout.scaledFontSize,
				textAlign: layout.textAlign,
				alignWidth: layout.block.alignWidth,
			});
		}
	}
	if (blurPx > 0.05) ctx.restore();
	if (design && geometry) {
		drawSubText({ ctx, geometry, state: design });
		drawDesignLayers({ ctx, geometry, state: design, over: true, align: layout.textAlign, pixelScale });
		ctx.restore();
		drawDesignLayers({ ctx, geometry, state: design, over: true, align: layout.textAlign, pixelScale, only: ["cursor"] });
	}
}

/** Plain fill (no stroke/shadow); kept for text masks and older callers. */
export function drawMeasuredTextLayout({
	ctx,
	layout,
	textColor,
	background,
	backgroundColor,
	textBaseline = "middle",
}: {
	ctx: TextCanvasContext;
	layout: MeasuredTextLayout;
	textColor: string;
	background?: ResolvedTextBackgroundLike | null;
	backgroundColor?: string;
	textBaseline?: CanvasTextBaseline;
}): void {
	drawStyledTextLayout({
		ctx,
		layout,
		style: { textColor },
		background,
		backgroundColor,
		textBaseline,
	});
}

export function strokeMeasuredTextLayout({
	ctx,
	layout,
	strokeColor,
	strokeWidth,
	textBaseline = "middle",
}: {
	ctx: TextCanvasContext;
	layout: MeasuredTextLayout;
	strokeColor: string;
	strokeWidth: number;
	textBaseline?: CanvasTextBaseline;
}): void {
	ctx.font = layout.fontString;
	ctx.textAlign = "left";
	ctx.textBaseline = textBaseline;
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = strokeWidth;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	setCanvasLetterSpacing({ ctx, letterSpacingPx: layout.letterSpacing });

	for (let index = 0; index < layout.lines.length; index++) {
		ctx.strokeText(
			layout.lines[index],
			getLineLeft({
				textAlign: layout.textAlign,
				alignWidth: layout.block.alignWidth,
				lineWidth: layout.lineWidths[index],
			}),
			getLineY({ layout, line: index }),
		);
	}
}
