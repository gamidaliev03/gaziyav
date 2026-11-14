import { describe, expect, test } from "bun:test";
import { coverDrawing, coverFrames, coverSeconds, exactRate, exportedFrameCount, framesAt, rateValue } from "../frame-count";
import { endSoundAt, findMoov, patchMoovRegion } from "../mp4-edit-list";
import { transcodeArgs } from "../target";

// exp (14.11): timeline frames → file frames at every rate, in exact rationals
const TPS = 120_000;
const RATES: Array<[string, number, number, number]> = [
	["23.976", 23.976, 24_000, 1_001],
	["24", 24, 24, 1],
	["25", 25, 25, 1],
	["29.97", 29.97, 30_000, 1_001],
	["30", 30, 30, 1],
	["50", 50, 50, 1],
	["59.94", 59.94, 60_000, 1_001],
	["60", 60, 60, 1],
];
const ticksPerFrame = (num: number, den: number) => (TPS * den) / num;

describe("exact rates", () => {
	test("every rate of the Export list is its exact fraction, never the rounded float", () => {
		for (const [, value, num, den] of RATES) expect(exactRate(value)).toEqual({ numerator: num, denominator: den });
		expect(rateValue(exactRate(59.94))).toBe(60_000 / 1_001);
		expect(exactRate(23.98)).toEqual({ numerator: 24_000, denominator: 1_001 });
		expect(exactRate({ numerator: 30_000, denominator: 1_001 })).toEqual({ numerator: 30_000, denominator: 1_001 });
	});
});

describe("timeline frames → file frames", () => {
	test("N frames of the timeline are N frames of a file at the same rate, at every rate", () => {
		for (const [, , num, den] of RATES) {
			const tpf = ticksPerFrame(num, den);
			expect(Number.isInteger(tpf)).toBe(true);
			for (const n of [1, 137, 600, 36_000, 215_784]) {
				expect(framesAt({ durationTicks: n * tpf, rate: { numerator: num, denominator: den }, ticksPerSecond: TPS })).toBe(n);
				expect(exportedFrameCount({ durationTicks: n * tpf, ticksPerFrame: Math.round(TPS / (num / den)) })).toBe(n);
			}
		}
	});

	test("at a higher rate: ceil(N · E / P), counted on integers", () => {
		const r = (num: number, den: number) => ({ numerator: num, denominator: den });
		// 12 s of 30 → 50 / 60: exactly 600 / 720 (check-export: 597 / 717 before)
		expect(framesAt({ durationTicks: 12 * TPS, rate: r(50, 1), ticksPerSecond: TPS })).toBe(600);
		expect(framesAt({ durationTicks: 12 * TPS, rate: r(60, 1), ticksPerSecond: TPS })).toBe(720);
		// 8 s → 59.94: 479.52 → 480
		expect(framesAt({ durationTicks: 8 * TPS, rate: r(60_000, 1_001), ticksPerSecond: TPS })).toBe(480);
		// 137 frames of 29.97 → 59.94 is exactly 274; of 24 → 60 is 342.5 → 343; of 23.976 → 59.94 is 342.5 → 343
		expect(framesAt({ durationTicks: 137 * 4004, rate: r(60_000, 1_001), ticksPerSecond: TPS })).toBe(274);
		expect(framesAt({ durationTicks: 137 * 5000, rate: r(60, 1), ticksPerSecond: TPS })).toBe(343);
		expect(framesAt({ durationTicks: 137 * 5005, rate: r(60_000, 1_001), ticksPerSecond: TPS })).toBe(343);
		// ten hours at 59.94 from 29.97 ticks stays exact
		expect(framesAt({ durationTicks: 1_078_920 * 4004, rate: r(60_000, 1_001), ticksPerSecond: TPS })).toBe(2_157_840);
		expect(framesAt({ durationTicks: 0, rate: r(60, 1), ticksPerSecond: TPS })).toBe(0);
	});
});

describe("the cover", () => {
	test("a tenth of a second in whole frames of the file's rate (6 at 60 and 59.94, 3 at 30, 2 at 24, 3 at 25)", () => {
		const want: Record<string, number> = { "23.976": 2, "24": 2, "25": 3, "29.97": 3, "30": 3, "50": 5, "59.94": 6, "60": 6 };
		for (const [label, value] of RATES) expect(coverFrames(exactRate(value))).toBe(want[label]);
		expect(coverSeconds(exactRate(60))).toBe(0.1);
		expect(coverSeconds(exactRate(59.94))).toBe((6 * 1001) / 60_000);
	});

	test("in a master at another rate it lasts exactly the final file's cover: whole frames, or one long frame", () => {
		expect(coverDrawing(0.1, exactRate(30))).toEqual({ frames: 3, frameSeconds: 1 / 30 });
		expect(coverDrawing(0.1, exactRate(24))).toEqual({ frames: 1, frameSeconds: 0.1 });
		expect(coverDrawing(0.1, exactRate(25))).toEqual({ frames: 1, frameSeconds: 0.1 });
		const ntsc = coverDrawing(coverSeconds(exactRate(59.94)), exactRate(29.97));
		expect(ntsc.frames).toBe(3);
		expect(ntsc.frames * ntsc.frameSeconds).toBeCloseTo((6 * 1001) / 60_000, 12);
	});
});

