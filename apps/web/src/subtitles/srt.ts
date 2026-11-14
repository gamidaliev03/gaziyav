import type { ParseSubtitleResult, SubtitleCue } from "./types";

const TIMESTAMP_SEPARATOR = /\s*-->\s*/;
// Some tools write a one-digit hour ("0:00:03,800"), and SRT allows position coordinates after the end time
// ("00:00:02,700 --> 00:00:03,700 X1:100 X2:500 Y1:50 Y2:80"): both used to drop the cue as malformed.
const TIMESTAMP = String.raw`\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}`;
const TIMESTAMP_PATTERN = new RegExp(
	String.raw`^(${TIMESTAMP})\s*-->\s*(${TIMESTAMP})(?:\s.*)?$`,
);

/**
 * Styling that SRT files carry but the caption styles replace: <i>, <b>, <u>, <s>, <font …> and ASS override
 * blocks such as {\an8}. Left in, they were drawn as text ("<I>ITALIC LINE</I>").
 */
const FORMATTING_TAG = /<\/?(?:i|b|u|s|font)\b[^>]*>/gi;
const ASS_OVERRIDE = /\{\\[^}]*\}/g;
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** One text line of a cue as the viewer should read it: no tags, entities decoded. */
export function cleanSrtTextLine(line: string): string {
	return line
		.replace(FORMATTING_TAG, "")
		.replace(ASS_OVERRIDE, "")
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
			if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
			const isHex = code[1] === "x" || code[1] === "X";
			const point = isHex
				? Number.parseInt(code.slice(2), 16)
				: Number.parseInt(code.slice(1), 10);
			return Number.isInteger(point) && point > 0 && point <= 0x10ffff
				? String.fromCodePoint(point)
				: entity;
		})
		.trim();
}

export function parseSrt({ input }: { input: string }): ParseSubtitleResult {
	const normalized = input.replace(/\r\n?/g, "\n").trim();
	if (!normalized) {
		return {
			captions: [],
			skippedCueCount: 0,
			warnings: [],
		};
	}

	const blocks = normalized.split(/\n{2,}/);
	const cues: SubtitleCue[] = [];
	let skippedCueCount = 0;

	for (const block of blocks) {
		const lines = block
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		if (lines.length < 2) {
			skippedCueCount += 1;
			continue;
		}

		const timestampIndex = TIMESTAMP_SEPARATOR.test(lines[0]) ? 0 : 1;
		const timestampLine = lines[timestampIndex];
		const timestampMatch = timestampLine?.match(TIMESTAMP_PATTERN);
		if (!timestampMatch) {
			skippedCueCount += 1;
			continue;
		}

		const textLines = lines
			.slice(timestampIndex + 1)
			.map(cleanSrtTextLine)
			.filter((line) => line.length > 0);
		const text = textLines.join("\n").trim();
		if (!text) {
			skippedCueCount += 1;
			continue;
		}

		const [, rawStart, rawEnd] = timestampMatch;
		if (!rawStart || !rawEnd) {
			skippedCueCount += 1;
			continue;
		}

		const startTime = parseSrtTimestamp({ input: rawStart });
		const endTime = parseSrtTimestamp({ input: rawEnd });
		const duration = endTime - startTime;

		if (
			!Number.isFinite(startTime) ||
			!Number.isFinite(endTime) ||
			duration <= 0
		) {
			skippedCueCount += 1;
			continue;
		}

		cues.push({
			text,
			startTime,
			duration,
		});
	}

	return {
		captions: cues,
		skippedCueCount,
		warnings: [],
	};
}

function parseSrtTimestamp({ input }: { input: string }): number {
	const normalized = input.trim().replace(",", ".");
	const match = normalized.match(/^(\d{1,3}):(\d{2}):(\d{2})\.(\d{1,3})$/);
	if (!match) {
		return Number.NaN;
	}

	const [, hours, minutes, seconds, milliseconds] = match;
	const parsedHours = Number.parseInt(hours, 10);
	const parsedMinutes = Number.parseInt(minutes, 10);
	const parsedSeconds = Number.parseInt(seconds, 10);
	const parsedMilliseconds = Number.parseInt(milliseconds.padEnd(3, "0"), 10);

	return (
		parsedHours * 3600 +
		parsedMinutes * 60 +
		parsedSeconds +
		parsedMilliseconds / 1000
	);
}
