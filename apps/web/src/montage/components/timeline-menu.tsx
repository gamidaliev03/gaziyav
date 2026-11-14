"use client";
// Timeline entry points of the composition clips that remain: compound clips (CapCut: a double-click opens their
// timeline) and AI compositions of older projects, which play and export as before and get «Flatten» — their clips and
// layers onto this timeline, one ⌘Z. New AI compositions are no longer made: «Create with AI» in Templates makes a
// plate / template as an ordinary layer (docs/EDITOR-MAP.md).
import { Layers01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { toast } from "sonner";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { EditorCore } from "@/core";
import { t } from "@/i18n";
import { dismissCompoundClips } from "@/timeline/compound";
import type { TimelineElement } from "@/timeline/types";
import { isAiLayer, isComposition, openComposition } from "../compositions";
import { fieldsFocus } from "./ai-fields";

/** An AI composition of an older project (not a compound clip). */
export const isOldAiComposition = (element: TimelineElement) => isComposition(element) && element.params.compound !== true;

/** Puts the selected old AI composition(s) onto the timeline as their clips and layers (one ⌘Z). */
export function flattenComposition(trackId: string, element: TimelineElement): boolean {
	const editor = EditorCore.getInstance();
	const selected = editor.selection.getSelectedElements();
	if (!selected.some((ref) => ref.elementId === element.id)) editor.selection.setSelectedElements({ elements: [{ trackId, elementId: element.id }] });
	return dismissCompoundClips(editor) === "done";
}

/** Element right-click on an old AI composition: «Flatten». Nothing for other clips. */
export function CompositionElementMenuItem({ trackId, element }: { trackId: string; element: TimelineElement }) {
	if (!isOldAiComposition(element)) return null;
	return (
		<ContextMenuItem
			icon={<HugeiconsIcon icon={Layers01Icon} />}
			data-flatten-composition=""
			onClick={(event: React.MouseEvent) => {
				event.stopPropagation();
				flattenComposition(trackId, element);
			}}
		>
			Flatten
		</ContextMenuItem>
	);
}

export function AiBadge() {
	return (
		<span
			data-ai-badge
			className="shrink-0 rounded-[3px] bg-linear-to-r from-amber-600 to-blue-600 px-1 text-[9px] leading-[14px] font-bold text-white"
		>
			AI
		</span>
	);
}

/**
 * Double-click on a timeline element: a compound clip opens its inner timeline; an AI layer is selected and its fields
 * (texts, colours, sizes, timings, pictures) open in its Template tab with the first one focused; an old AI
 * composition says how to edit it (Flatten).
 */
export function handleCompositionDoubleClick(element: TimelineElement, event: React.MouseEvent) {
	if (isAiLayer(element)) {
		event.stopPropagation();
		const trackId = (event.currentTarget as HTMLElement).dataset.timelineTrackId;
		if (!trackId) return;
		const editor = EditorCore.getInstance();
		fieldsFocus.pending = element.id;
		editor.selection.setSelectedElements({ elements: [{ trackId, elementId: element.id }] });
		// Kit layers use the regular graphic fields: focus the first one.
		setTimeout(() => {
			if (!fieldsFocus.pending) return;
			fieldsFocus.pending = "";
			const panels = [...document.querySelectorAll<HTMLElement>("[data-panel]")].filter((p) => !p.querySelector("[data-panel]") && p.getBoundingClientRect().width > 0);
			const panel = panels.find((p) => p.querySelector("[data-ai-fields]")) ?? panels.find((p) => p.querySelector('[data-inspector-section="ai.fields"]'));
			const field = panel?.querySelector<HTMLInputElement | HTMLTextAreaElement>("textarea, input[type=text], input:not([type])");
			field?.focus();
			field?.select();
		}, 250);
		return;
	}
	if (!isComposition(element)) return;
	event.stopPropagation();
	if (isOldAiComposition(element)) {
		toast.info(t("Old AI composition: right-click → Flatten to edit it"));
		return;
	}
	void openComposition(element);
}
