// «Paste Attributes…» (⌥⌘V): the clip whose look is pasted, and the checkboxes the user left last time.
import { create } from "zustand";
import { UpdateElementsCommand } from "@/commands/timeline";
import type { EditorCore } from "@/core";
import { effectsRegistry } from "@/effects/registry";
import type { Effect } from "@/effects/types";
import type { TimelineElement } from "@/timeline";
import { ALL_ATTRIBUTE_GROUPS, type AttributeGroup, buildAttributesPatch, captureAttributes, type ElementAttributes } from "./timeline-edits";

const STORAGE_KEY = "gaziyav.pasteAttributes.groups";

function storedGroups(): AttributeGroup[] {
	try {
		const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
		if (Array.isArray(raw)) return raw.filter((id): id is AttributeGroup => ALL_ATTRIBUTE_GROUPS.has(id));
	} catch {}
	return [...ALL_ATTRIBUTE_GROUPS];
}

interface AttributesClipboard {
	source: ElementAttributes | null;
	sourceName: string;
	dialogOpen: boolean;
	groups: AttributeGroup[];
}

export const useAttributesClipboard = create<AttributesClipboard>()(() => ({
	source: null,
	sourceName: "",
	dialogOpen: false,
	groups: typeof window === "undefined" ? [...ALL_ATTRIBUTE_GROUPS] : storedGroups(),
}));

/** ⌘C / ⌘X / ⌥⌘C: the copied clip is also the source of «Paste Attributes…». */
export function rememberAttributes(element: TimelineElement): void {
	useAttributesClipboard.setState({ source: captureAttributes(element), sourceName: element.name });
}

export function setPasteAttributeGroups(groups: AttributeGroup[]): void {
	useAttributesClipboard.setState({ groups });
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
	} catch {}
}

export function isColorEffect(effect: Effect): boolean {
	try {
		return effectsRegistry.get(effect.type).category === "Color";
	} catch {
		return false;
	}
}

/** Pastes the checked groups onto the selected clips: one ⌘Z. Returns how many clips changed. */
export function pasteAttributes(editor: EditorCore, groups: readonly AttributeGroup[]): number {
	const { source } = useAttributesClipboard.getState();
	if (!source) return 0;
	const include = new Set(groups);
	const updates = editor.timeline
		.getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
		.flatMap(({ track, element }) => {
			const patch = buildAttributesPatch({ source, target: element, include, isColorEffect });
			return patch ? [{ trackId: track.id, elementId: element.id, patch }] : [];
		});
	if (updates.length > 0) editor.command.execute({ command: new UpdateElementsCommand({ updates }) });
	return updates.length;
}
