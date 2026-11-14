import { EditorCore } from "@/core";
import { Command, type CommandResult } from "@/commands/base-command";
import {
	buildSeparatedAudioElement,
	canExtractSourceAudio,
	detachedSoundOf,
	isSourceAudioSeparated,
} from "@/timeline/audio-separation";
import {
	applyPlacement,
	resolveTrackPlacement,
} from "@/timeline/placement";
import { updateElementInSceneTracks } from "@/timeline/track-element-update";
import { canPlaceTimeSpansOnTrack } from "@/timeline/placement/overlap";
import type {
	SceneTracks,
	TimelineElement,
	VideoElement,
} from "@/timeline/types";
import { generateUUID } from "@/utils/id";

export class ToggleSourceAudioSeparationCommand extends Command {
	private savedState: SceneTracks | null = null;

	constructor(
		private readonly params: {
			trackId: string;
			elementId: string;
		},
	) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const sourceTrack = [
			...this.savedState.overlay,
			this.savedState.main,
			...this.savedState.audio,
		].find((track) => track.id === this.params.trackId);
		if (!sourceTrack) {
			return;
		}
		const sourceElement = sourceTrack.elements.find(
			(element) => element.id === this.params.elementId,
		) as TimelineElement | undefined;
		if (!sourceElement || sourceElement.type !== "video") {
			return;
		}
		const videoElement: VideoElement = sourceElement;

		if (isSourceAudioSeparated({ element: videoElement })) {
			// Restore: the detached piece goes back INTO its clip — moved or trimmed since, it is removed and the clip's own
			// sound plays at its place (blind3 F3: a moved piece stayed and the speech played twice, one copy 1 s late).
			const { remove, retag } = detachedSoundOf({ video: videoElement, tracks: this.savedState });
			// a piece on a locked track cannot go: the clip stays detached (never both sounds)
			if ([...remove, ...retag].some((ref) => this.savedState?.audio.find((track) => track.id === ref.trackId)?.locked === true)) return;
			const gone = new Set(remove.map((ref) => ref.elementId));
			const renamed = new Map(retag.map((ref) => [ref.elementId, ref.to]));
			const withoutExtracted: SceneTracks = {
				...this.savedState,
				audio: this.savedState.audio.map((track) =>
					track.elements.some((element) => gone.has(element.id) || renamed.has(element.id))
						? {
								...track,
								elements: track.elements
									.filter((element) => !gone.has(element.id))
									.map((element) => (renamed.has(element.id) && element.sourceType === "upload" ? { ...element, detachedFrom: renamed.get(element.id) } : element)),
							}
						: track,
				),
			};
			editor.timeline.updateTracks(
				updateSourceAudioEnabled({
					tracks: withoutExtracted,
					trackId: this.params.trackId,
					elementId: this.params.elementId,
					isSourceAudioEnabled: true,
				}),
			);
			return;
		}

		const mediaAsset = editor.media
			.getAssets()
			.find((asset) => asset.id === videoElement.mediaId);
		if (!canExtractSourceAudio(videoElement, mediaAsset)) {
			return;
		}
		if (videoElement.duration <= 0) {
			return;
		}

		const separatedAudioElement = {
			...buildSeparatedAudioElement({
				sourceElement: videoElement,
			}),
			id: generateUUID(),
		};
		const timeSpans = [{ startTime: separatedAudioElement.startTime, duration: separatedAudioElement.duration }];
		// the first free sound track that is not locked, else a new one (a locked track takes nothing)
		const free = this.savedState.audio.find((track) => track.locked !== true && canPlaceTimeSpansOnTrack({ track, timeSpans }));
		const placementResult = resolveTrackPlacement({
			tracks: this.savedState,
			trackType: "audio",
			timeSpans,
			strategy: free ? { type: "explicit", trackId: free.id } : { type: "alwaysNew", position: "highest" },
		});
		if (!placementResult) {
			return;
		}
		const appliedPlacement = applyPlacement({
			tracks: this.savedState,
			placementResult,
			elements: [separatedAudioElement],
		});
		if (!appliedPlacement) {
			return;
		}

		editor.timeline.updateTracks(
			updateSourceAudioEnabled({
				tracks: appliedPlacement.updatedTracks,
				trackId: this.params.trackId,
				elementId: this.params.elementId,
				isSourceAudioEnabled: false,
			}),
		);
	}

	undo(): void {
		if (!this.savedState) {
			return;
		}

		const editor = EditorCore.getInstance();
		editor.timeline.updateTracks(this.savedState);
	}
}

function updateSourceAudioEnabled({
	tracks,
	trackId,
	elementId,
	isSourceAudioEnabled,
}: {
	tracks: SceneTracks;
	trackId: string;
	elementId: string;
	isSourceAudioEnabled: boolean;
}): SceneTracks {
	return updateElementInSceneTracks({
		tracks,
		trackId,
		elementId,
		elementPredicate: (element): element is VideoElement =>
			element.type === "video",
		update: (element) => ({
			...element,
			isSourceAudioEnabled,
		}),
	});
}
