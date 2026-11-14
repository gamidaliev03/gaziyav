import { useEditor } from "@/editor/use-editor";
import { linkedItemIdsCached } from "@/timeline/linked-items";
import { useTimelineStore } from "@/timeline/timeline-store";

const NONE: ReadonlySet<string> = new Set();
const OFF: never[] = [];

/** The items that move with the selected main-track clips (timeline/linked-items.ts): one answer shared by every row. */
export function useLinkedItemIds(): ReadonlySet<string> {
	const enabled = useTimelineStore((s) => s.linkageEnabled);
	const kinds = useTimelineStore((s) => s.linkageKinds);
	return useEditor(
		(e) => {
			const scene = e.scenes.getActiveSceneOrNull();
			return scene ? linkedItemIdsCached(scene.tracks, e.selection.getSelectedElements(), enabled ? kinds : OFF) : NONE;
		},
		["selection", "scenes", "timeline"],
	);
}
