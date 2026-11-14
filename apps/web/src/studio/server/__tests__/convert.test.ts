import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Real ffmpeg round-trips for the import proxy. Skipped when ffmpeg is missing.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "convert-test-"));
process.env.STUDIO_DATA_DIR = work;

const { isCoverArt, startConvert } = await import("../convert");
const { getJob } = await import("../jobs");
const { newFile, getFile } = await import("../files");
const { findTool } = await import("../tools");

let ffmpeg: string | null = null;
let ffprobe: string | null = null;
try {
	ffmpeg = findTool("ffmpeg");
	ffprobe = findTool("ffprobe");
} catch {}

function make(name: string, args: string[]): string {
	const slot = newFile(name);
	execFileSync(ffmpeg as string, ["-y", "-hide_banner", "-loglevel", "error", ...args, slot.path]);
	return slot.id;
}

async function convert(id: string, kind: "repair" | null = null) {
	const source = getFile(id);
	const started = startConvert(source, kind);
	for (;;) {
		const state = getJob(started.id);
		if (state && state.status !== "running") return state;
		await new Promise((r) => setTimeout(r, 100));
	}
}

function probe(file: string) {
	return JSON.parse(
		execFileSync(ffprobe as string, [
			"-v", "error", "-show_entries",
			"stream=codec_type,codec_name,pix_fmt,r_frame_rate,avg_frame_rate,duration", "-of", "json", file,
		]).toString(),
	).streams as Array<Record<string, string>>;
}

describe("cover art", () => {
	test("attached pictures and single JPEG/PNG frames are cover art; a Motion-JPEG recording is not", () => {
		expect(isCoverArt({ codec_name: "mjpeg", disposition: { attached_pic: 1 } })).toBe(true);
		expect(isCoverArt({ codec_name: "png", nb_frames: "1" })).toBe(true);
		expect(isCoverArt({ codec_name: "mjpeg", nb_frames: "240", disposition: { attached_pic: 0 } })).toBe(false);
		expect(isCoverArt({ codec_name: "mjpeg", nb_frames: "N/A" })).toBe(false);
		expect(isCoverArt({ codec_name: "h264", nb_frames: "1" })).toBe(false);
	});
});

