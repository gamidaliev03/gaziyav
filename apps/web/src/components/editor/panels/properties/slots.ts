import type { ReactNode } from "react";
import type { TimelineElement } from "@/timeline";

/**
 * Inspector slots: features add their own collapsible group to a tab of the Properties panel without
 * touching the panel's code. A tab with nothing in it is hidden, so a slot shows up (and its tab
 * appears) as soon as a feature registers into it.
 *
 *   registerInspectorSection({
 *     id: "motion.tracker",
 *     tab: "animation",
 *     title: "Tracker",
 *     appliesTo: (element) => element.type === "text" || element.type === "video",
 *     render: ({ element, trackId }) => <TrackerSection element={element} trackId={trackId} />,
 *   });
 *
 * Put the import of the registering module in ./plugins.ts (one line per feature).
 */
export type InspectorTabId =
	| "basic"
	| "text"
	| "shape"
	| "audio"
	| "speed"
	/** Masks (id kept: the preview switches to mask editing on it). */
	| "masks"
	/** Shown as "Motion": in / out / loop animation, tracking, follow, make vertical, stabilize. */
	| "animation"
	/** Old id: its sections are in Motion ("animation") now. */
	| "tracking"
	/** The effects applied to this clip: list, on/off, order, params (id kept for the timeline's fx badge). */
	| "effects"
	/** Color: the clip's grading, its filter / LUT, AI color correction, color match. */
	| "color"
	/** Fix: AI repairs of the picture (remove flickers, enhance, reduce noise, remove objects). */
	| "fix"
	/** Text → Style: ready-made looks for the words (bubble, word art, caption template). */
	| "style"
	| "ai"
	/** Lipsync / voice tools for the selected clip (studio/components/lipsync-inspector.tsx). */
	| "lipsync"
	/** Cutout: what part of the picture shows — remove background, chroma key, masks. */
	| "cutout"
	/** Retouch: the face, on this Mac. */
	| "retouch"
	/** Text → Text-to-speech: the text read by a voice, onto the timeline. */
	| "tts"
	/** Text → Bubble (CapCut): a plate behind the words. */
	| "bubble"
	/** Text → Effects (CapCut word art): the letters' paint — fill, outline, glow, gradient. */
	| "wordart"
	/** Text → Template, caption clips only: the caption styles. */
	| "captions";

export interface InspectorSectionProps {
	element: TimelineElement;
	trackId: string;
}

export interface InspectorSection {
	/** Unique and stable (also keeps the group's open/closed state). */
	id: string;
	tab: InspectorTabId;
	/** Group header. Sentence case, one to three words. */
	title: string;
	/** Position inside the tab. Built-in groups use 100, 200, 300…; plug-ins usually go after them. */
	order?: number;
	appliesTo: (element: TimelineElement) => boolean;
	render: (props: InspectorSectionProps) => ReactNode;
	/** Closed until the user opens it. Default: open. */
	defaultOpen?: boolean;
	/** The section draws its own header/group (a full-width tool such as Masks). Otherwise the panel
	 * wraps it in a collapsible group titled `title`; build its rows with InspectorRow (components/inspector-ui). */
	bare?: boolean;
	/**
	 * perfb (14.11): the section shows nothing of where the clip sits — its start, length and trims — and its handlers
	 * don't read them either (rows read the playhead through useElementPlayhead, which looks the clip up live). A drop,
	 * a trim or ⌘Z of one then re-renders the panel without it. Leave it out when unsure: the section re-renders.
	 */
	placementFree?: boolean;
}

const sections = new Map<string, InspectorSection>();
const listeners = new Set<() => void>();
let version = 0;

export function registerInspectorSection(section: InspectorSection): () => void {
	sections.set(section.id, section);
	version++;
	for (const listener of listeners) listener();
	return () => {
		if (sections.get(section.id) !== section) return;
		sections.delete(section.id);
		version++;
		for (const listener of listeners) listener();
	};
}

export function getInspectorSections({
	tab,
	element,
}: {
	tab: InspectorTabId;
	element: TimelineElement;
}): InspectorSection[] {
	const from = mergedTabs({ tab, element });
	const rank = (section: InspectorSection) => from.indexOf(section.tab) * 100_000 + (section.order ?? 1000);
	return [...sections.values()]
		.filter((section) => from.includes(section.tab) && safeApplies(section, element))
		.sort((a, b) => rank(a) - rank(b));
}

/** The tabs whose sections a shown tab gathers (it comes first, the merged ones follow in this order). */
function mergedTabs({ tab }: { tab: InspectorTabId; element: TimelineElement }): InspectorTabId[] {
	// One tab per subject (docs/EDITOR-MAP.md); the AI tab also gathers the lipsync tool registered under its own id.
	switch (tab) {
		case "ai":
			return ["lipsync", "ai"];
		default:
			return [tab];
	}
}

/** One registered section by its id (⌘K and the menus open it: reveal.ts). */
export function getInspectorSection(id: string): InspectorSection | undefined {
	return sections.get(id);
}

/** Whether the section is shown for this clip (its appliesTo, never throwing). */
export function sectionAppliesTo(section: InspectorSection, element: TimelineElement): boolean {
	return safeApplies(section, element);
}

/** The tab a section shows under (the lipsync tool sits in AI). */
export const shownTabOf = (section: InspectorSection): InspectorTabId => (section.tab === "lipsync" ? "ai" : section.tab);

export function subscribeInspectorSections(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function getInspectorSectionsVersion(): number {
	return version;
}

function safeApplies(section: InspectorSection, element: TimelineElement): boolean {
	try {
		return section.appliesTo(element);
	} catch {
		return false;
	}
}
