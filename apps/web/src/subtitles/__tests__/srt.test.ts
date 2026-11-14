import { describe, expect, test } from "bun:test";
import { parseSrt } from "../srt";

// The file from the night QA run (H2-10): BOM, CRLF, tags, an ASS override, coordinates after the end time
// and a one-digit hour. Before the fix: 3 cues with the tags as text, 2 cues dropped as "malformed".
const QA_SRT =
	"﻿1\r\n00:00:00,500 --> 00:00:01,500\r\n<i>Italic line</i>\r\n\r\n" +
	"2\r\n00:00:01,600 --> 00:00:02,600\r\n{\\an8}Top positioned\r\n\r\n" +
	"3\r\n00:00:02,700 --> 00:00:03,700 X1:100 X2:500 Y1:50 Y2:80\r\nWith coordinates\r\n\r\n" +
	"4\r\n0:00:03,800 --> 0:00:04,500\r\nOne-digit hour\r\n\r\n" +
	'5\r\n00:00:04,600 --> 00:00:05,900\r\n<b>Bold</b> &amp; <font color="#ff0000">red</font>\r\n';

describe("parseSrt", () => {
	test("the QA file: every cue, no tags, entities decoded", () => {
		const result = parseSrt({ input: QA_SRT });
		expect(result.skippedCueCount).toBe(0);
		expect(result.captions.map((cue) => cue.text)).toEqual([
			"Italic line",
			"Top positioned",
			"With coordinates",
			"One-digit hour",
			"Bold & red",
		]);
		const times = result.captions.map((cue) => [cue.startTime, Math.round(cue.duration * 1000) / 1000]);
		expect(times).toEqual([
			[0.5, 1],
			[1.6, 1],
			[2.7, 1],
			[3.8, 0.7],
			[4.6, 1.3],
		]);
	});

	test("multi-line cues keep their lines; tag-only lines go", () => {
		const result = parseSrt({ input: "1\n00:00:01,000 --> 00:00:02,000\n<i>first</i>\n<i></i>\n- second &lt;3 &#x2764; &#9733;\n" });
		expect(result.captions[0]?.text).toBe("first\n- second <3 ❤ ★");
	});

	test("text that only looks like markup is kept", () => {
		const result = parseSrt({ input: "1\n00:00:01,000 --> 00:00:02,000\na < b and c > d {not an override} &unknown;\n" });
		expect(result.captions[0]?.text).toBe("a < b and c > d {not an override} &unknown;");
	});

	test("a cue that is only tags is skipped, the rest still import", () => {
		const result = parseSrt({ input: "1\n00:00:01,000 --> 00:00:02,000\n<i></i>\n\n2\n00:00:03,000 --> 00:00:04,000\nKept\n" });
		expect(result.captions.map((cue) => cue.text)).toEqual(["Kept"]);
		expect(result.skippedCueCount).toBe(1);
	});

	test("a broken timing line is still rejected", () => {
		const result = parseSrt({ input: "1\n00:00:01,000 -> 00:00:02,000\nNo arrow\n\n2\n00:00:05,000 --> 00:00:04,000\nBackwards\n" });
		expect(result.captions).toEqual([]);
		expect(result.skippedCueCount).toBe(2);
	});
});