describe("motion interpolation fallback", () => {
	test("holds the last frame and writes exactly the counted frames", () => {
		const target = { container: "mp4", codec: "h264", width: 640, height: 360, fps: 59.94, bitrate: 8_000_000, color: "sdr", bitDepth: 8, hardware: true } as Parameters<typeof transcodeArgs>[0];
		const args = transcodeArgs(target, "in.mp4", "out.mp4", { minterpolate: true, frames: 274 });
		const vf = args[args.indexOf("-vf") + 1];
		expect(vf).toContain("minterpolate=fps=60000/1001");
		expect(vf).toContain("tpad=stop_mode=clone");
		expect(args[args.indexOf("-r") + 1]).toBe("60000/1001");
		expect(vf).toContain("trim=end_frame=274");
		// (never -frames:v: it ends the whole output there, the sound's last packets with it)
		expect(args.includes("-frames:v")).toBe(false);
	});
});

describe("the sound's edit list", () => {
	// a minimal moov: mvhd (timescale 1000) + one sound trak (tkhd, mdia/mdhd timescale 48000, hdlr soun), then a free box
	const box = (type: string, body: Uint8Array) => {
		const out = new Uint8Array(8 + body.length);
		new DataView(out.buffer).setUint32(0, out.length);
		out.set(new TextEncoder().encode(type), 4);
		out.set(body, 8);
		return out;
	};
	const cat = (...parts: Uint8Array[]) => {
		const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
		let at = 0;
		for (const p of parts) {
			out.set(p, at);
			at += p.length;
		}
		return out;
	};
	const u32s = (...values: number[]) => {
		const out = new Uint8Array(values.length * 4);
		values.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v));
		return out;
	};
	const mvhd = box("mvhd", u32s(0, 0, 0, 1000, 4607, ...Array(20).fill(0)));
	const tkhd = box("tkhd", u32s(0, 0, 0, 2, 0, 4607, ...Array(15).fill(0)));
	const mdhd = box("mdhd", u32s(0, 0, 0, 48_000, 223_232, 0));
	const hdlr = box("hdlr", cat(u32s(0, 0), new TextEncoder().encode("soun"), u32s(0, 0, 0, 0)));
	const trak = box("trak", cat(tkhd, box("mdia", cat(mdhd, hdlr))));
	const moov = box("moov", cat(mvhd, trak));
	const region = cat(moov, box("free", new Uint8Array(200)));

	test("ends the sound with the picture, and the movie with its longest track", () => {
		// 137 frames at 30 = 4.5667 s = 219 200 samples; the encoder wrote 218 packets (223 232) with 2112 of priming
		const out = patchMoovRegion(region, { primingSamples: 2112, sampleRate: 48_000, samples: 219_200 });
		expect(out).not.toBeNull();
		const view = new DataView((out as Uint8Array).buffer);
		const text = new TextDecoder().decode(out as Uint8Array);
		const elst = text.indexOf("elst");
		expect(view.getUint32(elst + 4 + 4 + 4)).toBe(4567); // segment in movie ms: 219 200 / 48 000 s
		expect(view.getUint32(elst + 4 + 4 + 4 + 4)).toBe(2112); // media time: the priming
		const mvhdAt = text.indexOf("mvhd");
		expect(view.getUint32(mvhdAt + 4 + 4 + 8 + 4)).toBe(4567);
	});

	test("a file of the ffmpeg pass: its sound's edit is cut to the film's end, in place", () => {
		const patched = patchMoovRegion(region, { primingSamples: 2112, sampleRate: 48_000 }) as Uint8Array;
		const moovSize = new DataView(patched.buffer).getUint32(0);
		const moovBytes = patched.slice(0, moovSize);
		expect(findMoov((at, n) => cat(box("ftyp", new Uint8Array(8)), patched).subarray(at, at + n), 16 + patched.length)).toEqual({ start: 16, size: moovSize });
		expect(endSoundAt(moovBytes, 4.5667)).toBe(true);
		const text = new TextDecoder().decode(moovBytes);
		const view = new DataView(moovBytes.buffer);
		expect(view.getUint32(text.indexOf("elst") + 12)).toBe(4567);
		expect(view.getUint32(text.indexOf("mvhd") + 20)).toBe(4567);
		// never longer than the track: asking for more changes nothing
		expect(endSoundAt(moovBytes, 9)).toBe(false);
	});

	test("without a length it shows everything after the priming (as before)", () => {
		const out = patchMoovRegion(region, { primingSamples: 2112, sampleRate: 48_000 });
		const text = new TextDecoder().decode(out as Uint8Array);
		const view = new DataView((out as Uint8Array).buffer);
		expect(view.getUint32(text.indexOf("elst") + 12)).toBe(Math.round(((223_232 - 2112) * 1000) / 48_000));
	});
});
