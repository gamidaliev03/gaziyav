import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TimelineElement } from "@/timeline/types";

let captionCues: typeof import("../export-file").captionCues;
let captionFileText: typeof import("../export-file").captionFileText;
let TICKS = 0;
beforeAll(async () => {
	await installOpenCutWasm();
	({ captionCues, captionFileText } = await import("../export-file"));
	({ TICKS_PER_SECOND: TICKS } = await import("@/wasm"));
});

const s = (seconds: number) => Math.round(seconds * TICKS);
const caption = (text: string, start: number, end: number) =>
	({ id: text, type: "text", name: "Caption", startTime: s(start), duration: s(end - start), params: { content: text, "caption.style": "hormozi" } }) as unknown as TimelineElement;
const plainText = () => ({ id: "t", type: "text", name: "Title", startTime: 0, duration: s(5), params: { content: "Title" } }) as unknown as TimelineElement;

const fixture = () => ({
	overlay: [{ elements: [caption("second line", 2.5, 4), plainText()] }, { elements: [caption("first", 0, 2.5)] }],
	main: { elements: [] as TimelineElement[] },
});

describe("captions file", () => {
	test("SRT: only caption clips, in time order, numbered with times", () => {
		expect(captionFileText(captionCues(fixture()), "srt")).toBe("1\n00:00:00,000 --> 00:00:02,500\nfirst\n\n2\n00:00:02,500 --> 00:00:04,000\nsecond line\n");
	});

	test("TXT: the text only, one cue per line", () => {
		expect(captionFileText(captionCues(fixture()), "txt")).toBe("first\nsecond line\n");
	});

	test("an In→Out range keeps what's inside and starts at 0", () => {
		expect(captionCues(fixture(), { start: s(2), end: s(3) })).toEqual([
			{ start: 0, end: s(0.5), text: "first" },
			{ start: s(0.5), end: s(1), text: "second line" },
		]);
	});

	test("no captions: an empty file", () => {
		expect(captionFileText([], "srt")).toBe("");
	});
});
