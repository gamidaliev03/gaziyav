// The captions on the timeline as a file beside the video: SRT (numbered cues with times) or TXT (the text only),
// like CapCut's export dialog «Captions» section. Reads every caption clip of every text track, in time order.
import type { TimelineElement } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { isCaptionElement } from "./apply-style";

export type CaptionFileFormat = "srt" | "txt";

export interface CaptionCue {
	start: number;
	end: number;
	text: string;
}

/** Caption cues from the scene's tracks (overlay + main), in time order; an In→Out range keeps only what's inside it,
 * shifted so the range starts at 0 like the exported video. */
export function captionCues(
	tracks: { overlay: { elements: TimelineElement[] }[]; main: { elements: TimelineElement[] } },
	range?: { start: number; end: number },
): CaptionCue[] {
	const cues: CaptionCue[] = [];
	for (const track of [...tracks.overlay, tracks.main]) {
		for (const element of track.elements) {
			if (!isCaptionElement(element)) continue;
			const text = String(element.params.content ?? "").trim();
			if (!text) continue;
			let start: number = element.startTime;
			let end: number = element.startTime + element.duration;
			if (range) {
				if (end <= range.start || start >= range.end) continue;
				start = Math.max(start, range.start) - range.start;
				end = Math.min(end, range.end) - range.start;
			}
			cues.push({ start, end, text });
		}
	}
	return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 3725.5 s → "01:02:05,500" (SRT time). */
function srtTime(ticks: number): string {
	const totalMs = Math.max(0, Math.round((ticks / TICKS_PER_SECOND) * 1000));
	const ms = totalMs % 1000;
	const totalSeconds = Math.floor(totalMs / 1000);
	const pad = (value: number, size = 2) => String(value).padStart(size, "0");
	return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)},${pad(ms, 3)}`;
}

export function captionFileText(cues: CaptionCue[], format: CaptionFileFormat): string {
	if (format === "txt") return cues.map((cue) => cue.text).join("\n") + (cues.length ? "\n" : "");
	return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join("\n");
}