describe.skipIf(!ffmpeg)("import proxy (ffmpeg)", () => {
	const lavfi = (spec: string) => ["-f", "lavfi", "-i", spec];
	const cases: Array<[string, string, string[]]> = [
		["iPhone HEVC 10-bit", "iphone.mov", [...lavfi("testsrc2=size=1080x1920:rate=30"), ...lavfi("sine=f=440"), "-t", "2", "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-c:a", "aac"]],
		["ProRes 422", "prores.mov", [...lavfi("testsrc2=size=1280x720:rate=25"), ...lavfi("sine=f=330"), "-t", "2", "-c:v", "prores_ks", "-profile:v", "2", "-c:a", "pcm_s16le"]],
		["VFR phone clip", "vfr.mp4", [...lavfi("testsrc2=size=640x360:rate=30"), "-t", "3", "-vf", "setpts='if(lt(N,30),PTS,PTS*1.7)'", "-fps_mode", "vfr", "-c:v", "libx264"]],
		["MKV with Opus", "clip.mkv", [...lavfi("testsrc2=size=640x360:rate=24"), ...lavfi("sine=f=550"), "-t", "2", "-c:v", "libx264", "-c:a", "libopus"]],
	];

	for (const [label, name, args] of cases) {
		// a recorder's PCM sound stays PCM (24-bit, in a .mov): pro-heavy 09.11
		const pcm = args.some((a) => a.startsWith("pcm_"));
		test(`${label} → H.264 ${pcm ? "+ 24-bit PCM MOV" : "/AAC MP4"}, constant frame rate`, async () => {
			const state = await convert(make(name, args));
			expect(state.error).toBeUndefined();
			expect(state.status).toBe("done");
			const result = state.result as { fileId: string; mime: string };
			expect(result.mime).toBe(pcm ? "video/quicktime" : "video/mp4");
			const streams = probe(getFile(result.fileId).path);
			const sound = streams.find((s) => s.codec_type === "audio");
			if (sound) expect(sound.codec_name).toBe(pcm ? "pcm_s24le" : "aac");
			const video = streams.find((s) => s.codec_type === "video");
			expect(video?.codec_name).toBe("h264");
			expect(video?.pix_fmt).toBe("yuv420p");
			const [rn, rd] = String(video?.r_frame_rate).split("/").map(Number);
			const [an, ad] = String(video?.avg_frame_rate).split("/").map(Number);
			expect(Math.abs(rn / rd - an / ad)).toBeLessThan(0.05);
		}, 120_000);
	}

	test("camera Motion-JPEG .mov stays a video (was taken for cover art and imported as sound)", async () => {
		const state = await convert(make("camera.mov", [...lavfi("testsrc2=size=640x360:rate=30"), ...lavfi("sine=f=440"), "-t", "2", "-c:v", "mjpeg", "-c:a", "pcm_s16le"]));
		expect(state.status).toBe("done");
		const result = state.result as { fileId: string; mime: string };
		expect(result.mime).toBe("video/quicktime");
		expect(probe(getFile(result.fileId).path).find((s) => s.codec_type === "video")?.codec_name).toBe("h264");
		expect(probe(getFile(result.fileId).path).find((s) => s.codec_type === "audio")?.codec_name).toBe("pcm_s24le");
	}, 60_000);

	test("cover art in an MP3 is still not a video", async () => {
		const cover = make("cover.png", [...lavfi("testsrc2=size=300x300"), "-frames:v", "1"]);
		const mp3 = make("song.mp3", [...lavfi("sine=f=440"), "-i", getFile(cover).path, "-t", "2", "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "png", "-disposition:v", "attached_pic"]);
		const state = await convert(mp3);
		expect(state.status).toBe("done");
		expect((state.result as { mime: string }).mime).toBe("audio/mp4");
	}, 60_000);

	test("repair: a web MP4 cut off midway is copied up to where its data ends, no re-encode", async () => {
		const whole = make("whole.mp4", [...lavfi("testsrc2=size=640x360:rate=30"), ...lavfi("sine=f=440"), "-t", "4", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart"]);
		const bytes = fs.readFileSync(getFile(whole).path);
		const cut = newFile("cut.mp4");
		fs.writeFileSync(cut.path, bytes.subarray(0, Math.floor(bytes.length * 0.5)));
		const state = await convert(cut.id, "repair");
		expect(state.status).toBe("done");
		const result = state.result as { fileId: string; mime: string };
		const video = probe(getFile(result.fileId).path).find((s) => s.codec_type === "video");
		expect(video?.codec_name).toBe("h264");
		expect(Number(video?.duration)).toBeGreaterThan(0.5);
		expect(Number(video?.duration)).toBeLessThan(3.5);
	}, 60_000);

	test("Opus voice → AAC M4A", async () => {
		const state = await convert(make("voice.opus", [...lavfi("sine=f=660"), "-t", "2", "-c:a", "libopus"]));
		expect(state.status).toBe("done");
		const result = state.result as { fileId: string; mime: string };
		expect(result.mime).toBe("audio/mp4");
		expect(probe(getFile(result.fileId).path)[0]?.codec_name).toBe("aac");
	}, 60_000);

	test.skipIf(!fs.existsSync("/usr/bin/sips"))("HEIC photo → JPEG", async () => {
		const png = make("frame.png", [...lavfi("testsrc2=size=800x600"), "-frames:v", "1"]);
		const heic = newFile("photo.heic");
		execFileSync("/usr/bin/sips", ["-s", "format", "heic", getFile(png).path, "--out", heic.path]);
		const state = await convert(heic.id);
		expect(state.status).toBe("done");
		const result = state.result as { fileId: string; mime: string };
		expect(result.mime).toBe("image/jpeg");
		expect(probe(getFile(result.fileId).path)[0]?.codec_name).toBe("mjpeg");
	}, 60_000);

	test("garbage file → clear error, no crash", async () => {
		const slot = newFile("broken.mov");
		fs.writeFileSync(slot.path, "not a video");
		const state = await convert(slot.id);
		expect(state.status).toBe("failed");
		expect(state.error).toContain("can't be read");
	}, 60_000);
});
