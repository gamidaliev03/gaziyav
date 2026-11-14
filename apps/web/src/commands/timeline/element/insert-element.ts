import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type {
	CreateTimelineElement,
	SceneTracks,
	TimelineElement,
	TrackType,
} from "@/timeline";
import { generateUUID } from "@/utils/id";
import { requiresMediaId } from "@/timeline/element-utils";
import type { MediaAsset } from "@/media/types";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import { floatToFrameRate } from "@/fps/utils";
import { graphicsRegistry, registerDefaultGraphics } from "@/graphics";
import {
	applyPlacement,
	canElementGoOnTrack,
	resolveTrackPlacement,
	validateElementTrackCompatibility,
	type PlacementStrategy,
} from "@/timeline/placement";
import { roundMediaTime } from "@/wasm";
import { endOnFrame } from "@/timeline/frame-grid";
import { generatorOf } from "@/generators/document";

type InsertElementPlacement =
	| { mode: "explicit"; trackId: string }
	| { mode: "auto"; trackType?: TrackType; insertIndex?: number; newTrack?: boolean; preferTrackId?: string };

/** The auto placement for a drop: on the track under the cursor when it has room there, else where auto puts it. */
/** The track under the cursor is tried first (a drop on a free spot of a lower track stays there, not the top one). */
function strategyFor(placement: InsertElementPlacement, tracks: SceneTracks): PlacementStrategy {
	if (placement.mode === "explicit") return { type: "explicit", trackId: placement.trackId };
	if (placement.newTrack) return { type: "alwaysNew", position: "highest" };
	if (placement.preferTrackId) {
		const index = [...tracks.overlay, tracks.main, ...tracks.audio].findIndex((track) => track.id === placement.preferTrackId);
		if (index >= 0) return { type: "preferIndex", trackIndex: index, hoverDirection: "above" };
	}
	return { type: "firstAvailable" };
}

/** A drop's hint: the track under the cursor, or the new track the drop line showed (at that index, not the top one). */
export function autoPlacement(hint?: { trackId?: string; newTrackIndex?: number }): InsertElementPlacement {
	if (typeof hint?.newTrackIndex === "number") return { mode: "auto", newTrack: true, insertIndex: hint.newTrackIndex };
	return hint?.trackId ? { mode: "auto", preferTrackId: hint.trackId } : { mode: "auto" };
}

export interface InsertElementParams {
	element: CreateTimelineElement;
	placement: InsertElementPlacement;
}

export class InsertElementCommand extends Command {
	private elementId: string;
	private savedState: SceneTracks | null = null;
	private targetTrackId: string | null = null;

	constructor({ element, placement }: InsertElementParams) {
		super();
		this.elementId = generateUUID();
		this.element = element;
		this.placement = placement;
	}

	private element: CreateTimelineElement;
	private placement: InsertElementPlacement;

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		if (!this.validateElementBasics({ element: this.element })) {
			return;
		}

		const totalElementsInTimeline =
			this.savedState.main.elements.length +
			this.savedState.overlay.reduce(
				(total, track) => total + track.elements.length,
				0,
			) +
			this.savedState.audio.reduce(
				(total, track) => total + track.elements.length,
				0,
			);
		const isFirstElement = totalElementsInTimeline === 0;

		const newElement = this.onProjectFrames({
			editor,
			element: this.buildElement({ element: this.element }),
			isFirstElement,
		});
		const updateResult = this.applyPlacementResult({
			tracks: this.savedState,
			element: newElement,
		});

		if (!updateResult) {
			return;
		}

		const { updatedTracks, targetTrackId } = updateResult;
		this.targetTrackId = targetTrackId;

		const isVisualMedia =
			newElement.type === "video" || newElement.type === "image";

		// A format picked on the start page (originalCanvasSize already set) is kept as chosen.
		const formatChosen = !!editor.project.getActiveOrNull()?.settings.originalCanvasSize;
		if (isFirstElement && isVisualMedia && !formatChosen) {
			const mediaAssets = editor.media.getAssets();
			const activeProject = editor.project.getActive();
			const asset = mediaAssets.find(
				(item: MediaAsset) => item.id === newElement.mediaId,
			);

			const assetSize =
				asset?.width && asset?.height
					? { width: asset.width, height: asset.height }
					: null;
			// CapCut's «Original»: the first clip gives the canvas its shape, wide or vertical — its shape, not a smaller
			// resolution: a 1280×720 picture (an AI image) made the project 720p and the export defaulted to 720P (exam 03.11).
			// The long side stays at least 1920, as CapCut exports 1080P from any source.
			if (assetSize) {
				const scale = Math.max(1, 1920 / Math.max(assetSize.width, assetSize.height));
				const nextCanvasSize = { width: 2 * Math.round((assetSize.width * scale) / 2), height: 2 * Math.round((assetSize.height * scale) / 2) };
				const shouldSetOriginalCanvasSize =
					!activeProject?.settings.originalCanvasSize;
				editor.project.updateSettings({
					settings: {
						canvasSize: nextCanvasSize,
						...(shouldSetOriginalCanvasSize
							? { originalCanvasSize: nextCanvasSize }
							: {}),
					},
					pushHistory: false,
				});
			}

			if (asset?.type === "video" && asset?.fps) {
				editor.project.updateSettings({
					settings: { fps: floatToFrameRate(asset.fps) },
					pushHistory: false,
				});
			}
		}

