// Hand-made layers of a composition: the motion presets (motion.ts), their baking into keyframes for playback and
// export (flatten.ts), and the layer list / stack order (layers.ts).
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks, TScene, TimelineElement } from "@/timeline/types";
import { transformAt } from "../remotion/transform";
import { applyMotion, ease, hasMotion, IDENTITY_MOTION, motionAt, readMotion, withoutMotion } from "../motion";

let F: typeof import("../flatten");
let L: typeof import("../layers");
let resolve: typeof import("@/animation/resolve").resolveAnimationPathValueAtTime;
beforeAll(async () => {
	await installOpenCutWasm();
	F = await import("../flatten");
	L = await import("../layers");
	resolve = (await import("@/animation/resolve")).resolveAnimationPathValueAtTime;
	F.configureTimebase(T);
});

const T = 120000;
const track = (id: string, elements: TimelineElement[], type = "graphic") => ({ id, name: id, type, hidden: false, muted: false, elements }) as never;
const main = (elements: TimelineElement[] = []) => ({ id: "main", name: "main", type: "video", hidden: false, muted: false, elements }) as never;
const rect = (id: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
	({ id, type: "graphic", name: "Rectangle", definitionId: "rectangle", startTime: 0, duration: 2 * T, trimStart: 0, trimEnd: 0, params: { fill: "#fff", ...params }, ...extra }) as unknown as TimelineElement;
const text = (id: string, params: Record<string, unknown> = {}) =>
	({ id, type: "text", name: "Text", startTime: 0, duration: 2 * T, trimStart: 0, trimEnd: 0, params: { content: "Hello\nworld", ...params } }) as unknown as TimelineElement;
const plate = (params: Record<string, unknown> = {}) =>
	({ id: "plate", type: "graphic", name: "Plate", definitionId: "ai.Plate", startTime: 0, duration: 2 * T, trimStart: 0, trimEnd: 0, params: { text: "Offer", ...params } }) as unknown as TimelineElement;

function drawn(el: TimelineElement, localTicks: number) {
	const p = el.params as Record<string, number>;
	const r = (path: string, fb: number) => resolve({ animations: el.animations, propertyPath: path, localTime: localTicks, fallbackValue: fb });
	return { x: r("transform.positionX", p["transform.positionX"] ?? 0), y: r("transform.positionY", p["transform.positionY"] ?? 0), s: r("transform.scaleX", p["transform.scaleX"] ?? 1), op: r("opacity", p.opacity ?? 1) };
}

describe("motion presets", () => {
	test("no In and no Out is no motion", () => {
		expect(readMotion({})).toBeNull();
		expect(readMotion({ "motion.in": "none", "motion.out": "none" })).toBeNull();
		expect(readMotion({ "motion.in": "bogus" })).toBeNull();
		expect(hasMotion({ "motion.in": "fade" })).toBe(true);
	});
	test("a fade In starts invisible and is at rest after its time; a fade Out ends invisible", () => {
		const m = readMotion({ "motion.in": "fade", "motion.inDur": 0.5, "motion.out": "fade", "motion.outDur": 0.4, "motion.ease": "linear" })!;
		expect(motionAt(m, 0, 3).op).toBeCloseTo(0);
		expect(motionAt(m, 0.25, 3).op).toBeCloseTo(0.5);
		expect(motionAt(m, 1.5, 3)).toEqual(IDENTITY_MOTION);
		expect(motionAt(m, 2.8, 3).op).toBeCloseTo(0.5);
		expect(motionAt(m, 3, 3).op).toBeCloseTo(0);
	});
	test("slides come from their side and leave the named way", () => {
		const m = readMotion({ "motion.in": "slideLeft", "motion.out": "slideUp", "motion.dist": 300 })!;
		expect(motionAt(m, 0, 2).dx).toBeCloseTo(-300);
		expect(motionAt(m, 2, 2).dy).toBeCloseTo(-300);
		const r = readMotion({ "motion.in": "slideUp", "motion.dist": 100 })!;
		expect(motionAt(r, 0, 2).dy).toBeCloseTo(100);
	});
	test("pop overshoots and settles; a short layer shares In and Out", () => {
		const m = readMotion({ "motion.in": "pop", "motion.inDur": 1 })!;
		expect(motionAt(m, 0, 4).s).toBeCloseTo(0.6);
		expect(motionAt(m, 0.6, 4).s).toBeGreaterThan(1.05);
		expect(motionAt(m, 1, 4).s).toBeCloseTo(1);
		const short = readMotion({ "motion.in": "fade", "motion.inDur": 1, "motion.out": "fade", "motion.outDur": 1, "motion.ease": "linear" })!;
		expect(motionAt(short, 0.25, 1).op).toBeCloseTo(0.5);
		expect(motionAt(short, 0.5, 1).op).toBeCloseTo(1);
		expect(motionAt(short, 0.75, 1).op).toBeCloseTo(0.5);
		expect(motionAt(short, 1, 1).op).toBeCloseTo(0);
	});
	test("easings start at 0 and end at 1", () => {
		for (const e of ["linear", "easeOut", "easeIn", "easeInOut", "back", "bounce"] as const) {
			expect(ease(e, 0)).toBeCloseTo(0);
			expect(ease(e, 1)).toBeCloseTo(1);
		}
		expect(ease("back", 0.7)).toBeGreaterThan(1);
	});
	test("motion adds to the layer's transform", () => {
		const t = applyMotion({ x: 10, y: 0, sx: 2, sy: 1, rot: 5, op: 0.5 }, { dx: 5, dy: 1, s: 0.5, rot: 10, op: 0.5 });
		expect(t).toEqual({ x: 15, y: 1, sx: 1, sy: 0.5, rot: 15, op: 0.25 });
		expect(withoutMotion({ a: 1, "motion.in": "fade", "motion.ease": "linear" } as Record<string, unknown>)).toEqual({ a: 1 });
	});
});

describe("baking motion for playback and export", () => {
	test("a shape's In and Out become keyframes on top of its own position; the motion params go", () => {
		const el = rect("r", { "transform.positionX": 50, "motion.in": "slideRight", "motion.dist": 200, "motion.out": "fade", "motion.ease": "linear" });
		const baked = F.bakeMotion(el, 30);
		expect(baked).not.toBe(el);
		expect(hasMotion(baked.params as never)).toBe(false);
		expect(drawn(baked, 0).x).toBeCloseTo(250, 1);
		expect(drawn(baked, 0).op).toBeCloseTo(0, 2);
		expect(drawn(baked, T).x).toBeCloseTo(50, 1);
		expect(drawn(baked, T).op).toBeCloseTo(1, 2);
		expect(drawn(baked, 2 * T).op).toBeCloseTo(0, 2);
		// Baked once only: a second pass changes nothing.
		expect(F.bakeMotion(baked, 30)).toBe(baked);
		// The stored layer is untouched (it stays freely movable).
		expect(el.animations).toBeUndefined();
		expect(F.bakeMotion(rect("plain"), 30).animations).toBeUndefined();
	});
	test("inside a composition the baked motion plays (clips kept, AI layers through Remotion)", () => {
		const inner: TScene = {
			id: "inner",
			name: "Composition 1",
			isMain: false,
			bookmarks: [],
			createdAt: new Date(),
			updatedAt: new Date(),
			tracks: { overlay: [track("t1", [text("tx", { "motion.in": "fade" })]), track("t2", [plate({ "motion.in": "scale", "motion.ease": "linear" })])], main: main(), audio: [] },
		} as never;
		const comp = { id: "comp", type: "graphic", name: "AI Composition 1", definitionId: "ai.Composition", startTime: 0, duration: 2 * T, trimStart: 0, trimEnd: 0, params: { sceneId: "inner", alpha: true } } as never;
		const flat = F.flattenCompositions({ tracks: { overlay: [track("c", [comp])], main: main(), audio: [] }, scenes: [inner], fps: 30 });
		const tx = [...flat.tracks.overlay, flat.tracks.main].flatMap((t) => t.elements as TimelineElement[]).find((e) => e.id === "tx")!;
		expect(drawn(tx, 0).op).toBeCloseTo(0, 2);
		expect("motion.in" in tx.params).toBe(false);
		const item = flat.items.find((i) => i.id === "plate")!;
		expect(item.tfk).toBeDefined();
		expect(transformAt(item, 0)!.op).toBeCloseTo(0, 2);
		expect(transformAt(item, 0)!.sx).toBeCloseTo(0.3, 2);
		expect(transformAt(item, 1)!.sx).toBeCloseTo(1, 2);
		expect("motion.in" in item.props).toBe(false);
		expect(F.hasMotionLayers(inner.tracks)).toBe(true);
	});
});

describe("layer list and stack", () => {
	const tracks = (): SceneTracks => ({ overlay: [track("a", [text("t1")], "text"), track("b", [rect("r1"), rect("r2", {}, { startTime: 3 * T })]), track("c", [plate()])], main: main(), audio: [] });

	test("lists every layer top first, with its kind and label", () => {
		const rows = L.listLayers(tracks(), T);
		expect(rows.map((r) => r.id)).toEqual(["t1", "r1", "r2", "plate"]);
		expect(rows[0]).toMatchObject({ kind: "text", label: "Hello", from: 0, to: 2, main: false });
		expect(rows[1].kind).toBe("rect");
		expect(rows[3]).toMatchObject({ kind: "ai", label: "Plate · Offer" });
	});
	test("up / down moves a layer onto its own track next to its neighbour; an emptied track goes", () => {
		const up = L.reorderLayer(tracks(), "plate", "up", "new")!;
		expect(up.overlay.map((t) => t.id)).toEqual(["a", "new", "b"]);
		expect(L.listLayers(up, T).map((r) => r.id)).toEqual(["t1", "plate", "r1", "r2"]);
		const down = L.reorderLayer(tracks(), "r1", "down", "new")!;
		expect(down.overlay.map((t) => t.id)).toEqual(["a", "b", "c", "new"]);
		expect((down.overlay[1].elements as TimelineElement[]).map((e) => e.id)).toEqual(["r2"]);
		expect(L.reorderLayer(tracks(), "t1", "up", "new")).toBeNull();
		expect(L.reorderLayer(tracks(), "plate", "down", "new")).toBeNull();
	});
	test("a new layer goes on top on a track of its kind", () => {
		const out = L.addLayerOnTop(tracks(), text("t9"), "top");
		expect(out.overlay[0]).toMatchObject({ id: "top", type: "text" });
		expect(L.listLayers(out, T)[0].id).toBe("t9");
	});
	test("a renamed layer shows its own name: a text no longer follows its words, an AI layer drops its kind", () => {
		// The tester's double-click on a row did nothing: a layer could not be renamed at all.
		const patch = L.renameLayerPatch(text("t1"), "  Title   card ")!;
		expect(patch.name).toBe("Title card");
		const renamed = { ...text("t1"), ...patch } as TimelineElement;
		expect(L.layerLabel(renamed)).toBe("Title card");
		expect(L.layerLabel({ ...renamed, params: { ...renamed.params, content: "Other words" } } as TimelineElement)).toBe("Title card");
		expect((renamed.params as Record<string, unknown>).content).toBe("Hello\nworld");
		expect(L.layerLabel({ ...plate(), ...L.renameLayerPatch(plate(), "Price tag") } as TimelineElement)).toBe("Price tag");
		expect(L.layerLabel({ ...rect("r"), ...L.renameLayerPatch(rect("r"), "Bar") } as TimelineElement)).toBe("Bar");
	});
	test("renaming to the same name or to nothing changes nothing (no empty ⌘Z step)", () => {
		expect(L.renameLayerPatch(text("t1"), "Hello")).toBeNull();
		expect(L.renameLayerPatch(rect("r"), " Rectangle ")).toBeNull();
		expect(L.renameLayerPatch(rect("r"), "   ")).toBeNull();
	});
	test("a shape's size is the frame's short side times its scale", () => {
		expect(L.baseSize(rect("r"), { width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1080 });
		expect(L.baseSize({ type: "image" } as never, { width: 1080, height: 1920 }, { width: 2000, height: 1000 })).toEqual({ width: 1080, height: 540 });
	});
});
