import { EditorCore } from "@/core";
import { Command, type CommandResult } from "@/commands/base-command";
import type { SceneTracks, TimelineElement } from "@/timeline";
import {
	findTrackInSceneTracks,
	updateElementInSceneTracks,
} from "@/timeline";
import { applyElementUpdate } from "@/timeline/update-pipeline";
import { endOnFrame } from "@/timeline/frame-grid";
import { fitGrownClips } from "@/timeline/retime-room";

export class UpdateElementsCommand extends Command {
	private savedState: SceneTracks | null = null;
	/** The magnet when the step was first made: its redo fits a slower clip the same way. */
	private magnetic: boolean | null = null;
	private readonly updates: Array<{
		trackId: string;
		elementId: string;
		patch: Partial<TimelineElement>;
	}>;

	constructor({
		updates,
	}: {
		updates: Array<{
			trackId: string;
			elementId: string;
			patch: Partial<TimelineElement>;
		}>;
	}) {
		super();
		this.updates = updates;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;
		let updatedTracks = this.savedState;

		for (const updateEntry of this.updates) {
			const currentTrack = findTrackInSceneTracks({
				tracks: updatedTracks,
				trackId: updateEntry.trackId,
			});
			const currentElement = currentTrack?.elements.find(
				(element) => element.id === updateEntry.elementId,
			);
			if (!currentTrack || !currentElement) {
				continue;
			}

			const updated = applyElementUpdate({
				element: currentElement,
				patch: updateEntry.patch,
				context: {
					tracks: updatedTracks,
					trackId: updateEntry.trackId,
				},
			});
			// A new speed gives a new length: on the project's frames (6 s at 0.7× was 214.29 frames at 25, and every clip
			// after it started between frames).
			const fps = "retime" in updateEntry.patch ? editor.project.getActiveOrNull()?.settings.fps : undefined;
			const nextElement = fps ? endOnFrame(updated, fps) : updated;

			updatedTracks = updateElementInSceneTracks({
				tracks: updatedTracks,
				trackId: updateEntry.trackId,
				elementId: updateEntry.elementId,
				update: () => nextElement,
			});
		}

		// A slower clip: pushes the clips after it on the magnetic main track (the command manager packs it), else keeps its
		// start and fits the free space before the next clip, as its dragged right edge would (timeline/retime-room.ts).
		const retimed = new Set(this.updates.filter((u) => "retime" in u.patch).map((u) => u.elementId));
		const fps = editor.project.getActiveOrNull()?.settings.fps;
		if (retimed.size > 0 && fps) {
			this.magnetic ??= editor.command.isRippleEnabled;
			updatedTracks = fitGrownClips({ before: this.savedState, after: updatedTracks, magnetic: this.magnetic, fps, only: retimed });
		}

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
