import { describe, expect, test } from "bun:test";
import { EXPORT_CODECS, encodedInPage, ffmpegRate, gifFilter, normalizeTarget, outputSize, pageEncode, resolutionOf, transcodeArgs } from "../target";

const base = { container: "mp4", codec: "h264", width: 1080, height: 1920, fps: 30, bitrate: 8_000_000, color: "sdr", bitDepth: 8, hardware: true } as const;

describe("export target", () => {
	test("resolution scales the short side, even numbers", () => {
		expect(outputSize({ width: 1080, height: 1920 }, 720)).toEqual({ width: 720, height: 1280 });
		expect(outputSize({ width: 1920, height: 1080 }, 2160)).toEqual({ width: 3840, height: 2160 });
		expect(outputSize({ width: 1000, height: 1001 }, 480).width % 2).toBe(0);
		expect(resolutionOf({ width: 1080, height: 1920 })).toBe(1080);
	});
	test("H.264 MP4/MOV and VP9 WebM are encoded in the page; the rest goes through ffmpeg from an H.264 master", () => {
		expect(encodedInPage({ ...base })).toBe(true);
		expect(encodedInPage({ ...base, container: "mov" })).toBe(true);
		expect(encodedInPage({ ...base, container: "webm", codec: "vp9" })).toBe(true);
		for (const codec of ["hevc", "av1", "prores_422"] as const) expect(encodedInPage(normalizeTarget({ ...base, codec, container: codec === "prores_422" ? "mov" : "mp4" }))).toBe(false);
		expect(encodedInPage({ ...base, container: "gif" })).toBe(false);
		const master = pageEncode({ ...base, codec: "hevc" });
		expect(master.format).toBe("mp4");
		expect(master.bitrate).toBeGreaterThanOrEqual(20_000_000);
	});
	test("HDR and 10-bit move H.264 to HEVC; ProRes lives in MOV; WebM stays SDR", () => {
		expect(normalizeTarget({ ...base, color: "hlg" })).toMatchObject({ codec: "hevc", bitDepth: 10 });
		expect(normalizeTarget({ ...base, codec: "prores_422", container: "mp4" }).container).toBe("mov");
		expect(normalizeTarget({ ...base, container: "webm", codec: "vp9", color: "pq" })).toMatchObject({ color: "sdr", bitDepth: 8 });
	});
	test("ffmpeg arguments carry the codec, the colour tags and the GIF palette", () => {
		const hlg = transcodeArgs(normalizeTarget({ ...base, color: "hlg" }), "in.mp4", "out.mp4").join(" ");
		expect(hlg).toContain("hevc_videotoolbox");
		expect(hlg).toContain("arib-std-b67");
		expect(transcodeArgs({ ...base, container: "mov", codec: "prores_422hq", hardware: false }, "i", "o.mov").join(" ")).toContain("prores_ks -profile:v 3");
		expect(gifFilter({ width: 1080, height: 1920, fps: 30 })).toContain("fps=15,scale=360");
		expect(transcodeArgs({ ...base, container: "gif" }, "i", "o.gif")).toContain("-an");
	});
	test("NTSC rates reach ffmpeg as exact fractions (29.97 is 30000/1001, not 2997/100)", () => {
		expect(ffmpegRate(29.97)).toBe("30000/1001");
		expect(ffmpegRate(59.94)).toBe("60000/1001");
		expect(ffmpegRate(23.976)).toBe("24000/1001");
		expect(ffmpegRate(25)).toBe("25");
		const args = transcodeArgs({ ...base, container: "mov", fps: 29.97 }, "i", "o.mov");
		expect(args[args.indexOf("-r") + 1]).toBe("30000/1001");
	});
	test("CapCut's codec list: its order, ProRes Proxy / 4444XQ and RLE made by ffmpeg, mov only", () => {
		expect(EXPORT_CODECS.filter((c) => !c.hidden).map((c) => c.label)).toEqual([
			"H.264",
			"HEVC",
			"Apple ProRes 422",
			"Apple ProRes 422 LT",
			"Apple ProRes 422 HQ",
			"Apple ProRes 4444",
			"Apple ProRes Proxy",
			"Apple ProRes 4444XQ",
			"RLE",
		]);
		expect(EXPORT_CODECS[0].containers).toEqual(["mov", "mp4"]);
		const proxy = transcodeArgs({ ...base, container: "mov", codec: "prores_proxy", hardware: false }, "i", "o.mov").join(" ");
		expect(proxy).toContain("prores_ks -profile:v 0");
		const xq = transcodeArgs({ ...base, container: "mov", codec: "prores_4444xq", hardware: false }, "i", "o.mov").join(" ");
		expect(xq).toContain("prores_ks -profile:v 5");
		expect(xq).toContain("yuv444p10le");
		expect(transcodeArgs({ ...base, container: "mov", codec: "prores_4444xq", hardware: true }, "i", "o.mov").join(" ")).toContain("prores_videotoolbox -profile:v xq");
		const rle = transcodeArgs({ ...base, container: "mp4", codec: "rle" }, "i", "o.mov").join(" ");
		expect(rle).toContain("-c:v qtrle");
		expect(rle).toContain("format=rgb24");
		expect(normalizeTarget({ ...base, codec: "rle", color: "hlg" })).toMatchObject({ codec: "rle", container: "mov", color: "sdr", bitDepth: 8 });
		expect(encodedInPage(normalizeTarget({ ...base, codec: "rle" }))).toBe(false);
	});
});
