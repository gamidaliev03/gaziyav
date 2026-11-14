// Motion titles: the layers a designer puts around a line of text — a plate, an accent bar or line, a frame, an icon,
// a second line (a job title under a name), a badge, a cursor that presses the button — each with its own entrance.
// A text clip names its design in `design.id`; its colours, second line and icon are ordinary params, so the
// inspector edits them and ⌘Z undoes them. Sizes are in em of the text's font, times in seconds at the design's
// own pace, scaled by the clip's In duration (a slower In slows the whole choreography).
import type { TextElement } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { getTextRect } from "./layout";
import type { TextCanvasContext } from "./layout";
import type { MeasuredTextLayout } from "./primitives";

/** A colour: a design token (the clip's own colours) or a literal. */
export type Fill = "accent" | "plate" | "text" | "sub" | (string & {});
export type Side = "left" | "right" | "top" | "bottom";
/** What a layer wraps: the main text, the second line, or both (with the icons that sit inside). */
export type Around = "main" | "sub" | "all";

export interface LayerMotion {
	type: "wipeX" | "wipeXR" | "wipeY" | "grow" | "pop" | "slideX" | "slideY" | "fade" | "draw" | "spin" | "swing";
	/** Seconds after the clip start. */
	delay: number;
	dur: number;
	/** Em the slide starts from. */
	from?: number;
}

interface LayerBase {
	motion?: LayerMotion;
	/** Drawn over the text (icons, cursor); otherwise under it. */
	over?: boolean;
}

export interface PlateLayer extends LayerBase {
	kind: "plate";
	shape?: "rect" | "tag" | "bubble" | "circle" | "burst" | "ribbon" | "marker" | "sun";
	around?: Around;
	/** Padding, em (x, y). */
	pad?: [number, number];
	/** Corner radius, em; 99 = a pill. */
	radius?: number;
	fill: Fill;
	/** Second colour: a left-to-right (top-to-bottom for the sun) gradient. */
	fill2?: Fill;
	stroke?: Fill;
	strokeWidth?: number;
	shadow?: boolean;
	/** Glow radius, em. */
	glow?: number;
	/** Horizontal slant (0.1 ≈ 6°). */
	skew?: number;
	/** Degrees. */
	rotate?: number;
	/** Em. */
	offset?: [number, number];
	/** Degrees per second (a burst turning slowly). */
	spin?: number;
	/** Colour after the press (a subscribed button). */
	pressed?: Fill;
}

export interface BarLayer extends LayerBase {
	kind: "bar";
	side: Side;
	around?: Around;
	/** Thickness, em. */
	size: number;
	gap: number;
	fill: Fill;
	/** Em beyond the wrapped box at both ends. */
	extend?: number;
}

export interface LineLayer extends LayerBase {
	kind: "line";
	at: "under" | "over" | "flank" | "between";
	around?: Around;
	size: number;
	gap: number;
	fill: Fill;
	/** Flank: each line's length, em. Under / over: share of the box width (1 = as wide). */
	length?: number;
	glow?: number;
	/** A hand-drawn wave instead of a straight line. */
	wave?: boolean;
}

export interface FrameLayer extends LayerBase {
	kind: "frame";
	around?: Around;
	pad: [number, number];
	radius?: number;
	size: number;
	color: Fill;
	glow?: number;
	/** Corner brackets: arm length as a share of the shorter side; omitted = the whole outline. */
	corners?: number;
	/** A pointer under the bottom-left corner (a callout box). */
	tail?: boolean;
	/** A ring (a round badge) instead of a rounded box. */
	round?: boolean;
	/** Flickers on like a neon tube. */
	flicker?: boolean;
}

export interface IconLayer extends LayerBase {
	kind: "icon";
	/** Icon id; omitted = the clip's `design.icon`. */
	icon?: string;
	side: Side;
	around?: Around;
	/** Em. */
	size: number;
	gap: number;
	color: Fill;
	/** A disc behind the icon. */
	disc?: Fill;
	/** Sits inside the plate (the «all» box grows to hold it). */
	inside?: boolean;
	/** Rings after the press (a bell). */
	ring?: boolean;
	/** Bobs up and down (an arrow pointing at the link). */
	bob?: boolean;
}

export interface EchoLayer extends LayerBase {
	kind: "echo";
	count: number;
	/** Em per copy. */
	dx: number;
	dy: number;
	colors: Fill[];
	/** Outlined copies (a stack) instead of filled ones. */
	outline?: boolean;
	/** Copies on both sides (above and below). */
	mirror?: boolean;
}

