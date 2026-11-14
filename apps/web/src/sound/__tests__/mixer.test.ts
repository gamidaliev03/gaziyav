import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "@/timeline/types";
import { FADER_MAX_DB, FADER_MIN_DB, faderDb, faderPosition, formatDb, formatPan } from "../mixer/fader-law";

const T = 120000;
type Levels = typeof import("../mixer/levels");
let levels: Levels;
beforeAll(async () => {
	await installOpenCutWasm();
	levels = await import("../mixer/levels");
});

const clip = (id: string, start: number, seconds: number, params: Record<string, unknown> = {}, animations?: unknown) => ({ id, name: id, type: "audio", sourceType: "upload", mediaId: "m", startTime: start * T, duration: seconds * T, trimStart: 0, trimEnd: 0, params, ...(animations ? { animations } : {}) });
const key = (id: string, seconds: number, value: number) => ({ id, time: seconds * T, value, segmentToNext: "linear", tangentMode: "auto" });
const tracksOf = (audio: unknown[], main: unknown[] = []) =>
	({ overlay: [{ id: "text", name: "Text", type: "text", hidden: false, elements: [] }], main: { id: "main", name: "Main Track", type: "video", muted: false, hidden: false, elements: main }, audio }) as unknown as SceneTracks;

describe("the fader's law", () => {
	test("0 dB at four fifths, the ends at −60 and +12, there and back", () => {
		expect(faderPosition(0)).toBeCloseTo(0.8, 6);
		expect(faderPosition(FADER_MIN_DB)).toBe(0);
		expect(faderPosition(FADER_MAX_DB)).toBe(1);
		expect(faderPosition(-200)).toBe(0);
		expect(faderPosition(40)).toBe(1);
		for (const db of [-60, -47, -30, -12, -6, -3, 0, 3, 6, 9, 12]) expect(faderDb(faderPosition(db))).toBeCloseTo(db, 6);
		// it only ever rises
		let last = -1;
		for (let db = -60; db <= 12; db += 0.5) {
			const p = faderPosition(db);
			expect(p).toBeGreaterThanOrEqual(last);
			last = p;
		}
	});
	test("how levels and pans are written", () => {
		expect(formatDb(-6)).toBe("−6.0");
		expect(formatDb(3.46)).toBe("+3.5");
		expect(formatDb(0.04)).toBe("0.0");
		expect(formatPan(0)).toBe("C");
		expect(formatPan(-30)).toBe("L 30");
		expect(formatPan(100)).toBe("R 100");
	});
});

describe("strips", () => {
	const video = { id: "v", name: "v", type: "video", mediaId: "vid", startTime: 0, duration: 4 * T, trimStart: 0, trimEnd: 0, params: {} };
	const picture = { id: "p", name: "p", type: "image", mediaId: "pic", startTime: 4 * T, duration: 2 * T, trimStart: 0, trimEnd: 0, params: {} };
	const assets = [{ id: "vid", type: "video", hasAudio: true }, { id: "pic", type: "image" }, { id: "m", type: "audio" }] as never[];

	test("one per track that has a clip with sound, in the timeline's order; named like the timeline names them", () => {
		const tracks = tracksOf(
			[
				{ id: "a1", name: "Audio Track", type: "audio", muted: false, elements: [clip("x", 0, 2)] },
				{ id: "a2", name: "· drums", type: "audio", muted: true, solo: true, elements: [clip("y", 0, 2)] },
				{ id: "a3", name: "Audio Track", type: "audio", muted: false, elements: [] },
			],
			[video, picture],
		);
		const strips = levels.stripsOf(tracks, assets);
		expect(strips.map((s) => [s.trackId, s.kind, s.name, s.number, s.muted, s.solo, s.clips.length])).toEqual([
			["main", "main", null, 0, false, false, 1],
			["a1", "audio", null, 1, false, false, 1],
			["a2", "audio", "· drums", 2, true, true, 1],
		]);
		// a video whose file has no sound, or whose sound is switched off, is not on the mixer
		const mute = levels.stripsOf(tracksOf([], [{ ...video, isSourceAudioEnabled: false }]), assets);
		expect(mute.length).toBe(0);
	});

	test("a strip reads the clip under the playhead, else the next one, else the last", () => {
		const clips = [clip("a", 0, 2, { volume: -3 }), clip("b", 5, 2, { volume: -9, pan: 40 })] as never[];
		expect(levels.clipAt(clips, 1 * T)).toMatchObject({ under: true, clip: { id: "a" } });
		expect(levels.clipAt(clips, 3 * T)).toMatchObject({ under: false, clip: { id: "b" } });
		expect(levels.clipAt(clips, 9 * T)).toMatchObject({ under: false, clip: { id: "b" } });
		const strip = { trackId: "t", kind: "audio", name: null, number: 0, muted: false, solo: false, clips } as never;
		expect(levels.readStrip(strip, 1 * T)).toMatchObject({ clipId: "a", under: true, volumeDb: -3, pan: 0, animated: false, keyed: false });
		expect(levels.readStrip(strip, 6 * T)).toMatchObject({ clipId: "b", volumeDb: -9, pan: 40 });
	});

	test("with keyframes it reads the level at the playhead, and knows when it stands on a key", () => {
		const keyed = clip("k", 10, 4, { volume: 0 }, { volume: { keys: [key("k1", 1, -12), key("k2", 3, 0)] } });
		const strip = { trackId: "t", kind: "audio", name: null, number: 0, muted: false, solo: false, clips: [keyed] } as never;
		expect(levels.readStrip(strip, 12 * T)).toMatchObject({ animated: true, keyed: false });
		expect(levels.readStrip(strip, 12 * T)?.volumeDb).toBeCloseTo(-6, 5);
		expect(levels.readStrip(strip, 11 * T)).toMatchObject({ keyed: true, volumeDb: -12 });
	});
});

