import { useEditor } from "@/editor/use-editor";
import { findTrackInSceneTracks, type TimelineElement } from "@/timeline";
import { findElementOnTrack } from "@/timeline/element-index";
import { speedOff } from "@/timeline/speed-flags";

/**
 * Subscribes to render tracks and returns the live (preview-aware) version of
 * an element alongside helpers for previewing and committing updates.
 *
 * Use this wherever property fields need to reflect in-progress preview state
 * (e.g. a slider being dragged) rather than the last committed value.
 */
export function useElementPreview<T extends TimelineElement>({
	trackId,
	elementId,
	fallback,
}: {
	trackId: string;
	elementId: string;
	fallback: T;
}) {
	const editor = useEditor();
	useEditor((e) => e.timeline.getPreviewTracks());

	const previewTracks = editor.timeline.getPreviewTracks();
	const renderElement =
		(findTrackInSceneTracks({
			tracks: previewTracks ?? editor.scenes.getActiveScene().tracks,
			trackId,
		})?.elements.find((element) => element.id === elementId) as T | undefined) ??
		fallback;

	const previewUpdates = (updates: Partial<TimelineElement>) =>
		editor.timeline.previewElements({
			updates: [{ trackId, elementId, updates }],
		});

	const commit = () => editor.timeline.commitPreview();

	return { renderElement, previewUpdates, commit };
}

/**
 * Narrow variant for the timeline: returns this element's in-progress preview
 * (or null when nothing is being previewed). Only the previewed element
 * re-renders while a slider is dragged; the rest of the timeline stays put.
 */
export function useElementPreviewOverride<T extends TimelineElement>({
	trackId,
	elementId,
}: {
	trackId: string;
	elementId: string;
}): T | null {
	return useEditor(
		(editor) => {
			const previewTracks = editor.timeline.getPreviewTracks();
			const committedTracks = editor.scenes.getActiveSceneOrNull()?.tracks;
			if (!previewTracks || previewTracks === committedTracks) {
				return null;
			}
			// By the preview tracks' id index, built once per preview step: every mounted clip looks itself up on each
			// step of a preview (a letter typed in a title, a slider dragged), and a scan of its track made that
			// clips × track length per keystroke — 2 500 captions zoomed to fit were ~6 M comparisons.
			const previewed = findElementOnTrack({ tracks: previewTracks, trackId, elementId })?.element as T | undefined;
			if (!previewed) return null;
			// A preview of some other clip (a letter typed in a title, a slider, a neighbour dragged) leaves this one as
			// it is: nothing to override. Every mounted clip used to get its own committed element back here and render
			// again when a preview began and when it ended.
			if (!speedOff("previewSame") && committedTracks && findElementOnTrack({ tracks: committedTracks, trackId, elementId })?.element === previewed) {
				return null;
			}
			return previewed;
		},
		["timeline", "scenes"],
	);
}
