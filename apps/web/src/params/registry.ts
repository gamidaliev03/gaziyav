import {
	NUMBER_CHANNEL_LAYOUT,
	type LeafChannelLayout,
	type ParamDefinition,
	type ParamValue,
	type ParamValues,
} from "@/params";
import { MIN_TRANSFORM_SCALE } from "@/animation/transform";
import type { BlendMode } from "@/rendering";
import type {
	ElementType,
	TimelineElement,
} from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { DESIGN_OPTIONS, ICON_OPTIONS } from "@/text/design";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/timeline/audio-constants";
import { AUDIO_FX } from "@/sounds/mix/fx";
import {
	CORNER_RADIUS_MAX,
	CORNER_RADIUS_MIN,
} from "@/text/background";
import { LAYER_SHADOW_PARAMS } from "@/shadow/params";

export type ElementParamDefinition<TKey extends string = string> =
	ParamDefinition<TKey> & {
		read?: ({ element }: { element: TimelineElement }) => ParamValue | null;
		write?: ({
			element,
			value,
		}: {
			element: TimelineElement;
			value: ParamValue;
		}) => TimelineElement;
	};

export function buildDefaultParamValues(
	params: readonly ParamDefinition[],
): ParamValues {
	const values: ParamValues = {};
	for (const param of params) {
		values[param.key] = param.default;
	}
	return values;
}

export class DefinitionRegistry<TKey extends string, TDefinition> {
	private definitions = new Map<TKey, TDefinition>();
	private entityName: string;

	constructor(entityName: string) {
		this.entityName = entityName;
	}

	register({
		key,
		definition,
	}: {
		key: TKey;
		definition: TDefinition;
	}): void {
		this.definitions.set(key, definition);
	}

	has(key: TKey): boolean {
		return this.definitions.has(key);
	}

	get(key: TKey): TDefinition {
		const def = this.definitions.get(key);
		if (!def) {
			throw new Error(`Unknown ${this.entityName}: ${key}`);
		}
		return def;
	}

	getAll(): TDefinition[] {
		return Array.from(this.definitions.values());
	}
}

const BLEND_MODE_OPTIONS: Array<{ value: BlendMode; label: string }> = [
	{ value: "normal", label: "Normal" },
	{ value: "darken", label: "Darken" },
	{ value: "multiply", label: "Multiply" },
	{ value: "color-burn", label: "Color Burn" },
	{ value: "lighten", label: "Lighten" },
	{ value: "screen", label: "Screen" },
	{ value: "plus-lighter", label: "Plus Lighter" },
	{ value: "color-dodge", label: "Color Dodge" },
	{ value: "overlay", label: "Overlay" },
	{ value: "soft-light", label: "Soft Light" },
	{ value: "hard-light", label: "Hard Light" },
	{ value: "difference", label: "Difference" },
	{ value: "exclusion", label: "Exclusion" },
	{ value: "hue", label: "Hue" },
	{ value: "saturation", label: "Saturation" },
	{ value: "color", label: "Color" },
	{ value: "luminosity", label: "Luminosity" },
];

const visualElementParams: ElementParamDefinition[] = [
	{
		key: "transform.positionX",
		label: "Position X",
		type: "number",
		default: DEFAULTS.element.transform.position.x,
		min: -100_000,
		max: 100_000,
		step: 1,
	},
	{
		key: "transform.positionY",
		label: "Position Y",
		type: "number",
		default: DEFAULTS.element.transform.position.y,
		min: -100_000,
		max: 100_000,
		step: 1,
	},
	{
		key: "transform.scaleX",
		label: "Scale X",
		type: "number",
		default: DEFAULTS.element.transform.scaleX,
		min: MIN_TRANSFORM_SCALE,
		step: 0.01,
	},
	{
		key: "transform.scaleY",
		label: "Scale Y",
		type: "number",
		default: DEFAULTS.element.transform.scaleY,
		min: MIN_TRANSFORM_SCALE,
		step: 0.01,
	},
	{
		key: "transform.rotate",
		label: "Rotate",
		type: "number",
		default: DEFAULTS.element.transform.rotate,
		min: -360,
		max: 360,
		step: 1,
	},
	{
		key: "opacity",
		label: "Opacity",
		type: "number",
		default: DEFAULTS.element.opacity,
		min: 0,
		max: 1,
		step: 0.01,
	},
	{
		key: "blendMode",
		label: "Blend Mode",
		type: "select",
		default: DEFAULTS.element.blendMode,
		keyframable: false,
		options: BLEND_MODE_OPTIONS,
	},
];

