import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { ElementAnimations, ScalarAnimationKey } from "@/animation/types";
import type { GraphicElement, SceneTracks, TScene, TimelineElement } from "@/timeline/types";
import { transformAt } from "../remotion/transform";

// flatten resolves keyframes with the editor's own interpolation, which needs the wasm timebase.
let F: typeof import("../flatten");
let resolve: typeof import("@/animation/resolve").resolveAnimationPathValueAtTime;
beforeAll(async () => {
	await installOpenCutWasm();
	F = await import("../flatten");
	resolve = (await import("@/animation/resolve")).resolveAnimationPathValueAtTime;
	F.configureTimebase(T);
});

const T = 120000;
const track = (id: string, elements: TimelineElement[]) => ({ id, name: id, type: "graphic", hidden: false, muted: false, elements }) as never;
const emptyMain = () => ({ id: "m", name: "m", type: "video", hidden: false, muted: false, elements: [] }) as never;
const plate = (extra: Record<string, unknown> = {}) =>
	({ id: "plate", type: "graphic", name: "Plate", definitionId: "ai.Plate", startTime: 0, duration: 2 * T, trimStart: 0, trimEnd: 0, params: { text: "x", "transform.positionX": 10 }, ...extra }) as never;
const logo = (extra: Record<string, unknown> = {}) =>
	({ id: "logo", type: "image", name: "logo.png", mediaId: "m", startTime: 0, duration: 2 * T, trimStart: 0, trimEnd: 0, params: { "transform.positionX": 20, "transform.scaleX": 1, "transform.scaleY": 1, opacity: 1 }, ...extra }) as never;
const sceneOf = (id: string, elements: TimelineElement[][], main: TimelineElement[] = []): TScene =>
	({
		id,
		name: "Composition 1",
		isMain: false,
		bookmarks: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		tracks: { overlay: elements.map((e, i) => track(`${id}-t${i}`, e)), main: { ...(emptyMain() as object), id: `${id}-main`, elements: main } as never, audio: [] },
	}) as never;
const inner = () => sceneOf("inner", [[plate()], [logo()]]);
const comp = (params: Record<string, unknown>, extra: Record<string, unknown> = {}): GraphicElement =>
	({ id: "comp", type: "graphic", name: "AI Composition 1", definitionId: "ai.Composition", startTime: 0, duration: 2 * T, trimStart: 0, trimEnd: 0, params: { sceneId: "inner", alpha: true, ...params }, ...extra }) as never;
const mainTracks = (c: GraphicElement): SceneTracks => ({ overlay: [track("c", [c])], main: emptyMain(), audio: [] });
const flatEls = (tracks: SceneTracks) => [...tracks.overlay, tracks.main].flatMap((t) => t.elements as TimelineElement[]);

const key = (time: number, value: number, segmentToNext: ScalarAnimationKey["segmentToNext"] = "linear"): ScalarAnimationKey =>
	({ id: `k${time}-${value}`, time, value, segmentToNext, tangentMode: "auto" }) as never;
const channel = (...keys: ScalarAnimationKey[]) => ({ keys });

/** What the renderer draws for an element at parent time t (ticks). */
function drawn(el: TimelineElement, t: number) {
	const local = Math.min(Math.max(t - el.startTime, 0), el.duration);
	const p = el.params as Record<string, number>;
	const r = (path: string, fb: number) => resolve({ animations: el.animations, propertyPath: path, localTime: local, fallbackValue: fb });
	return { x: r("transform.positionX", p["transform.positionX"] ?? 0), y: r("transform.positionY", p["transform.positionY"] ?? 0), sx: r("transform.scaleX", p["transform.scaleX"] ?? 1), rot: r("transform.rotate", p["transform.rotate"] ?? 0), op: r("opacity", p.opacity ?? 1) };
}

describe("composition clip transform", () => {
	test("moving and scaling the clip moves its AI layers and its clips (composed with their own transform)", () => {
		const c = comp({ "transform.positionX": 100, "transform.positionY": -50, "transform.scaleX": 0.5, "transform.scaleY": 0.5, opacity: 0.8 });
		const flat = F.flattenCompositions({ tracks: mainTracks(c), scenes: [inner()] });
		const tf = flat.items[0].tf!;
		expect(tf.x).toBeCloseTo(100 + 10 * 0.5);
		expect(tf.y).toBeCloseTo(-50);
		expect(tf.sx).toBeCloseTo(0.5);
		expect(tf.op).toBeCloseTo(0.8);
		expect(flat.items[0].tfk).toBeUndefined();
		const l = flatEls(flat.tracks).find((e) => e.id === "logo")!;
		expect(l.params["transform.positionX"]).toBeCloseTo(100 + 20 * 0.5);
		expect(l.params["transform.scaleX"]).toBeCloseTo(0.5);
		expect(l.animations).toBeUndefined();
	});
	test("rotation turns the inner offsets around the frame centre", () => {
		const t = F.composeTf({ ...F.IDENTITY_TF, rot: 90 }, { ...F.IDENTITY_TF, x: 10 });
		expect(t.x).toBeCloseTo(0);
		expect(t.y).toBeCloseTo(10);
		expect(t.rot).toBe(90);
	});
	test("an untouched clip changes nothing", () => {
		const flat = F.flattenCompositions({ tracks: mainTracks(comp({})), scenes: [inner()] });
		expect(flat.items[0].tf!.x).toBe(10);
		const l = flatEls(flat.tracks).find((e) => e.id === "logo")!;
		expect(l.params["transform.positionX"]).toBe(20);
	});
});

