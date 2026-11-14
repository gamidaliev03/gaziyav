// polish3 (11.11): the player's timecode refused every short form a film editor types («1000», «10:00») — it turned red
// and stayed open. Fields now fill from the right, as Premiere, Resolve and Avid read them.
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let tc: typeof import("@/fps/timecode");
beforeAll(async () => {
	await installOpenCutWasm();
	tc = await import("@/fps/timecode");
});
const R = (numerator: number, denominator = 1) => ({ numerator, denominator });
const parse = (text: string, fps = R(25)) => tc.parseFrameNumber({ text, fps });

describe("typed timecode: short forms fill from the right", () => {
	test("bare digits are pairs from the right: 1000 = 00:00:10:00, 5 = five frames", () => {
		expect(parse("1000")).toBe(250);
		expect(parse("5")).toBe(5);
		expect(parse("10000")).toBe(parse("00:01:00:00"));
		expect(parse("1021512")).toBe(parse("01:02:15:12"));
		expect(parse("00001000")).toBe(250);
	});

	test("fewer fields: SS:FF, MM:SS:FF", () => {
		expect(parse("10:00")).toBe(250);
		expect(parse("2:11")).toBe(61);
		expect(parse("1:02:03")).toBe(parse("00:01:02:03"));
	});

	test("the full form and its separators read as before", () => {
		expect(parse("00:00:02:11")).toBe(61);
		expect(parse("00:16:40.00", R(24_000, 1001))).toBe(24_000);
		expect(parse("00:01:00;02", R(30_000, 1001))).toBe(1800);
	});

	test("what is not a time stays refused", () => {
		expect(parse("")).toBeNull();
		expect(parse("abc")).toBeNull();
		expect(parse("130")).toBeNull(); // 1 s 30 frames at 25 fps
		expect(parse("123456789")).toBeNull();
		expect(parse("1:2:3:4:5")).toBeNull();
		expect(parse("00:00:61:00")).toBeNull();
	});

	test("drop-frame: a short form at 29.97 lands like the long one", () => {
		const ntsc = R(30_000, 1001);
		expect(parse("10000", ntsc)).toBe(parse("00:01:00;00", ntsc));
		expect(parse("1:00;02", ntsc)).toBe(parse("00:01:00;02", ntsc));
	});
});
