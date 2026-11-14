// A scene's one-line note: what is said first in it (its captions' first sentence), so the grid reads as the film's
// plan. Nothing when the scene has no captions (the app does not know what a shot shows yet). Pure.
import { isCaptionElement } from "@/subtitles/apply-style";
import type { SceneTracks } from "@/timeline/types";
import type { Chapter } from "./model";

const MAX = 90;

export function noteOf(tracks: SceneTracks, chapter: Chapter): string | null {
	const said: { at: number; text: string }[] = [];
	for (const track of [...tracks.overlay, ...tracks.audio]) {
		for (const e of track.elements) {
			if (e.startTime < chapter.start || e.startTime >= chapter.end || !isCaptionElement(e)) continue;
			const text = String(e.params.content ?? "").trim();
			if (text) said.push({ at: e.startTime, text });
		}
	}
	if (said.length === 0) return null;
	said.sort((a, b) => a.at - b.at);
	let line = "";
	for (const s of said) {
		line = line ? `${line} ${s.text}` : s.text;
		const end = line.search(/[.!?…](\s|$)/u);
		if (end >= 0) return clip(line.slice(0, end + 1));
		if (line.length >= MAX) break;
	}
	return clip(line);
}

function clip(text: string): string {
	const t = text.replace(/\s+/g, " ").trim();
	if (t.length <= MAX) return t.charAt(0).toUpperCase() + t.slice(1);
	const cut = t.slice(0, MAX);
	return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trim()}…`;
}
