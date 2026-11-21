// What the user's presets do in the editor: Gaziyav AI designs one (the AI Composition agent for a title or plate,
// a quick style call for captions), a preset goes onto the timeline at the playhead, and a clip from the timeline
// is kept as a preset.
import { BatchCommand, InsertElementCommand } from "@/commands";
import type { EditorCore } from "@/core";
import { KIND_BY_ID, propsFromParams } from "@/montage/catalog";
import { isAiLayer, isComposition } from "@/montage/flatten";
import { layoutDefaults, runAgent } from "@/montage/run-agent";
import { DEFAULT_STYLE, styleOf } from "@/montage/styles";
import type { PropValue } from "@/montage/types";
import { isCaptionElement } from "@/subtitles/apply-style";
import { buildPresetElement, settlePlayhead } from "@/text/insert-preset";
import type { TextPreset } from "@/text/presets";
import type { CreateGraphicElement, TextElement, TimelineElement, TScene } from "@/timeline/types";
import { generateUUID } from "@/utils/id";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { useLang } from "@/i18n";
import { type LayersPreset, type PresetLayer, type TextStylePreset, USER_PREFIX, type UserCaptionStyle, type UserTextPreset } from "./user-presets";

const sec = (ticks: number) => ticks / TICKS_PER_SECOND;
const ticks = (seconds: number) => mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });

/** Kinds that only make sense across a whole composition with its speech (they need the words of the video). */
const NOT_A_PRESET = new Set(["Captions"]);
/** Editor-only params of an AI layer: the speech words and the transform belong to the clip, not to the look. */
const CLIP_ONLY = new Set(["words"]);

/** The request Gaziyav AI gets: the user's words, and what a preset is. */
export function presetRequest(description: string): string {
	return [
		`Design one reusable on-screen element for the user's own library of titles and plates: ${description.trim()}`,
		"It is a preset kept for many videos: no speech to follow, so any text is a short placeholder in the language of the request that the user will replace.",
		"One element only (it may be built from a few layers), on a transparent background: no captions, no full-frame scene, no film finish, no progress bar, no sound effects.",
		"Make it look finished on its own: an entrance, a calm hold and an exit within about 4 seconds.",
	].join("\n");
}

/** Layers of a finished run as a preset (times from its own start), or null when nothing in it can be kept. */
export function presetFromPlan({
	layers,
	description,
	style,
	id = `${USER_PREFIX}${generateUUID()}`,
	now = Date.now(),
}: {
	layers: { kind: string; from: number; to: number; props: Record<string, PropValue> }[];
	description: string;
	style: { id: string; accent: string };
	id?: string;
	now?: number;
}): LayersPreset | null {
	const kept = layers.filter((layer) => !NOT_A_PRESET.has(layer.kind) && layer.to > layer.from);
	if (!kept.length) return null;
	const start = Math.min(...kept.map((layer) => layer.from));
	const presetLayers: PresetLayer[] = kept.map((layer) => {
		const props: Record<string, PropValue> = { accent: style.accent, style: style.id };
		for (const [key, value] of Object.entries(layer.props)) if (!CLIP_ONLY.has(key)) props[key] = value;
		return { kind: layer.kind, from: layer.from - start, to: layer.to - start, props };
	});
	return {
		id,
		type: "layers",
		name: presetName({ layers: presetLayers, description }),
		createdAt: now,
		duration: Math.max(...presetLayers.map((layer) => layer.to)),
		layers: presetLayers,
	};
}

