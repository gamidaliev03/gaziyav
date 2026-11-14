import { getElementKeyframes } from "@/animation/keyframe-query";
import type { AnimationPath, SelectedKeyframeRef } from "@/animation/types";
import type { EditorCore } from "@/core";
import type { TimelineElement } from "@/timeline/types";

export type ClipRef = { trackId: string; element: TimelineElement };

/** What a keyframe command acts on: the keys themselves, every key of their parameters, or every key of their clips. */
export type KeyframeScope = "keys" | "parameter" | "clip";

const refKey = (ref: SelectedKeyframeRef) => `${ref.elementId}\u0000${ref.propertyPath}\u0000${ref.keyframeId}`;

function clipKeyframes({ trackId, element }: ClipRef): SelectedKeyframeRef[] {
	return getElementKeyframes({ animations: element.animations }).map((keyframe) => ({
		trackId,
		elementId: element.id,
		propertyPath: keyframe.propertyPath,
		keyframeId: keyframe.id,
	}));
}

/**
 * The keys a command touches. `refs` are the keys it was called on (the right-clicked ◆, the selection); `clips` are
 * the clips that own them. «parameter» widens to every key of the same parameters, «clip» to every key of the clips.
 */
export function keyframesInScope({
	clips,
	refs,
	scope,
}: {
	clips: ClipRef[];
	refs: SelectedKeyframeRef[];
	scope: KeyframeScope;
}): SelectedKeyframeRef[] {
	if (scope === "keys") return refs;
	const owners = new Set(refs.map((ref) => ref.elementId));
	const paths = new Set(refs.map((ref) => `${ref.elementId}\u0000${ref.propertyPath}`));
	return clips
		.filter((clip) => owners.has(clip.element.id))
		.flatMap(clipKeyframes)
		.filter((ref) => scope === "clip" || paths.has(`${ref.elementId}\u0000${ref.propertyPath}`));
}

/**
 * ⌘A while keys are selected, step by step like the other editors: first every key of the parameter you are on (all
 * selected keys on one parameter), then — pressed again — every key of the clip. Null when no key is selected
 * (⌘A selects clips then).
 */
export function selectAllKeyframesStep({
	clips,
	selected,
}: {
	clips: ClipRef[];
	selected: SelectedKeyframeRef[];
}): SelectedKeyframeRef[] | null {
	if (selected.length === 0) return null;
	const chosen = new Set(selected.map(refKey));
	const paths = new Set<AnimationPath>(selected.map((ref) => ref.propertyPath));
	if (paths.size === 1) {
		const parameter = keyframesInScope({ clips, refs: selected, scope: "parameter" });
		if (parameter.some((ref) => !chosen.has(refKey(ref)))) return parameter;
	}
	return keyframesInScope({ clips, refs: selected, scope: "clip" });
}

/**
 * ⌘X with keys selected: the keys go to the clipboard and off the clip (one ⌘Z). It copied the keys and then deleted
 * the selected clips. False when no key is selected (⌘X cuts clips then).
 */
export function cutSelectedKeyframes(editor: EditorCore): boolean {
	const keyframes = editor.selection.getSelectedKeyframes();
	if (keyframes.length === 0) return false;
	if (!editor.clipboard.copy()) return true;
	editor.timeline.removeKeyframes({ keyframes });
	editor.selection.clearKeyframeSelection();
	return true;
}

/**
 * ⌥⌫ / ⌥⇧⌫: every key of the selected keys' parameters / clips, one ⌘Z. «clip» with no key selected takes the
 * selected clips. Returns how many keys went.
 */
export function deleteKeyframesInScope(editor: EditorCore, scope: "parameter" | "clip"): number {
	const selectedKeys = editor.selection.getSelectedKeyframes();
	const owners =
		selectedKeys.length > 0
			? [...new Map(selectedKeys.map((ref) => [ref.elementId, { trackId: ref.trackId, elementId: ref.elementId }])).values()]
			: scope === "clip"
				? editor.selection.getSelectedElements()
				: [];
	const clips = editor.timeline
		.getElementsWithTracks({ elements: owners })
		.map(({ track, element }) => ({ trackId: track.id, element }));
	const keyframes =
		selectedKeys.length > 0 ? keyframesInScope({ clips, refs: selectedKeys, scope }) : clips.flatMap(clipKeyframes);
	if (keyframes.length === 0) return 0;
	editor.timeline.removeKeyframes({ keyframes });
	editor.selection.clearKeyframeSelection();
	return keyframes.length;
}
