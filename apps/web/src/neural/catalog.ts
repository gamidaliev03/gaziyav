// Effects → AI: on-device video AI ported from Kadr (NeuralEffects.swift, Upscaler.swift). Each effect makes a
// processed copy of the clip's media on this Mac (Neural Engine / GPU) and points the clip at it — one ⌘Z
// goes back to the original, which always stays in Media.
//
// Four families (their settings live in the inspector's AI tab) and seven tiles in Effects → AI (a tile is a
// family plus a few preset values: "Blur Background" = Remove Background with the Portrait blur mode).
import { VOICES } from "@/generate/voices";
import type { ModelId } from "@/ondevice/client";
import type { ParamDefinition, ParamValues } from "@/params";

export type NeuralOp = "matte" | "enhance" | "upscale" | "retouch" | "voice-enhance" | "separate" | "voice-change" | "deflicker" | "autocolor" | "colormatch";
export type NeuralFamilyId = "background" | "enhance" | "denoise" | "upscale" | "retouch" | "voiceEnhance" | "separate" | "voiceChange" | "deflicker" | "autoColor" | "colorMatch";

export interface NeuralFamily {
	id: NeuralFamilyId;
	name: string;
	op: NeuralOp;
	params: ParamDefinition[];
	/** Fixed helper options (e.g. the Enhance preset). */
	fixed?: Record<string, string | number>;
	summary: string;
	/** A tool with its own place in the inspector (Retouch, the Audio tools), not in the AI tab's list or Effects → AI. */
	tool?: "video" | "audio";
	/**
	 * The model on this Mac the tool runs on (ondevice/client.ts): downloaded on the first run, inside the tool's own
	 * progress. A function when it depends on the settings (Voice changer: a voice needs the model, an effect doesn't).
	 */
	model?: ModelId | ((values: ParamValues) => ModelId | null);
}

export interface NeuralEffect {
	id: string;
	name: string;
	family: NeuralFamilyId;
	/** Values this tile sets (e.g. mode: "blur"). */
	preset?: ParamValues;
	keywords: string[];
	/** Done-line: "Background removed". */
	done: string;
}

const VIDEO_FAMILIES: Record<"background" | "enhance" | "denoise" | "upscale", NeuralFamily> = {
	background: {
		id: "background",
		name: "Remove Background",
		op: "matte",
		summary: "Apple's on-device person segmentation. Transparent clips show the tracks below.",
		params: [
			{
				key: "mode",
				label: "Background",
				type: "select",
				default: "transparent",
				options: [
					{ value: "transparent", label: "Transparent" },
					{ value: "color", label: "Color" },
					{ value: "blur", label: "Blur" },
				],
			},
			{ key: "color", label: "Color", type: "color", default: "#00CC4D", dependencies: [{ param: "mode", equals: "color" }] },
			{ key: "blur", label: "Blur amount", type: "number", default: 30, min: 0, max: 120, step: 1, dependencies: [{ param: "mode", equals: "blur" }] },
			{ key: "feather", label: "Edge softness", type: "number", default: 2, min: 0, max: 20, step: 0.5 },
			{ key: "edge", label: "Edge position", type: "number", default: 0, min: -10, max: 10, step: 0.5 },
		],
	},
	enhance: {
		id: "enhance",
		name: "Enhance",
		op: "enhance",
		summary: "Denoise, then gentle sharpening, contrast and colour.",
		fixed: { preset: "enhance" },
		params: [
			{ key: "strength", label: "Strength", type: "number", default: 1, min: 0, max: 2, step: 0.05 },
			{ key: "level", label: "Noise level", type: "number", default: 0.02, min: 0, max: 0.1, step: 0.005 },
		],
	},
	denoise: {
		id: "denoise",
		name: "Denoise",
		op: "enhance",
		summary: "Cleans grain from low-light footage.",
		fixed: { preset: "denoise" },
		params: [
			{ key: "level", label: "Noise level", type: "number", default: 0.02, min: 0, max: 0.1, step: 0.005 },
			{ key: "sharpness", label: "Sharpness", type: "number", default: 0.4, min: 0, max: 2, step: 0.05 },
		],
	},
	upscale: {
		id: "upscale",
		name: "Upscale",
		op: "upscale",
		summary: "More pixels with Apple's MetalFX scaler on the GPU (Lanczos where MetalFX is missing).",
		params: [
			{
				key: "scale",
				label: "Factor",
				type: "select",
				default: "2",
				options: [
					{ value: "2", label: "2×" },
					{ value: "4", label: "4×" },
				],
			},
		],
	},
};

/** Voice changer → Voice effects (filters, no model); the server has the same ids (studio/server/audio-ai.ts). */
export const VOICE_EFFECTS = [
	{ id: "chipmunk", name: "Chipmunk" },
	{ id: "deep", name: "Deep" },
	{ id: "monster", name: "Monster" },
	{ id: "robot", name: "Robot" },
	{ id: "whisper", name: "Whisper" },
	{ id: "telephone", name: "Telephone" },
	{ id: "megaphone", name: "Megaphone" },
	{ id: "echo", name: "Echo" },
];

