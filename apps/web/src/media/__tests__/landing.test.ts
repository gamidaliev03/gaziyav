import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// Run on its own too (the wasm is set up by whichever test file runs first otherwise).
beforeAll(installOpenCutWasm);

const video = (seconds: number) => ({ id: "v", type: "video", startTime: 0, duration: seconds * 120_000 });
const tracksOf = (seconds: number) => ({ main: { id: "m", type: "video", elements: [video(seconds)] }, overlay: [], audio: [] });
const asset = (id: string, seconds: number) => ({ id, type: "audio", name: id, duration: seconds, file: new File([], `${id}.mp3`) });

describe("an imported song lands cut to the end of the video", () => {
	test("a 3-minute song over a 15 s video: 15 s, the rest kept in the source, 1 s fade-out", async () => {
		const { buildLandingElement } = await import("@/media/source-marks");
		const { TICKS_PER_SECOND } = await import("@/wasm");
		const tracks = tracksOf(15 * TICKS_PER_SECOND / 120_000) as never;
		const song = buildLandingElement({ asset: asset("song", 180) as never, startTime: 0 as never, tracks }) as unknown as Record<string, number & Record<string, number>>;
		expect(song.duration / TICKS_PER_SECOND).toBeCloseTo(15, 3);
		expect(song.trimEnd / TICKS_PER_SECOND).toBeCloseTo(165, 3);
		expect(song.params.fadeOut).toBe(1);
	});

	test("a sound effect, a song with no video after it and a song that fits keep their length", async () => {
		const { buildLandingElement } = await import("@/media/source-marks");
		const { TICKS_PER_SECOND } = await import("@/wasm");
		const tracks = tracksOf(15 * TICKS_PER_SECOND / 120_000) as never;
		const len = (id: string, seconds: number, at = 0) =>
			(buildLandingElement({ asset: asset(id, seconds) as never, startTime: (at * TICKS_PER_SECOND) as never, tracks }) as unknown as { duration: number }).duration / TICKS_PER_SECOND;
		expect(len("whoosh", 5, 12)).toBeCloseTo(5, 3);
		expect(len("late", 120, 14)).toBeCloseTo(120, 3);
		expect(len("short", 12)).toBeCloseTo(12, 3);
		expect(len("empty", 60, 0)).toBeCloseTo(15, 3);
	});
});

describe("a source range lands on the file's frames (pro-core 09.11)", () => {
	test("I / O a hair off a 29.97 frame: the range starts on the frame shown and lasts whole frames", async () => {
		const { useSourceMarks, buildSourceRangeElement, sourceFrameTicks } = await import("@/media/source-marks");
		const clip = { id: "v2997", type: "video", name: "v", duration: 12, fps: 30_000 / 1_001, file: new File([], "v.mp4") };
		// the player's time a little before and after frame 12 (0.4004 s) and frame 42 (1.4014 s)
		useSourceMarks.getState().setIn({ id: clip.id, seconds: 0.40039999 });
		useSourceMarks.getState().setOut({ id: clip.id, seconds: 1.4014000001 });
		const element = buildSourceRangeElement({ asset: clip as never, startTime: 0 as never }) as unknown as { trimStart: number; duration: number; trimEnd: number };
		expect(element.trimStart).toBe(12 * 4004);
		expect(element.duration).toBe(30 * 4004);
		expect(element.trimStart + element.duration + element.trimEnd).toBe(12 * 120_000);
		// the player's time a few microseconds short of a frame it was stepped to is that frame (it read 11 for 12)
		expect(sourceFrameTicks({ type: "video", fps: 25 })(0.479996)).toBe(12 * 4800);
		expect(sourceFrameTicks({ type: "video", fps: 30_000 / 1_001 })(0.4004 - 12e-6)).toBe(12 * 4004);
		// a time inside a frame belongs to that frame; a sound keeps its exact time
		expect(sourceFrameTicks({ type: "video", fps: 25 })(0.4 + 0.039)).toBe(10 * 4800);
		expect(sourceFrameTicks({ type: "audio" })(0.123456)).toBe(Math.round(0.123456 * 120_000));
	});
});