const audioElementParams: ElementParamDefinition[] = [
	{
		key: "volume",
		label: "Volume, dB",
		type: "number",
		default: DEFAULTS.element.volume,
		min: VOLUME_DB_MIN,
		max: VOLUME_DB_MAX,
		step: 0.01,
	},
	// Left ↔ right (src/sounds/mix/pan.ts): heard in preview and export, keyframe-able like the volume.
	{
		key: "pan",
		label: "Pan",
		type: "number",
		default: 0,
		min: -100,
		max: 100,
		step: 1,
	},
	{
		key: "muted",
		label: "Mute",
		type: "boolean",
		default: false,
		keyframable: false,
	},
	// Mix (src/sounds/mix/envelope.ts): the same envelope drives preview and export.
	{
		key: "fadeIn",
		label: "Fade in, s",
		type: "number",
		default: 0,
		min: 0,
		max: 10,
		step: 0.1,
		keyframable: false,
	},
	{
		key: "fadeOut",
		label: "Fade out, s",
		type: "number",
		default: 0,
		min: 0,
		max: 10,
		step: 0.1,
		keyframable: false,
	},
	{
		key: "duckUnderVoice",
		label: "Duck under voice",
		type: "boolean",
		default: false,
		keyframable: false,
	},
	{
		key: "voiceRole",
		label: "This is a voice",
		type: "select",
		default: "auto",
		keyframable: false,
		dependencies: [{ param: "duckUnderVoice", equals: false }],
		options: [
			{ value: "auto", label: "Auto" },
			{ value: "yes", label: "Yes — music ducks under it" },
			{ value: "no", label: "No" },
		],
	},
	// Per-clip effects (sounds/mix/fx.ts): one switch each, rendered once, heard in preview and export.
	...AUDIO_FX.map(
		(fx): ElementParamDefinition => ({
			key: fx.param,
			label: fx.label,
			type: "boolean",
			default: false,
			keyframable: false,
		}),
	),
];

const TEXT_STYLE = DEFAULTS.text.style;

/** Discrete-step numeric channel: keys hold their value until the next key. */
const HOLD_NUMBER_CHANNEL_LAYOUT: LeafChannelLayout<number> = {
	...NUMBER_CHANNEL_LAYOUT,
	component: {
		...NUMBER_CHANNEL_LAYOUT.component,
		defaultInterpolation: "hold",
	},
};

export const TEXT_FONT_WEIGHT_OPTIONS: Array<{ value: string; label: string }> =
	[
		{ value: "300", label: "Light 300" },
		{ value: "normal", label: "Regular 400" },
		{ value: "500", label: "Medium 500" },
		{ value: "600", label: "Semibold 600" },
		{ value: "bold", label: "Bold 700" },
		{ value: "800", label: "Extra bold 800" },
		{ value: "900", label: "Black 900" },
	];

export const TEXT_HIGHLIGHT_MODE_OPTIONS: Array<{
	value: string;
	label: string;
}> = [
	{ value: "none", label: "None" },
	{ value: "color", label: "Word color" },
	{ value: "karaoke", label: "Karaoke" },
	{ value: "box", label: "Word box" },
	{ value: "reveal", label: "Word by word" },
	{ value: "pop", label: "Word pop" },
	{ value: "jump", label: "Word jump" },
	{ value: "rise", label: "Words rise" },
	{ value: "slide", label: "Words fly in" },
	{ value: "glow", label: "Word glow" },
	{ value: "underline", label: "Word underline" },
];

