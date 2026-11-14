import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { planMaster } from "../plan";
import { measureProgramme } from "../dsp/offline";
import { cleanMaster, isNoMaster, masterOf, NO_MASTER, withMaster } from "../master";
import { isTrackSilent, resolve, soloedTracks, withSoloToggled } from "../solo";
import { ceilingFor, cleanTarget, formatDelta, formatLufs, formatTarget, isOnTarget } from "../targets";
import type { SceneTracks, TScene } from "@/timeline/types";

setDefaultTimeout(120000);
const RATE = 48000;

const track = (id: string, type: "video" | "audio", extra: Record<string, unknown> = {}, elements: unknown[] = []) => ({ id, name: id, type, muted: false, ...(type === "video" ? { hidden: false } : {}), elements, ...extra });
const tracksOf = (over: unknown[] = [], audio: unknown[] = [], main: Record<string, unknown> = {}) => ({ overlay: over, main: track("main", "video", main), audio }) as unknown as SceneTracks;

describe("the master on the timeline", () => {
	test("none by default; a set one rides on the main track and comes off again when it says nothing", () => {
		const t = tracksOf();
		expect(masterOf(t)).toBe(NO_MASTER);
		const set = withMaster(t, { gainDb: 2.5, ceilingDb: -1 });
		expect(masterOf(set)).toEqual({ gainDb: 2.5, ceilingDb: -1 });
		expect(set.main.id).toBe("main");
		expect(set.overlay).toBe(t.overlay);
		const back = withMaster(set, { gainDb: 0 });
		expect("master" in back.main).toBe(false);
		expect(isNoMaster(masterOf(back))).toBe(true);
		// the same master again is the same tracks (no empty undo step)
		expect(withMaster(set, { gainDb: 2.5, ceilingDb: -1 })).toBe(set);
	});
	test("what is stored is made safe", () => {
		expect(cleanMaster({ gainDb: 99 })).toEqual({ gainDb: 24 });
		expect(cleanMaster({ gainDb: Number.NaN, ceilingDb: 3 })).toEqual({ gainDb: 0, ceilingDb: 0 });
		expect(cleanMaster(null)).toEqual({ gainDb: 0 });
	});
});

describe("solo", () => {
	const a = track("a", "audio");
	const b = track("b", "audio");
	const v = track("v", "video");
	test("no solo silences nothing; a solo silences every other track with sound", () => {
		const t = tracksOf([v], [a, b]);
		expect(resolve(t, t, []).size).toBe(0);
		const s = withSoloToggled(t, "a");
		expect([...soloedTracks(s)]).toEqual(["a"]);
		expect([...resolve(s, s, [])].sort()).toEqual(["b", "main", "v"]);
		// a second solo adds; the same again takes it off
		const two = withSoloToggled(s, "b");
		expect([...resolve(two, two, [])].sort()).toEqual(["main", "v"]);
		expect(resolve(withSoloToggled(two, "a"), withSoloToggled(two, "a"), []).has("a")).toBe(true);
	});
	test("«only» makes it the one soloed track, and clears every solo when it already was", () => {
		const t = withSoloToggled(withSoloToggled(tracksOf([v], [a, b]), "a"), "b");
		const only = withSoloToggled(t, "v", true);
		expect([...soloedTracks(only)]).toEqual(["v"]);
		expect(soloedTracks(withSoloToggled(only, "v", true)).size).toBe(0);
	});
	test("a track's own mute still wins", () => {
		const t = withSoloToggled(tracksOf([], [track("a", "audio", { muted: true }), b]), "a");
		const silenced = resolve(t, t, []);
		expect(isTrackSilent(t.audio[0], silenced)).toBe(true);
		expect(isTrackSilent(t.audio[1], silenced)).toBe(true);
	});
	test("the tracks of a compound clip follow the track their clip sits on; a solo left inside does not reach out", () => {
		const inner: TScene = { id: "inner", name: "c", isMain: false, nested: true, bookmarks: [], createdAt: new Date(), updatedAt: new Date(), tracks: tracksOf([], [track("in-a", "audio", { solo: true })], { id: "in-main" }) as SceneTracks };
		(inner.tracks.main as { id: string }).id = "in-main";
		const clip = { id: "c1", type: "graphic", definitionId: "ai.Composition", params: { sceneId: "inner" } };
		const own = tracksOf([], [a], {}) as SceneTracks;
		(own.main as unknown as { elements: unknown[] }).elements = [clip];
		// as it is mixed: the compound's tracks beside the own ones
		const played = { overlay: [{ ...inner.tracks.main, id: "in-main~c1" }], main: own.main, audio: [...own.audio, ...inner.tracks.audio] } as unknown as SceneTracks;
		// nothing soloed outside: the inner solo silences nothing
		expect(resolve(played, own, [inner]).size).toBe(0);
		// «a» soloed: the main track and everything of its compound clip go silent
		const soloA = withSoloToggled(own, "a");
		expect([...resolve({ ...played, audio: [...soloA.audio, ...inner.tracks.audio] } as SceneTracks, soloA, [inner])].sort()).toEqual(["in-a", "in-main~c1", "main"]);
		// the main track soloed: its compound clip's tracks sound, «a» does not
		const soloMain = withSoloToggled(own, "main");
		expect([...resolve({ ...played, main: soloMain.main } as SceneTracks, soloMain, [inner])]).toEqual(["a"]);
	});
});

