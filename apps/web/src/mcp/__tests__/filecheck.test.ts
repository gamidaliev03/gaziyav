// What `export` says about the file it wrote (exam 11.11: five of six examinees wanted to run ffprobe on the export).
import { describe, expect, test } from "bun:test";
import { checkLine, type FileCheck } from "../server/filecheck";

const ok: FileCheck = { seconds: 32.42, width: 1080, height: 1920, fps: 30, hasVideo: true, hasAudio: true, lufs: -14, peak: -1.5, black: [], silent: [], frames: ["a", "b", "c"], whole: true };

describe("the export's check of its own file, in words", () => {
	test("a good file: its own facts, nothing wrong, the frames named", () => {
		const line = checkLine(ok, { seconds: 32.3 });
		expect(line).toBe("The file itself, checked: 32.42 s · 1080×1920 30 fps · sound -14 LUFS, peak -1.5 dB · no black or silent stretch. Its frames: first, middle, last second.");
	});

	test("the cover's few frames are not a difference; half a second is", () => {
		expect(checkLine(ok, { seconds: 32.3 })).not.toMatch(/⚠/);
		expect(checkLine(ok, { seconds: 31.2 })).toMatch(/⚠ the file is 32\.42 s but the timeline was 31\.2 s/);
	});

	test("what is wrong comes after ⚠: no sound, black picture, silence — with their times", () => {
		const line = checkLine({ ...ok, hasAudio: false, lufs: null, peak: null, black: [[0, 0.8], [30.1, 32.4]], silent: [] }, { seconds: 32.3 });
		expect(line).toMatch(/⚠ NO SOUND in the file; black picture at 0–0\.8 s, 30\.1–32\.4 s/);
		expect(checkLine({ ...ok, silent: [[12, 15.5]] })).toMatch(/⚠ no sound at all at 12–15\.5 s/);
	});

	test("a long file says its key frames were read; many stretches are counted, not listed", () => {
		expect(checkLine({ ...ok, whole: false, frames: [] })).toMatch(/no black or silent stretch \(a long file: its key frames were read\)\.$/);
		const many = checkLine({ ...ok, black: [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11]] });
		expect(many).toMatch(/black picture at 0–1 s, 2–3 s, 4–5 s, 6–7 s and 2 more/);
	});
});
