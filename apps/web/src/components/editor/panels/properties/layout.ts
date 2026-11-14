// The inspector's tabs (./layout-places.ts — the owner, 14.11: tabs by sphere, not one list). Every section a clip
// has — the panel's own and every plug-in's (./slots) — is placed in one of a few named tabs: the clip itself, its
// sound, speed, colour, effects, AI. Nothing is lost: a section this table does not name still shows, in «AI».
import { generatorOf } from "@/generators/document";
import type { TimelineElement } from "@/timeline";
import { BLOCK_ORDER, type BlockId, placeOf, worksInABrowser } from "./layout-places";
import { DEMO } from "@/demo/flag";
import { effectLayerLabel, elementKind, type ElementKind } from "./registry";
import { getInspectorSections, type InspectorSection, type InspectorTabId } from "./slots";

export { type BlockId, placeOf };

export interface PlacedSection {
	section: InspectorSection;
	rank: number;
	/** The list keeps it folded until the user opens it (a tool, Shadow…). */
	folded: boolean;
}

export interface InspectorBlockSpec {
	id: BlockId;
	title: string;
	sections: PlacedSection[];
}

/** Every tab id a section can be registered under: the list gathers them all. */
const ALL_TABS: InspectorTabId[] = [
	"basic",
	"text",
	"shape",
	"audio",
	"speed",
	"masks",
	"animation",
	"tracking",
	"effects",
	"color",
	"fix",
	"style",
	"ai",
	"lipsync",
	"cutout",
	"retouch",
	"tts",
	"bubble",
	"wordart",
	"captions",
];

/** Every section that applies to the clip, each once. */
export function clipSections(element: TimelineElement): InspectorSection[] {
	const seen = new Map<string, InspectorSection>();
	for (const tab of ALL_TABS) {
		for (const section of getInspectorSections({ tab, element })) seen.set(section.id, section);
	}
	return [...seen.values()];
}

const MAIN_TITLE: Record<ElementKind, string> = {
	video: "Video",
	image: "Photo",
	sticker: "Sticker",
	shape: "Shape",
	ai: "AI layer",
	text: "Text",
	audio: "Audio",
	effect: "Effect",
};

const TAB_TITLE: Record<Exclude<BlockId, "main">, string> = {
	audio: "Audio",
	speed: "Speed",
	color: "Color",
	effects: "Effects",
	tools: "AI",
};

/** The tabs of a clip in order, each with its sections in order; a tab with nothing in it is left out. */
export function inspectorBlocks(element: TimelineElement): InspectorBlockSpec[] {
	const kind = elementKind(element);
	const blocks: Record<BlockId, PlacedSection[]> = { main: [], audio: [], speed: [], color: [], effects: [], tools: [] };
	for (const section of clipSections(element)) {
		if (DEMO && !worksInABrowser(section.id)) continue;
		const place = placeOf(section.id, kind);
		blocks[place.block].push({ section, rank: place.rank * 1000 + (section.order ?? 0), folded: !!place.folded });
	}
	const title = kind === "effect" ? effectLayerLabel(element) : element.type === "graphic" && generatorOf(element) ? "Generator" : MAIN_TITLE[kind];
	const spec: InspectorBlockSpec[] = BLOCK_ORDER.map((id) => ({ id, title: id === "main" ? title : TAB_TITLE[id], sections: blocks[id] }));
	for (const block of spec) block.sections.sort((a, b) => a.rank - b.rank);
	return spec.filter((block) => block.sections.length > 0);
}