describe("targets", () => {
	test("numbers as they are shown", () => {
		expect(formatLufs(-14.04)).toBe("−14.0");
		expect(formatLufs(Number.NEGATIVE_INFINITY)).toBe("−∞");
		expect(formatLufs(null)).toBe("—");
		expect(formatDelta(2.84)).toBe("+2.8");
		expect(formatDelta(-0.04)).toBe("0.0");
		expect(formatTarget(-14)).toBe("−14");
		expect(formatTarget(-17.5)).toBe("−17.5");
	});
	test("a target is kept to half steps within −36 … −6; ±0.5 LU counts as on it", () => {
		expect(cleanTarget(-17.74)).toBe(-17.5);
		expect(cleanTarget(3)).toBe(-6);
		expect(cleanTarget("x")).toBe(-14);
		expect(isOnTarget(-14.5, -14)).toBe(true);
		expect(isOnTarget(-14.6, -14)).toBe(false);
		expect(ceilingFor(-14)).toBe(-1);
		expect(ceilingFor(-24)).toBe(-2);
	});
});

/** Deterministic noise in −1 … 1. */
function noise(seconds: number, seed: number): Float32Array {
	let s = seed >>> 0;
	const x = new Float32Array(Math.round(seconds * RATE));
	for (let i = 0; i < x.length; i++) {
		s = (s * 1664525 + 1013904223) >>> 0;
		x[i] = s / 2 ** 31 - 1;
	}
	return x;
}

describe("the plan of «Bring to target»", () => {
	const plan = async (x: Float32Array, target: number) => {
		const channels = [x, x.slice(0)];
		const dry = await measureProgramme({ channels, sampleRate: RATE });
		let passes = 0;
		const result = await planMaster({
			dry,
			target,
			ceilingDb: -1,
			through: (gainDb) => {
				passes++;
				return measureProgramme({ channels, sampleRate: RATE, gainDb, limiterCeilingDb: -1 });
			},
		});
		return { dry, passes, ...result };
	};

	test("room under the ceiling: a plain gain, no limiter, not one extra pass", async () => {
		const x = noise(8, 3).map((v) => v * 0.05);
		const r = await plan(x, -23);
		expect(r.master.ceilingDb).toBeUndefined();
		expect(r.passes).toBe(0);
		expect(Math.abs(r.dry.integrated + r.master.gainDb + 23)).toBeLessThan(0.02);
		expect(r.reached).toBe(true);
	});

	test("stray peaks in the way: the limiter comes on and the loudness still lands on the target", async () => {
		// a steady bed with a thump every two seconds (5 ms of 200 Hz, well above it): the thumps are what the limiter holds
		const x = noise(12, 5).map((v) => v * 0.25);
		for (let i = 4800; i < x.length; i += 96000) for (let j = 0; j < 240; j++) x[i + j] += 0.75 * Math.sin((Math.PI * j) / 240) * Math.sin((2 * Math.PI * 200 * j) / RATE + Math.PI / 2);
		const channels = [x, x.slice(0)];
		const dry = await measureProgramme({ channels, sampleRate: RATE });
		const target = Math.round((dry.integrated + 3) * 2) / 2;
		const r = await plan(x, target);
		expect(r.master.ceilingDb).toBe(-1);
		expect(r.out).not.toBeNull();
		expect(Math.abs((r.out?.integrated ?? 0) - target)).toBeLessThan(0.1);
		expect(r.out?.truePeakDb ?? 0).toBeLessThanOrEqual(-1);
		expect(r.reached).toBe(true);
		expect(r.passes).toBeLessThanOrEqual(3);
		// it worked on the thumps only: under a twentieth of the sound is taken down by more than 1 dB
		expect(r.out?.limiterShare ?? 1).toBeLessThan(0.05);
	});

	test("loudness made of peaks: bursts that carry the loudness are not flattened to reach a number", async () => {
		const x = noise(12, 5);
		for (let i = 0; i < x.length; i++) x[i] *= i % RATE < 2400 ? 0.5 : 0.08;
		const r = await plan(x, -14);
		const loss = r.dry.integrated + r.master.gainDb - (r.out?.integrated ?? 0);
		expect(loss).toBeLessThanOrEqual(1.1);
		expect(r.out?.truePeakDb ?? 0).toBeLessThanOrEqual(-1);
	});

	test("too far to go cleanly: it stops where the limiter would start to flatten the sound, and says it did not reach", async () => {
		// a quiet bed with clicks 30 dB above it: −8 LUFS would need the clicks crushed
		const x = noise(10, 9).map((v) => v * 0.02);
		for (let i = 0; i < x.length; i += 2400) for (let j = 0; j < 480; j++) x[i + j] = (j % 2 ? -0.9 : 0.9) * (1 - j / 480);
		const r = await plan(x, -8);
		expect(r.master.ceilingDb).toBe(-1);
		expect(r.reached).toBe(false);
		const loss = r.dry.integrated + r.master.gainDb - (r.out?.integrated ?? 0);
		expect(loss).toBeLessThanOrEqual(1.1);
		expect(r.out?.integrated ?? 0).toBeLessThan(-8);
	});
});
