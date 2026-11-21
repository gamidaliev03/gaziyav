// A compound clip's own sound and picture settings reach the clips it plays (owner 21.11, test/compound-av.mjs):
// flattening gives each inner clip the compound's volume / mute / pan / ducking / audio effects / effects, and its fades
// and keyframed volume as an outer layer the clip envelope multiplies in (preview and export read the same envelope).
import { describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks, TimelineElement, TScene } from "@/timeline/types";

await installOpenCutWasm();
const { COMPOSITION_DEF, configureTimebase, flattenCompositions } = await import("@/montage/flatten");
const { OUTER_MIX, readOuterMix } = await import("@/montage/compound-sound");
const { envelopeGainAt, isEnvelopeDynamic, makeClipEnvelope } = await import("@/sounds/mix/envelope");
const { TICKS_PER_SECOND } = await import("@/wasm");

const T = TICKS_PER_SECOND;
configureTimebase(T);

const track = (id: string, type: string, elements: unknown[]): Record<string, unknown> => ({ id, name: id, type, elements, muted: false, hidden: false });
const video = (id: string, s: number, d: number, params: Record<string, unknown> = {}) =>
	({ id, name: id, type: "video", mediaId: "m", startTime: s * T, duration: d * T, trimStart: 0, trimEnd: 0, params, isSourceAudioEnabled: false }) as unknown as TimelineElement;
const sound = (id: string, s: number, d: number, params: Record<string, unknown> = {}) =>
	({ id, name: id, type: "audio", sourceType: "upload", mediaId: "m", startTime: s * T, duration: d * T, trimStart: 0, trimEnd: 0, params }) as unknown as TimelineElement;

function project(compParams: Record<string, unknown>, extra: Partial<TimelineElement> = {}, mainMuted = false) {
	const inner: TScene = {
		id: "inner",
		name: "Compound clip 1",
		isMain: false,
		tracks: { overlay: [], main: track("im", "video", [video("v", 0, 6)]), audio: [track("ia", "audio", [sound("a", 0, 6, { volume: -6 })])] },
	} as unknown as TScene;
	const comp = {
		id: "c",
		name: "Compound clip 1",
		type: "graphic",
		definitionId: COMPOSITION_DEF,
		startTime: 2 * T,
		duration: 6 * T,
		trimStart: 0,
		trimEnd: 0,
		params: { sceneId: "inner", alpha: true, compound: true, ...compParams },
		...extra,
	};
	const tracks: SceneTracks = { overlay: [], main: { ...track("pm", "video", [comp]), muted: mainMuted }, audio: [] } as unknown as SceneTracks;
	return { tracks, scenes: [inner] };
}

const flatAudio = (p: ReturnType<typeof project>) => {
	const flat = flattenCompositions(p).tracks;
	return [...flat.overlay, flat.main, ...flat.audio].flatMap((t) => t.elements as TimelineElement[]).filter((e) => e.type === "audio" || e.type === "video");
};
const gainAt = (el: TimelineElement, local: number) =>
	envelopeGainAt(makeClipEnvelope({ element: el as never, startTime: el.startTime / T, duration: el.duration / T, voiceRanges: [] }), local);