/** Retouch (Video → Retouch) and the AI tools on a clip's sound (Audio tab): the same processed-copy flow as the effects. */
export const TOOL_FAMILIES: Record<"retouch" | "voiceEnhance" | "separate" | "voiceChange" | "deflicker" | "autoColor" | "colorMatch", NeuralFamily> = {
	retouch: {
		id: "retouch",
		name: "Retouch",
		op: "retouch",
		tool: "video",
		model: "retouch",
		summary: "The person's own face restored: sharper eyes, smoother skin.",
		params: [{ key: "strength", label: "Strength", type: "number", default: 0.7, min: 0.1, max: 1, step: 0.05 }],
	},
	voiceEnhance: {
		id: "voiceEnhance",
		name: "Enhance voice",
		op: "voice-enhance",
		tool: "audio",
		model: "denoise",
		summary: "Noise, hum and room taken out of speech.",
		params: [{ key: "strength", label: "Strength", type: "number", default: 1, min: 0.1, max: 1, step: 0.05 }],
	},
	separate: {
		id: "separate",
		name: "Separate voice and music",
		op: "separate",
		tool: "audio",
		// Best: the downloaded model (Demucs; the first run gets it inside its own progress). Quick: what macOS has built in.
		model: (values) => (values.engine === "quick" ? null : "separate"),
		summary: "The clip keeps the voice; the music becomes a clip of its own under it.",
		params: [
			{
				key: "engine",
				label: "Quality",
				type: "select",
				default: "best",
				options: [
					{ value: "best", label: "Best" },
					{ value: "quick", label: "Quick" },
				],
			},
		],
	},
	voiceChange: {
		id: "voiceChange",
		name: "Voice changer",
		op: "voice-change",
		tool: "audio",
		// "ready:…" / "my:…" voices speak through the voice model; the effects (deep, robot…) are filters without one.
		model: (values) => (String(values.voice ?? "").includes(":") ? "voicechange" : null),
		summary: "A voice effect, or the speech in another voice with its own timing and intonation.",
		params: [{ key: "voice", label: "Voice", type: "select", default: "deep", options: VOICE_EFFECTS.map((v) => ({ value: v.id, label: v.name })) }],
	},
	deflicker: {
		id: "deflicker",
		name: "Remove flickers",
		op: "deflicker",
		tool: "video",
		summary: "The brightness evened out from frame to frame (lights on mains power, timelapses).",
		params: [
			{
				key: "amount",
				label: "Amount",
				type: "select",
				default: "medium",
				options: [
					{ value: "light", label: "Light" },
					{ value: "medium", label: "Medium" },
					{ value: "strong", label: "Strong" },
				],
			},
		],
	},
	autoColor: {
		id: "autoColor",
		name: "AI color correction",
		op: "autocolor",
		tool: "video",
		summary: "White balance and levels set by the picture itself, followed smoothly over time.",
		params: [{ key: "strength", label: "Strength", type: "number", default: 0.6, min: 0.1, max: 1, step: 0.05 }],
	},
	colorMatch: {
		id: "colorMatch",
		name: "Color match",
		op: "colormatch",
		tool: "video",
		summary: "The clip's colours brought to a reference picture or clip from Media.",
		// The reference's colours travel as `ref` (a histogram the editor measures, see apply.ts).
		params: [{ key: "strength", label: "Strength", type: "number", default: 0.8, min: 0.1, max: 1, step: 0.05 }],
	},
};
export const FAMILIES: Record<NeuralFamilyId, NeuralFamily> = { ...VIDEO_FAMILIES, ...TOOL_FAMILIES };

export const NEURAL_EFFECTS: NeuralEffect[] = [
	{
		id: "ai.removeBackground",
		name: "Remove Background",
		family: "background",
		preset: { mode: "transparent" },
		keywords: ["cutout", "matte", "person", "segmentation", "green screen", "alpha", "transparent", "neural"],
		done: "Background removed",
	},
	{
		id: "ai.blurBackground",
		name: "Blur Background",
		family: "background",
		preset: { mode: "blur" },
		keywords: ["portrait", "bokeh", "depth", "segmentation", "neural"],
		done: "Background blurred",
	},
	{
		id: "ai.colorBackground",
		name: "Color Background",
		family: "background",
		preset: { mode: "color" },
		keywords: ["solid", "studio", "backdrop", "segmentation", "neural"],
		done: "Background replaced",
	},
	{
		id: "ai.enhance",
		name: "Enhance",
		family: "enhance",
		keywords: ["improve", "auto", "clean", "sharpen", "quality", "denoise", "neural"],
		done: "Enhanced",
	},
	{
		id: "ai.denoise",
		name: "Denoise",
		family: "denoise",
		keywords: ["noise", "grain", "low light", "clean", "neural"],
		done: "Denoised",
	},
	{
		id: "ai.upscale2x",
		name: "Upscale 2×",
		family: "upscale",
		preset: { scale: "2" },
		keywords: ["upscale", "super resolution", "4k", "resolution", "sharpen", "metalfx", "neural"],
		done: "Upscaled 2×",
	},
	{
		id: "ai.upscale4x",
		name: "Upscale 4×",
		family: "upscale",
		preset: { scale: "4" },
		keywords: ["upscale", "super resolution", "8k", "resolution", "metalfx", "neural"],
		done: "Upscaled 4×",
	},
];

