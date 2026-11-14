// A song put on the timeline is cut to where the video ends, with a 1 s fade-out (library/client.ts cutToVideoEnd):
// a 3-minute track must not make a 15-second reel 3 minutes long. Done silently it surprised people — a 60 s song
// added at 20 s of a 24 s video came out 4 s long and nothing said why (blind check rc33, B11). Now it says so, and
// the whole song is one click away (one ⌘Z takes that click back).
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import { t } from "@/i18n";
import { buildSourceRangeElement } from "@/media/source-marks";
import type { MediaAsset } from "@/media/types";
import type { CreateTimelineElement, TimelineElement } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";

const seconds = (ticks: number) => {
	const s = ticks / TICKS_PER_SECOND;
	return s >= 10 ? String(Math.round(s)) : s.toFixed(1).replace(/\.0$/, "");
};

/** After a landing element was inserted: when it is a song cut to the video's end, say so and offer the whole song. */
export function sayFittedToVideo(editor: EditorCore, asset: MediaAsset, placed: CreateTimelineElement): void {
	if (placed.type !== "audio") return;
	const whole = buildSourceRangeElement({ asset, startTime: placed.startTime });
	if (!("trimEnd" in whole) || !("trimEnd" in placed) || whole.duration <= placed.duration + 1) return;
	// the clip as it landed: the insert selects it
	const ref = editor.selection.getSelectedElements().at(-1);
	const found = ref ? editor.timeline.getElementsWithTracks({ elements: [ref] })[0] : undefined;
	if (!found || found.element.type !== "audio" || found.element.duration !== placed.duration) return;
	const { track, element } = found;
	const end = element.startTime + whole.duration;
	// the whole song only where the track is free for it (a later clip on the same track would be covered)
	const free = !track.elements.some((other: TimelineElement) => other.id !== element.id && other.startTime < end && other.startTime + other.duration > element.startTime);
	toast(t("Music fitted to the video's length"), {
		description: t("{n} s of {total} s, fading out where the video ends", { n: seconds(placed.duration), total: seconds(whole.duration) }),
		duration: 8000,
		action: free
			? {
					label: t("Whole song"),
					onClick: () => {
						const now = editor.timeline.getElementsWithTracks({ elements: [{ trackId: track.id, elementId: element.id }] })[0]?.element;
						if (!now || now.type !== "audio" || now.duration !== element.duration) return;
						const params = { ...now.params, fadeOut: (whole as { params?: Record<string, unknown> }).params?.fadeOut ?? 0 };
						editor.timeline.updateElements({
							updates: [{ trackId: track.id, elementId: element.id, patch: { duration: whole.duration, trimEnd: whole.trimEnd, params } as unknown as Partial<TimelineElement> }],
						});
					},
				}
			: undefined,
	});
}
