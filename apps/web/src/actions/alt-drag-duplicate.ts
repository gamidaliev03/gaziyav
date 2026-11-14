import { MoveElementCommand } from "@/commands/timeline/element/move-elements";
import type { EditorCore } from "@/core";
import type { GroupMoveResult } from "@/timeline/group-move";
import { generateUUID } from "@/utils/id";
import { TracksEditCommand } from "./tracks-edit-command";
import { placeDragCopies } from "./timeline-edits";
import { copyElementWithFreshKeyframes } from "@/timeline/element-copy";
import { groupRemapper } from "@/timeline/groups";

/**
 * ⌥-drag (Kadr, CapCut, FCP, Premiere): the dragged clips stay where they were and copies land at the drop point.
 * One undo step. A copy that would overlap its own original (a short drag) makes room — inserted at the next cut on
 * the magnetic main track, on a new track elsewhere — instead of the drag silently becoming a move.
 */
export function moveOrDuplicateOnAltDrag({
	editor,
	moves,
	createTracks,
	duplicate,
}: Pick<GroupMoveResult, "moves" | "createTracks"> & {
	editor: EditorCore;
	duplicate: boolean;
}): void {
	if (!duplicate) {
		editor.timeline.moveElements({ moves, createTracks });
		return;
	}
	const before = editor.scenes.getActiveScene().tracks;
	const move = new MoveElementCommand({ moves, createTracks });
	move.execute();
	const moved = editor.scenes.getActiveScene().tracks;
	move.undo();

	const { tracks, copies } = placeDragCopies({
		before,
		moved,
		moves,
		newId: generateUUID,
		magnetTrackId: editor.command.isRippleEnabled ? before.main.id : null,
		// Copies of a group make a new group (⌘G), not more members of the original one.
		copyElement: (() => {
			const regroup = groupRemapper();
			return (element: Parameters<typeof copyElementWithFreshKeyframes>[0], id: string) =>
				regroup(copyElementWithFreshKeyframes(element, id));
		})(),
	});
	editor.command.execute({
		// Final as computed: the magnet must not close the gaps a copy left or shift the clips it pushed again.
		command: new TracksEditCommand({ before, after: tracks, selection: copies, noEngineRipple: true }),
	});
}
