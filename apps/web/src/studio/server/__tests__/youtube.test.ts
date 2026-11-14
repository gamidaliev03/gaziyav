import { afterAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A piece download that goes silent (a stalled connection under ffmpeg) is stopped by the stall guard and reported,
// instead of hanging until the job's 15-minute limit; ffmpeg gets a network read timeout.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt-stall-"));
const bin = path.join(root, "bin");
fs.mkdirSync(bin);
const argvLog = path.join(root, "argv.txt");
// A yt-dlp that says one line, then never sends a byte (a script for the test's own runtime).
fs.writeFileSync(
	path.join(bin, "yt-dlp"),
	`#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(argvLog)}, process.argv.slice(2).join(" ") + "\\n");\nconsole.log("[youtube] Extracting URL");\nsetTimeout(() => {}, 30000);\n`,
	{ mode: 0o755 },
);
fs.writeFileSync(path.join(bin, "ffmpeg"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const saved = { ...process.env };
Object.assign(process.env, { STUDIO_BIN_DIR: bin, STUDIO_TEST: "1", STUDIO_FAKE_TIMEOUT: "1", LIPSYNC_HOME: root, STUDIO_SUPPORT_DIR: root });
const { downloadSection } = await import("../youtube");
afterAll(() => {
	for (const k of ["STUDIO_BIN_DIR", "STUDIO_TEST", "STUDIO_FAKE_TIMEOUT", "LIPSYNC_HOME", "STUDIO_SUPPORT_DIR"]) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	fs.rmSync(root, { recursive: true, force: true });
});

test("a silent piece download is stopped as stalled (fast way, then the exact way), with a clear message", async () => {
	const dir = path.join(root, "out");
	const t0 = Date.now();
	await expect(downloadSection("https://www.youtube.com/watch?v=abcdefghijk", 10, 20, dir, "clip")).rejects.toThrow("YouTube stopped sending the video");
	expect(Date.now() - t0).toBeLessThan(8000);
	const calls = fs.readFileSync(argvLog, "utf8").trim().split("\n");
	expect(calls.length).toBe(2);
	expect(calls.every((c) => c.includes("ffmpeg_i:-rw_timeout 20000000"))).toBe(true);
	expect(fs.readdirSync(dir)).toEqual([]);
}, 15000);
