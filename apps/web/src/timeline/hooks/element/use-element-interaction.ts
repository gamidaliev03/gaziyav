import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { useEditor } from "@/editor/use-editor";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { useAltKey, useSnapSuspendKey } from "@/hooks/use-snap-suspend-key";
import { moveOrDuplicateOnAltDrag } from "@/actions/alt-drag-duplicate";
import { useElementSelectionActions } from "@/timeline/hooks/element/use-element-selection";
import {
	ElementInteractionController,
	type ElementInteractionDeps,
	type ElementInteractionDepsRef,
} from "@/timeline/controllers/element-interaction-controller";
import type { SnapPoint } from "@/timeline/snapping";
import { TracksEditCommand } from "@/actions/tracks-edit-command";

interface UseElementInteractionProps {
	zoomLevel: number;
	tracksContainerRef: RefObject<HTMLDivElement | null>;
	tracksScrollRef: RefObject<HTMLDivElement | null>;
	headerRef?: RefObject<HTMLElement | null>;
	snappingEnabled: boolean;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export function useElementInteraction({
	zoomLevel,
	tracksContainerRef,
	tracksScrollRef,
	headerRef,
	snappingEnabled,
	onSnapPointChange,
}: UseElementInteractionProps) {
	const editor = useEditor();
	const isShiftHeldRef = useSnapSuspendKey();
	const isAltHeldRef = useAltKey();
	// Live reads at event time; subscribing here re-rendered the whole timeline on every click.
	const selection = useElementSelectionActions();

	const deps: ElementInteractionDeps = {
		viewport: {
			getZoomLevel: () => zoomLevel,
			getTracksScrollEl: () => tracksScrollRef.current,
			getTracksContainerEl: () => tracksContainerRef.current,
			getHeaderEl: () => headerRef?.current ?? null,
		},
		input: {
			isShiftHeld: () => isShiftHeldRef.current,
		},
		scene: {
			getTracks: () => editor.scenes.getActiveScene().tracks,
			getActiveFps: () => editor.project.getActive()?.settings.fps ?? null,
		},
		selection: {
			getSelected: selection.getSelectedElements,
			isSelected: selection.isElementSelected,
			groupOf: selection.groupOf,
			select: selection.selectElement,
			handleClick: selection.handleElementClick,
			clearKeyframeSelection: () => editor.selection.clearKeyframeSelection(),
		},
		playback: {
			getCurrentTime: () => editor.playback.getCurrentTime(),
		},
		timeline: {
			moveElements: (args) =>
				moveOrDuplicateOnAltDrag({
					editor,
					...args,
					duplicate: isAltHeldRef.current,
				}),
		},
		snap: {
			isEnabled: () => snappingEnabled,
			onChange: onSnapPointChange,
		},
		magnet: {
			getTrackId: () =>
				editor.command.isRippleEnabled ? editor.scenes.getActiveScene().tracks.main.id : null,
			getTrackRowRect: (trackId) =>
				tracksContainerRef.current
					?.querySelector(`[data-timeline-track-row="${CSS.escape(trackId)}"]`)
					?.getBoundingClientRect() ?? null,
			isCopy: () => isAltHeldRef.current,
			preview: (updates) =>
				editor.timeline.previewElements({
					updates: updates.map(({ trackId, elementId, startTime }) => ({
						trackId,
						elementId,
						updates: { startTime },
					})),
				}),
			discardPreview: () => editor.timeline.discardPreview(),
			commit: ({ trackId, elements, selection }) => {
				const before = editor.scenes.getActiveScene().tracks;
				if (before.main.id !== trackId) return;
				// A clip brought down from a layer track leaves it (and the layer track goes when that left it empty).
				const onMain = new Set(elements.map((element) => element.id));
				const leave = <T extends { elements: readonly { id: string }[] }>(tracks: T[]): T[] =>
					tracks.flatMap((track) => {
						if (!track.elements.some((element) => onMain.has(element.id))) return [track];
						const rest = track.elements.filter((element) => !onMain.has(element.id));
						return rest.length ? [{ ...track, elements: rest } as T] : [];
					});
				editor.command.execute({
					// The final layout (closed up and pushed along): the magnet must not ripple it again.
					command: new TracksEditCommand({
						before,
						after: { ...before, main: { ...before.main, elements } as typeof before.main, overlay: leave(before.overlay), audio: leave(before.audio) },
						selection,
						noEngineRipple: true,
					}),
				});
			},
		},
	};
	const depsRef = useCommittedRef(deps) as ElementInteractionDepsRef;
	const [controller] = useState(
		() => new ElementInteractionController({ depsRef }),
	);

	// Only the start and the end of a drag re-render the caller (the whole timeline). The moving clip,
	// the drop line and the auto-scroll read the live view from the controller themselves.
	const isDragging = useSyncExternalStore(
		controller.subscribe,
		() => controller.isDragging,
		() => false,
	);

	useEffect(() => () => controller.destroy(), [controller]);

	return {
		dragController: controller,
		isDragging,
		handleElementMouseDown: controller.onElementMouseDown,
		handleElementClick: controller.onElementClick,
	};
}