export interface CalloutLayer extends LayerBase {
	kind: "callout";
	/** The anchor dot, em from the main text's bottom-left corner. */
	dx: number;
	dy: number;
	color: Fill;
	size: number;
}

export interface CursorLayer extends LayerBase {
	kind: "cursor";
	color: Fill;
	/** Where it comes from, em from the press point. */
	from: [number, number];
}

export interface SparkLayer extends LayerBase {
	kind: "sparks";
	count: number;
	color: Fill;
	/** How far they fly, em. */
	spread: number;
	/** Burst around the icon instead of the text. */
	fromIcon?: boolean;
}

export type DesignLayer = PlateLayer | BarLayer | LineLayer | FrameLayer | IconLayer | EchoLayer | CalloutLayer | CursorLayer | SparkLayer;

export interface SubSpec {
	/** Font size as a share of the main text's. */
	size: number;
	weight?: string;
	font?: string;
	color?: Fill;
	/** Em between the main text and the second line. */
	gap: number;
	align?: "left" | "center" | "right";
	/** Em of letter spacing. */
	tracking?: number;
	upper?: boolean;
	italic?: boolean;
	/** Crossed out (an old price). */
	strike?: boolean;
	place?: "below" | "above";
	motion?: LayerMotion;
}

export interface TextDesign {
	id: string;
	label: string;
	layers: DesignLayer[];
	sub?: SubSpec;
	/** The In duration the choreography was timed for, s. */
	nominal: number;
	/** Seconds: the cursor presses the button. */
	pressAt?: number;
	/** Numbers in the text count up during the entrance. */
	count?: boolean;
}

const m = (type: LayerMotion["type"], delay: number, dur: number, from?: number): LayerMotion => ({ type, delay, dur, from });

