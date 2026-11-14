// Destructive keyboard actions act on the editor's *current* selection.
//
// Action handlers are React closures refreshed in a passive effect, so under
// heavy load a key press can run a handler whose `selectedElements` is from an
// older render — ⌫ then deleted a selection the user no longer had (the
// release gate once saw ⌫ remove all 296 clips). Reading the live selection
// from the core removes that window entirely.
import type { EditorCore } from "@/core";
import type { ElementRef } from "@/timeline/types";
import { removeElements } from "@/actions/timeline-edits";
import { TracksEditCommand } from "@/actions/tracks-edit-command";

/** Big deletions get a visible "Undo" so nothing disappears silently. */
export const BULK_DELETE_NOTICE_MIN = 10;

export function liveSelectedElements(editor: EditorCore): ElementRef[] {
	return [...editor.selection.getSelectedElements()];
}

/** Deletes exactly what is selected now; returns how many elements were removed. */
export function deleteLiveSelection({
	editor,
	ripple = false,
}: {
	editor: EditorCore;
	ripple?: boolean;
}): number {
	const elements = liveSelectedElements(editor);
	if (elements.length === 0) return 0;
	if (ripple) {
		const before = editor.scenes.getActiveScene().tracks;
		editor.command.execute({
			command: new TracksEditCommand({
				before,
				after: removeElements({ tracks: before, elements }),
				ripple: true,
				selection: [],
			}),
		});
	} else {
		editor.timeline.deleteElements({ elements });
	}
	return elements.length;
}
