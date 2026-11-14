import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { parseTimeInput } from "@/fps/time-input";

const R = (numerator: number, denominator = 1) => ({ numerator, denominator });
const F24 = R(24);
const F25 = R(25);
const F30 = R(30);
const F60 = R(60);
const N30 = R(30_000, 1001);
const TPS = 120_000;
const frameTicks = (fps: { numerator: number; denominator: number }) => (TPS * fps.denominator) / fps.numerator;

/** Parses and returns the answer in frames (null stays null); now and max are given in frames. */
const frames = (text: string, fps = F25, now = 0, max?: number) => {
	const r = parseTimeInput({ text, fps, now: now * frameTicks(fps), max: max === undefined ? undefined : max * frameTicks(fps) });
	return r === null ? null : Math.round(r / frameTicks(fps));
};
const sec = (text: string, fps = F25, now = 0, max?: number) => {
	const f = frames(text, fps, now, max);
	return f === null ? null : f / (fps.numerator / fps.denominator);
};

const BIG = 100_000_000; // no clamp in the way

describe("parseTimeInput: digits only, seconds first", () => {
	const rows: Array<[string, number | null]> = [
		["5", 5], ["05", 5], ["0", 0], ["00", 0], ["45", 45], ["59", 59], ["60", 60], ["90", 90], ["99", 99],
		["130", 90], ["100", 60], ["190", 150], ["1005", 605], ["1230", 750], ["0130", 90], ["9959", 99 * 60 + 59],
		["10203", 3723], ["010203", 3723], ["102030", 10 * 3600 + 20 * 60 + 30], ["235959", 86399],
		["00000501", 5 + 1 / 25], ["0000501", 5 + 1 / 25], ["01020304", 3723 + 4 / 25],
		["123456789", null], ["", null], ["   ", null],
	];
	for (const [text, expected] of rows) {
		test(`«${text}» → ${expected}`, () => {
			const got = sec(text, F25, 0, BIG);
			if (expected === null) expect(got).toBeNull();
			else expect(got).toBeCloseTo(expected, 6);
		});
	}
});

describe("parseTimeInput: with separators", () => {
	const rows: Array<[string, number | null]> = [
		["1:5", 65], ["1:05", 65], ["0:30", 30], [":30", 30], ["5:", 300], ["5:00", 300], ["1:30", 90], ["0:90", 90],
		["1.5", 65], ["1,5", 65], ["1;5", 65], ["1 5", 65], ["1  5", 65], ["1.:5", 65], ["1::5", 65],
		["1:02:03", 3723], ["1.2.3", 3723], ["1 2 3", 3723], ["::5", 5], ["1:2:", 3720], ["0:0:5", 5],
		["00:00:05:00", 5], ["00:00:05:01", 5.04], ["0:0:5:1", 5.04], ["00:00:05;01", 5.04], ["00.00.05.01", 5.04],
		["00:00:05:25", 6], ["00:00:05:30", 6.2], ["00:00:75:00", 75], ["00:75:00", 4500],
		["1:2:3:4:5", null], ["1:234", null], ["12:345:1", null], [":", null], ["..", null], ["1:a", null],
		[" 1:30 ", 90], ["\t1:30", 90],
	];
	for (const [text, expected] of rows) {
		test(`«${text}» → ${expected}`, () => {
			const got = sec(text, F25, 0, BIG);
			if (expected === null) expect(got).toBeNull();
			else expect(got).toBeCloseTo(expected, 6);
		});
	}
});

describe("parseTimeInput: frames suffix", () => {
	test("12f at 25", () => expect(frames("12f")).toBe(12));
	test("12F", () => expect(frames("12F")).toBe(12));
	test("12к", () => expect(frames("12к")).toBe(12));
	test("12К", () => expect(frames("12К")).toBe(12));
	test("12 f", () => expect(frames("12 f")).toBe(12));
	test("100f at 24 is frame 100", () => expect(frames("100f", F24, 0, BIG)).toBe(100));
	test("0f", () => expect(frames("0f", F25, 77)).toBe(0));
	test("f alone", () => expect(frames("f")).toBeNull());
	test("12ff", () => expect(frames("12ff")).toBeNull());
	test("1:2f", () => expect(frames("1:2f")).toBeNull());
});

