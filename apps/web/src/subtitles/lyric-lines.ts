// Auto lyrics: recognized words → sung lines (kept apart from the recognizer so it can be tested on its own).
import type { Word } from "@/transcribe/align";
import type { CaptionChunk } from "@/transcription/types";

/** Sung lines: a new line after a pause of 0.6 s or 8 words. */
export function wordsToLyricLines(words: Word[], maxWords = 8): CaptionChunk[] {
	const lines: CaptionChunk[] = [];
	let current: Word[] = [];
	const flush = () => {
		if (current.length === 0) return;
		const start = current[0].start;
		const end = current[current.length - 1].end;
		lines.push({
			text: current.map((word) => word.text.trim()).join(" "),
			startTime: start,
			duration: Math.max(0.4, end - start + 0.2),
			words: current.map((word) => ({ text: word.text.trim(), startTime: word.start, endTime: word.end })),
		});
		current = [];
	};
	for (const word of words) {
		const previous = current[current.length - 1];
		if (previous && (word.start - previous.end > 0.6 || current.length >= maxWords)) flush();
		if (word.text.trim()) current.push(word);
	}
	flush();
	// A line never runs into the next one.
	return lines.map((line, index) => {
		const next = lines[index + 1];
		return next && line.startTime + line.duration > next.startTime ? { ...line, duration: Math.max(0.3, next.startTime - line.startTime) } : line;
	});
}