describe("keyframed composition clip", () => {
	// x: 0 → 300 (bezier ease), scale 1 → 0.5 (linear), rotation 0 → 45, opacity 1 → 0.25 over the 2 s clip.
	const animations: ElementAnimations = {
		"transform.positionX": channel(key(0, 0, "bezier"), key(2 * T, 300)),
		"transform.scaleX": channel(key(0, 1), key(2 * T, 0.5)),
		"transform.scaleY": channel(key(0, 1), key(2 * T, 0.5)),
		"transform.rotate": channel(key(0, 0), key(T, 45)),
		opacity: channel(key(T / 2, 1), key(2 * T, 0.25)),
	};
	const c = () => comp({}, { animations });
	const expected = (t: number, child: { x: number; y?: number }) => F.composeTf(F.tfAt(c() as never, t), { ...F.IDENTITY_TF, x: child.x, y: child.y ?? 0 });

	test("AI layers follow the animation frame by frame (samples = exact composed transform on every frame)", () => {
		const flat = F.flattenCompositions({ tracks: mainTracks(c()), scenes: [inner()], fps: 30 });
		const item = flat.items[0];
		expect(item.tfk).toBeDefined();
		expect(item.tfk!.r).toBe(60);
		for (let frame = 0; frame <= 60; frame++) {
			const t = (frame / 30) * T;
			const want = expected(t, { x: 10 });
			const got = transformAt(item, frame / 30)!;
			expect(got.x).toBeCloseTo(want.x, 2);
			expect(got.y).toBeCloseTo(want.y, 2);
			expect(got.sx).toBeCloseTo(want.sx, 3);
			expect(got.rot).toBeCloseTo(want.rot, 2);
			expect(got.op).toBeCloseTo(want.op, 3);
		}
		// It really moves: start and end differ by the animation.
		expect(transformAt(item, 0)!.x).toBeCloseTo(10);
		expect(transformAt(item, 2)!.x).toBeCloseTo(300 + 10 * 0.5 * Math.cos(Math.PI / 4), 1);
	});

	test("inner clips get keyframes that draw the same composed transform (within a sub-pixel tolerance)", () => {
		const flat = F.flattenCompositions({ tracks: mainTracks(c()), scenes: [inner()], fps: 30 });
		const l = flatEls(flat.tracks).find((e) => e.id === "logo")!;
		expect(l.animations?.["transform.positionX"]).toBeDefined();
		let worst = 0;
		for (let frame = 0; frame <= 60; frame++) {
			const t = (frame / 30) * T;
			const want = expected(t, { x: 20 });
			const got = drawn(l, t);
			worst = Math.max(worst, Math.abs(got.x - want.x), Math.abs(got.sx - want.sx) * 1000, Math.abs(got.rot - want.rot), Math.abs(got.op - want.op) * 100);
		}
		expect(worst).toBeLessThan(0.05);
		// Simplified: far fewer keys than frames on the linear scale ramp.
		const keys = (l.animations!["transform.scaleX"] as { keys: unknown[] }).keys;
		expect(keys.length).toBeLessThanOrEqual(3);
	});

	test("an inner clip's own keyframes are composed with the clip's still transform", () => {
		const own: ElementAnimations = { "transform.positionY": channel(key(0, 0), key(2 * T, 200)) };
		const scene = sceneOf("inner", [[plate({ animations: own })], [logo({ animations: own })]]);
		const flat = F.flattenCompositions({ tracks: mainTracks(comp({ "transform.scaleX": 0.5, "transform.scaleY": 0.5, "transform.positionX": 100 })), scenes: [scene], fps: 30 });
		const item = flat.items[0];
		expect(transformAt(item, 1)!.y).toBeCloseTo(100 * 0.5, 2);
		expect(transformAt(item, 1)!.x).toBeCloseTo(100 + 10 * 0.5, 2);
		const l = flatEls(flat.tracks).find((e) => e.id === "logo")!;
		expect(drawn(l, T).y).toBeCloseTo(50, 1);
		expect(drawn(l, 2 * T).y).toBeCloseTo(100, 1);
	});

	test("preview and export see the same samples (deterministic flattening)", () => {
		const a = F.flattenCompositions({ tracks: mainTracks(c()), scenes: [inner()], fps: 30 }).items[0].tfk;
		const b = F.flattenCompositions({ tracks: mainTracks(c()), scenes: [inner()], fps: 30 }).items[0].tfk;
		expect(a).toEqual(b);
	});

	test("nested: the outer clip's animation reaches the inner composition's layers", () => {
		const middle = sceneOf("middle", [[comp({}, { id: "comp-in", startTime: 0 })]]);
		const outer = comp({ sceneId: "middle" }, { animations: { "transform.positionY": channel(key(0, 0), key(2 * T, -400)) } });
		const flat = F.flattenCompositions({ tracks: mainTracks(outer), scenes: [middle, inner()], fps: 30 });
		const item = flat.items.find((i) => i.id === "plate")!;
		expect(item.owner).toBe("comp-in");
		expect(transformAt(item, 1)!.y).toBeCloseTo(-200, 1);
		expect(transformAt(item, 2)!.y).toBeCloseTo(-400, 1);
	});

	test("a 25 fps project samples on its own frame grid (75 Hz)", () => {
		expect(F.sampleRate(25)).toBe(75);
		expect(F.sampleRate(24)).toBe(72);
		expect(F.sampleRate(60)).toBe(60);
		expect(F.sampleRate(30)).toBe(60);
	});
});

