import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { MediaAsset } from "@/media/types";
import type { AnyBaseNode } from "@/services/renderer/nodes/base-node";
import type { SceneTracks, TimelineTrack } from "@/timeline";

// Transitions on an adjustment layer (transitions/layer.ts): the timing, the A/B source times and the scene it builds.
type LayerModule = typeof import("../layer");
let L: LayerModule;
let buildScene: typeof import("@/services/renderer/scene-builder").buildScene;
let LayerTransitionNode: typeof import("@/services/renderer/nodes/layer-transition-node").LayerTransitionNode;
let VideoNode: typeof import("@/services/renderer/nodes/video-node").VideoNode;
let StickerNode: typeof import("@/services/renderer/nodes/sticker-node").StickerNode;
let TextNode: typeof import("@/services/renderer/nodes/text-node").TextNode;
let EffectLayerNode: typeof import("@/services/renderer/nodes/effect-layer-node").EffectLayerNode;
let withLayerTransition: typeof import("../layer-commands").withLayerTransition;
let layerTransitionFor: typeof import("../layer-commands").layerTransitionFor;
let buildTransitionPasteCommand: typeof import("@/commands/timeline/clipboard/paste-transition").buildTransitionPasteCommand;
let T = 0;
beforeAll(async () => {
	await installOpenCutWasm();
	L = await import("../layer");
	({ buildScene } = await import("@/services/renderer/scene-builder"));
	({ LayerTransitionNode } = await import("@/services/renderer/nodes/layer-transition-node"));
	({ VideoNode } = await import("@/services/renderer/nodes/video-node"));
	({ StickerNode } = await import("@/services/renderer/nodes/sticker-node"));
	({ TextNode } = await import("@/services/renderer/nodes/text-node"));
	({ EffectLayerNode } = await import("@/services/renderer/nodes/effect-layer-node"));
	({ withLayerTransition, layerTransitionFor } = await import("../layer-commands"));
	({ buildTransitionPasteCommand } = await import("@/commands/timeline/clipboard/paste-transition"));
	T = (await import("@/wasm")).TICKS_PER_SECOND;
});

const s = (seconds: number) => seconds * T;
const clip = (id: string, at: number, length: number, trimStart = 0, trimEnd = 0, mediaId = "x") => ({
	id,
	type: "video",
	name: id,
	mediaId,
	startTime: s(at),
	duration: s(length),
	trimStart: s(trimStart),
	trimEnd: s(trimEnd),
	params: {},
});
const videoTrack = (id: string, elements: unknown[], hidden = false) =>
	({ id, type: "video", name: id, elements, muted: false, hidden }) as unknown as TimelineTrack;
const layer = (at: number, length: number) => ({ startTime: s(at), duration: s(length) });