		editor.timeline.updateTracks(updatedTracks);

		return {
			selection: {
				selectedElements: [
					{ trackId: targetTrackId, elementId: this.elementId },
				],
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

	getElementId(): string {
		return this.elementId;
	}

	getTrackId(): string | null {
		return this.targetTrackId;
	}

	private buildElement({
		element,
	}: {
		element: CreateTimelineElement;
	}): TimelineElement {
		return {
			...element,
			id: this.elementId,
			startTime: element.startTime,
			trimStart: element.trimStart ?? 0,
			trimEnd: element.trimEnd ?? 0,
			duration: element.duration ?? DEFAULT_NEW_ELEMENT_DURATION,
		} as TimelineElement;
	}

	/**
	 * Its end on the project's frames (timeline/frame-grid.ts), the first clip's at the rate it gives the project: a clip
	 * as long as its file ended between frames, and so did the start of the next one put after it.
	 */
	private onProjectFrames({
		editor,
		element,
		isFirstElement,
	}: {
		editor: EditorCore;
		element: TimelineElement;
		isFirstElement: boolean;
	}): TimelineElement {
		const settings = editor.project.getActiveOrNull()?.settings;
		const firstVideo =
			isFirstElement && !settings?.originalCanvasSize && element.type === "video"
				? editor.media.getAssets().find((item: MediaAsset) => item.id === element.mediaId)
				: undefined;
		const fps = firstVideo?.type === "video" && firstVideo.fps ? floatToFrameRate(firstVideo.fps) : settings?.fps;
		return fps ? endOnFrame(element, fps) : element;
	}

	private validateElementBasics({
		element,
	}: {
		element: CreateTimelineElement;
	}): boolean {
		if (requiresMediaId({ element }) && !("mediaId" in element)) {
			console.error("Element requires mediaId");
			return false;
		}

		if (
			element.type === "audio" &&
			element.sourceType === "library" &&
			!element.sourceUrl
		) {
			console.error("Library audio element must have sourceUrl");
			return false;
		}

		if (element.type === "sticker" && !element.stickerId) {
			console.error("Sticker element must have stickerId");
			return false;
		}

		if (element.type === "graphic") {
			registerDefaultGraphics();
			if (
				!element.definitionId ||
				!graphicsRegistry.has(element.definitionId)
			) {
				console.error("Graphic element must have a valid definitionId");
				return false;
			}
		}

		if (element.type === "text" && !element.params.content) {
			console.error("Text element must have content");
			return false;
		}

		if (element.type === "effect" && !element.effectType) {
			console.error("Effect element must have effectType");
			return false;
		}

		return true;
	}

	private applyPlacementResult({
		tracks,
		element,
	}: {
		tracks: SceneTracks;
		element: TimelineElement;
	}): { updatedTracks: SceneTracks; targetTrackId: string } | null {
		const placement = this.placement;

		if (
			placement.mode === "auto" &&
			placement.trackType &&
			!canElementGoOnTrack({
				elementType: element.type,
				trackType: placement.trackType,
			})
		) {
			console.error(
				`${element.type} elements cannot be placed on ${placement.trackType} tracks`,
			);
			return null;
		}

		const groundInRow =
			placement.mode === "explicit" && placement.trackId === tracks.main.id && element.type === "graphic" && generatorOf(element)?.role === "ground";
		const placementResult = resolveTrackPlacement({
			tracks,
			...(placement.mode === "auto" && placement.trackType
				? { trackType: placement.trackType }
				: groundInRow
					? { trackType: "video" as const }
					: { elementType: element.type }),
			timeSpans: [
				{
					startTime: element.startTime,
					duration: element.duration,
				},
			],
			strategy: strategyFor(placement, tracks),
		});
		if (!placementResult) {
			if (placement.mode === "explicit") {
				const targetTrack =
					tracks.main.id === placement.trackId
						? tracks.main
						: (tracks.overlay.find((track) => track.id === placement.trackId) ??
							tracks.audio.find((track) => track.id === placement.trackId));
				if (!targetTrack) {
					console.error("Track not found:", placement.trackId);
					return null;
				}

				const validation = validateElementTrackCompatibility({
					element,
					track: targetTrack,
				});
				console.error(validation.errorMessage);
			}

			return null;
		}

		const elementToPlace =
			placementResult.kind === "existingTrack"
				? {
						...element,
						startTime:
							placementResult.adjustedStartTime !== undefined
								? roundMediaTime({
										time: placementResult.adjustedStartTime,
									})
								: element.startTime,
					}
				: element;

		const appliedPlacement = applyPlacement({
			tracks,
			placementResult,
			elements: [elementToPlace],
			newTrackInsertIndexOverride:
				placement.mode === "auto" && typeof placement.insertIndex === "number"
					? placement.insertIndex
					: undefined,
		});
		if (!appliedPlacement) {
			return null;
		}

		return {
			updatedTracks: appliedPlacement.updatedTracks,
			targetTrackId: appliedPlacement.targetTrackId,
		};
	}
}
