import { EditorCore } from "@/core";
import { AddClipEffectCommand, BatchCommand } from "@/commands";
import { isVisualElement } from "@/timeline/element-utils";
import type { TimelineElement, TimelineTrack } from "@/timeline";

/** Selected visual clips (video, image, text, sticker, graphic). */
export function getSelectedVisualClips(): Array<{ track: TimelineTrack; element: TimelineElement }> {
	const editor = EditorCore.getInstance();
	return editor.timeline
		.getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
		.filter(({ element }) => isVisualElement(element));
}

/**
 * Adds an effect to every selected visual clip as ONE undo step.
 * Returns how many clips got the effect (0 → nothing selected).
 */
export function applyEffectToSelection({ effectType }: { effectType: string }): number {
	const targets = getSelectedVisualClips();
	if (targets.length === 0) return 0;
	const commands = targets.map(
		({ track, element }) =>
			new AddClipEffectCommand({ trackId: track.id, elementId: element.id, effectType }),
	);
	const command = commands.length === 1 ? commands[0] : new BatchCommand(commands);
	EditorCore.getInstance().command.execute({ command });
	// one clip: the inspector opens on its Effects, where the new effect is edited (properties/reveal.ts)
	if (targets.length === 1 && typeof window !== "undefined")
		window.dispatchEvent(new CustomEvent("gz-clip-effect-added", { detail: { trackId: targets[0].track.id, elementId: targets[0].element.id, effectType } }));
	return targets.length;
}