export const DESIGNS: TextDesign[] = [
	// Lower thirds: a name and a job.
	{
		id: "lt-bar",
		label: "Accent bar",
		nominal: 0.7,
		sub: { size: 0.56, weight: "500", color: "sub", gap: 0.28, align: "left", motion: m("slideY", 0.42, 0.5, 0.45) },
		layers: [
			{ kind: "plate", around: "all", pad: [0.6, 0.42], radius: 0.1, fill: "plate", shadow: true, motion: m("wipeX", 0.06, 0.5) },
			{ kind: "bar", side: "left", around: "all", size: 0.13, gap: 0.6, fill: "accent", extend: 0.42, motion: m("wipeY", 0, 0.38) },
		],
	},
	{
		id: "lt-pill",
		label: "Two pills",
		nominal: 0.7,
		sub: { size: 0.56, weight: "600", color: "sub", gap: 0.42, align: "left", motion: m("slideX", 0.34, 0.45, -0.6) },
		layers: [
			{ kind: "plate", around: "main", pad: [0.5, 0.2], radius: 99, fill: "plate", shadow: true, motion: m("wipeX", 0, 0.42) },
			{ kind: "plate", around: "sub", pad: [0.42, 0.16], radius: 99, fill: "accent", motion: m("wipeX", 0.24, 0.42) },
		],
	},
	{
		id: "lt-line",
		label: "Minimal line",
		nominal: 0.7,
		sub: { size: 0.5, weight: "400", color: "sub", gap: 0.5, align: "left", tracking: 0.12, upper: true, motion: m("slideY", 0.4, 0.5, -0.35) },
		layers: [{ kind: "line", at: "between", around: "all", size: 0.05, gap: 0.25, fill: "accent", length: 1.08, motion: m("wipeX", 0, 0.55) }],
	},
	{
		id: "lt-glass",
		label: "Glass card",
		nominal: 0.7,
		sub: { size: 0.55, weight: "500", color: "sub", gap: 0.22, align: "left", motion: m("fade", 0.42, 0.45) },
		layers: [
			{ kind: "plate", around: "all", pad: [0.62, 0.48], radius: 0.38, fill: "plate", stroke: "#ffffff66", strokeWidth: 0.035, shadow: true, motion: m("grow", 0, 0.45) },
			{ kind: "icon", side: "left", around: "all", size: 1.25, gap: 0.42, color: "#ffffff", disc: "accent", inside: true, motion: m("pop", 0.18, 0.5) },
		],
	},
	{
		id: "lt-split",
		label: "Split block",
		nominal: 0.7,
		sub: { size: 0.55, weight: "600", color: "sub", gap: 0.3, align: "left", motion: m("slideX", 0.3, 0.45, -0.5) },
		layers: [
			{ kind: "plate", around: "main", pad: [0.45, 0.22], radius: 0.06, fill: "accent", motion: m("wipeX", 0, 0.42) },
			{ kind: "plate", around: "sub", pad: [0.45, 0.2], radius: 0.06, fill: "plate", motion: m("wipeX", 0.2, 0.42) },
		],
	},
	// Callouts and counters.
	{
		id: "callout-line",
		label: "Callout",
		nominal: 0.8,
		sub: { size: 0.55, weight: "500", color: "sub", gap: 0.32, align: "left", motion: m("fade", 0.62, 0.4) },
		layers: [{ kind: "callout", dx: -1.6, dy: 1.7, color: "accent", size: 0.07, motion: m("draw", 0, 0.6) }],
	},
	{
		id: "callout-box",
		label: "Callout box",
		nominal: 0.7,
		layers: [
			{ kind: "plate", around: "all", pad: [0.5, 0.32], radius: 0.18, fill: "plate", motion: m("fade", 0.15, 0.4) },
			{ kind: "frame", around: "all", pad: [0.5, 0.32], radius: 0.18, size: 0.06, color: "accent", tail: true, motion: m("draw", 0, 0.6) },
		],
	},
	{
		id: "counter",
		label: "Counter",
		nominal: 1.2,
		count: true,
		sub: { size: 0.36, weight: "600", color: "sub", gap: 0.18, tracking: 0.18, upper: true, motion: m("slideY", 0.3, 0.6, 0.5) },
		layers: [{ kind: "line", at: "between", around: "all", size: 0.06, gap: 0.12, fill: "accent", length: 0.55, motion: m("wipeX", 0.2, 0.7) }],
	},
	// Social.
	{
		id: "subscribe",
		label: "Subscribe button",
		nominal: 0.5,
		pressAt: 1.15,
		layers: [
			{ kind: "plate", around: "all", pad: [0.62, 0.36], radius: 99, fill: "accent", pressed: "#2c2c30", shadow: true, motion: m("pop", 0, 0.5) },
			{ kind: "icon", icon: "bell", side: "right", around: "main", size: 1.05, gap: 0.38, color: "#ffffff", inside: true, ring: true, motion: m("pop", 0.15, 0.45) },
			{ kind: "cursor", color: "#ffffff", from: [2.6, 2.4], over: true, motion: m("fade", 0.45, 0.65) },
		],
	},
	{
		id: "like",
		label: "Like",
		nominal: 0.5,
		layers: [
			{ kind: "plate", around: "all", pad: [0.55, 0.32], radius: 99, fill: "plate", shadow: true, motion: m("pop", 0, 0.45) },
			{ kind: "icon", icon: "heart", side: "left", around: "main", size: 1.1, gap: 0.32, color: "accent", inside: true, motion: m("pop", 0.22, 0.55) },
			{ kind: "sparks", count: 8, color: "accent", spread: 1.1, fromIcon: true, over: true, motion: m("fade", 0.3, 0.6) },
		],
	},
	{
		id: "link-bio",
		label: "Link in bio",
		nominal: 0.5,
		layers: [
			{ kind: "plate", around: "all", pad: [0.55, 0.3], radius: 99, fill: "plate", stroke: "accent", strokeWidth: 0.05, motion: m("grow", 0, 0.45) },
			{ kind: "icon", icon: "link", side: "left", around: "main", size: 0.95, gap: 0.3, color: "accent", inside: true, motion: m("pop", 0.15, 0.45) },
			{ kind: "icon", icon: "arrowDown", side: "bottom", around: "all", size: 1.1, gap: 0.55, color: "accent", bob: true, motion: m("slideY", 0.3, 0.5, -0.6) },
		],
	},
	{
		id: "follow",
		label: "Follow",
		nominal: 0.5,
		layers: [
			{ kind: "plate", around: "all", pad: [0.5, 0.3], radius: 99, fill: "plate", stroke: "#ffffff55", strokeWidth: 0.04, motion: m("wipeX", 0, 0.45) },
			{ kind: "icon", icon: "plus", side: "right", around: "main", size: 1, gap: 0.35, color: "#ffffff", disc: "accent", inside: true, motion: m("spin", 0.25, 0.5) },
		],
	},
	{
		id: "comment",
		label: "Speech bubble",
		nominal: 0.5,
		layers: [{ kind: "plate", shape: "bubble", around: "all", pad: [0.6, 0.38], radius: 0.45, fill: "plate", shadow: true, motion: m("pop", 0, 0.5) }],
	},
	// Sale and ads.
	{
		id: "price-burst",
		label: "Price burst",
		nominal: 0.55,
		sub: { size: 0.34, weight: "800", color: "sub", gap: 0.1, upper: true, tracking: 0.08, motion: m("fade", 0.3, 0.4) },
		layers: [
			{ kind: "plate", shape: "burst", around: "all", pad: [0.4, 0.4], fill: "accent", spin: 10, shadow: true, motion: m("spin", 0, 0.6) },
			{ kind: "sparks", count: 10, color: "#ffffff", spread: 1.4, over: true, motion: m("fade", 0.35, 0.65) },
		],
	},
	{
		id: "price-tag",
		label: "Price tag",
		nominal: 0.6,
		sub: { size: 0.42, weight: "600", color: "sub", gap: 0.04, strike: true, place: "above", motion: m("fade", 0.35, 0.4) },
		layers: [{ kind: "plate", shape: "tag", around: "all", pad: [0.55, 0.3], radius: 0.16, fill: "accent", shadow: true, motion: m("swing", 0, 0.7) }],
	},
	{
		id: "sale-ribbon",
		label: "Ribbon",
		nominal: 0.55,
		layers: [
			{ kind: "plate", shape: "ribbon", around: "all", pad: [0.85, 0.24], fill: "accent", fill2: "plate", skew: 0.12, shadow: true, motion: m("wipeX", 0, 0.45) },
			{ kind: "sparks", count: 6, color: "#ffffff", spread: 0.9, over: true, motion: m("fade", 0.4, 0.6) },
		],
	},
	{
		id: "badge-circle",
		label: "Round badge",
		nominal: 0.6,
		layers: [
			{ kind: "plate", shape: "circle", around: "all", pad: [0.5, 0.5], fill: "accent", shadow: true, motion: m("spin", 0, 0.55) },
			{ kind: "frame", around: "all", pad: [0.32, 0.32], radius: 99, round: true, size: 0.05, color: "#ffffff", motion: m("draw", 0.25, 0.6) },
		],
	},
	{
		id: "cta-button",
		label: "Button",
		nominal: 0.5,
		layers: [
			{ kind: "plate", around: "all", pad: [0.65, 0.36], radius: 99, fill: "accent", fill2: "plate", shadow: true, motion: m("pop", 0, 0.5) },
			{ kind: "icon", icon: "arrowRight", side: "right", around: "main", size: 0.9, gap: 0.32, color: "#ffffff", inside: true, motion: m("slideX", 0.2, 0.45, -0.5) },
		],
	},
	// Titles and trends.
	{
		id: "marker",
		label: "Marker",
		nominal: 0.6,
		layers: [{ kind: "plate", shape: "marker", around: "main", pad: [0.24, 0.06], fill: "accent", rotate: -1.6, skew: -0.06, motion: m("wipeX", 0.05, 0.45) }],
	},
	{
		id: "underline",
		label: "Underline",
		nominal: 0.6,
		layers: [{ kind: "line", at: "under", around: "main", size: 0.11, gap: 0.12, fill: "accent", length: 1, motion: m("wipeX", 0.25, 0.5) }],
	},
	{
		id: "box-reveal",
		label: "Box reveal",
		nominal: 0.7,
		layers: [{ kind: "plate", around: "main", pad: [0.4, 0.14], radius: 0.04, fill: "accent", motion: m("wipeX", 0, 0.4) }],
	},
	{
		id: "title-sub",
		label: "Title and subtitle",
		nominal: 0.8,
		sub: { size: 0.32, weight: "500", color: "sub", gap: 0.55, tracking: 0.42, upper: true, motion: m("fade", 0.55, 0.6) },
		layers: [{ kind: "line", at: "between", around: "main", size: 0.03, gap: 0.27, fill: "accent", length: 0.3, motion: m("wipeX", 0.35, 0.55) }],
	},
	{
		id: "flank",
		label: "Flank lines",
		nominal: 0.8,
		layers: [{ kind: "line", at: "flank", around: "main", size: 0.03, gap: 0.45, fill: "accent", length: 1.6, motion: m("wipeX", 0.3, 0.6) }],
	},
	{
		id: "brackets",
		label: "Brackets",
		nominal: 0.7,
		layers: [{ kind: "frame", around: "all", pad: [0.55, 0.38], size: 0.045, color: "accent", corners: 0.28, motion: m("draw", 0, 0.6) }],
	},
	{
		id: "chapter",
		label: "Chapter",
		nominal: 0.8,
		sub: { size: 0.42, weight: "700", color: "accent", gap: 0.32, tracking: 0.3, place: "above", motion: m("slideY", 0, 0.5, 0.4) },
		layers: [{ kind: "line", at: "between", around: "all", size: 0.035, gap: 0.16, fill: "accent", length: 0.22, motion: m("wipeX", 0.2, 0.5) }],
	},
	{
		id: "stack",
		label: "Stack",
		nominal: 0.6,
		layers: [{ kind: "echo", count: 2, dx: 0, dy: 1.02, colors: ["text", "text"], outline: true, mirror: true, motion: m("slideY", 0.2, 0.55) }],
	},
	// Neon.
	{
		id: "neon-frame",
		label: "Neon frame",
		nominal: 0.8,
		layers: [{ kind: "frame", around: "all", pad: [0.6, 0.42], radius: 0.4, size: 0.06, color: "accent", glow: 0.55, flicker: true, motion: m("draw", 0, 0.7) }],
	},
	{
		id: "neon-line",
		label: "Neon underline",
		nominal: 0.8,
		layers: [{ kind: "line", at: "under", around: "main", size: 0.06, gap: 0.22, fill: "accent", length: 0.9, glow: 0.5, motion: m("wipeX", 0.3, 0.6) }],
	},
	// Retro.
	{
		id: "retro-echo",
		label: "Echo",
		nominal: 0.6,
		layers: [{ kind: "echo", count: 4, dx: 0.055, dy: 0.055, colors: ["#ff3d7f", "#ffb800", "#00c2ff", "#7c4dff"], motion: m("slideX", 0.15, 0.6) }],
	},
	{
		id: "retro-sun",
		label: "Sunset",
		nominal: 0.7,
		layers: [{ kind: "plate", shape: "sun", around: "main", pad: [0.15, 0.9], fill: "accent", fill2: "plate", offset: [0, -0.15], motion: m("slideY", 0, 0.7, 0.8) }],
	},
	{
		id: "pixel-shadow",
		label: "Pixel shadow",
		nominal: 0.5,
		layers: [{ kind: "echo", count: 1, dx: 0.12, dy: 0.12, colors: ["accent"], motion: m("fade", 0.1, 0.3) }],
	},
	// Minimal and handwritten.
	{
		id: "label-dot",
		label: "Label",
		nominal: 0.5,
		layers: [{ kind: "icon", icon: "dot", side: "left", around: "main", size: 0.55, gap: 0.42, color: "accent", motion: m("pop", 0, 0.45) }],
	},
	{
		id: "thin-frame",
		label: "Thin frame",
		nominal: 0.7,
		layers: [{ kind: "frame", around: "all", pad: [0.65, 0.42], size: 0.025, color: "accent", motion: m("draw", 0, 0.8) }],
	},
	{
		id: "quote-mark",
		label: "Quote",
		nominal: 0.7,
		sub: { size: 0.5, weight: "600", color: "sub", gap: 0.45, align: "left", motion: m("fade", 0.5, 0.45) },
		layers: [{ kind: "icon", icon: "quote", side: "top", around: "main", size: 1.3, gap: 0.2, color: "accent", motion: m("pop", 0, 0.5) }],
	},
	{
		id: "scribble",
		label: "Scribble underline",
		nominal: 0.7,
		layers: [{ kind: "line", at: "under", around: "main", size: 0.07, gap: 0.08, fill: "accent", length: 1.04, wave: true, motion: m("draw", 0.45, 0.6) }],
	},
	{
		id: "sticker",
		label: "Sticker",
		nominal: 0.5,
		layers: [{ kind: "plate", around: "main", pad: [0.42, 0.26], radius: 0.3, fill: "plate", rotate: -3, shadow: true, motion: m("pop", 0, 0.5) }],
	},
];

