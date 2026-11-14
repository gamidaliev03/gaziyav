import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "@/timeline/types";

let F: typeof import("../fit-film");
beforeAll(async () => {
	await installOpenCutWasm();
	F = await import("../fit-film");
});

const S = 120000;
const clip = (id: string, s: number, d: number) => ({ id, type: "video", startTime: s * S, duration: d * S, trimStart: 0, trimEnd: 0, params: {} });
// a 60 s song from 0, cut to 22 s: 38 s of the file left after it
const song = (d = 22, fit = true, extra: Record<string, unknown> = {}) => ({ id: "M", type: "audio", startTime: 0, duration: d * S, trimStart: 0, trimEnd: (60 - d) * S, params: { fadeOut: 3, ...(fit ? { fitFilm: true } : {}) }, ...extra });
const tracks = (main: unknown[], audio: unknown[]) => ({ main: { id: "m", type: "video", elements: main }, overlay: [], audio: [{ id: "a", type: "audio", elements: audio }] }) as unknown as SceneTracks;
const music = (t: SceneTracks) => t.audio[0].elements.find((e) => e.id === "M") as unknown as { duration: number; trimEnd: number; params: Record<string, unknown> };

describe("rule D: a song fitted to the film follows the film's end", () => {
	test("the film got shorter (a 2× speed): the song ends with it, the file's part and the fade follow", () => {
		const t = F.followFilm(tracks([clip("A", 0, 7), clip("B", 7, 3.5), clip("C", 10.5, 8)], [song()]));
		expect(music(t).duration / S).toBe(18.5);
		expect(music(t).trimEnd / S).toBe(41.5);
		expect(music(t).params.fadeOut).toBe(3);
	});
	test("the film got longer: the song grows, never past the end of its file", () => {
		expect(music(F.followFilm(tracks([clip("A", 0, 30)], [song()]))).duration / S).toBe(30);
		expect(music(F.followFilm(tracks([clip("A", 0, 90)], [song()]))).duration / S).toBe(60);
	});
	test("never into the next sound on its track", () => {
		const next = { id: "X", type: "audio", startTime: 25 * S, duration: 2 * S, trimStart: 0, trimEnd: 0, params: {} };
		expect(music(F.followFilm(tracks([clip("A", 0, 30)], [song(), next]))).duration / S).toBe(25);
	});
	test("a song not fitted, or already at the film's end: the same object back", () => {
		const free = tracks([clip("A", 0, 10)], [song(22, false)]);
		expect(F.followFilm(free)).toBe(free);
		const even = tracks([clip("A", 0, 22)], [song()]);
		expect(F.followFilm(even)).toBe(even);
	});
	test("a sped-up song keeps its file maths (2×: 1 s of timeline is 2 s of file)", () => {
		const t = F.followFilm(tracks([clip("A", 0, 20)], [song(22, true, { retime: { mode: "constant", rate: 2 }, trimEnd: 16 * S })]));
		expect(music(t).duration / S).toBe(20);
		expect(music(t).trimEnd / S).toBe(20);
	});
	test("moved or trimmed by hand: the relation ends; the film's own change does not end it", () => {
		const before = tracks([clip("A", 0, 22)], [song()]);
		expect(F.endedByHand(before, tracks([clip("A", 0, 22)], [song(20)]))).toEqual(["M"]);
		expect(F.endedByHand(before, tracks([clip("A", 0, 22)], [{ ...song(), startTime: S }]))).toEqual(["M"]);
		expect(F.endedByHand(before, tracks([clip("A", 0, 18)], [song()]))).toEqual([]);
		const dropped = F.dropFit(before, ["M"]);
		expect(music(dropped).params.fitFilm).toBeUndefined();
		expect(music(dropped).params.fadeOut).toBe(3);
	});
	test("⌘Z: the snapshot gives the song back exactly, its mark too", () => {
		const before = tracks([clip("A", 0, 22)], [song()]);
		const snap = F.snapshotFitted(before);
		const after = F.dropFit(F.followFilm(tracks([clip("A", 0, 15)], [song()])), ["M"]);
		const back = F.restoreFitted(after, snap);
		expect(music(back).duration).toBe(22 * S);
		expect(music(back).trimEnd).toBe(38 * S);
		expect(music(back).params.fitFilm).toBe(true);
	});
});