describe("layer transition timing", () => {
	test("its middle sits on the cut under the layer (also off the layer's middle)", () => {
		const main = videoTrack("main", [clip("a", 0, 3), clip("b", 3, 3)]);
		const centred = L.layerTransitionWindow({ layer: layer(2, 2), tracksBelow: [main] });
		expect(centred).toEqual({ start: s(2), end: s(4), cut: s(3) });
		expect(L.layerTransitionProgress(centred, s(2))).toBe(0);
		expect(L.layerTransitionProgress(centred, s(2.5))).toBeCloseTo(0.25);
		expect(L.layerTransitionProgress(centred, s(3))).toBeCloseTo(0.5);
		expect(L.layerTransitionProgress(centred, s(3.5))).toBeCloseTo(0.75);
		// layer 2.5 → 5 s, cut at 3 s: 0 → 0.5 in half a second, 0.5 → 1 in two
		const off = L.layerTransitionWindow({ layer: layer(2.5, 2.5), tracksBelow: [main] });
		expect(off.cut).toBe(s(3));
		expect(L.layerTransitionProgress(off, s(2.75))).toBeCloseTo(0.25);
		expect(L.layerTransitionProgress(off, s(3))).toBeCloseTo(0.5);
		expect(L.layerTransitionProgress(off, s(4))).toBeCloseTo(0.75);
		expect(L.layerTransitionProgress(off, s(5))).toBeCloseTo(1);
	});

	test("without a cut under it the transition runs across the layer", () => {
		const main = videoTrack("main", [clip("a", 0, 10)]);
		const window = L.layerTransitionWindow({ layer: layer(1, 2), tracksBelow: [main] });
		expect(window.cut).toBeNull();
		expect(L.layerTransitionProgress(window, s(1))).toBe(0);
		expect(L.layerTransitionProgress(window, s(1.5))).toBeCloseTo(0.25);
		expect(L.layerTransitionProgress(window, s(2.5))).toBeCloseTo(0.75);
		// a cut on the layer's edge, a gap (not a cut) and a hidden track's cut don't count
		const edge = videoTrack("main", [clip("a", 0, 1), clip("b", 1, 9)]);
		const gap = videoTrack("v2", [clip("c", 0, 1.5), clip("d", 1.8, 2)]);
		const hidden = videoTrack("v3", [clip("e", 0, 2), clip("f", 2, 2)], true);
		expect(L.layerTransitionWindow({ layer: layer(1, 2), tracksBelow: [edge, gap, hidden] }).cut).toBeNull();
	});

	test("with several cuts, the one nearest the layer's middle (any video track below)", () => {
		const main = videoTrack("main", [clip("a", 0, 2.2), clip("b", 2.2, 1.7), clip("c", 3.9, 3)]);
		const v2 = videoTrack("v2", [clip("d", 1, 2.1), clip("e", 3.1, 2)]);
		const window = L.layerTransitionWindow({ layer: layer(2, 2), tracksBelow: [main, v2] });
		expect(L.cutsInside({ tracks: [main, v2], start: s(2), end: s(4) }).map((c) => c / T)).toEqual([2.2, 3.1, 3.9]);
		expect(window.cut).toBe(s(3.1));
		expect(L.layerTransitionProgress(window, s(3.1))).toBeCloseTo(0.5);
	});

	test("the kind of each transition: warps are one picture, blends are two", () => {
		expect(L.layerTransitionMode("studio.transition.zoomThrough")).toBe("single");
		expect(L.layerTransitionMode("studio.transition.shake")).toBe("single");
		expect(L.layerTransitionMode("studio.transition.dissolve")).toBe("pair");
		expect(L.layerTransitionMode("kadr.transition.wipe")).toBe("pair");
		expect(L.layerTransitionMode("studio.transition.slide")).toBe("pair");
	});
});

describe("A/B source times", () => {
	// a: 0–3 s of the timeline showing source 1–4 s, with 2 s more media after it; b: 3–6 s from source 0.05 s.
	// built per test: the tick rate is known once the wasm shim is in (beforeAll)
	let a: ReturnType<typeof clip>;
	let b: ReturnType<typeof clip>;
	let window: { start: number; end: number; cut: number };
	beforeAll(() => {
		a = clip("a", 0, 3, 1, 2);
		b = clip("b", 3, 3, 0.05, 0);
		window = { start: s(2), end: s(4), cut: s(3) };
	});
	const at = (c: ReturnType<typeof clip>, side: "A" | "B", time: number) => {
		const value = L.sideSourceTime({ clip: c, window, side, time: s(time) });
		return value === null ? null : value / T;
	};

	test("A is the outgoing clip, played on past the cut from its handle", () => {
		expect(at(a, "A", 2.5)).toBeCloseTo(3.5);
		expect(at(a, "A", 3.5)).toBeCloseTo(4.5); // real frames beyond the cut
		expect(at(b, "A", 3.5)).toBeNull(); // the incoming clip is not on side A
	});

	test("without a handle the edge frame is held", () => {
		const short = clip("a", 0, 3, 1, 0.2); // only 0.2 s of media after the cut
		expect(at(short, "A", 3.1)).toBeCloseTo(4.1);
		expect(at(short, "A", 3.9)).toBeCloseTo(4.2 - 1 / 60, 3);
		expect(at(b, "B", 2.5)).toBe(0); // b has 0.05 s before it: the first frame is held
	});

	test("B is the incoming clip, started early from its handle", () => {
		const early = clip("b", 3, 3, 2, 0);
		expect(at(early, "B", 2)).toBeCloseTo(1);
		expect(at(early, "B", 2.5)).toBeCloseTo(1.5);
		expect(at(early, "B", 3.5)).toBeCloseTo(2.5);
		expect(at(a, "B", 2.5)).toBeNull(); // the outgoing clip is not on side B
	});

	test("what spans the cut is the same on both sides", () => {
		const long = clip("s", 0, 10, 0, 0);
		expect(at(long, "A", 3.5)).toBeCloseTo(3.5);
		expect(at(long, "B", 3.5)).toBeCloseTo(3.5);
		expect(L.sideExtension({ element: long, window, side: "A" })).toEqual({ before: 0, after: 0 });
	});
});