const BY_ID = new Map(DESIGNS.map((design) => [design.id, design]));
export const getDesign = (id: unknown): TextDesign | undefined => (typeof id === "string" ? BY_ID.get(id) : undefined);

export const DESIGN_OPTIONS = [{ value: "", label: "None" }, ...DESIGNS.map((design) => ({ value: design.id, label: design.label }))];

/** Vector icons on a 24-unit grid (drawn here, no icon font): `fill` shapes, or strokes 2 units wide. */
export const ICONS: Record<string, { d: string; stroke?: boolean }> = {
	bell: { d: "M12 2.6a6.2 6.2 0 0 0-6.2 6.2v4.1L3.9 15.8v1.3h16.2v-1.3l-1.9-2.9V8.8A6.2 6.2 0 0 0 12 2.6zM9.6 18.4a2.4 2.4 0 0 0 4.8 0z" },
	heart: { d: "M12 21.2s-7.9-4.8-10-9.6C.5 8 2.7 3.9 6.6 3.9c2.2 0 3.7 1.2 5.4 3.1 1.7-1.9 3.2-3.1 5.4-3.1 3.9 0 6.1 4.1 4.6 7.7-2.1 4.8-10 9.6-10 9.6z" },
	play: { d: "M8 4.8v14.4L19.6 12z" },
	star: { d: "M12 2.4l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6-4.9-4.6 6.6-.8z" },
	check: { d: "M4.5 12.6l4.8 4.8L19.5 7.2", stroke: true },
	plus: { d: "M12 5v14M5 12h14", stroke: true },
	arrowRight: { d: "M4 12h15M13 5.5l6.5 6.5-6.5 6.5", stroke: true },
	arrowDown: { d: "M12 4v15M5.5 13l6.5 6.5 6.5-6.5", stroke: true },
	link: { d: "M10.2 13.8a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7l-1.4 1.4M13.8 10.2a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1.4-1.4", stroke: true },
	fire: { d: "M12.6 2.2c.6 3.4-1.6 5-3.3 7C7.8 11 6.4 12.9 6.4 15.6a5.6 5.6 0 0 0 11.2 0c0-2.5-1.1-4.4-2.6-5.9-.2 1.6-1 2.8-2.3 3.4.5-4-.5-8.3-.1-10.9z" },
	pin: { d: "M12 2.2a7.2 7.2 0 0 0-7.2 7.2c0 5.4 7.2 12.4 7.2 12.4s7.2-7 7.2-12.4A7.2 7.2 0 0 0 12 2.2zm0 10a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6z" },
	bolt: { d: "M13.4 2L4.6 13.6h6.2L9.8 22l8.8-11.6h-6.2z" },
	cart: { d: "M3 4h2.6l2.3 10.6h10.2L20.4 7.4H7M10 19.6a1.2 1.2 0 1 0 0 .1M17 19.6a1.2 1.2 0 1 0 0 .1", stroke: true },
	gift: { d: "M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1.5-3.5-6-3.5-5 0M12 7c1.5-3.5 6-3.5 5 0", stroke: true },
	mic: { d: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5V21", stroke: true },
	user: { d: "M12 12.2a4.4 4.4 0 1 0 0-8.8 4.4 4.4 0 0 0 0 8.8zM3.8 21c.6-4.2 4-6.6 8.2-6.6s7.6 2.4 8.2 6.6z" },
	quote: { d: "M4 17.5c0-4.6 1.6-8.6 5.6-10.9l1.2 1.6C8.6 9.7 7.6 11.6 7.5 13.4H10V19H4zM13.5 17.5c0-4.6 1.6-8.6 5.6-10.9l1.2 1.6c-2.2 1.5-3.2 3.4-3.3 5.2h2.5V19h-6z" },
	dot: { d: "M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z" },
	cursor: { d: "M5.2 2.8l13.6 8.1-6.1 1.5 3.6 6.6-2.7 1.4-3.5-6.6-4.9 4z" },
};

export const ICON_OPTIONS = [
	{ value: "", label: "Design's own" },
	...Object.keys(ICONS)
		.filter((id) => id !== "cursor")
		.map((id) => ({ value: id, label: id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) })),
];

