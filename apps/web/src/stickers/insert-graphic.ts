// A graphic from the library (Lottie: callouts, titles, lower thirds, stickers…) onto the timeline — shared by the
// Stickers tab and Gaziyav AI, so both place, size and time it the same way.
import { autoPlacement } from "@/commands/timeline/element/insert-element";
import type { DropHint } from "@/timeline/drag";
import type { EditorCore } from "@/core";
import { LOTTIE_GRAPHIC_ID } from "@/graphics/definitions/lottie";
import { fetchGraphicJson, type GraphicItem } from "@/graphics/lottie/library";
import { lottieTexts, lottieTextsEditable } from "@/graphics/lottie/player";
import { buildGraphicElement } from "@/timeline/element-utils";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";

export const TEXT_CATEGORIES = new Set(["Titles", "Lower Thirds", "Callouts", "Countdown"]);
const ticks = (seconds: number) => mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });

/** Inserts the graphic at `start` seconds (default: the playhead); returns where and how long. */
export async function insertGraphic(editor: EditorCore, item: GraphicItem, start?: number, hint?: DropHint): Promise<{ start: number; duration: number }> {
	const json = await fetchGraphicJson(item);
	const { width, height } = editor.project.getActive().settings.canvasSize;
	const textual = TEXT_CATEGORIES.has(item.category) || item.texts > 0;
	const duration = Math.max(item.duration, textual ? 4 : 2);
	const landscape = item.w / Math.max(1, item.h) >= 1.7;
	const lowerThird = item.category === "Lower Thirds";
	// Full-width designs fill the width; lower thirds sit bottom-left; stickers take half the width.
	const scale = lowerThird ? 0.75 : landscape ? 1 : 0.5;
	const contain = Math.min(width / 512, height / 512);
	const size = 512 * contain * scale;
	const positionX = lowerThird ? -width / 2 + width * 0.05 + size / 2 : 0;
	// Lower third: left edge at 5 % of the width, above the bottom UI band.
	const positionY = lowerThird ? height * 0.22 : landscape ? -height * 0.18 : -height * 0.08;
	const fixedText = !lottieTextsEditable(json);
	const texts = fixedText ? [] : lottieTexts(json);
	const at = start ?? editor.playback.getCurrentTime() / TICKS_PER_SECOND;
	const element = {
		...buildGraphicElement({
			definitionId: LOTTIE_GRAPHIC_ID,
			name: item.name,
			startTime: ticks(at),
			params: {
				"lottie.json": json,
				"lottie.source": item.id,
				"lottie.fixedText": fixedText,
				text: texts[0] ?? "",
				text2: texts[1] ?? "",
				timing: textual ? "fit" : "loop",
				"transform.scaleX": scale,
				"transform.scaleY": scale,
				"transform.positionX": Math.round(positionX),
				"transform.positionY": Math.round(positionY),
			},
		}),
		duration: ticks(duration),
	};
	editor.timeline.insertElement({ element, placement: autoPlacement(hint) });
	return { start: at, duration };
}
