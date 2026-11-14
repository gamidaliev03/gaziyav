// Export → ad marking for Russia: «Реклама · <advertiser> · erid: <token>» on the whole video (the law wants the
// label on every ad creative). Added to the timeline as its own text track before the render: visible, editable,
// one ⌘Z removes it; an export again updates that same label instead of adding a second one.
import { AddTrackCommand, BatchCommand, InsertElementCommand } from "@/commands";
import type { EditorCore } from "@/core";
import { buildTextElement } from "@/timeline/element-utils";

const PREFIX = "Реклама";

/** "Реклама · ООО Ромашка · erid: 2SDnjc…"; the advertiser is optional, the erid is not. */
export function adLabelText({ advertiser, erid }: { advertiser?: string; erid: string }): string {
	const who = advertiser?.trim();
	return [PREFIX, ...(who ? [who] : []), `erid: ${erid.trim()}`].join(" · ");
}

/** An erid token as ORD registries issue it: letters and digits, no spaces. */
export function isEridToken(value: string): boolean {
	return /^[A-Za-z0-9]{6,64}$/.test(value.trim());
}

/** Puts the label over the whole timeline (top-left, inside every platform's safe zone), or updates the one there. */
export function placeAdLabel(editor: EditorCore, text: string): void {
	const duration = editor.timeline.getTotalDuration();
	const canvas = editor.project.getActive().settings.canvasSize;
	for (const track of editor.scenes.getActiveScene().tracks.overlay) {
		if (track.type !== "text") continue;
		const label = track.elements.find((element) => element.type === "text" && String(element.params.content ?? "").startsWith(`${PREFIX} ·`));
		if (!label) continue;
		editor.timeline.updateElements({
			updates: [{ trackId: track.id, elementId: label.id, patch: { startTime: 0, duration, params: { ...label.params, content: text } } as never }],
		});
		return;
	}
	const add = new AddTrackCommand({ type: "text", index: 0 });
	const element = buildTextElement({
		startTime: 0 as never,
		raw: {
			name: "Ad label",
			duration,
			params: {
				content: text,
				fontFamily: "Inter",
				fontWeight: "600",
				fontSize: 1.6,
				color: "#ffffff",
				textAlign: "left",
				"background.enabled": true,
				"background.color": "#00000080",
				"background.cornerRadius": 8,
				"background.paddingX": 10,
				"background.paddingY": 6,
				// Left-aligned text starts at its position: the left edge at 6.5 %, below the 14 % top band every
				// platform keeps free, so a long advertiser name still ends before the right rail.
				"transform.positionX": -canvas.width * 0.435,
				"transform.positionY": -canvas.height * 0.33,
			},
		},
	});
	editor.command.execute({
		command: new BatchCommand([add, new InsertElementCommand({ placement: { mode: "explicit", trackId: add.getTrackId() }, element })]),
	});
	editor.selection.clearSelection();
}
