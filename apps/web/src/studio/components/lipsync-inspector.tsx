// Lipsync is a tool for the selected clip, so it lives in the inspector — among the tools, first of the AI ones, never
// without a header of its own. Every way in — the key ⌥L, the clip's menu, ⌘K — is one function, `openLipsync`, and ends the same: the clip
// selected and chosen, the section open and in view, the caret in the words field.
import { toast } from "sonner";
import { bindAction } from "@/actions/registry";
import { EditorCore } from "@/core";
import { revealInspectorSection } from "@/components/editor/panels/properties/reveal";
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import { usePropertiesStore } from "@/components/editor/panels/properties/stores/properties-store";
import { t } from "@/i18n";
import { currentClip } from "@/studio/client/editor-bridge";
import { draftKey, useStudioStore } from "@/studio/client/studio-store";
import { LipsyncView } from "./lipsync-view";

registerInspectorSection({
	id: "studio.lipsync",
	tab: "lipsync",
	title: "Lipsync",
	appliesTo: (element) => element.type === "video" || element.type === "audio",
	render: () => <LipsyncView embedded />,
});

/** Opens the inspector's AI tab (Lipsync is its first group) for the selected clip. */
export function openLipsyncInspector(elementType = "video") {
	usePropertiesStore.getState().setActiveTab({ elementType, tabId: "ai" });
}

/** The words field of this clip's Lipsync section, once it is on screen (not the one of the clip selected before). */
const wordsField = (elementId: string) =>
	[...document.querySelectorAll<HTMLTextAreaElement>(`[data-inspector-section="studio.lipsync"][data-inspector-element="${elementId}"] [data-lipsync-text]`)].find((n) => n.getBoundingClientRect().height > 0) ?? null;

/**
 * Lipsync for a clip from anywhere: the clip (the given one, else the selected or chosen video) becomes the selection and
 * the lipsync clip, its section opens (the folded tools too) and scrolls into view, and the caret goes into the words field (a clip whose
 * sound is a file or the audio under it gets the words field back only when it has no voice yet). False: no video clip.
 */
export function openLipsync(ref?: { trackId: string; elementId: string }): boolean {
	const editor = EditorCore.getInstance();
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	if (!projectId) return false;
	let target = ref;
	if (!target) {
		const clip = currentClip(editor);
		if (clip) target = { trackId: clip.trackId, elementId: clip.elementId };
	}
	if (!target) {
		toast.error(t("Select a video clip on the timeline"));
		return false;
	}
	editor.selection.setSelectedElements({ elements: [target] });
	const store = useStudioStore.getState();
	store.pin(projectId, target.elementId);
	const key = draftKey(projectId, target.elementId);
	const draft = store.draft(key);
	const patch: Record<string, unknown> = {};
	if (draft.source !== "clip") patch.source = "clip";
	if ((draft.voice === "timeline" || draft.voice === "file") && !draft.speech) patch.voice = "clone";
	if (Object.keys(patch).length) store.patch(key, patch);
	if (!revealInspectorSection("studio.lipsync", target)) return false;
	if (typeof window === "undefined") return true;
	// the section mounts a frame or two later: then the caret, at the end of what is typed
	const elementId = target.elementId;
	const started = performance.now();
	const focus = () => {
		const field = wordsField(elementId);
		if (!field) {
			if (performance.now() - started < 2000) requestAnimationFrame(focus);
			return;
		}
		field.focus({ preventScroll: true });
		field.setSelectionRange(field.value.length, field.value.length);
		// a closing dialog (⌘K, the menu) hands the focus back where it was a moment later: the caret comes back here
		window.setTimeout(() => {
			if (document.activeElement !== field && field.isConnected) {
				field.focus({ preventScroll: true });
				field.setSelectionRange(field.value.length, field.value.length);
			}
		}, 250);
	};
	requestAnimationFrame(focus);
	return true;
}

// ⌥L (actions/definitions.ts «lipsync-open») and ⌘K's «Lipsync» run it.
bindAction("lipsync-open", () => {
	openLipsync();
});