export interface DesignState {
	spec: TextDesign;
	colors: { accent: string; plate: string; sub: string; text: string };
	sub: string;
	icon: string;
	family: string;
	weight: string;
	italic: boolean;
	/** Seconds since the clip start. */
	t: number;
	/** Time scale: the clip's In duration ÷ the design's own. */
	k: number;
	/** Where the In starts (s). */
	inDelay: number;
	/** 0…1 through the clip's exit (layers rewind with it). */
	outQ: number;
}

const str = (v: unknown, fallback: string) => (typeof v === "string" && v !== "" ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** The design of a text clip on this frame, or null for plain text. */
export function resolveDesignState({ element, localTime, textColor }: { element: Pick<TextElement, "params" | "duration">; localTime: number; textColor: string }): DesignState | null {
	const params = element.params as Record<string, unknown>;
	const spec = getDesign(params["design.id"]);
	if (!spec) return null;
	const t = Math.max(0, localTime) / TICKS_PER_SECOND;
	const total = Math.max(0, element.duration) / TICKS_PER_SECOND;
	const inDuration = Math.max(0.05, num(params["anim.inDuration"], spec.nominal));
	const outKind = str(params["anim.out"], "none");
	const outDuration = Math.max(0.05, num(params["anim.outDuration"], 0.4));
	// the same window as the letters' Out (animation/presets.ts): the whole clip when there is no In, else 40 %
	const inKind = str(params["anim.in"], "none");
	const fitOut = Math.min(outDuration, total * (inKind === "none" ? 1 : 0.4));
	const outQ = outKind === "none" || fitOut <= 0 ? 0 : Math.min(1, Math.max(0, 1 - (total - t) / fitOut));
	return {
		spec,
		colors: {
			accent: str(params["design.accent"], "#ffd60a"),
			plate: str(params["design.plate"], "#111111"),
			sub: str(params["design.subColor"], "#ffffff"),
			text: textColor,
		},
		sub: typeof params["design.sub"] === "string" ? (params["design.sub"] as string) : "",
		icon: str(params["design.icon"], ""),
		family: str(params.fontFamily, "Golos Text"),
		weight: str(params.fontWeight, "700"),
		italic: params.fontStyle === "italic",
		t,
		k: Math.min(3, Math.max(0.25, inDuration / spec.nominal)),
		inDelay: Math.max(0, num(params["anim.inDelay"], 0)),
		outQ,
	};
}

const TOKENS = new Set(["accent", "plate", "sub", "text"]);
export const fillOf = (fill: Fill | undefined, state: DesignState): string =>
	fill && TOKENS.has(fill) ? state.colors[fill as keyof DesignState["colors"]] : (fill ?? state.colors.accent);

/** 0…1 through a layer's own entrance on this frame, rewound by the clip's exit. */
export function layerProgress(motion: LayerMotion | undefined, state: DesignState): number {
	const exit = 1 - state.outQ;
	if (!motion) return exit;
	const p = (state.t - motion.delay * state.k) / Math.max(0.01, motion.dur * state.k);
	return Math.min(exit, p <= 0 ? 0 : p >= 1 ? 1 : p);
}

/** Seconds since the press (negative before it), or null for a design without one. */
export const sincePress = (state: DesignState): number | null => (state.spec.pressAt == null ? null : state.t - state.spec.pressAt * state.k);

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface DesignGeometry {
	fontPx: number;
	main: Rect;
	sub: Rect | null;
	subLines: { text: string; width: number }[];
	subPx: number;
	subFont: string;
	subTracking: number;
	/** Main text, second line and the icons that sit inside. */
	all: Rect;
	icons: Map<IconLayer, Rect>;
}

export const union = (a: Rect, b: Rect): Rect => {
	const left = Math.min(a.left, b.left);
	const top = Math.min(a.top, b.top);
	return { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(a.top + a.height, b.top + b.height) - top };
};
export const inflate = (r: Rect, x: number, y: number): Rect => ({ left: r.left - x, top: r.top - y, width: r.width + 2 * x, height: r.height + 2 * y });

export function subFontOf(state: DesignState, px: number): string {
	const sub = state.spec.sub;
	const family = sub?.font ?? state.family;
	return `${sub?.italic || state.italic ? "italic " : ""}${sub?.weight ?? "500"} ${px.toFixed(2)}px "${family}", "Golos Text", sans-serif`;
}

/** Where every layer sits at rest (local px, the text's anchor at 0,0). */
export function layoutDesign({ ctx, layout, state }: { ctx: TextCanvasContext; layout: MeasuredTextLayout; state: DesignState }): DesignGeometry {
	const fontPx = layout.scaledFontSize;
	const main = getTextRect({ textAlign: layout.textAlign, block: layout.block });
	const spec = state.spec.sub;
	let sub: Rect | null = null;
	let subLines: { text: string; width: number }[] = [];
	const subPx = fontPx * (spec?.size ?? 0.5);
	const subFont = subFontOf(state, subPx);
	const subTracking = (spec?.tracking ?? 0) * subPx;
	if (spec && state.sub.trim() !== "") {
		ctx.save();
		ctx.font = subFont;
		if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${subTracking}px`;
		subLines = state.sub.split("\n").map((line) => {
			const text = spec.upper ? line.toUpperCase() : line;
			return { text, width: ctx.measureText(text).width };
		});
		ctx.restore();
		const width = Math.max(0, ...subLines.map((line) => line.width));
		const height = subLines.length * subPx * 1.25;
		const align = spec.align ?? layout.textAlign;
		const left = align === "left" ? main.left : align === "right" ? main.left + main.width - width : main.left + (main.width - width) / 2;
		const top = spec.place === "above" ? main.top - spec.gap * fontPx - height : main.top + main.height + spec.gap * fontPx;
		sub = { left, top, width, height };
	}
	const content = sub ? union(main, sub) : main;
	const icons = new Map<IconLayer, Rect>();
	let all = content;
	for (const layer of state.spec.layers) {
		if (layer.kind !== "icon") continue;
		const box = layer.around === "main" ? main : content;
		const size = layer.size * fontPx;
		const gap = layer.gap * fontPx;
		const cx = layer.side === "left" ? box.left - gap - size / 2 : layer.side === "right" ? box.left + box.width + gap + size / 2 : box.left + box.width / 2;
		const cy = layer.side === "top" ? box.top - gap - size / 2 : layer.side === "bottom" ? box.top + box.height + gap + size / 2 : box.top + box.height / 2;
		const rect = { left: cx - size / 2, top: cy - size / 2, width: size, height: size };
		icons.set(layer, rect);
		if (layer.inside) all = union(all, rect);
	}
	return { fontPx, main, sub, subLines, subPx, subFont, subTracking, all, icons };
}

export const boxOf = (geometry: DesignGeometry, around: Around | undefined): Rect =>
	around === "main" ? geometry.main : around === "sub" ? (geometry.sub ?? geometry.main) : geometry.all;

/** Everything the design covers at rest (the clip's selection box). */
export function designExtent(geometry: DesignGeometry, state: DesignState): Rect {
	const em = geometry.fontPx;
	let extent = geometry.all;
	if (geometry.sub) extent = union(extent, geometry.sub);
	for (const layer of state.spec.layers) {
		const box = "around" in layer ? boxOf(geometry, layer.around) : geometry.all;
		if (layer.kind === "plate" || layer.kind === "frame") {
			const [px, py] = layer.pad ?? [0, 0];
			let r = inflate(box, px * em, py * em);
			if ((layer.kind === "plate" && (layer.shape === "circle" || layer.shape === "burst" || layer.shape === "sun")) || (layer.kind === "frame" && layer.round)) {
				const radius = Math.max(r.width, r.height) / 2;
				const cx = r.left + r.width / 2;
				const cy = r.top + r.height / 2;
				r = { left: cx - radius, top: cy - radius, width: radius * 2, height: radius * 2 };
			}
			extent = union(extent, r);
		} else if (layer.kind === "bar") {
			const size = layer.size * em;
			const gap = layer.gap * em;
			const ext = (layer.extend ?? 0) * em;
			const r =
				layer.side === "left"
					? { left: box.left - gap - size, top: box.top - ext, width: size, height: box.height + 2 * ext }
					: layer.side === "right"
						? { left: box.left + box.width + gap, top: box.top - ext, width: size, height: box.height + 2 * ext }
						: layer.side === "top"
							? { left: box.left - ext, top: box.top - gap - size, width: box.width + 2 * ext, height: size }
							: { left: box.left - ext, top: box.top + box.height + gap, width: box.width + 2 * ext, height: size };
			extent = union(extent, r);
		} else if (layer.kind === "icon") {
			const r = geometry.icons.get(layer);
			if (r) extent = union(extent, r);
		} else if (layer.kind === "callout") {
			extent = union(extent, { left: geometry.main.left + layer.dx * em - em * 0.2, top: geometry.main.top, width: 1, height: geometry.main.height + layer.dy * em + em * 0.2 });
		} else if (layer.kind === "line" && layer.at === "flank") {
			const length = (layer.length ?? 1) * em + layer.gap * em;
			extent = union(extent, inflate(box, length, 0));
		}
	}
	return extent;
}

/** Numbers in the text count up from 0 (a counter): `p` is 0…1 through the count. Keeps the digit grouping. */
export function countUp(content: string, p: number): string {
	if (p >= 1) return content;
	return content.replace(/\d+(?:[\u00a0\u202f ,.]\d{3})*/g, (token) => {
		const separator = token.match(/[\u00a0\u202f ,.]/)?.[0] ?? "";
		const value = Number(token.replace(/[^\d]/g, ""));
		const now = Math.round(value * p);
		if (!separator) return String(now);
		return String(now).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
	});
}

/** Count-up progress of a counter design on this frame. */
export function countProgress(state: DesignState): number {
	if (!state.spec.count) return 1;
	const start = state.inDelay;
	const span = 1.1 * state.k;
	const p = (state.t - start) / span;
	if (p <= 0) return 0;
	if (p >= 1) return 1;
	return 1 - 2 ** (-10 * p);
}
