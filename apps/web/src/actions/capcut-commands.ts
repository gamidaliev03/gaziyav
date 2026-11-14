import { BatchCommand } from "@/commands/batch-command";
import { ToggleBookmarkCommand } from "@/commands/scene/toggle-bookmark";
import { UpdateBookmarkCommand } from "@/commands/scene/update-bookmark";
import type { EditorCore } from "@/core";
import { getElementParams, readElementParamValue, writeElementParamValue } from "@/params/registry";
import { usePreviewStore } from "@/preview/preview-store";
import { getFrameTime } from "@/timeline/bookmarks/index";
import { DEFAULT_TIMELINE_BOOKMARK_COLOR } from "@/timeline/components/theme";
import { useTimelineStore } from "@/timeline/timeline-store";
import type { ElementRef } from "@/timeline/types";
import { mediaTime } from "@/wasm";

/**
 * CapCut keys whose commands Gaziyav lacked (docs/capcut/keymap-default.json): markers ⌥M ⇧M ⌥⇧M, volume ⌘. ⌘,,
 * keyframe panel ⌥K, guides ⌘; and rulers ⌥⌘R. Editor-level so the key test can run them without React.
 */

/** ⌥M: the second marker color (CapCut's «marker with another color»). */
export const ALT_MARKER_COLOR = "#f5a623";

/** One step of ⌘. / ⌘, in dB (CapCut moves the selected clip's volume by 1 dB). */
export const VOLUME_STEP_DB = 1;

/** ⇧M / ⌥⇧M: the playhead to the next / previous marker. Returns the time moved to, or null when there is none. */
export function jumpToMarker(editor: EditorCore, direction: "previous" | "next"): number | null {
	const now = editor.playback.getCurrentTime();
	let best: number | null = null;
	for (const bookmark of editor.scenes.getActiveScene().bookmarks ?? []) {
		const time = bookmark.time;
		if (direction === "next" ? time > now && (best === null || time < best) : time < now && (best === null || time > best)) {
			best = time;
		}
	}
	if (best !== null) editor.playback.seek({ time: mediaTime({ ticks: best }) });
	return best;
}

/**
 * ⌥M: a marker in the other color at the playhead — one ⌘Z. On a marker already there, its color flips between the
 * two, like pressing ⌥M on it in CapCut.
 */
export function addMarkerInAnotherColor(editor: EditorCore): void {
	const project = editor.project.getActive();
	const time = getFrameTime({ time: editor.playback.getCurrentTime(), fps: project.settings.fps });
	const existing = editor.scenes.getBookmarkAtTime({ time });
	if (existing) {
		const color = (existing.color ?? DEFAULT_TIMELINE_BOOKMARK_COLOR) === ALT_MARKER_COLOR ? DEFAULT_TIMELINE_BOOKMARK_COLOR : ALT_MARKER_COLOR;
		editor.command.execute({ command: new UpdateBookmarkCommand({ time, updates: { color } }) });
		return;
	}
	editor.command.execute({
		command: new BatchCommand([new ToggleBookmarkCommand(time), new UpdateBookmarkCommand({ time, updates: { color: ALT_MARKER_COLOR } })]),
	});
}

/** ⌘. / ⌘,: the selected clips' volume up / down by `deltaDb`, within the parameter's range — one ⌘Z. */
export function changeSelectedVolume(editor: EditorCore, deltaDb: number): number {
	const updates = editor.timeline
		.getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
		.flatMap(({ track, element }) => {
			const param = getElementParams({ element }).find((candidate) => candidate.key === "volume");
			if (!param || param.type !== "number") return [];
			const current = Number(readElementParamValue({ element, param }) ?? param.default);
			const next = Math.min(param.max ?? Number.POSITIVE_INFINITY, Math.max(param.min ?? Number.NEGATIVE_INFINITY, current + deltaDb));
			if (next === current) return [];
			return [{ trackId: track.id, elementId: element.id, patch: writeElementParamValue({ element, param, value: next }) }];
		});
	if (updates.length > 0) editor.timeline.updateElements({ updates });
	return updates.length;
}

/** ⌥K: the keyframe lanes of the selected clips open or close (all follow the first one). */
export function toggleKeyframePanel(editor: EditorCore): number {
	const selected: ElementRef[] = editor.selection.getSelectedElements();
	if (selected.length === 0) return 0;
	const store = useTimelineStore.getState();
	const open = !store.expandedElementIds.has(selected[0].elementId);
	for (const { elementId } of selected) {
		if (useTimelineStore.getState().expandedElementIds.has(elementId) !== open) store.toggleElementExpanded(elementId);
	}
	return selected.length;
}

let lastGuide: string | null = null;

/** ⌘;: the player's guides off, or back on (the last one used; the grid the first time). */
export function toggleGuides(): void {
	const state = usePreviewStore.getState();
	if (state.activeGuide) {
		lastGuide = state.activeGuide;
		state.toggleGuide(state.activeGuide);
		return;
	}
	state.toggleGuide((lastGuide ?? "grid") as Parameters<typeof state.toggleGuide>[0]);
}

export const RULERS_OVERLAY_ID = "rulers";

/** ⌥⌘R: the player's rulers on / off. */
export function toggleRulers(): void {
	const state = usePreviewStore.getState();
	state.setOverlayVisibility({ overlayId: RULERS_OVERLAY_ID, isVisible: state.overlays[RULERS_OVERLAY_ID] !== true });
}
