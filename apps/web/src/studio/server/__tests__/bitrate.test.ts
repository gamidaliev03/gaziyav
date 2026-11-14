import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bitrateOf, fitBitrate } from "../media";
import { findTool } from "../tools";

// kie's ByteDance lipsync takes video of 1–30 Mbit/s. A still talking head cut at a normal quality is far under 1 Mbit/s,
// and kie refused it after the upload; fitBitrate brings it into range first (real ffmpeg).
let ffmpeg = "";
try {
	ffmpeg = findTool("ffmpeg");
} catch {}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-bitrate-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const RANGE = { min: 1_000_000, max: 30_000_000 };
const make = (name: string, video: string[]) => {
	const file = path.join(dir, name);
	execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=4", ...video, "-c:a", "aac", "-shortest", file]);
	return file;
};
const STILL = ["-f", "lavfi", "-i", "color=c=gray:s=640x360:r=25:d=4", "-c:v", "libx264", "-crf", "28", "-pix_fmt", "yuv420p"];

describe.skipIf(!ffmpeg)("video bit rate for kie's lipsync", () => {
	test("a still picture is far under 1 Mbit/s as it is cut", async () => {
		expect(await bitrateOf(make("still.mp4", STILL))).toBeLessThan(RANGE.min / 3);
	});

	test("too low: encoded again inside the range, the sound kept, the original untouched", async () => {
		const input = make("low.mp4", STILL);
		const before = fs.statSync(input).size;
		const out = path.join(dir, "low.fit.mp4");
		const r = await fitBitrate(input, out, RANGE);
		expect(r.changed).toBe(true);
		expect(r.file).toBe(out);
		expect(r.from).toBeLessThan(RANGE.min);
		expect(r.to).toBeGreaterThanOrEqual(RANGE.min);
		expect(r.to).toBeLessThanOrEqual(RANGE.max);
		expect(await bitrateOf(out)).toBe(r.to);
		expect(fs.statSync(input).size).toBe(before);
		const streams = execFileSync(findTool("ffprobe"), ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out]).toString();
		expect(streams).toContain("audio");
	});

	test("inside the range: nothing is done and the same file is sent", async () => {
		const input = path.join(dir, "ok.mp4");
		execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=4", "-c:v", "libx264", "-b:v", "3M", "-minrate", "3M", "-maxrate", "3M", "-bufsize", "6M", "-x264-params", "nal-hrd=cbr", "-pix_fmt", "yuv420p", input]);
		const out = path.join(dir, "ok.fit.mp4");
		const r = await fitBitrate(input, out, RANGE);
		expect(r.changed).toBe(false);
		expect(r.file).toBe(input);
		expect(fs.existsSync(out)).toBe(false);
	});

	test("too high: capped under 30 Mbit/s", async () => {
		const input = path.join(dir, "high.mp4");
		execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=3", "-c:v", "libx264", "-b:v", "42M", "-minrate", "42M", "-maxrate", "42M", "-bufsize", "84M", "-x264-params", "nal-hrd=cbr", "-pix_fmt", "yuv420p", input]);
		expect(await bitrateOf(input)).toBeGreaterThan(RANGE.max);
		const r = await fitBitrate(input, path.join(dir, "high.fit.mp4"), RANGE);
		expect(r.changed).toBe(true);
		expect(r.to).toBeLessThanOrEqual(RANGE.max);
		expect(r.to).toBeGreaterThanOrEqual(RANGE.min);
	});
});