const asset = (id: string) =>
	({ id, name: id, type: "video", file: new File([], `${id}.mp4`), url: `blob:${id}`, duration: 60 }) as unknown as MediaAsset;

function project(transitionType: string): SceneTracks {
	const sticker = {
		id: "st",
		type: "sticker",
		name: "st",
		stickerId: "emoji:1",
		startTime: 0,
		duration: s(10),
		trimStart: 0,
		trimEnd: 0,
		params: {},
	};
	const caption = { id: "cap", type: "text", name: "cap", startTime: 0, duration: s(10), trimStart: 0, trimEnd: 0, params: { content: "Hi" } };
	const fx = {
		id: "fx",
		type: "effect",
		name: "Adjustment",
		effectType: "studio.color",
		startTime: s(2),
		duration: s(2),
		trimStart: 0,
		trimEnd: 0,
		params: {},
		transition: { id: "t1", type: transitionType, params: {} },
	};
	return {
		main: { id: "main", type: "video", name: "Main", elements: [clip("a", 0, 3, 0, 5), clip("b", 3, 3, 1, 0, "y")], muted: false, hidden: false },
		overlay: [
			{ id: "captions", type: "text", name: "T", elements: [caption], hidden: false },
			{ id: "fxTrack", type: "effect", name: "E", elements: [fx], hidden: false },
			{ id: "stickers", type: "graphic", name: "G", elements: [sticker], hidden: false },
		],
		audio: [],
	} as unknown as SceneTracks;
}

function sceneOf(tracks: SceneTracks) {
	return buildScene({
		tracks,
		mediaAssets: [asset("x"), asset("y")],
		duration: s(10),
		canvasSize: { width: 1920, height: 1080 },
		background: { type: "color", color: "#000000" },
		isPreview: true,
	} as Parameters<typeof buildScene>[0]);
}

const kinds = (nodes: AnyBaseNode[]) => nodes.map((n) => n.constructor.name);

