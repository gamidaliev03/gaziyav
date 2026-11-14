import { generatorOf } from "@/generators/document";
import {
	AiMagicIcon,
	ColorsIcon,
	DashboardSpeed02Icon,
	FaceIdIcon,
	MagicWand05Icon,
	Mic01Icon,
	Move01Icon,
	PaintBrush01Icon,
	ScissorIcon,
	Shapes01Icon,
	SlidersHorizontalIcon,
	TextIcon,
	VolumeHighIcon,
	Wrench01Icon,
	LayerMask01Icon,
	Target02Icon,
	VoiceIdIcon,
	ClosedCaptionIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@/components/ui/icon";
import { COLOR_EFFECT_TYPE } from "@/effects/definitions/studio/color";
import { isAiDefinition } from "@/montage/catalog";
import { COMPOSITION_DEF } from "@/montage/compositions";
import type { TimelineElement } from "@/timeline";
import { getInspectorSections, type InspectorTabId } from "./slots";

/** What the panel calls the selected thing; decides which tabs it gets and in what order. */
export type ElementKind = "video" | "image" | "sticker" | "shape" | "ai" | "text" | "audio" | "effect";

export function elementKind(element: TimelineElement): ElementKind {
	switch (element.type) {
		case "graphic":
			return isAiDefinition(element.definitionId) ? "ai" : "shape";
		default:
			return element.type;
	}
}

/**
 * One rule for every clip (docs/EDITOR-MAP.md): Basic (where it sits) · Cutout (what part of the picture shows) ·
 * Color · Effects (the ones applied to it) · Motion · Fix · Speed · Audio · Retouch · AI. Every function has one home;
 * a tab with nothing for the clip is left out, so a sticker or a text gets the subset that applies.
 */
const TAB_ORDER: Record<ElementKind, InspectorTabId[]> = {
	video: ["basic", "cutout", "color", "effects", "animation", "fix", "speed", "audio", "retouch", "ai"],
	image: ["basic", "cutout", "color", "effects", "animation", "fix", "retouch", "ai"],
	sticker: ["basic", "color", "effects", "animation"],
	shape: ["shape", "basic", "cutout", "color", "effects", "animation"],
	ai: ["ai", "basic", "cutout", "color", "effects", "animation"],
	text: ["text", "style", "basic", "color", "animation", "tts"],
	audio: ["basic", "speed", "ai"],
	effect: ["effects"],
};

/** Tab ids of earlier versions (kept in the store per kind, used by older code) → the tab that holds them now. */
const LEGACY_TAB: Partial<Record<string, InspectorTabId>> = {
	masks: "cutout",
	tracking: "animation",
	bubble: "style",
	wordart: "style",
	captions: "style",
	lipsync: "ai",
};

/** The tab a stored or requested id stands for today. */
export const currentTabId = (id: string | undefined): InspectorTabId | undefined => (id ? (LEGACY_TAB[id] ?? (id as InspectorTabId)) : undefined);

/** The clip's own tab: an audio clip's is its sound. */
const BASIC_LABEL: Partial<Record<ElementKind, string>> = { audio: "Audio" };

const TAB_LABEL: Record<InspectorTabId, string> = {
	basic: "Basic",
	text: "Text",
	shape: "Shape",
	audio: "Audio",
	speed: "Speed",
	masks: "Mask",
	animation: "Motion",
	tracking: "Tracking",
	effects: "Effects",
	color: "Color",
	fix: "Fix",
	style: "Style",
	ai: "AI",
	lipsync: "Lipsync",
	cutout: "Cutout",
	retouch: "Retouch",
	tts: "Voice",
	bubble: "Bubble",
	wordart: "Word art",
	captions: "Template",
};

export interface InspectorTab {
	id: InspectorTabId;
	label: string;
	icon: IconSvgElement;
}

/** Each tab's icon: the default inspector shows the 10 tabs of a video as icons (components/inspector-tabs.tsx). */
const TAB_ICON: Record<InspectorTabId, IconSvgElement> = {
	basic: SlidersHorizontalIcon,
	text: TextIcon,
	shape: Shapes01Icon,
	audio: VolumeHighIcon,
	speed: DashboardSpeed02Icon,
	masks: LayerMask01Icon,
	animation: Move01Icon,
	tracking: Target02Icon,
	effects: MagicWand05Icon,
	color: ColorsIcon,
	fix: Wrench01Icon,
	style: PaintBrush01Icon,
	ai: AiMagicIcon,
	lipsync: VoiceIdIcon,
	cutout: ScissorIcon,
	retouch: FaceIdIcon,
	tts: Mic01Icon,
	bubble: PaintBrush01Icon,
	wordart: PaintBrush01Icon,
	captions: ClosedCaptionIcon,
};

function tabIcon(kind: ElementKind, id: InspectorTabId): IconSvgElement {
	if (kind === "ai" && id === "ai") return AiMagicIcon;
	if (kind === "audio" && id === "basic") return VolumeHighIcon;
	return TAB_ICON[id];
}

/** An effect layer's one tab is named after what the layer is: a filter (a look), an adjustment (grading) or an effect. */
export function effectLayerLabel(element: TimelineElement): string {
	if (element.type !== "effect" || element.effectType !== COLOR_EFFECT_TYPE) return "Effect";
	const look = element.params.look;
	return typeof look === "string" && look !== "none" ? "Filter" : "Adjustment";
}

function tabLabel(kind: ElementKind, element: TimelineElement, id: InspectorTabId): string {
	if (kind === "effect") return effectLayerLabel(element);
	// an AI layer's own tab holds the fields of the plate / template it is
	if (kind === "ai" && id === "ai") return "Template";
	// a generator (a solid, a gradient…) rides on a rectangle: its tab is named for what it is
	if (id === "shape" && element.type === "graphic" && generatorOf(element)) return "Generator";
	if (id === "basic") return BASIC_LABEL[kind] ?? TAB_LABEL.basic;
	return TAB_LABEL[id];
}

/** The tabs this clip has, in the fixed order of its kind. */
export function getInspectorTabs(element: TimelineElement): InspectorTab[] {
	const kind = elementKind(element);
	return TAB_ORDER[kind]
		.filter((id) => getInspectorSections({ tab: id, element }).length > 0)
		.map((id) => ({ id, label: tabLabel(kind, element, id), icon: tabIcon(kind, id) }));
}

/** Kept for callers of the old two-row layout: there are no sub-tab rows any more. */
export function subtabRow(_kind: ElementKind): null {
	return null;
}

export const isCompositionElement = (element: TimelineElement) => element.type === "graphic" && element.definitionId === COMPOSITION_DEF;

export function kindLabel(element: TimelineElement): string {
	if (element.type === "graphic" && isCompositionElement(element)) return element.params?.compound ? "Compound clip" : "Old AI composition";
	if (element.type === "graphic" && generatorOf(element)) return "Generator";
	return {
		video: "Video",
		image: "Photo",
		sticker: "Sticker",
		shape: "Shape",
		ai: "AI layer",
		text: "Text",
		audio: "Audio",
		effect: "Effect",
	}[elementKind(element)];
}
