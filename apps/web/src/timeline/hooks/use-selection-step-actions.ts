// tlc2's keys: ⌘← / ⌘→ select the previous / next clip on the track, the playhead to its start (timeline/selection-step.ts);
// ⌥W inserts the clip open in Media at the playhead.
import { toast } from "sonner";
import { useActionHandler } from "@/actions/use-action-handler";
import { insertSourceRange } from "@/components/editor/panels/assets/source/source-monitor";
import { useSourceStore } from "@/components/editor/panels/assets/source/source-store";
import { t as translate } from "@/i18n";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { expandToGroups } from "@/timeline/groups";
import { adjacentClip } from "@/timeline/selection-step";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";

export function stepSelection(editor: EditorCore, direction: 1 | -1): boolean {
	const scene = editor.scenes.getActiveSceneOrNull();
	if (!scene) return false;
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	const frame = fps ? (TICKS_PER_SECOND * fps.denominator) / fps.numerator : TICKS_PER_SECOND / 30;
	const selected = editor.selection.getSelectedElements();
	const from = editor.selection.getSelectionAnchor() ?? selected[selected.length - 1] ?? null;
	const next = adjacentClip({ tracks: scene.tracks, from, playhead: editor.playback.getCurrentTime() as number, half: frame / 2, direction });
	if (!next) return false;
	editor.selection.setSelectedElements({ elements: expandToGroups({ tracks: scene.tracks, elements: [next.ref] }), anchor: next.ref });
	editor.playback.seek({ time: mediaTime({ ticks: Math.max(0, Math.round(next.startTime)) }) });
	return true;
}

/** ⌥W (Final Cut: W): the clip open in Media — its In–Out, else all of it — inserted at the playhead, as Media's menu does. */
export function insertOpenMediaAtPlayhead(editor: EditorCore): boolean {
	const id = useSourceStore.getState().assetId;
	const asset = id ? editor.media.getAssets().find((a) => a.id === id) : undefined;
	if (!asset || !editor.scenes.getActiveSceneOrNull()) {
		toast.info(translate("Click a clip in Media first: it goes in at the playhead"), { id: "insert-at-playhead" });
		return false;
	}
	insertSourceRange({ editor, asset });
	return true;
}

export function useSelectionStepActions(): void {
	const editor = useEditor();
	useActionHandler("insert-at-playhead", () => void insertOpenMediaAtPlayhead(editor), undefined);
	useActionHandler("select-next-clip", () => void stepSelection(editor, 1), undefined);
	useActionHandler("select-previous-clip", () => void stepSelection(editor, -1), undefined);
}
