import type { EditorCore } from "@/core";
import { SplitElementsCommand } from "@/commands/timeline/element/split-elements";
import type { ElementRef, SceneTracks } from "@/timeline/types";
import { keepRange } from "./keep-range";
import { mediaTime } from "@/wasm";
import type { InOutRange } from "./store";

export { keepRange };

function elementsCrossing(tracks: SceneTracks, time: number): ElementRef[] {
	const result: ElementRef[] = [];
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		for (const element of track.elements) {
			if (time > element.startTime && time < element.startTime + element.duration) {
				result.push({ trackId: track.id, elementId: element.id });
			}
		}
	}
	return result;
}

/**
 * Tracks of the active scene cut to the In→Out range (for "Export In→Out" and lipsync
 * fragments). Uses the regular split (retime, animations and trims stay correct) on the
 * live scene, reads the result and restores the scene in the same task — nothing is
 * rendered or pushed to undo history.
 */
/**
 * Tracks of the active scene cut at `times` with the regular split (retime, animations and
 * trims stay correct). The live scene is restored in the same task — nothing is rendered
 * or pushed to undo history.
 */
export function splitActiveSceneAt({
	editor,
	times,
}: {
	editor: EditorCore;
	times: number[];
}): SceneTracks {
	const original = editor.scenes.getActiveScene().tracks;
	try {
		for (const time of times) {
			const targets = elementsCrossing(editor.scenes.getActiveScene().tracks, time);
			if (targets.length === 0) continue;
			new SplitElementsCommand({
				elements: targets,
				splitTime: mediaTime({ ticks: Math.round(time) }),
			}).execute();
		}
		return editor.scenes.getActiveScene().tracks;
	} finally {
		editor.timeline.updateTracks(original);
	}
}

/** Tracks of the active scene cut to the In→Out range and moved to 0 (Export In→Out). */
export function sliceActiveSceneToRange({
	editor,
	range,
}: {
	editor: EditorCore;
	range: InOutRange;
}): SceneTracks {
	return keepRange({
		tracks: splitActiveSceneAt({ editor, times: [range.start, range.end] }),
		range,
	});
}
