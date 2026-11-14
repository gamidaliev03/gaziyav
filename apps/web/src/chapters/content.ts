// What is inside a scene, for the thin strip under its still: speech, music and titles as spans of 0…1. Pure.
import { isCaptionElement } from "@/subtitles/apply-style";
import type { SceneTracks, TimelineElement } from "@/timeline/types";
import type { Chapter } from "./model";

export type Lane = "speech" | "music" | "titles";
export type Strip = Record<Lane, [number, number][]>;

const end = (e: TimelineElement) => e.startTime + e.duration;

function laneOf(element: TimelineElement, total: number): Lane | null {
	if (element.type === "text") return isCaptionElement(element) ? "speech" : "titles";
	if (element.type === "audio") {
		// A library track or a long sound under much of the film is music; a recording is speech.
		if (element.sourceType === "library" || element.duration > total * 0.5) return "music";
		return "speech";
	}
	if (element.type === "video" && element.isSourceAudioEnabled !== false && !("hidden" in element && element.hidden)) return "speech";
	if (element.type === "sticker" || element.type === "graphic") return "titles";
	return null;
}

/** One strip per chapter, in one pass over the elements sorted by start. */
export function stripsOf(tracks: SceneTracks, chapters: readonly Chapter[], total: number): Strip[] {
	const strips: Strip[] = chapters.map(() => ({ speech: [], music: [], titles: [] }));
	if (chapters.length === 0) return strips;
	const hasCaptions = tracks.overlay.some((t) => t.elements.some(isCaptionElement));
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
		for (const e of track.elements) {
			const lane = laneOf(e, total);
			if (!lane) continue;
			// Captions draw the speech better than a clip's whole sound.
			if (lane === "speech" && hasCaptions && e.type === "video") continue;
			// Chapters overlapping [start, end): binary search for the first.
			let lo = 0;
			let hi = chapters.length - 1;
			while (lo < hi) {
				const m = (lo + hi) >> 1;
				if (chapters[m].end <= e.startTime) lo = m + 1;
				else hi = m;
			}
			for (let i = lo; i < chapters.length && chapters[i].start < end(e); i++) {
				const c = chapters[i];
				const len = c.end - c.start;
				if (len <= 0) continue;
				const a = Math.max(0, (e.startTime - c.start) / len);
				const b = Math.min(1, (end(e) - c.start) / len);
				if (b > a) strips[i][lane].push([a, b]);
			}
		}
	}
	// Merge touching spans so a strip is a handful of rectangles.
	for (const strip of strips) {
		for (const lane of Object.keys(strip) as Lane[]) {
			const spans = strip[lane].sort((x, y) => x[0] - y[0]);
			const merged: [number, number][] = [];
			for (const s of spans) {
				const last = merged[merged.length - 1];
				if (last && s[0] <= last[1] + 0.01) last[1] = Math.max(last[1], s[1]);
				else merged.push([s[0], s[1]]);
			}
			strip[lane] = merged;
		}
	}
	return strips;
}
