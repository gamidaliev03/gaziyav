// Snap-to-beat: markers (beat markers included) are snap points for moving and trimming clips, as in Kadr
// ("clips snap to them"). The playhead and marker drags already snap to markers.
import { EditorCore } from "@/core";
import { getBookmarkSnapPoints } from "@/timeline/bookmarks/snap-source";
import type { SnapPoint } from "@/timeline/snapping";

export function getMarkerSnapPoints(): SnapPoint[] {
	try {
		const bookmarks = EditorCore.getInstance().scenes.getActiveSceneOrNull()?.bookmarks ?? [];
		return bookmarks.length ? getBookmarkSnapPoints({ bookmarks }) : [];
	} catch {
		return []; // no editor (unit tests)
	}
}
