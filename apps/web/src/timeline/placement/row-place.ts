// the files of an import into an empty project. Pictures and videos go IN on the main track at a cut, in their order,
// as one undo step; sounds go under the film at the playhead, on a sound track (a song cut to the film's end, as a
// drop does). Not exported from ./index: it imports the commands, which import the placement.
import { BatchCommand } from "@/commands";
import type { Command } from "@/commands/base-command";
import { InsertElementCommand } from "@/commands/timeline";
import { TracksEditCommand } from "@/actions/tracks-edit-command";
import type { EditorCore } from "@/core";
import { buildLandingElement, buildSourceRangeElement } from "@/media/source-marks";
import type { MediaAsset } from "@/media/types";
import type { CreateTimelineElement, TimelineElement } from "@/timeline";
import { endOnFrame } from "@/timeline/frame-grid";
import { mediaTime, type MediaTime, TICKS_PER_SECOND } from "@/wasm";
import { insertIntoRow, rowCutAtPlayhead, withMainElements } from "./row";

const isPicture = (asset: MediaAsset) => asset.type === "video" || asset.type === "image";

function halfFrameTicks(editor: EditorCore): number {
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	return fps ? Math.floor((TICKS_PER_SECOND * fps.denominator) / fps.numerator / 2) : 0;
}

/**
 * Puts the assets in: pictures into the row at `at` (default: the cut at the playhead), sounds at `soundAt` (default: the
 * playhead). One undo step. Returns the time just after the last picture (where the playhead goes), or null when no
 * picture went in. `whole`: every file whole (a row of several); one file lands as a drop lands it (a song fitted).
 */
export function placeAssetsInRow({
	editor,
	assets,
	at,
	soundAt,
}: {
	editor: EditorCore;
	assets: readonly MediaAsset[];
	at?: MediaTime;
	soundAt?: MediaTime;
}): { end: MediaTime | null; commands: number } {
	const scene = editor.scenes.getActiveSceneOrNull();
	if (!scene || assets.length === 0) return { end: null, commands: 0 };
	const tracks = scene.tracks;
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	const playhead = editor.playback.getCurrentTime();
	const cut = at ?? rowCutAtPlayhead({ elements: tracks.main.elements, time: playhead, tolerance: halfFrameTicks(editor) });
	const pictures = assets.filter(isPicture);
	const sounds = assets.filter((asset) => !isPicture(asset));
	// the row's new clips, each ending on a frame, one after another from the cut
	const built: CreateTimelineElement[] = [];
	let cursor: number = cut;
	for (const asset of pictures) {
		let element = (assets.length === 1 ? buildLandingElement({ asset, startTime: mediaTime({ ticks: cursor }), tracks }) : buildSourceRangeElement({ asset, startTime: mediaTime({ ticks: cursor }) })) as CreateTimelineElement;
		if (fps) element = endOnFrame(element as TimelineElement, fps) as unknown as CreateTimelineElement;
		built.push(element);
		cursor += element.duration ?? 0;
	}
	const commands: Command[] = [];
	if (built.length > 0) {
		const { moved } = insertIntoRow({ elements: tracks.main.elements, at: cut, items: built.map((e) => ({ startTime: e.startTime, duration: e.duration ?? 0 })) });
		if (moved.some((element, i) => element !== tracks.main.elements[i])) {
			commands.push(new TracksEditCommand({ before: tracks, after: withMainElements(tracks, moved) }));
		}
		for (const element of built) commands.push(new InsertElementCommand({ element, placement: { mode: "explicit", trackId: tracks.main.id } }));
	}
	let soundCursor: number = soundAt ?? playhead;
	for (const asset of sounds) {
		const startTime = mediaTime({ ticks: soundCursor });
		// fitted to the film as it will be (the pictures above are in by then): the same rule as a drop
		const after = built.length > 0 ? { ...tracks, main: { ...tracks.main, elements: [...tracks.main.elements, ...(built as TimelineElement[])] } as typeof tracks.main } : tracks;
		const element = buildLandingElement({ asset, startTime, tracks: after });
		commands.push(new InsertElementCommand({ element, placement: { mode: "auto" } }));
		soundCursor += element.duration ?? 0;
	}
	if (commands.length === 0) return { end: null, commands: 0 };
	editor.command.execute({ command: commands.length === 1 ? commands[0] : new BatchCommand(commands) });
	return { end: built.length > 0 ? mediaTime({ ticks: cursor }) : null, commands: commands.length };
}

/** «+» / double-click / ↵ on Media items: into the row, the playhead to the new clip's end (five presses, five in a row). */
export function addAssetsAtPlayhead({ editor, assets }: { editor: EditorCore; assets: readonly MediaAsset[] }): void {
	const { end } = placeAssetsInRow({ editor, assets });
	if (end !== null) editor.playback.seek({ time: end });
}