describe("parseTimeInput: relative to the playhead", () => {
	test("+5 s", () => expect(frames("+5", F25, 100, BIG)).toBe(225));
	test("-5 s", () => expect(frames("-5", F25, 300, BIG)).toBe(175));
	test("−5 (minus sign)", () => expect(frames("−5", F25, 300, BIG)).toBe(175));
	test("– 5 (en dash, space)", () => expect(frames("– 5", F25, 300, BIG)).toBe(175));
	test("+12f", () => expect(frames("+12f", F25, 100, BIG)).toBe(112));
	test("-12к", () => expect(frames("-12к", F25, 100, BIG)).toBe(88));
	test("-12f below zero → 0", () => expect(frames("-12f", F25, 5, BIG)).toBe(0));
	test("-90 below zero → 0", () => expect(frames("-90", F25, 25, BIG)).toBe(0));
	test("+130 = +1:30", () => expect(frames("+130", F25, 0, BIG)).toBe(90 * 25));
	test("+1:30", () => expect(frames("+1:30", F25, 25, BIG)).toBe(91 * 25));
	test("+ 5 spaced", () => expect(frames("+ 5", F25, 0, BIG)).toBe(125));
	test("+ alone", () => expect(frames("+")).toBeNull());
	test("- alone", () => expect(frames("-")).toBeNull());
	test("+abc", () => expect(frames("+abc")).toBeNull());
	test("5-3 is not a time", () => expect(frames("5-3")).toBeNull());
	test("++5", () => expect(frames("++5")).toBeNull());
	test("+5 past the end → the end", () => expect(frames("+5", F25, 100, 120)).toBe(120));
	test("+5 at 30 fps", () => expect(frames("+5", F30, 30, BIG)).toBe(180));
	test("relative from a time between frames counts its frame", () => {
		const r = parseTimeInput({ text: "+1f", fps: F25, now: 2.5 * frameTicks(F25), max: 10 ** 9 });
		expect(Math.round((r as number) / frameTicks(F25))).toBe(3);
	});
});

describe("parseTimeInput: clamping", () => {
	test("past the end = the end", () => expect(frames("99", F25, 0, 250)).toBe(250));
	test("exactly the end", () => expect(frames("10", F25, 0, 250)).toBe(250));
	test("before the end is kept", () => expect(frames("9", F25, 0, 250)).toBe(225));
	test("huge frames", () => expect(frames("999999999f", F25, 0, 250)).toBe(250));
	test("max 0", () => expect(frames("5", F25, 0, 0)).toBe(0));
	test("no max: no upper clamp", () => expect(frames("1:00:00", F25)).toBe(90000));
});

describe("parseTimeInput: frame rates", () => {
	for (const [name, fps, perSec] of [["24", F24, 24], ["25", F25, 25], ["30", F30, 30], ["60", F60, 60]] as const) {
		test(`${name} fps: 5 → ${5 * perSec} frames`, () => expect(frames("5", fps, 0, BIG)).toBe(5 * perSec));
		test(`${name} fps: 00:00:05:01 → ${5 * perSec + 1}`, () => expect(frames("00:00:05:01", fps, 0, BIG)).toBe(5 * perSec + 1));
		test(`${name} fps: 1:30 → ${90 * perSec}`, () => expect(frames("1:30", fps, 0, BIG)).toBe(90 * perSec));
		test(`${name} fps: frame ${perSec} carries into 1 s`, () => expect(frames(`0:0:0:${perSec}`, fps, 0, BIG)).toBe(perSec));
		test(`${name} fps: 00000501`, () => expect(frames("00000501", fps, 0, BIG)).toBe(5 * perSec + 1));
	}
	test("29.97 drop-frame: 1:00 is frame 1800", () => expect(frames("1:00", N30, 0, BIG)).toBe(1800));
	test("29.97 drop-frame: 00:01:00;02 is frame 1800", () => expect(frames("00:01:00;02", N30, 0, BIG)).toBe(1800));
	test("29.97 drop-frame: 10:00 is frame 17982", () => expect(frames("10:00", N30, 0, BIG)).toBe(17982));
	test("29.97 drop-frame: +5 is +150 frames", () => expect(frames("+5", N30, 300, BIG)).toBe(450));
});

describe("parseTimeInput: garbage is null, never a throw", () => {
	for (const text of ["abc", "5a", "a5", "1:3x", "five", "1e3", "0x10", "5/6", "--5", "5 s", "٣", "1__2", "?", "5%", "5\n", "∞", "00:00:05:01:00"]) {
		test(`«${text.replace("\n", "\\n")}»`, () => {
			const got = frames(text);
			// «5\n» trims to «5»: a time; everything else is none
			if (text === "5\n") expect(got).toBe(125);
			else expect(got).toBeNull();
		});
	}
	test("non-string", () => expect(parseTimeInput({ text: undefined as unknown as string, fps: F25 })).toBeNull());
});

describe("property: format(parse(format(t))) = format(t)", () => {
	let tc: typeof import("@/fps/timecode");
	beforeAll(async () => {
		await installOpenCutWasm();
		tc = await import("@/fps/timecode");
	});
	let seed = 12345;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	for (const fps of [F24, F25, F30, F60, N30, R(24_000, 1001), R(60_000, 1001)]) {
		test(`${fps.numerator}/${fps.denominator}`, () => {
			for (let i = 0; i < 400; i++) {
				const frame = Math.floor(rnd() ** 2 * 400_000);
				const time = tc.frameStartTime({ frame, fps }) as number;
				const shown = tc.formatFrameTimecode({ time, fps });
				const back = parseTimeInput({ text: shown, fps, now: 0 });
				expect(back).not.toBeNull();
				expect(tc.formatFrameTimecode({ time: back as number, fps })).toBe(shown);
			}
		});
	}
});