describe("compound sound", () => {
	test("no setting on the compound: its clips are exactly as inside", () => {
		const [v, a] = flatAudio(project({}));
		expect(a.params).toEqual({ volume: -6 });
		expect(v.params).toEqual({});
		expect(Number(a.startTime)).toBe(2 * T);
	});

	test("volume adds to each clip's own, mute and its track's mute silence them", () => {
		const a = flatAudio(project({ volume: -12 })).find((e) => e.type === "audio")!;
		expect(a.params.volume).toBe(-18);
		expect(flatAudio(project({ muted: true })).every((e) => e.params.muted === true)).toBe(true);
		expect(flatAudio(project({}, {}, true)).every((e) => e.params.muted === true)).toBe(true);
	});

	test("fades act over the compound's own time, multiplied in by the envelope", () => {
		const a = flatAudio(project({ fadeIn: 2, fadeOut: 1 })).find((e) => e.type === "audio")!;
		expect(readOuterMix(a.params)).toEqual([{ start: 2 * T, duration: 6 * T, fadeIn: 2, fadeOut: 1 }]);
		const env = makeClipEnvelope({ element: a as never, startTime: 2, duration: 6, voiceRanges: [] });
		expect(isEnvelopeDynamic(env)).toBe(true);
		const flat = 10 ** (-6 / 20);
		expect(gainAt(a, 0)).toBeCloseTo(0, 6);
		expect(gainAt(a, 3)).toBeCloseTo(flat, 6);
		expect(gainAt(a, 1)).toBeCloseTo(flat * Math.sin(Math.PI / 4), 6);
		expect(gainAt(a, 5.999)).toBeLessThan(flat * 0.01);
	});

	test("keyframed compound volume: the curve over the compound's time", () => {
		const animations = { volume: { keys: [{ id: "k0", time: 0, value: 0, segmentToNext: "linear", tangentMode: "auto" }, { id: "k1", time: 6 * T, value: -20, segmentToNext: "linear", tangentMode: "auto" }] } };
		const a = flatAudio(project({}, { animations } as never)).find((e) => e.type === "audio")!;
		expect(a.params.volume).toBe(-6);
		expect(gainAt(a, 0)).toBeCloseTo(10 ** (-6 / 20), 4);
		expect(gainAt(a, 3)).toBeCloseTo(10 ** (-16 / 20), 3);
	});

	test("pan, ducking and audio effects reach every clip; a clip's own effect is kept", () => {
		const p = project({ pan: 40, duckUnderVoice: true, "fx.limiter": true, "fx.limiter.ceiling": -3 });
		(p.scenes[0].tracks.audio[0].elements[0] as TimelineElement).params["fx.limiter"] = true;
		(p.scenes[0].tracks.audio[0].elements[0] as TimelineElement).params["fx.limiter.ceiling"] = -6;
		const [v, a] = flatAudio(p);
		expect(v.params).toMatchObject({ pan: 40, duckUnderVoice: true, "fx.limiter": true, "fx.limiter.ceiling": -3 });
		expect(a.params).toMatchObject({ pan: 40, duckUnderVoice: true, "fx.limiter": true, "fx.limiter.ceiling": -6 });
	});

	test("the compound's effects (Color, Effects) follow each picture's own", () => {
		const p = project({}, { effects: [{ id: "e1", type: "color", params: {} }] } as never);
		(p.scenes[0].tracks.main.elements[0] as unknown as { effects: unknown[] }).effects = [{ id: "own", type: "blur", params: {} }];
		const v = flatAudio(p).find((e) => e.type === "video") as unknown as { effects: { id: string; type: string }[] };
		expect(v.effects.map((e) => e.type)).toEqual(["blur", "color"]);
		expect(v.effects[1].id).toBe("e1~c");
	});

	test("the compound's effect keyframes follow its effect, in each clip's own time", () => {
		const animations = { "effects.e1.params.saturation": { keys: [{ id: "k", time: 1 * T, value: -100, segmentToNext: "linear", tangentMode: "auto" }] } };
		const p = project({}, { effects: [{ id: "e1", type: "studio.color", params: {} }], animations } as never);
		(p.scenes[0].tracks.main.elements[0] as TimelineElement).startTime = (1 * T) as never;
		const v = flatAudio(p).find((e) => e.type === "video")!;
		const keys = (v.animations?.["effects.e1~c.params.saturation"] as { keys: { time: number }[] } | undefined)?.keys;
		// compound at 2 s, clip at 3 s on the parent: the key at compound time 1 s is clip time 0
		expect(keys?.map((k) => k.time)).toEqual([0]);
	});

	test("nested: both compounds' volumes add, the outer layers stack", () => {
		const p = project({ volume: -3, fadeIn: 1 });
		const outerScene = { id: "outer", name: "Compound clip 2", isMain: false, tracks: p.tracks } as unknown as TScene;
		const top = project({ volume: -4, fadeOut: 1 });
		const topComp = top.tracks.main.elements[0] as unknown as { params: Record<string, unknown>; startTime: number };
		topComp.params.sceneId = "outer";
		topComp.startTime = 0;
		const a = flatAudio({ tracks: top.tracks, scenes: [...p.scenes, outerScene] }).find((e) => e.type === "audio")!;
		expect(a.params.volume).toBe(-13);
		expect(readOuterMix(a.params).length).toBe(2);
		expect(OUTER_MIX in a.params).toBe(true);
	});
});

