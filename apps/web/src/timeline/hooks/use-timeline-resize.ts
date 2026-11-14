import { useEffect, useReducer, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { useSnapSuspendKey } from "@/hooks/use-snap-suspend-key";
import { useTimelineStore } from "@/timeline/timeline-store";
import { clickSelect } from "@/timeline/hooks/element/use-element-selection";
import { registerCanceller } from "@/editor/cancel-interaction";
import {
	ResizeController,
	type ResizeConfig,
} from "@/timeline/controllers/resize-controller";
import type { ResizeSide } from "@/timeline/group-resize";
import type { SnapPoint } from "@/timeline/snapping";
import type { TimelineElement } from "@/timeline";
import { applyElementUpdate } from "@/timeline/update-pipeline";

export type { ResizeSide };

interface UseTimelineResizeProps {
	zoomLevel: number;
	tracksScrollRef?: React.RefObject<HTMLDivElement | null>;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export function useTimelineResize({
	zoomLevel,
	tracksScrollRef,
	onSnapPointChange,
}: UseTimelineResizeProps) {
	const editor = useEditor();
	const isShiftHeldRef = useSnapSuspendKey();
	const snappingEnabled = useTimelineStore((state) => state.snappingEnabled);

	const config: ResizeConfig = {
		zoomLevel,
		snappingEnabled,
		isShiftHeld: () => isShiftHeldRef.current,
		getSceneTracks: () => editor.scenes.getActiveScene().tracks,
		getCurrentPlayheadTime: () => editor.playback.getCurrentTime(),
		getActiveProjectFps: () => editor.project.getActive()?.settings.fps ?? null,
		getScrollLeft: () => tracksScrollRef?.current?.scrollLeft ?? 0,
		getRippleTrackId: () => (editor.command.isRippleEnabled ? editor.scenes.getActiveScene().tracks.main.id : null),
		// Read when a trim starts (live): this hook lives in the timeline shell, which no longer
		// re-renders on selection changes.
		get selectedElements() {
			return editor.selection.getSelectedElements();
		},
		discardPreview: () => editor.timeline.discardPreview(),
		previewElements: (updates) => {
			const tracks = editor.scenes.getActiveScene().tracks;
			const all = [tracks.main, ...tracks.overlay, ...tracks.audio];
			editor.timeline.previewElements({
				updates: updates.map(({ trackId, elementId, patch }) => {
					const element = all.find((track) => track.id === trackId)?.elements.find((e) => e.id === elementId);
					// The keyframes the commit will have (a left trim keeps them on their frame of the picture): without
					// them the preview showed the old keyframes until the mouse was released.
					const animations = element
						? applyElementUpdate({ element, patch: patch as Partial<TimelineElement>, context: { tracks, trackId } })
								.animations
						: undefined;
					return {
						trackId,
						elementId,
						updates: (element ? { ...patch, animations } : patch) as Partial<TimelineElement>,
					};
				}),
			});
		},
		commitElements: (updates) =>
			editor.timeline.updateElements({
				updates: updates.map(({ trackId, elementId, patch }) => ({
					trackId,
					elementId,
					patch: patch as Partial<TimelineElement>,
				})),
			}),
		onSnapPointChange,
		// one rule for a click on a clip, edge or body (timeline/selection-click.ts)
		selectOnClick: (ref, additive, range = false) => clickSelect(editor, ref, { range, toggle: additive && !range }),
	};
	const configRef = useCommittedRef(config);
	const [controller] = useState(() => new ResizeController({ configRef }));

	const [, rerender] = useReducer((n: number) => n + 1, 0);
	useEffect(() => controller.subscribe(rerender), [controller]);

	useEffect(() => {
		if (!controller.isResizing) return;
		return registerCanceller({ fn: () => controller.cancel() });
	}, [controller.isResizing, controller]);

	useEffect(() => () => controller.destroy(), [controller]);

	return {
		isResizing: controller.isResizing,
		handleResizeStart: controller.onResizeStart,
		getResizePointerX: () => controller.getLastClientX(),
	};
}