const textElementParams: ElementParamDefinition[] = [
	{
		key: "content",
		label: "Text",
		type: "text",
		default: "Default text",
		keyframable: false,
	},
	{
		key: "fontFamily",
		label: "Font",
		type: "font",
		default: "Arial",
		keyframable: false,
	},
	{
		key: "fontSize",
		label: "Size",
		type: "number",
		default: 15,
		min: 0.5,
		// A title fills a 4K frame at about 300: past that a typed 99999 only hung the text layout (blind test 05.11).
		max: 500,
		step: 0.1,
	},
	{
		key: "color",
		label: "Color",
		type: "color",
		default: "#ffffff",
	},
	{
		key: "textAlign",
		label: "Alignment",
		type: "select",
		default: "center",
		keyframable: false,
		options: [
			{ value: "left", label: "Left" },
			{ value: "center", label: "Center" },
			{ value: "right", label: "Right" },
		],
	},
	{
		key: "fontWeight",
		label: "Weight",
		type: "select",
		default: "normal",
		keyframable: false,
		options: TEXT_FONT_WEIGHT_OPTIONS,
	},
	{
		key: "fontStyle",
		label: "Style",
		type: "select",
		default: "normal",
		keyframable: false,
		options: [
			{ value: "normal", label: "Regular" },
			{ value: "italic", label: "Italic" },
		],
	},
	{
		key: "textDecoration",
		label: "Decoration",
		type: "select",
		default: "none",
		keyframable: false,
		options: [
			{ value: "none", label: "None" },
			{ value: "underline", label: "Underline" },
			{ value: "line-through", label: "Strikethrough" },
		],
	},
	{
		key: "textTransform",
		label: "Case",
		type: "select",
		default: TEXT_STYLE.textTransform,
		keyframable: false,
		options: [
			{ value: "none", label: "As typed" },
			{ value: "uppercase", label: "UPPERCASE" },
			{ value: "lowercase", label: "lowercase" },
			{ value: "capitalize", label: "Title Case" },
		],
	},
	{
		key: "letterSpacing",
		label: "Letter spacing",
		type: "number",
		default: DEFAULTS.text.letterSpacing,
		min: -100,
		step: 0.1,
	},
	{
		key: "lineHeight",
		label: "Line height",
		type: "number",
		default: DEFAULTS.text.lineHeight,
		min: 0.1,
		step: 0.1,
	},
	{
		key: "stroke.enabled",
		label: "Stroke",
		type: "boolean",
		default: TEXT_STYLE.stroke.enabled,
		keyframable: false,
	},
	{
		key: "stroke.color",
		label: "Stroke color",
		type: "color",
		default: TEXT_STYLE.stroke.color,
		dependencies: [{ param: "stroke.enabled", equals: true }],
	},
	{
		key: "stroke.width",
		label: "Stroke width, % of size",
		type: "number",
		default: TEXT_STYLE.stroke.width,
		min: 0,
		max: 60,
		step: 1,
		dependencies: [{ param: "stroke.enabled", equals: true }],
	},
	{
		key: "shadow.enabled",
		label: "Shadow",
		type: "boolean",
		default: TEXT_STYLE.shadow.enabled,
		keyframable: false,
	},
	{
		key: "shadow.color",
		label: "Shadow color",
		type: "color",
		default: TEXT_STYLE.shadow.color,
		dependencies: [{ param: "shadow.enabled", equals: true }],
	},
	{
		key: "shadow.blur",
		label: "Shadow blur, % of size",
		type: "number",
		default: TEXT_STYLE.shadow.blur,
		min: 0,
		max: 200,
		step: 1,
		dependencies: [{ param: "shadow.enabled", equals: true }],
	},
	{
		key: "shadow.offsetX",
		label: "Shadow X, % of size",
		type: "number",
		default: TEXT_STYLE.shadow.offsetX,
		min: -200,
		max: 200,
		step: 1,
		dependencies: [{ param: "shadow.enabled", equals: true }],
	},
	{
		key: "shadow.offsetY",
		label: "Shadow Y, % of size",
		type: "number",
		default: TEXT_STYLE.shadow.offsetY,
		min: -200,
		max: 200,
		step: 1,
		dependencies: [{ param: "shadow.enabled", equals: true }],
	},
	{
		key: "gradient.enabled",
		label: "Gradient",
		type: "boolean",
		default: TEXT_STYLE.gradient.enabled,
		keyframable: false,
	},
	{
		key: "gradient.color",
		label: "Bottom color",
		type: "color",
		default: TEXT_STYLE.gradient.color,
		dependencies: [{ param: "gradient.enabled", equals: true }],
	},
	{
		key: "box.width",
		label: "Box width, % of frame",
		type: "number",
		default: TEXT_STYLE.box.width,
		min: 0,
		max: 100,
		step: 1,
		keyframable: false,
	},
	{
		key: "box.maxLines",
		label: "Max lines",
		type: "number",
		default: TEXT_STYLE.box.maxLines,
		min: 0,
		max: 20,
		step: 1,
		keyframable: false,
	},
	{
		key: "box.autoFit",
		label: "Auto-fit size",
		type: "boolean",
		default: TEXT_STYLE.box.autoFit,
		keyframable: false,
	},
	{
		key: "highlight.mode",
		label: "Word highlight",
		type: "select",
		default: TEXT_STYLE.highlight.mode,
		keyframable: false,
		options: TEXT_HIGHLIGHT_MODE_OPTIONS,
	},
	{
		key: "highlight.color",
		label: "Highlight color",
		type: "color",
		default: TEXT_STYLE.highlight.color,
	},
	{
		key: "highlight.index",
		label: "Active word",
		type: "number",
		default: TEXT_STYLE.highlight.index,
		min: -1,
		step: 1,
		channels: HOLD_NUMBER_CHANNEL_LAYOUT,
	},
	{
		key: "highlight.scale",
		label: "Active word scale",
		type: "number",
		default: TEXT_STYLE.highlight.scale,
		min: 0.5,
		max: 3,
		step: 0.01,
	},
	{
		key: "background.enabled",
		label: "Background",
		type: "boolean",
		default: DEFAULTS.text.background.enabled,
		keyframable: false,
	},
	{
		key: "background.color",
		label: "Background color",
		type: "color",
		default: DEFAULTS.text.background.color,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.cornerRadius",
		label: "Corner radius",
		type: "number",
		default: DEFAULTS.text.background.cornerRadius,
		min: CORNER_RADIUS_MIN,
		max: CORNER_RADIUS_MAX,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.paddingX",
		label: "Padding X",
		type: "number",
		default: DEFAULTS.text.background.paddingX,
		min: 0,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.paddingY",
		label: "Padding Y",
		type: "number",
		default: DEFAULTS.text.background.paddingY,
		min: 0,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.offsetX",
		label: "Background offset X",
		type: "number",
		default: DEFAULTS.text.background.offsetX,
		min: -100_000,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	{
		key: "background.offsetY",
		label: "Background offset Y",
		type: "number",
		default: DEFAULTS.text.background.offsetY,
		min: -100_000,
		step: 1,
		dependencies: [{ param: "background.enabled", equals: true }],
	},
	// Channels written by animation presets (src/animation/presets.ts). They are
	// applied on top of the element transform/opacity, so moving or scaling the
	// text by hand never fights with an applied animation.
	{
		key: "anim.offsetX",
		label: "Animation offset X",
		type: "number",
		default: TEXT_STYLE.anim.offsetX,
		min: -100_000,
		step: 0.1,
	},
	{
		key: "anim.offsetY",
		label: "Animation offset Y",
		type: "number",
		default: TEXT_STYLE.anim.offsetY,
		min: -100_000,
		step: 0.1,
	},
	{
		key: "anim.scale",
		label: "Animation scale",
		type: "number",
		default: TEXT_STYLE.anim.scale,
		min: 0,
		step: 0.001,
	},
	{
		key: "anim.rotate",
		label: "Animation rotation",
		type: "number",
		default: TEXT_STYLE.anim.rotate,
		min: -3600,
		step: 0.01,
	},
	{
		key: "anim.opacity",
		label: "Animation opacity",
		type: "number",
		default: TEXT_STYLE.anim.opacity,
		min: 0,
		max: 1,
		step: 0.001,
	},
	{
		key: "anim.reveal",
		label: "Animation reveal",
		type: "number",
		default: TEXT_STYLE.anim.reveal,
		min: 0,
		max: 1,
		step: 0.001,
	},
	// Preset bookkeeping (which preset is applied and for how long). Not shown
	// as raw fields; the Animation tab reads and writes them.
	...(["in", "out", "loop"] as const).flatMap(
		(slot): ElementParamDefinition[] => [
			{
				key: `anim.${slot}`,
				label: `Animation ${slot}`,
				type: "text",
				default: "none",
				keyframable: false,
			},
			{
				key: `anim.${slot}Duration`,
				label: `Duration ${slot}`,
				type: "number",
				default: 0.5,
				min: 0.05,
				max: 30,
				step: 0.01,
				keyframable: false,
			},
		],
	),
	{
		key: "caption.style",
		label: "Caption style",
		type: "text",
		default: "",
		keyframable: false,
	},
	// Word start times in seconds from the clip start ("0 0.32 0.61"), written
	// by caption insertion; drives the active-word highlight.
	{
		key: "caption.words",
		label: "Word timings",
		type: "text",
		default: "",
		keyframable: false,
	},
	// The id of the clip the captions were heard in: they follow it wherever it goes (timeline/linkage.ts).
	{
		key: "caption.source",
		label: "Caption source",
		type: "text",
		default: "",
		keyframable: false,
	},
	// Caption styles with emoji accents (src/text/emoji-accents.ts).
	{ key: "caption.emoji", label: "Emoji accents", type: "boolean", default: false, keyframable: false },
	// Motion titles (src/text/design.ts): the layers around the text, their colours, the second line and the icon.
	{ key: "design.id", label: "Design", type: "select", default: "", keyframable: false, options: DESIGN_OPTIONS },
	{ key: "design.accent", label: "Accent", type: "color", default: "#ffd60a", keyframable: false },
	{ key: "design.plate", label: "Plate", type: "color", default: "#111111", keyframable: false },
	{ key: "design.sub", label: "Second line", type: "text", default: "", keyframable: false },
	{ key: "design.subColor", label: "Second line color", type: "color", default: "#ffffff", keyframable: false },
	{ key: "design.icon", label: "Icon", type: "select", default: "", keyframable: false, options: ICON_OPTIONS },
	// The text's entrance starts after the design's plate (seconds).
	{ key: "anim.inDelay", label: "In delay", type: "number", default: 0, min: 0, max: 10, step: 0.05, keyframable: false },
];

export const elementParamRegistry = new DefinitionRegistry<
	ElementType,
	readonly ElementParamDefinition[]
>("element params");

elementParamRegistry.register({
	key: "video",
	definition: [...visualElementParams, ...LAYER_SHADOW_PARAMS, ...audioElementParams],
});
elementParamRegistry.register({ key: "image", definition: [...visualElementParams, ...LAYER_SHADOW_PARAMS] });
elementParamRegistry.register({
	key: "text",
	definition: [...textElementParams, ...visualElementParams],
});
// Drop shadow (shadow/layer-shadow.ts): the layers' own; a text keeps its letters' shadow above.
elementParamRegistry.register({
	key: "sticker",
	definition: [...visualElementParams, ...LAYER_SHADOW_PARAMS],
});
elementParamRegistry.register({
	key: "graphic",
	definition: [...visualElementParams, ...LAYER_SHADOW_PARAMS],
});
elementParamRegistry.register({ key: "audio", definition: audioElementParams });
elementParamRegistry.register({ key: "effect", definition: [] });

/** A compound clip's params: a layer's, plus the sound of a clip (its sound is what is inside it: montage/compound-sound.ts). */
// No blend mode: a compound would need its whole picture blended at once (the renderer has no group of layers yet), so
// the row stays off the screen rather than change nothing.
const compoundParams: readonly ElementParamDefinition[] = [
	...visualElementParams.filter((param) => param.key !== "blendMode"),
	...LAYER_SHADOW_PARAMS,
	...audioElementParams,
];

export function getElementParams({
	element,
}: {
	element: TimelineElement;
}): readonly ElementParamDefinition[] {
	if (element.type === "graphic" && element.params?.compound === true) return compoundParams;
	return elementParamRegistry.has(element.type)
		? elementParamRegistry.get(element.type)
		: [];
}

export function getBuiltInElementParams({
	type,
}: {
	type: ElementType;
}): readonly ElementParamDefinition[] {
	return elementParamRegistry.has(type) ? elementParamRegistry.get(type) : [];
}

export function getElementParam({
	element,
	key,
}: {
	element: TimelineElement;
	key: string;
}): ElementParamDefinition | null {
	return (
		getElementParams({ element }).find((param) => param.key === key) ?? null
	);
}

export function readElementParamValue({
	element,
	param,
}: {
	element: TimelineElement;
	param: ElementParamDefinition;
}): ParamValue | null {
	if (param.read) {
		return param.read({ element });
	}
	if ("params" in element) {
		return element.params[param.key] ?? param.default;
	}
	return null;
}

export function writeElementParamValue({
	element,
	param,
	value,
}: {
	element: TimelineElement;
	param: ElementParamDefinition;
	value: ParamValue;
}): TimelineElement {
	if (param.write) {
		return param.write({ element, value });
	}
	if ("params" in element) {
		return {
			...element,
			params: {
				...element.params,
				[param.key]: value,
			},
		};
	}
	return element;
}