/** A short name: the element's own text, else the first words of the description. */
export function presetName({ layers, description }: { layers: PresetLayer[]; description: string }): string {
	for (const layer of layers) {
		for (const key of ["text", "title", "name", "label"]) {
			const value = layer.props[key];
			if (typeof value === "string" && value && !value.startsWith("json:")) {
				return value.replace(/[*\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 22);
			}
		}
	}
	const words = description.replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
	return words.slice(0, 22) || "My preset";
}

/** What the run is doing, as the tile says it (RU in i18n/ru-services.ts); null: keep the line it shows. */
export function stepOf(log: string): string | null {
	if (/^Quick/.test(log)) return "Putting the plate together…";
	if (/^(Full|Planning|Plan:)/.test(log)) return "Thinking it over…";
	if (/^(Searching|Picking|Your media|Using your picture)/.test(log)) return "Looking for pictures…";
	if (/^Writing/.test(log)) return "Writing the animation…";
	if (/^(Looking at the frames|Art director)/.test(log)) return "Checking the frames…";
	if (/^Fixing/.test(log)) return "Fixing a detail…";
	if (/^Done/.test(log)) return "Almost done…";
	return null;
}

/** Gaziyav AI designs a title or plate (the AI Composition agent, in Remotion) and it becomes a preset. */
export async function designLayerPreset({
	editor,
	description,
	signal,
	onStep,
}: {
	editor: EditorCore;
	description: string;
	signal: AbortSignal;
	onStep: (step: string) => void;
}): Promise<LayersPreset> {
	const settings = editor.project.getActive().settings;
	const style = styleOf(DEFAULT_STYLE);
	const fps = Math.round((settings.fps.numerator / settings.fps.denominator) * 100) / 100;
	const plan = await runAgent(
		{
			request: presetRequest(description),
			preset: true,
			brief: description.trim().slice(0, 300),
			uiLang: useLang.getState().lang,
			mode: "variation",
			force: "auto",
			style: style.id,
			width: settings.canvasSize.width,
			height: settings.canvasSize.height,
			fps,
			duration: 5,
			playhead: 0,
			alpha: true,
			clips: [],
			words: [],
			onScreen: [],
			face: null,
			history: [],
			media: [],
			provided: [],
			layers: [],
		},
		signal,
		(lines) => {
			// One short line per step, in the interface's words (the run's own log is English and technical).
			const step = stepOf(lines[lines.length - 1] ?? "");
			if (step) onStep(step);
		},
	);
	if (plan.question) throw new Error(plan.question.text);
	const preset = presetFromPlan({ layers: plan.layers, description, style });
	if (!preset) throw new Error("Gaziyav AI made nothing to keep. Describe it a little differently.");
	return preset;
}

/** Gaziyav AI designs a caption style (fonts, colours, the active word) from the user's words. */
export async function designCaptionStyle({ description, signal }: { description: string; signal: AbortSignal }): Promise<UserCaptionStyle> {
	let response: Response;
	try {
		response = await fetch("/api/text/caption-style", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Studio": "1" },
			body: JSON.stringify({ description }),
			signal,
		});
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		throw new Error("Gaziyav's local server is not responding. Restart Gaziyav.");
	}
	const data = (await response.json().catch(() => ({}))) as { style?: UserCaptionStyle; error?: string };
	if (!data.style) throw new Error(data.error || "Gaziyav AI couldn't make the style. Try again.");
	return data.style;
}

/** AI layers of a preset as clips starting at `at` seconds. */
export function layerClips(preset: LayersPreset, at: number): CreateGraphicElement[] {
	// A kind this version doesn't have (a preset from a newer Gaziyav) is left out rather than drawn as nothing.
	return preset.layers.filter((layer) => KIND_BY_ID.has(layer.kind)).map((layer) => {
		const kind = KIND_BY_ID.get(layer.kind);
		const label = layer.kind === "Custom" ? String(layer.props.component || "Motion") : (kind?.label ?? layer.kind);
		return {
			type: "graphic",
			name: `${label} · ${preset.name}`,
			definitionId: `ai.${layer.kind}`,
			startTime: ticks(at + layer.from),
			duration: ticks(Math.max(0.3, layer.to - layer.from)),
			trimStart: ticks(0),
			trimEnd: ticks(0),
			params: { ...(kind ? layoutDefaults(kind.fields) : {}), ...layer.props },
		};
	});
}

/** The built-in preset shape of a saved text look, on a frame of the given height. */
export function textPresetOf(preset: TextStylePreset, canvasHeight: number): TextPreset {
	const scale = preset.canvasHeight > 0 ? canvasHeight / preset.canvasHeight : 1;
	const params: Record<string, string | number | boolean> = { ...preset.params };
	for (const key of ["background.paddingX", "background.paddingY"]) {
		if (typeof params[key] === "number") params[key] = Math.round((params[key] as number) * scale);
	}
	return { id: preset.id, name: preset.name, group: "Titles", content: preset.content, y: preset.y, duration: preset.duration, params };
}

