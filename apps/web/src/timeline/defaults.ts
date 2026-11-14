import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import type { TTimelineViewState } from "@/project/types";
import type { BlendMode, Transform } from "@/rendering";
import { ZERO_MEDIA_TIME } from "@/wasm";
import type { TextElement } from "./types";

const defaultTransform: Transform = {
	scaleX: 1,
	scaleY: 1,
	position: { x: 0, y: 0 },
	rotate: 0,
};

const defaultOpacity = 1;
const defaultBlendMode: BlendMode = "normal";
const defaultVolume = 0;

const defaultTextLetterSpacing = 0;
const defaultTextLineHeight = 1.2;

const defaultTextBackground = {
	enabled: false,
	color: "#000000",
	cornerRadius: 0,
	paddingX: 30,
	paddingY: 42,
	offsetX: 0,
	offsetY: 0,
};

/**
 * Defaults for the extended text style (stroke, shadow, gradient, box/auto-fit,
 * active-word highlight and preset animation channels). Distances for stroke
 * and shadow are percentages of the rendered font size so they scale with
 * auto-fit and any canvas size.
 */
const defaultTextStyle = {
	textTransform: "none",
	stroke: { enabled: false, color: "#000000", width: 12 },
	shadow: {
		enabled: false,
		color: "#00000099",
		blur: 12,
		offsetX: 0,
		offsetY: 6,
	},
	gradient: { enabled: false, color: "#ffd60a" },
	box: { width: 0, maxLines: 0, autoFit: false },
	highlight: { mode: "none", color: "#ffd60a", index: -1, scale: 1 },
	anim: {
		offsetX: 0,
		offsetY: 0,
		scale: 1,
		rotate: 0,
		opacity: 1,
		reveal: 1,
	},
} as const;

const defaultTextElement: Omit<TextElement, "id"> = {
	type: "text",
	name: "Text",
	duration: DEFAULT_NEW_ELEMENT_DURATION,
	startTime: ZERO_MEDIA_TIME,
	trimStart: ZERO_MEDIA_TIME,
	trimEnd: ZERO_MEDIA_TIME,
	params: {
		content: "Default text",
		fontSize: 15,
		fontFamily: "Arial",
		color: "#ffffff",
		textAlign: "center",
		fontWeight: "normal",
		fontStyle: "normal",
		textDecoration: "none",
		letterSpacing: defaultTextLetterSpacing,
		lineHeight: defaultTextLineHeight,
		"background.enabled": defaultTextBackground.enabled,
		"background.color": defaultTextBackground.color,
		"background.cornerRadius": defaultTextBackground.cornerRadius,
		"background.paddingX": defaultTextBackground.paddingX,
		"background.paddingY": defaultTextBackground.paddingY,
		"background.offsetX": defaultTextBackground.offsetX,
		"background.offsetY": defaultTextBackground.offsetY,
		"transform.positionX": defaultTransform.position.x,
		"transform.positionY": defaultTransform.position.y,
		"transform.scaleX": defaultTransform.scaleX,
		"transform.scaleY": defaultTransform.scaleY,
		"transform.rotate": defaultTransform.rotate,
		opacity: defaultOpacity,
		blendMode: defaultBlendMode,
	},
};

const defaultTimelineViewState: TTimelineViewState = {
	zoomLevel: 1,
	scrollLeft: 0,
	playheadTime: ZERO_MEDIA_TIME,
};

export const DEFAULTS = {
	element: {
		transform: defaultTransform,
		opacity: defaultOpacity,
		blendMode: defaultBlendMode,
		volume: defaultVolume,
	},
	text: {
		letterSpacing: defaultTextLetterSpacing,
		lineHeight: defaultTextLineHeight,
		background: defaultTextBackground,
		style: defaultTextStyle,
		element: defaultTextElement,
	},
	timeline: {
		viewState: defaultTimelineViewState,
	},
};
