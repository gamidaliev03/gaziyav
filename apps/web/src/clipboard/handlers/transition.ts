import { buildTransitionPasteCommand } from "@/commands/timeline/clipboard/paste-transition";
import { warmShader } from "@/services/renderer/compositor/pipeline-warmup";
import type { SceneTracks, VideoTrack } from "@/timeline";
import { getTransitions, useSelectedCut } from "@/transitions/commands";
import type { TimelineTransition } from "@/transitions/types";
import type { ClipboardHandler, CopyContext } from "../types";

function videoTracks(tracks: SceneTracks): VideoTrack[] {
	return [tracks.main, ...tracks.overlay.filter((track): track is VideoTrack => track.type === "video")];
}

function selectedTransition({ editor, selectedElements }: CopyContext): TimelineTransition | null {
	const cut = useSelectedCut.getState().cut;
	if (!cut || selectedElements.length > 0) return null;
	const track = videoTracks(editor.scenes.getActiveScene().tracks).find((candidate) => candidate.id === cut.trackId);
	return track
		? (getTransitions(track).find((t) => t.fromElementId === cut.fromElementId && t.toElementId === cut.toElementId) ?? null)
		: null;
}

/**
 * ⌘C on a selected transition copies it (type, length, settings); ⌘V puts it on the selected cut, or at the cut of
 * each selected clip (commands/timeline/clipboard/paste-transition.ts): one ⌘Z.
 */
export const TransitionClipboardHandler = {
	type: "transition",

	canCopy(context) {
		return selectedTransition(context) !== null;
	},

	copy(context) {
		const transition = selectedTransition(context);
		if (!transition) return null;
		return { type: "transition", transition: { type: transition.type, duration: transition.duration, params: { ...transition.params } } };
	},

	paste({ entry, context }) {
		const command = buildTransitionPasteCommand({
			tracks: context.editor.scenes.getActiveScene().tracks,
			transition: entry.transition,
			selectedElementIds: context.selectedElements.map((ref) => ref.elementId),
			selectedCut: useSelectedCut.getState().cut,
		});
		// the player compiles the effect now: it shows the plain cut until it is ready, never a frozen frame
		if (command) warmShader(entry.transition.type);
		return command;
	},
} satisfies ClipboardHandler<"transition">;