describe("trims on the composition clip", () => {
	test("a head trim shows inner time from the trim on: AI layer skip and clip keyframes stay on inner time", () => {
		const own: ElementAnimations = { "transform.positionX": channel(key(0, 0), key(2 * T, 200)) };
		const scene = sceneOf("inner", [[plate()], [logo({ animations: own })]]);
		// Trimmed 0.5 s at the head: the clip starts at 3 s on the parent and shows inner 0.5 s → 2 s.
		const c = comp({}, { startTime: 3 * T, duration: 1.5 * T, trimStart: 0.5 * T });
		const flat = F.flattenCompositions({ tracks: mainTracks(c), scenes: [scene], fps: 30 });
		const item = flat.items[0];
		expect(item.from).toBeCloseTo(3);
		expect(item.skip).toBeCloseTo(0.5);
		expect(item.dur).toBeCloseTo(1.5);
		const l = flatEls(flat.tracks).find((e) => e.id === "logo")!;
		expect(Number(l.startTime)).toBe(3 * T);
		expect(Number(l.trimStart)).toBe(0.5 * T);
		// At parent 3 s = inner 0.5 s the logo is a quarter of the way: x = 50 (not 0).
		expect(drawn(l, 3 * T).x).toBeCloseTo(50, 3);
		expect(drawn(l, 4.5 * T).x).toBeCloseTo(200, 3);
	});

	test("a tail trim cuts the inner clips at the end of the clip", () => {
		const c = comp({}, { duration: 1 * T, trimEnd: 1 * T });
		const flat = F.flattenCompositions({ tracks: mainTracks(c), scenes: [inner()] });
		expect(flat.items[0].dur).toBeCloseTo(1);
		const l = flatEls(flat.tracks).find((e) => e.id === "logo")!;
		expect(Number(l.duration)).toBe(1 * T);
		expect(Number(l.trimEnd)).toBe(1 * T);
	});

	test("a 2× clip inside a head-trimmed composition plays the right source frames", () => {
		const fast = { id: "v", type: "video", name: "v.mp4", mediaId: "m", startTime: 0, duration: 2 * T, trimStart: 0, trimEnd: 0, params: {}, retime: { rate: 2 } } as never;
		const scene = sceneOf("inner", [], [fast]);
		const c = comp({}, { startTime: 1 * T, duration: 1 * T, trimStart: 1 * T });
		const flat = F.flattenCompositions({ tracks: mainTracks(c), scenes: [scene] });
		const v = flatEls(flat.tracks).find((e) => e.id === "v")!;
		expect(Number(v.startTime)).toBe(1 * T);
		expect(Number(v.duration)).toBe(1 * T);
		// 1 s of timeline at 2× = 2 s of source cut at the head.
		expect(Number(v.trimStart)).toBe(2 * T);
	});
});

describe("inside a composition", () => {
	test("only its own contents play unless 'Show video underneath' is on", () => {
		expect(F.showsUnderlay(comp({}))).toBe(false);
		expect(F.showsUnderlay(comp({ underlay: true }))).toBe(true);
		expect(F.showsUnderlay(comp({ underlay: true, alpha: false }))).toBe(false);
	});
});
