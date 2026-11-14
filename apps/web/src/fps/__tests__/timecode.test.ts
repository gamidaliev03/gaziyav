import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { MediaTime } from "@/wasm";

let tc: typeof import("@/fps/timecode");
beforeAll(async () => {
	await installOpenCutWasm();
	tc = await import("@/fps/timecode");
});
const formatFrameNumber = (a: { frame: number; fps: { numerator: number; denominator: number } }) => tc.formatFrameNumber(a);
const formatFrameTimecode = (a: { time: number; fps: { numerator: number; denominator: number } }) => tc.formatFrameTimecode(a);
const parseFrameNumber = (a: { text: string; fps: { numerator: number; denominator: number } }) => tc.parseFrameNumber(a);

const R = (numerator: number, denominator = 1) => ({ numerator, denominator });
const NTSC24 = R(24_000, 1001);
const NTSC30 = R(30_000, 1001);
const NTSC60 = R(60_000, 1001);

describe("SMPTE frame timecode (pro-core)", () => {
	test("whole rates count frames in the second", () => {
		expect(formatFrameNumber({ frame: 61, fps: R(25) })).toBe("00:00:02:11");
		expect(formatFrameNumber({ frame: 59, fps: R(60) })).toBe("00:00:00:59");
		expect(formatFrameNumber({ frame: 3600 * 30, fps: R(30) })).toBe("01:00:00:00");
	});

	test("23.976 is non-drop at timebase 24 (Premiere: frame 24000 = 00:16:40:00)", () => {
		expect(formatFrameNumber({ frame: 23, fps: NTSC24 })).toBe("00:00:00:23");
		expect(formatFrameNumber({ frame: 24, fps: NTSC24 })).toBe("00:00:01:00");
		expect(formatFrameNumber({ frame: 24_000, fps: NTSC24 })).toBe("00:16:40:00");
		// the wasm count read 00:16:41:00 there: wall-clock seconds
		expect(formatFrameTimecode({ time: 24_000 * 5005, fps: NTSC24 })).toBe("00:16:40:00");
	});

	test("29.97 is drop-frame: ;00 and ;01 skipped each minute except every tenth", () => {
		expect(formatFrameNumber({ frame: 1799, fps: NTSC30 })).toBe("00:00:59;29");
		expect(formatFrameNumber({ frame: 1800, fps: NTSC30 })).toBe("00:01:00;02");
		expect(formatFrameNumber({ frame: 17_982, fps: NTSC30 })).toBe("00:10:00;00");
		expect(formatFrameNumber({ frame: 17_981, fps: NTSC30 })).toBe("00:09:59;29");
		expect(formatFrameNumber({ frame: 107_892, fps: NTSC30 })).toBe("01:00:00;00");
		expect(formatFrameTimecode({ time: 1800 * 4004, fps: NTSC30 })).toBe("00:01:00;02");
	});

	test("59.94 drops four numbers a minute", () => {
		expect(formatFrameNumber({ frame: 3599, fps: NTSC60 })).toBe("00:00:59;59");
		expect(formatFrameNumber({ frame: 3600, fps: NTSC60 })).toBe("00:01:00;04");
		expect(formatFrameNumber({ frame: 35_964, fps: NTSC60 })).toBe("00:10:00;00");
	});

	test("every frame of an hour at 29.97 has its own code, in order, and reads back to itself", () => {
		let last = "";
		for (let frame = 0; frame < 107_892; frame += 7) {
			const code = formatFrameNumber({ frame, fps: NTSC30 });
			expect(code > last).toBe(true);
			expect(parseFrameNumber({ text: code, fps: NTSC30 })).toBe(frame);
			last = code;
		}
	});

	test("typing reads every separator; a dropped number lands on the minute's first frame", () => {
		expect(parseFrameNumber({ text: "00:00:02:11", fps: R(25) })).toBe(61);
		expect(parseFrameNumber({ text: "00:01:00;02", fps: NTSC30 })).toBe(1800);
		expect(parseFrameNumber({ text: "00:01:00;00", fps: NTSC30 })).toBe(1800);
		expect(parseFrameNumber({ text: "00:16:40.00", fps: NTSC24 })).toBe(24_000);
		expect(parseFrameNumber({ text: "00:00:00:30", fps: NTSC30 })).toBeNull();
		expect(parseFrameNumber({ text: "00:00:61:00", fps: R(25) })).toBeNull();
		// short forms fill from the right as in Premiere / Resolve / Avid (polish3, 11.11): «1:00» is 1 s 00 frames
		expect(parseFrameNumber({ text: "1:00", fps: R(25) })).toBe(25);
	});

	test("the editor format round-trips a frame start at every rate", () => {
		for (const fps of [NTSC24, R(24), R(25), NTSC30, R(30), R(50), NTSC60, R(60)]) {
			for (const frame of [0, 1, 23, 24, 29, 30, 1799, 1800, 17_982, 86_400]) {
				const time = tc.frameStartTime({ frame, fps });
				const text = tc.formatEditorTimecode({ time, format: "HH:MM:SS:FF", fps });
				expect(tc.parseEditorTimecode({ text, format: "HH:MM:SS:FF", fps })).toBe(time);
			}
		}
		// a time inside a frame shows that frame
		expect(tc.formatEditorTimecode({ time: 5004 as MediaTime, format: "HH:MM:SS:FF", fps: NTSC24 })).toBe("00:00:00:00");
		expect(tc.formatEditorTimecode({ time: 5005 as MediaTime, format: "HH:MM:SS:FF", fps: NTSC24 })).toBe("00:00:00:01");
	});
});
