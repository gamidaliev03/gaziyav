import { Command, type CommandResult } from "@/commands/base-command";
import type { SceneTracks } from "@/timeline";
import { EditorCore } from "@/core";
import type { TimelineTrack } from "@/timeline";

function removeTrackElements<TTrack extends TimelineTrack>({
	track,
	elements,
}: {
	track: TTrack;
	elements: { trackId: string; elementId: string }[];
}): TTrack {
	// The ids to go on this track, as a set: a scan of the targets per element was elements × targets (2 792 × 324 on
	// a two-hour film, ~7 ms of a ⌫).
	const ids = new Set<string>();
	for (const target of elements) if (target.trackId === track.id) ids.add(target.elementId);
	// A track that loses nothing stays the same object: its row does not render again.
	if (ids.size === 0) return track;
	const nextElements = track.elements.filter((element) => !ids.has(element.id));

	return { ...track, elements: nextElements } as TTrack;
}

export class DeleteElementsCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly elements: { trackId: string; elementId: string }[];

	constructor({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}) {
		super();
		this.elements = elements;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks: SceneTracks = {
			overlay: this.savedState.overlay.map((track) =>
				removeTrackElements({ track, elements: this.elements }),
			),
			main: removeTrackElements({
				track: this.savedState.main,
				elements: this.elements,
			}),
			audio: this.savedState.audio.map((track) =>
				removeTrackElements({ track, elements: this.elements }),
			),
		};

		editor.timeline.updateTracks(updatedTracks);

		return {
			selection: {
				selectedElements: [],
				selectedKeyframes: [],
				keyframeSelectionAnchor: null,
				selectedMaskPoints: null,
			},
		};
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