describe("the scene of an adjustment layer with a transition", () => {
	test("a pair wraps everything below (main + sticker) with sides A and B; the captions above stay outside", () => {
		const root = sceneOf(project("studio.transition.dissolve"));
		const wrapped = root.children.find((n) => n instanceof LayerTransitionNode);
		expect(wrapped).toBeDefined();
		if (!(wrapped instanceof LayerTransitionNode)) return;
		expect(wrapped.params).toMatchObject({ start: s(2), end: s(4), cut: s(3), mode: "pair" });
		expect(wrapped.children).toHaveLength(3);
		const [live, sideA, sideB] = wrapped.children;
		expect(kinds(live.children)).toEqual(["VideoNode", "VideoNode", "StickerNode"]);
		// A: clip a continued to the layer's end, no clip b; B: clip b from the layer's start, no clip a
		const videosA = sideA.children.filter((n) => n instanceof VideoNode);
		const videosB = sideB.children.filter((n) => n instanceof VideoNode);
		expect(videosA.map((n) => (n as InstanceType<typeof VideoNode>).params.elementId)).toEqual(["a"]);
		expect(videosB.map((n) => (n as InstanceType<typeof VideoNode>).params.elementId)).toEqual(["b"]);
		expect((videosA[0] as InstanceType<typeof VideoNode>).params.duration).toBe(s(4));
		const incoming = (videosB[0] as InstanceType<typeof VideoNode>).params;
		expect(incoming.timeOffset).toBe(s(2));
		expect(incoming.trimStart).toBeCloseTo(s(0));
		expect(sideA.children.some((n) => n instanceof StickerNode)).toBe(true);
		expect(sideB.children.some((n) => n instanceof StickerNode)).toBe(true);
		// above it: the layer's own effect, then the captions — never inside the transition
		const after = root.children.slice(root.children.indexOf(wrapped) + 1);
		expect(after[0]).toBeInstanceOf(EffectLayerNode);
		expect(after.some((n) => n instanceof TextNode)).toBe(true);
		const inside = (node: AnyBaseNode): boolean => node instanceof TextNode || node.children.some(inside);
		expect(inside(wrapped)).toBe(false);
	});

	test("text below the layer is transitioned too: one ending on the cut plays on, on side A only", () => {
		const tracks = project("studio.transition.dissolve");
		const title = { id: "title", type: "text", name: "title", startTime: s(1), duration: s(2), trimStart: 0, trimEnd: 0, params: { content: "Under" } };
		const under = { ...tracks, overlay: [...tracks.overlay, { id: "titles", type: "text", name: "U", elements: [title], hidden: false }] } as unknown as SceneTracks;
		const wrapped = sceneOf(under).children.find((n) => n instanceof LayerTransitionNode);
		if (!(wrapped instanceof LayerTransitionNode)) throw new Error("no transition node");
		const [live, sideA, sideB] = wrapped.children;
		const textOf = (group: AnyBaseNode) => group.children.find((n) => n instanceof TextNode) as InstanceType<typeof TextNode> | undefined;
		expect(Number(textOf(live)?.params.duration)).toBe(s(2));
		expect(Number(textOf(sideA)?.params.duration)).toBe(s(3)); // 1 → 4 s, the layer's end
		expect(textOf(sideB)).toBeUndefined();
		expect(Number(under.overlay[3].elements[0].duration)).toBe(s(2)); // the project's own element is untouched
	});

	test("a single-picture transition draws the live composite only", () => {
		const root = sceneOf(project("studio.transition.zoomThrough"));
		const wrapped = root.children.find((n) => n instanceof LayerTransitionNode);
		expect(wrapped?.children).toHaveLength(1);
		expect((wrapped as InstanceType<typeof LayerTransitionNode>).params.mode).toBe("single");
	});

	test("no transition: the scene is built as before", () => {
		const tracks = project("studio.transition.dissolve");
		const plain = withLayerTransition(tracks, { trackId: "fxTrack", elementId: "fx" }, undefined);
		expect(sceneOf(plain).children.some((n) => n instanceof LayerTransitionNode)).toBe(false);
		const fx = plain.overlay[1].elements[0] as { transition?: unknown };
		expect(fx.transition).toBeUndefined();
	});

	test("a new transition replaces the old one, keeping its id; a paste onto a selected layer is one step", () => {
		const existing = { id: "t1", type: "studio.transition.dissolve", params: {} };
		const next = layerTransitionFor({ type: "kadr.transition.wipe", existing, newId: () => "new" });
		expect(next).toMatchObject({ id: "t1", type: "kadr.transition.wipe" });
		expect(layerTransitionFor({ type: "no.such.transition" })).toBeNull();
		const tracks = project("studio.transition.dissolve");
		const command = buildTransitionPasteCommand({
			tracks,
			transition: { type: "studio.transition.whip", duration: s(0.3), params: { direction: "up" } },
			selectedElementIds: ["fx"],
			selectedCut: null,
		});
		expect(command).not.toBeNull();
		const after = (command as unknown as { after: SceneTracks }).after;
		const fx = after.overlay[1].elements[0] as { transition?: { id: string; type: string; params: Record<string, unknown> } };
		expect(fx.transition).toEqual({ id: "t1", type: "studio.transition.whip", params: { direction: "up" } });
	});
});
