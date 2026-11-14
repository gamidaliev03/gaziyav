// A tool's result where the user edits it: after Auto color the clip's Color section opens with the Color groups the tool
// changed unfolded (the panel used to stay on Video with every group closed, so the result was nowhere to be seen). The
// inspector is one list (./layout.ts): revealing a section opens it — and the folded tools when it is one — and scrolls to it.
import { COLOR_EFFECT_TYPE, COLOR_GROUP_KEYS, type ColorGroup, isColorGroupNeutral } from "@/effects/definitions/studio/color";
import { EditorCore } from "@/core";
import { isVisualElement } from "@/timeline/element-utils";
import { openInspectorGroups } from "./components/inspector-ui";
import { openInspectorTab } from "./inspector-tab";
import { placeOf } from "./layout-places";
import { elementKind } from "./registry";
import { getInspectorSection, sectionAppliesTo } from "./slots";
import type { TimelineElement } from "@/timeline";

/** The Color tab of the clip, its changed Color groups open; the clip becomes the selection when it is not. */
export function revealClipColor({ trackId, elementId }: { trackId: string; elementId: string }) {
	const editor = EditorCore.getInstance();
	const [found] = editor.timeline.getElementsWithTracks({ elements: [{ trackId, elementId }] });
	if (!found || !isVisualElement(found.element)) return;
	const selected = editor.selection.getSelectedElements();
	if (!(selected.length === 1 && selected[0].elementId === elementId)) editor.selection.setSelectedElements({ elements: [{ trackId, elementId }] });
	const params = (found.element.effects ?? []).find((effect) => effect.type === COLOR_EFFECT_TYPE)?.params ?? {};
	const changed = (Object.keys(COLOR_GROUP_KEYS) as ColorGroup[]).filter((group) => !isColorGroupNeutral(group, params));
	revealInspectorSection("adjust.color", { trackId, elementId });
	openInspectorGroups(changed.map((group) => `color.${group}`));
}

/**
 * Opens a section of the clip's inspector (⌘K, the right-click menus, a tile that leads to its tool): the clip becomes
 * the selection, its tab opens, the section's group unfolds and scrolls into view with a short highlight. False when
 * the clip has no such section (a photo has no Remove background, say).
 */
export function revealInspectorSection(sectionId: string, ref?: { trackId: string; elementId: string }): boolean {
	const editor = EditorCore.getInstance();
	const selected = editor.selection.getSelectedElements();
	const target = ref ?? (selected.length === 1 ? selected[0] : null);
	if (!target) return false;
	const [found] = editor.timeline.getElementsWithTracks({ elements: [target] });
	const section = getInspectorSection(sectionId);
	if (!found || !section || !sectionAppliesTo(section, found.element)) return false;
	// a compact window shows Media or the inspector in one side column: the inspector comes forward (page.tsx)
	window.dispatchEvent(new Event("gz-reveal-inspector"));
	if (!(selected.length === 1 && selected[0].elementId === target.elementId)) editor.selection.setSelectedElements({ elements: [target] });
	// its tab comes forward (./layout-places.ts), then its row unfolds
	openInspectorTab(placeOf(sectionId, elementKind(found.element)).block);
	openInspectorGroups([sectionId]);
	if (typeof window === "undefined") return true;
	// The panel follows the selection a frame later (index.tsx): wait for the section OF THIS CLIP (the panel of the clip
	// selected before — an audio clip has its own Lipsync — is still there for a frame), then unfold a bare one's own
	// group, scroll to it and light it up for a moment.
	const started = performance.now();
	const step = () => {
		const node = [...document.querySelectorAll<HTMLElement>(`[data-inspector-section="${sectionId}"][data-inspector-element="${target.elementId}"]`)].find((n) => n.getBoundingClientRect().height > 0);
		if (!node) {
			if (performance.now() - started < 1500) requestAnimationFrame(step);
			return;
		}
		const group = node.querySelector<HTMLElement>("[data-inspector-group]")?.getAttribute("data-inspector-group");
		if (group && group !== sectionId) openInspectorGroups([group]);
		node.scrollIntoView({ block: "start", behavior: "smooth" });
		node.setAttribute("data-revealed", "");
		window.setTimeout(() => node.removeAttribute("data-revealed"), 1600);
	};
	requestAnimationFrame(step);
	return true;
}

/** The sections a clip has, with the tab each one shows under (⌘K lists the tools of the selected clip). */
export function clipHasSection(sectionId: string, element: TimelineElement): boolean {
	const section = getInspectorSection(sectionId);
	return !!section && sectionAppliesTo(section, element);
}

// An effect or a filter dropped on a clip (timeline/controllers/drag-drop-controller.ts): the inspector opens where it
// is edited — a filter in Colour (its name and strength on top), any other effect in the clip's Effects list. The
if (typeof window !== "undefined") {
	window.addEventListener("gz-clip-effect-added", (event) => {
		const detail = (event as CustomEvent<{ trackId: string; elementId: string; effectType: string }>).detail;
		if (!detail) return;
		if (detail.effectType === COLOR_EFFECT_TYPE) revealClipColor(detail);
		else revealInspectorSection("effects", detail);
	});
}
