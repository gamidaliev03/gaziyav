import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { readableUntil } from "../readable-until";
import { findTool } from "@/studio/server/tools";

// A web MP4 (index up front) cut off midway reports its full length; readableUntil finds where the data ends.
let ffmpeg: string | null = null;
try {
	ffmpeg = findTool("ffmpeg");
} catch {}

async function videoTrackOf(bytes: Uint8Array) {
	const input = new Input({ source: new BlobSource(new Blob([new Uint8Array(bytes)])), formats: ALL_FORMATS });
	const track = await input.getPrimaryVideoTrack();
	if (!track) throw new Error("no video");
	return { input, track };
}

describe.skipIf(!ffmpeg)("readableUntil", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readable-until-"));
	const file = path.join(dir, "clip.mp4");
	execFileSync(ffmpeg as string, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "4", "-c:v", "libx264", "-g", "30", "-movflags", "+faststart", file]);
	const bytes = new Uint8Array(fs.readFileSync(file));

	test("a complete file → null", async () => {
		const { input, track } = await videoTrackOf(bytes);
		expect(await readableUntil(track)).toBeNull();
		input.dispose();
	});

	test("cut at 50 % → about half of its 4 s", async () => {
		const { input, track } = await videoTrackOf(bytes.subarray(0, Math.floor(bytes.length * 0.5)));
		expect(await input.computeDuration()).toBeCloseTo(4, 1);
		const until = await readableUntil(track);
		expect(until).not.toBeNull();
		expect(until as number).toBeGreaterThan(1);
		expect(until as number).toBeLessThan(3);
		input.dispose();
	});
});