/** What a tool's result is called (not tiles: the tools have their own buttons). */
export const TOOL_EFFECTS: NeuralEffect[] = [
	{ id: "ai.retouch", name: "Retouch", family: "retouch", keywords: ["face", "beauty", "skin", "restore"], done: "Face retouched" },
	{ id: "ai.voiceEnhance", name: "Enhance voice", family: "voiceEnhance", keywords: ["noise", "voice", "clean"], done: "Voice enhanced" },
	{ id: "ai.separate", name: "Separate voice and music", family: "separate", keywords: ["vocals", "music", "stems"], done: "Voice and music separated" },
	{ id: "ai.voiceChange", name: "Voice changer", family: "voiceChange", keywords: ["voice", "pitch", "character"], done: "Voice changed" },
	{ id: "ai.deflicker", name: "Remove flickers", family: "deflicker", keywords: ["flicker", "strobe", "timelapse", "lights"], done: "Flicker removed" },
	{ id: "ai.autoColor", name: "AI color correction", family: "autoColor", keywords: ["color", "white balance", "auto", "levels"], done: "Color corrected" },
	{ id: "ai.colorMatch", name: "Color match", family: "colorMatch", keywords: ["color", "match", "grade", "reference"], done: "Colors matched" },
];

export function neuralEffect(id: string): NeuralEffect | undefined {
	return NEURAL_EFFECTS.find((e) => e.id === id) ?? TOOL_EFFECTS.find((e) => e.id === id);
}

/** The name of a Voice changer choice: a voice effect, a ready-made voice ("ready:<id>") or one of My voices ("my:<id>"). */
export function voiceName(voice: string): string {
	const [kind, id] = voice.includes(":") ? voice.split(":", 2) : ["", voice];
	if (kind === "ready") return VOICES.find((v) => v.id === id)?.name ?? id;
	if (kind === "my") return "My voice";
	return VOICE_EFFECTS.find((v) => v.id === id)?.name ?? id;
}

export function familyOf(effectId: string): NeuralFamily | undefined {
	const effect = neuralEffect(effectId);
	return effect ? FAMILIES[effect.family] : undefined;
}

export function defaultParams(family: NeuralFamily): ParamValues {
	return Object.fromEntries(family.params.map((p) => [p.key, p.default]));
}

/** The tile that matches a family's settings (Remove Background in Blur mode → "Blur Background"). */
export function effectFor(family: NeuralFamilyId, values: ParamValues): NeuralEffect {
	const tiles = [...NEURAL_EFFECTS, ...TOOL_EFFECTS].filter((e) => e.family === family);
	return tiles.find((e) => Object.entries(e.preset ?? {}).every(([k, v]) => String(values[k]) === String(v))) ?? tiles[0];
}

export function isVisible(param: ParamDefinition, values: ParamValues): boolean {
	return !param.dependencies?.some((d) => values[d.param] !== d.equals);
}

/** Helper options for the server: the family's fixed options plus the visible settings. */
export function helperOptions(family: NeuralFamily, values: ParamValues): Record<string, string | number> {
	const out: Record<string, string | number> = { ...(family.fixed ?? {}) };
	for (const p of family.params) {
		if (!isVisible(p, values)) continue;
		const v = values[p.key] ?? p.default;
		out[p.key] = p.type === "color" ? String(v).replace(/^#/, "").toUpperCase() : typeof v === "boolean" ? Number(v) : v;
	}
	return out;
}

/** "Remove Background · Blur", "Enhance", "Upscale 4×" — the name in Media and in the inspector. */
export function describe(family: NeuralFamily, values: ParamValues): string {
	if (family.id === "upscale") return `Upscale ${values.scale ?? "2"}×`;
	if (family.id === "voiceChange") return `Voice changer · ${voiceName(String(values.voice ?? "deep"))}`;
	if (family.id !== "background") return family.name;
	const mode = String(values.mode ?? "transparent");
	const option = family.params[0].type === "select" ? family.params[0].options.find((o) => o.value === mode) : undefined;
	return `Remove Background · ${option?.label ?? mode}`;
}
