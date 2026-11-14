// LRC lyrics files ([mm:ss.xx] line): each line lasts until the next one (the last one 3 s), like CapCut's import.
import type { ParseSubtitleResult, SubtitleCue } from "./types";

const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

export function parseLrc({ input }: { input: string }): ParseSubtitleResult {
	const lines: Array<{ time: number; text: string }> = [];
	let skipped = 0;
	for (const raw of input.split(/\r?\n/)) {
		const stamps = [...raw.matchAll(STAMP)];
		if (stamps.length === 0) continue;
		const text = raw.replace(STAMP, "").trim();
		for (const stamp of stamps) {
			const time = Number(stamp[1]) * 60 + Number(stamp[2].replace(":", "."));
			if (!Number.isFinite(time)) skipped++;
			else if (text) lines.push({ time, text });
		}
	}
	lines.sort((a, b) => a.time - b.time);
	const captions: SubtitleCue[] = lines.map((line, index) => {
		const next = lines[index + 1]?.time ?? line.time + 3;
		return { text: line.text, startTime: line.time, duration: Math.max(0.3, Math.min(next, line.time + 8) - line.time) };
	});
	return { captions, skippedCueCount: skipped, warnings: [] };
}