describe("compound speed", () => {
	test("2×: its clips play twice as fast at the compound's place, half as long, the sound with them", () => {
		const p = project({ "compound.rate": 2 }, { duration: 3 * T } as never);
		const [v, a] = flatAudio(p);
		for (const e of [v, a]) {
			expect(Number(e.startTime)).toBe(2 * T);
			expect(Number(e.duration)).toBe(3 * T);
			expect((e as unknown as { retime: { rate: number } }).retime.rate).toBe(2);
		}
	});

	test("a head trim on the parent (in its time) skips twice as much of the compound's own timeline", () => {
		const p = project({ "compound.rate": 2 }, { duration: 2 * T, trimStart: 1 * T, startTime: 3 * T } as never);
		const a = flatAudio(p).find((e) => e.type === "audio")!;
		expect(Number(a.startTime)).toBe(3 * T);
		expect(Number(a.duration)).toBe(2 * T);
		expect(Number(a.trimStart)).toBe(2 * T);
	});

	test("0.5× with keep pitch: twice as long, pitch kept, volume keyframes stretched", () => {
		const animations = { volume: { keys: [{ id: "k", time: 2 * T, value: -10, segmentToNext: "linear", tangentMode: "auto" }] } };
		const p = project({ "compound.rate": 0.5, "compound.keepPitch": true }, { duration: 12 * T } as never);
		(p.scenes[0].tracks.audio[0].elements[0] as TimelineElement).animations = animations as never;
		const a = flatAudio(p).find((e) => e.type === "audio")! as unknown as { duration: number; retime: { rate: number; maintainPitch?: boolean }; animations: { volume: { keys: { time: number }[] } } };
		expect(a.duration).toBe(12 * T);
		expect(a.retime).toMatchObject({ rate: 0.5, maintainPitch: true });
		expect(a.animations.volume.keys[0].time).toBe(4 * T);
	});
});

describe("compound as one picture (mask)", () => {
	test("a compound with a mask marks every track it opens into with itself; without one, none", async () => {
		const { compoundGroupsOf } = await import("@/montage/compound-group");
		const masked = project({}, { masks: [{ id: "m", type: "ellipse", params: { feather: 0, inverted: false } }] } as never);
		const flat = flattenCompositions(masked).tracks;
		const marked = flat.overlay.filter((t) => compoundGroupsOf(t).length > 0);
		expect(marked.length).toBeGreaterThan(0);
		expect(marked.every((t) => compoundGroupsOf(t)[0].id === "c")).toBe(true);
		expect(flattenCompositions(project({})).tracks.overlay.some((t) => compoundGroupsOf(t).length > 0)).toBe(false);
	});

	test("the builder's layers of one compound become one group node, the rest stay", async () => {
		const { markCompoundGroups, nestCompoundGroups } = await import("@/services/renderer/compound-group");
		const { BaseNode } = await import("@/services/renderer/nodes/base-node");
		const { CompoundGroupNode } = await import("@/services/renderer/nodes/compound-group-node");
		const c = { id: "c", masks: [] } as never;
		const [a, b, d, e] = [new BaseNode(), new BaseNode(), new BaseNode(), new BaseNode()];
		markCompoundGroups(b, [c]);
		markCompoundGroups(d, [c]);
		const out = nestCompoundGroups([a, b, d, e]);
		expect(out.length).toBe(3);
		expect(out[1]).toBeInstanceOf(CompoundGroupNode);
		expect(out[1].children).toEqual([b, d]);
	});
});