describe("what a fader writes", () => {
	test("the whole track moves together: every clip's volume and every keyframe, by the same dB", () => {
		const a = clip("a", 0, 2, { volume: -3, fadeIn: 0.5 });
		const b = clip("b", 5, 4, { volume: 0 }, { volume: { keys: [key("k1", 1, -12), key("k2", 3, 0)] }, pan: { keys: [key("p1", 0, -50)] } });
		const patches = levels.shiftVolumes([a, b] as never[], -4);
		expect(patches[0]).toEqual({ elementId: "a", updates: { params: { volume: -7 } } });
		const moved = patches[1].updates as unknown as { params: { volume: number }; animations: { volume: { keys: Array<{ id: string; value: number; time: number }> }; pan: unknown } };
		expect(moved.params.volume).toBe(-4);
		expect(moved.animations.volume.keys.map((k) => [k.id, k.value, k.time])).toEqual([["k1", -16, 1 * T], ["k2", -4, 3 * T]]);
		// the pan's keys are untouched (the same object)
		expect(moved.animations.pan).toBe((b as unknown as { animations: { pan: unknown } }).animations.pan);
		// the range holds: nothing goes past −60 … +20
		expect((levels.shiftVolumes([clip("c", 0, 1, { volume: 18 })] as never[], 9)[0].updates as unknown as { params: { volume: number } }).params.volume).toBe(20);
		expect((levels.shiftVolumes([clip("c", 0, 1, { volume: -55 })] as never[], -30)[0].updates as unknown as { params: { volume: number } }).params.volume).toBe(-60);
	});

	test("pans move together too, and stay inside −100 … 100", () => {
		const patches = levels.shiftPans([clip("a", 0, 2, { pan: 20 }), clip("b", 3, 2, { pan: -90 })] as never[], -30);
		expect(patches.map((p) => (p.updates as unknown as { params: { pan: number } }).params.pan)).toEqual([-10, -100]);
	});

	test("on a keyframe the fader moves that keyframe only; where there is none it makes one, joined by straight lines", () => {
		const keyed = clip("k", 10, 4, { volume: 0 }, { volume: { keys: [key("k1", 1, -12), key("k2", 3, 0)] } });
		const on = levels.keyVolume(keyed as never, (1 * T) as never, -20).updates as unknown as { animations: { volume: { keys: Array<{ id: string; value: number }> } } };
		expect(on.animations.volume.keys.map((k) => [k.id, k.value])).toEqual([["k1", -20], ["k2", 0]]);
		const between = levels.keyVolume(keyed as never, (2 * T) as never, -3).updates as unknown as { animations: { volume: { keys: Array<{ time: number; value: number; segmentToNext: string }> } } };
		expect(between.animations.volume.keys.map((k) => [k.time / T, k.value])).toEqual([[1, -12], [2, -3], [3, 0]]);
		expect(between.animations.volume.keys[1].segmentToNext).toBe("linear");
	});
});