/** Puts a preset at the playhead, one undo step. */
export async function insertUserTextPreset({ editor, preset }: { editor: EditorCore; preset: UserTextPreset }): Promise<void> {
	if (!editor.project.getActiveOrNull()) return;
	const at = sec(editor.playback.getCurrentTime());
	if (preset.type === "layers") {
		const commands = layerClips(preset, at).map((element) => new InsertElementCommand({ element, placement: { mode: "auto" } }));
		if (!commands.length) return;
		editor.command.execute({ command: commands.length === 1 ? commands[0] : new BatchCommand(commands) });
		return;
	}
	const settings = editor.project.getActive().settings;
	const textPreset = textPresetOf(preset, settings.canvasSize.height);
	const { element, start, duration } = await buildPresetElement({ editor, preset: textPreset });
	element.params["transform.positionX"] = Math.round(preset.x * settings.canvasSize.width);
	editor.timeline.insertElement({ element, placement: { mode: "auto" } });
	settlePlayhead({ editor, preset: textPreset, start, duration });
}

/** Whether a clip can be kept as a preset: an AI layer or a whole AI Composition, or a title (not a caption). */
export const canSaveAsPreset = (element: TimelineElement) =>
	isAiLayer(element) || isComposition(element) || (element.type === "text" && !isCaptionElement(element));

/** The clips a preset is made of: the AI layers inside a composition, the clip itself otherwise. */
export function clipsForPreset({ element, scenes }: { element: TimelineElement; scenes: TScene[] }): TimelineElement[] {
	if (!isComposition(element)) return [element];
	const scene = scenes.find((candidate) => candidate.id === element.params.sceneId);
	if (!scene) return [];
	const { overlay, main } = scene.tracks;
	return [...overlay, main].flatMap((track) => track.elements as TimelineElement[]).filter((clip) => isAiLayer(clip));
}

/**
 * A preset from timeline clips: the AI layers among them (with their times), or the first title's look.
 * Null when none of them can be kept.
 */
export function presetFromClips({
	elements,
	canvas,
	id = `${USER_PREFIX}${generateUUID()}`,
	now = Date.now(),
}: {
	elements: TimelineElement[];
	canvas: { width: number; height: number };
	id?: string;
	now?: number;
}): UserTextPreset | null {
	const ai = elements.filter((element) => isAiLayer(element) && !NOT_A_PRESET.has(element.definitionId.slice(3)));
	if (ai.length) {
		const start = Math.min(...ai.map((element) => element.startTime));
		const layers: PresetLayer[] = ai.map((element) => {
			const props: Record<string, PropValue> = {};
			for (const [key, value] of Object.entries(propsFromParams(element.params))) if (!CLIP_ONLY.has(key)) props[key] = value;
			return {
				kind: (element as { definitionId: string }).definitionId.slice(3),
				from: sec(element.startTime - start),
				to: sec(element.startTime - start + element.duration),
				props,
			};
		});
		return {
			id,
			type: "layers",
			name: presetName({ layers, description: ai[0].name }),
			createdAt: now,
			duration: Math.max(...layers.map((layer) => layer.to)),
			layers,
		};
	}
	const text = elements.find((element): element is TextElement => element.type === "text" && !isCaptionElement(element));
	if (!text) return null;
	const params: Record<string, PropValue> = {};
	for (const [key, value] of Object.entries(text.params)) {
		if (key === "content" || key === "transform.positionX" || key === "transform.positionY") continue;
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") params[key] = value;
	}
	const content = String(text.params.content ?? "");
	return {
		id,
		type: "text",
		name: (content.replace(/\s+/g, " ").trim() || text.name).slice(0, 22),
		createdAt: now,
		duration: sec(text.duration),
		content,
		x: canvas.width ? Number(text.params["transform.positionX"] ?? 0) / canvas.width : 0,
		y: canvas.height ? Number(text.params["transform.positionY"] ?? 0) / canvas.height : 0,
		canvasHeight: canvas.height,
		params,
	};
}
