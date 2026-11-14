// picked — the pictures and videos one after another in the row on the main track, the sounds under the film from 0 (a
// song fitted to the film) — as one undo step, the playhead staying at 0. Into a project that has something on its
// timeline nothing is placed by itself: the files wait in Media, selected. (It used to place the first video only: of
// six files imported together, one reached the timeline — blind1 S3-1.)
import { create } from "zustand";
import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { placeAssetsInRow } from "@/timeline/placement/row-place";
import { ZERO_MEDIA_TIME } from "@/wasm";

export function timelineIsEmpty(editor: EditorCore): boolean {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return false;
	return [tracks.main, ...tracks.overlay, ...tracks.audio].every((track) => track.elements.length === 0);
}

export function placeImportIfEmpty(editor: EditorCore, assets: Array<MediaAsset | null | undefined>): number {
	const list = assets.filter((a): a is MediaAsset => !!a);
	if (!list.some((a) => a.type === "video" || a.type === "image")) return 0;
	if (!timelineIsEmpty(editor)) return 0;
	const { commands } = placeAssetsInRow({ editor, assets: list, at: ZERO_MEDIA_TIME, soundAt: ZERO_MEDIA_TIME });
	if (commands > 0) editor.playback.seek({ time: ZERO_MEDIA_TIME });
	return commands;
}

/** The old name, kept for callers outside Media. */
export const placeFirstVideoIfEmpty = placeImportIfEmpty;

/** The files of the last import, in the order picked: Media shows them as new for a moment (SelectableSurface `newIds`), never selects them. */
export const useImportedSelection = create<{ pick: { ids: string[]; at: number } | null; set: (ids: string[]) => void }>((set) => ({
	pick: null,
	set: (ids) => set({ pick: { ids, at: Date.now() } }),
}));
