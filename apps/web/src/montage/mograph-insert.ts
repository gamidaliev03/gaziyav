// A ready-made motion graphic onto the timeline: one clip (ai.<Kind>) with every field at its default, on its own
// track above the video, as one ⌘Z step. The clip plays in the editor's Remotion layer and renders on export.
import { autoPlacement } from "@/commands/timeline/element/insert-element";
import type { DropHint } from "@/timeline/drag";
import { InsertElementCommand } from "@/commands";
import type { EditorCore } from "@/core";
import type { CreateGraphicElement } from "@/timeline/types";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { AI_PREFIX } from "./catalog";
import { type MographKind, mographDefaults } from "./mograph";

const ticks = (seconds: number) =>
	mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });

export function mographElement(
	kind: MographKind,
	at: number,
): CreateGraphicElement {
	return {
		type: "graphic",
		name: kind.label,
		definitionId: `${AI_PREFIX}${kind.kind}`,
		startTime: ticks(Math.max(0, at)),
		duration: ticks(kind.dur),
		trimStart: ticks(0),
		trimEnd: ticks(0),
		params: mographDefaults(kind),
	};
}

/** Adds the graphic at `at` seconds (the playhead when not given). */
export function insertMograph(
	editor: EditorCore,
	kind: MographKind,
	at?: number, hint?: DropHint
): void {
	if (!editor.project.getActiveOrNull()) return;
	const start = at ?? editor.playback.getCurrentTime() / TICKS_PER_SECOND;
	editor.command.execute({
		command: new InsertElementCommand({
			element: mographElement(kind, start),
			placement: autoPlacement(hint),
		}),
	});
}
