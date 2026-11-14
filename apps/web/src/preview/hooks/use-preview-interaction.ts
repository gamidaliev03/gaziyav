import { useEffect, useReducer, useRef, useState } from "react";
import { TracksEditCommand } from "@/actions/tracks-edit-command";
import { useEditor } from "@/editor/use-editor";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { usePreviewViewport } from "@/preview/components/preview-viewport";
import type { SnapLine } from "@/preview/preview-snap";
import { registerCanceller } from "@/editor/cancel-interaction";
import {
	PreviewInteractionController,
	type PreviewInteractionDeps,
	type PreviewInteractionDepsRef,
} from "@/preview/controllers/preview-interaction-controller";
import { withFrameDragCopies } from "@/preview/drag-copies";
import { expandToGroups } from "@/timeline/groups";
import { withoutLockedClips } from "@/timeline/track-lock";
import type { ElementRef, SceneTracks } from "@/timeline";
import { generateUUID } from "@/utils/id";

export type OnSnapLinesChange = (lines: SnapLine[]) => void;

export function usePreviewInteraction({
	onSnapLinesChange,
	isMaskMode = false,
}: {
	onSnapLinesChange?: OnSnapLinesChange;
	isMaskMode?: boolean;
}) {
	const editor = useEditor();
	const viewport = usePreviewViewport();
	// A ⌥-drag in progress: the tracks and selection before its copies were put in.
	const duplicateRef = useRef<{ before: SceneTracks; selection: ElementRef[]; copies: ElementRef[] } | null>(null);
	const deps: PreviewInteractionDeps = {
		viewport: {
			screenToCanvas: viewport.screenToCanvas,
			screenPixelsToLogicalThreshold: viewport.screenPixelsToLogicalThreshold,
		},
		scene: {
			// A clip of a locked track (🔒) can't be picked or dragged on the frame either.
			getTracks: () => withoutLockedClips(editor.scenes.getActiveScene().tracks),
			getCurrentTime: () => editor.playback.getCurrentTime(),
			getMediaAssets: () => editor.media.getAssets(),
			getCanvasSize: () => editor.project.getActive().settings.canvasSize,
		},
		selection: {
			getSelected: () => editor.selection.getSelectedElements(),
			// A grouped clip (⌘G) is picked with its group, as on the timeline.
			setSelected: (elements) =>
				editor.selection.setSelectedElements({
					elements: expandToGroups({ tracks: editor.scenes.getActiveScene().tracks, elements }),
				}),
			clearSelection: () => editor.selection.clearSelection(),
			groupOf: (element) => expandToGroups({ tracks: editor.scenes.getActiveScene().tracks, elements: [element] }),
		},
		timeline: {
			getElementsWithTracks: ({ elements }) =>
				editor.timeline.getElementsWithTracks({ elements: [...elements] }),
			previewElements: (updates) =>
				editor.timeline.previewElements({ updates: [...updates] }),
			commitPreview: () => editor.timeline.commitPreview(),
			discardPreview: () => editor.timeline.discardPreview(),
			beginDuplicate: (elements) => {
				const before = editor.scenes.getActiveScene().tracks;
				const { tracks, copies } = withFrameDragCopies({ tracks: before, elements, newId: generateUUID });
				if (copies.length === 0) return null;
				duplicateRef.current = { before, selection: [...editor.selection.getSelectedElements()], copies };
				// Outside the history: the drop makes one undo step of copies + move.
				editor.timeline.updateTracks(tracks);
				editor.selection.setSelectedElements({ elements: copies });
				return copies;
			},
			commitDuplicate: () => {
				const duplicate = duplicateRef.current;
				duplicateRef.current = null;
				if (!duplicate) return;
				const after = editor.timeline.getPreviewTracks() ?? editor.scenes.getActiveScene().tracks;
				editor.timeline.discardPreview();
				editor.command.execute({
					command: new TracksEditCommand({ before: duplicate.before, after, selection: duplicate.copies, noEngineRipple: true }),
				});
			},
			discardDuplicate: () => {
				const duplicate = duplicateRef.current;
				duplicateRef.current = null;
				if (!duplicate) return;
				editor.timeline.discardPreview();
				editor.timeline.updateTracks(duplicate.before);
				editor.selection.setSelectedElements({ elements: duplicate.selection });
			},
		},
		playback: {
			getIsPlaying: () => editor.playback.getIsPlaying(),
			subscribe: (listener) => editor.playback.subscribe(listener),
		},
		preview: {
			isMaskMode: () => isMaskMode,
			onSnapLinesChange,
		},
	};
	const depsRef = useCommittedRef(deps) as PreviewInteractionDepsRef;
	const [controller] = useState(
		() => new PreviewInteractionController({ depsRef }),
	);

	const [, rerender] = useReducer((n: number) => n + 1, 0);
	useEffect(
		() => controller.subscribe({ listener: rerender }),
		[controller],
	);

	useEffect(() => {
		if (!controller.isDragging) return;
		return registerCanceller({ fn: () => controller.cancel() });
	}, [controller.isDragging, controller]);

	useEffect(() => () => controller.destroy(), [controller]);

	return {
		onPointerDown: controller.onPointerDown,
		onPointerMove: controller.onPointerMove,
		onPointerUp: controller.onPointerUp,
		onDoubleClick: controller.onDoubleClick,
		editingText: controller.editingText,
		commitTextEdit: controller.commitTextEdit,
	};
}
