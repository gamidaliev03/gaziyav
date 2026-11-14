// a clip has — the panel's own and every plug-in's (./slots) — is placed in ONE scrolling list, in parts like
// Premiere's Video / Audio: the clip's properties first (what everybody touches: where it sits, how see-through, how
// fast, its colour, then its effects in order), its sound under «Audio», and the tools (cut-outs, tracking, repairs, AI)
// folded at the end. Nothing a tab held is gone: a section this table does not name still shows, among the tools.
import type { TimelineElement } from "@/timeline";
import { type BlockId, placeOf } from "./layout-places";
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

/** The list of a clip: its parts in order, each with its sections in order; empty parts left out. */
export function inspectorBlocks(element: TimelineElement): InspectorBlockSpec[] {
	const kind = elementKind(element);
	const blocks: Record<BlockId, PlacedSection[]> = { main: [], audio: [], tools: [] };
	for (const section of clipSections(element)) {
		const place = placeOf(section.id, kind);
		blocks[place.block].push({ section, rank: place.rank * 1000 + (section.order ?? 0), folded: place.block === "tools" || !!place.folded });
	}
	const title = kind === "effect" ? effectLayerLabel(element) : MAIN_TITLE[kind];
	const spec: InspectorBlockSpec[] = [
		{ id: "main", title, sections: blocks.main },
		{ id: "audio", title: "Audio", sections: blocks.audio },
		{ id: "tools", title: "Tools", sections: blocks.tools },
	];
	for (const block of spec) block.sections.sort((a, b) => a.rank - b.rank);
	return spec.filter((block) => block.sections.length > 0);
}
