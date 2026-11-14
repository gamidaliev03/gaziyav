import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// 10.11: `look media` drew the 24 OLDEST files with black padding Claude read as letterboxing (three needless
// regenerations «no black bars»), and separate_voice left the voice stem named «мама.mp3» while it played the voice
// alone (Claude muted it as «the song»). The sheet's cell and the stems' names are fixed here; the frames themselves
// (no source player in them, newest first) are checked in the app by GaziyavShell/test/gaziyav-produce.mjs.

let vision: typeof import("../vision");
let apply: typeof import("@/neural/apply");
beforeAll(async () => {
	await installOpenCutWasm();
	vision = await import("../vision");
	apply = await import("@/neural/apply");
}, 60_000);

describe("the media sheet", () => {
	test("a cell takes the median shape of the pictures (9:16 … 16:9): one 16:9 picture among portraits doesn't set it", () => {
		expect(vision.cellAspect([9 / 16, 9 / 16, 16 / 9])).toBeCloseTo(9 / 16, 3);
		expect(vision.cellAspect([16 / 9, 16 / 9, 9 / 16])).toBeCloseTo(16 / 9, 3);
		expect(vision.cellAspect([3])).toBeCloseTo(16 / 9, 3);
		expect(vision.cellAspect([])).toBeCloseTo(16 / 9, 3);
	});
});

describe("separate_voice names what it made", () => {
	test("«<song> · voice» and «<song> · music», files to match; separating a stem again keeps the song's name", () => {
		expect(apply.separationNames("мама.mp3")).toEqual({ voice: "мама · voice", music: "мама · music", voiceFile: "мама · voice.mov", musicFile: "мама · music.m4a" });
		expect(apply.separationNames("мама · voice.m4a").voice).toBe("мама · voice");
	});
	test("no separation running: the hearing doesn't wait", () => {
		expect(apply.separationsRunning()).toEqual([]);
		expect(apply.separationsRunning("abc")).toEqual([]);
	});
});
