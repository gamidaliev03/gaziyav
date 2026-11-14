// Drawing a layer on the player (shape-draw.ts), its ◇ keyframes (layer-keys.ts) and drag-reorder in the list
// (layers.ts → reorderLayerTo).
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks, TimelineElement } from "@/timeline/types";
import { CLICK_SLOP, dragBox, lineEnd, lineThickness, shapeAtPoint, shapeFromDrag, textAtPoint } from "../shape-draw";

let K: typeof import("../layer-keys");
let L: typeof import("../layers");
beforeAll(async () => {
	await installOpenCutWasm();
	K = await import("../layer-keys");
	L = await import("../layers");
});

const C = { width: 1080, height: 1920 };
const BASE = 1080; // a shape at scale 1 is a square of the short side
const T = 120000;

describe("drawing a shape by a drag", () => {
	test("a rectangle lands where it was dragged, at the dragged size", () => {
		const tf = shapeFromDrag("rect", { x: 100, y: 200 }, { x: 500, y: 400 }, false, C)!;
		expect(tf["transform.positionX"]).toBe(300 - 540);
		expect(tf["transform.positionY"]).toBe(300 - 960);
		expect(tf["transform.scaleX"] * BASE).toBeCloseTo(400, 0);
		expect(tf["transform.scaleY"] * BASE).toBeCloseTo(200, 0);
		expect(tf["transform.rotate"]).toBe(0);
	});

	test("dragging up-left gives the same box", () => {
		expect(shapeFromDrag("rect", { x: 500, y: 400 }, { x: 100, y: 200 }, false, C)).toEqual(shapeFromDrag("rect", { x: 100, y: 200 }, { x: 500, y: 400 }, false, C));
	});

	test("Shift keeps a square (the larger side, growing from the press point)", () => {
		const tf = shapeFromDrag("rect", { x: 100, y: 200 }, { x: 500, y: 300 }, true, C)!;
		expect(tf["transform.scaleX"]).toBe(tf["transform.scaleY"]);
		expect(tf["transform.scaleX"] * BASE).toBeCloseTo(400, 0);
		expect(tf["transform.positionX"]).toBe(300 - 540);
		expect(tf["transform.positionY"]).toBe(400 - 960);
		// up-left with Shift: the square grows towards the cursor
		expect(dragBox({ x: 500, y: 500 }, { x: 450, y: 300 }, true)).toEqual({ x: 300, y: 300, w: 200, h: 200 });
	});

	test("Shift keeps a circle", () => {
		const tf = shapeFromDrag("circle", { x: 540, y: 960 }, { x: 640, y: 1260 }, true, C)!;
		expect(tf["transform.scaleX"]).toBe(tf["transform.scaleY"]);
		expect(tf["transform.scaleX"] * BASE).toBeCloseTo(300, 0);
	});

	test("a line runs from the press to the release, turned to its angle; Shift snaps it to 45°", () => {
		const tf = shapeFromDrag("line", { x: 100, y: 100 }, { x: 400, y: 500 }, false, C)!;
		expect(tf["transform.scaleX"] * BASE).toBeCloseTo(500, 0);
		expect(tf["transform.scaleY"] * BASE).toBeCloseTo(lineThickness(C), 0);
		expect(tf["transform.rotate"]).toBeCloseTo(53.13, 1);
		expect(tf["transform.positionX"]).toBe(250 - 540);
		const snapped = shapeFromDrag("line", { x: 100, y: 100 }, { x: 400, y: 500 }, true, C)!;
		expect(snapped["transform.rotate"]).toBeCloseTo(45, 5);
		const end = lineEnd({ x: 0, y: 0 }, { x: 100, y: 8 }, true);
		expect(end.y).toBeCloseTo(0, 5);
		expect(end.x).toBeCloseTo(Math.hypot(100, 8), 5);
	});

	test("a click (no drag) is not a drawn size: a default shape is centred at the point instead", () => {
		expect(shapeFromDrag("rect", { x: 300, y: 300 }, { x: 300 + CLICK_SLOP / 2, y: 300 }, false, C)).toBeNull();
		const tf = shapeAtPoint("circle", { x: 300, y: 500 }, C);
		expect(tf["transform.positionX"]).toBe(-240);
		expect(tf["transform.positionY"]).toBe(-460);
		expect(tf["transform.scaleX"]).toBe(tf["transform.scaleY"]);
		expect(textAtPoint({ x: 540, y: 100 }, C)).toEqual({ "transform.positionX": 0, "transform.positionY": -860 });
	});
});

describe("◇ keyframes of a layer", () => {
	type Layer = { params: Record<string, unknown>; animations?: import("@/animation/types").ElementAnimations };
	const layer = (): Layer => ({ params: { "transform.positionX": 10, "transform.positionY": 20, opacity: 1 } });

	test("◇ adds a key on every channel of the group with what the layer shows, ◇ again takes it away", () => {
		const el = layer();
		expect(K.keyState(el, "position", 0)).toEqual({ animated: false, active: false });
		const on = K.toggleKeys(el, "position", 0);
		const keyed = { ...el, ...on };
		expect(K.keyState(keyed, "position", 0)).toEqual({ animated: true, active: true });
		expect(K.keyState(keyed, "opacity", 0).animated).toBe(false);
		expect(K.valueAt(keyed, "transform.positionX", 0)).toBe(10);
		const off = K.toggleKeys(keyed, "position", 0);
		expect(K.keyState({ ...keyed, ...off }, "position", 0)).toEqual({ animated: false, active: false });
		// the value seen stays the layer's own
		expect(off.params["transform.positionX"]).toBe(10);
	});

	test("a position key pair: a typed value on a keyed property adds a key at the playhead and the move plays between them", () => {
		let el = layer();
		el = { ...el, ...K.toggleKeys(el, "position", 0) };
		el = { ...el, ...K.writeValues(el, { "transform.positionX": 210 }, T, true) };
		expect(K.keyState(el, "position", T).active).toBe(true);
		expect(K.valueAt(el, "transform.positionX", 0)).toBe(10);
		expect(K.valueAt(el, "transform.positionX", T)).toBe(210);
		const mid = K.valueAt(el, "transform.positionX", T / 2);
		expect(mid).toBeGreaterThan(10);
		expect(mid).toBeLessThan(210);
		// a property without keys changes its own value, no key appears
		const op = K.writeValues(el, { opacity: 0.5 }, T, true);
		expect(op.params.opacity).toBe(0.5);
		expect(K.keyState({ ...el, ...op }, "opacity", T).animated).toBe(false);
	});

	test("removing one of two keys keeps the other, the curve holds it", () => {
		let el = layer();
		el = { ...el, ...K.toggleKeys(el, "opacity", 0) };
		el = { ...el, ...K.writeValues(el, { opacity: 0 }, T, true) };
		el = { ...el, ...K.toggleKeys(el, "opacity", T) };
		expect(K.keyState(el, "opacity", T).active).toBe(false);
		expect(K.keyState(el, "opacity", 0)).toEqual({ animated: true, active: true });
		expect(K.valueAt(el, "opacity", T)).toBe(1);
	});
});

describe("drag-reorder in the layer list", () => {
	const g = (id: string) => ({ id, type: "graphic", name: id, definitionId: "rectangle", startTime: 0, duration: T, trimStart: 0, trimEnd: 0, params: {} }) as unknown as TimelineElement;
	const tr = (id: string, els: TimelineElement[]) => ({ id, name: id, type: "graphic", hidden: false, elements: els }) as never;
	const tracks = (): SceneTracks => ({ overlay: [tr("t1", [g("a")]), tr("t2", [g("b")]), tr("t3", [g("c")])], main: { id: "m", name: "m", type: "video", hidden: false, muted: false, elements: [] } as never, audio: [] });
	const order = (t: SceneTracks) => t.overlay.map((x) => (x.elements as TimelineElement[]).map((e) => e.id).join("")).join(",");
	let n = 0;
	const id = () => `n${n++}`;

	test("dragged up onto a row: right above it; dragged down: right below it", () => {
		expect(order(L.reorderLayerTo(tracks(), "c", "a", id)!.tracks)).toBe("c,a,b");
		expect(order(L.reorderLayerTo(tracks(), "a", "c", id)!.tracks)).toBe("b,c,a");
		expect(order(L.reorderLayerTo(tracks(), "a", "b", id)!.tracks)).toBe("b,a,c");
	});

	test("onto itself or a layer that isn't there: nothing moves", () => {
		expect(L.reorderLayerTo(tracks(), "a", "a", id)).toBeNull();
		expect(L.reorderLayerTo(tracks(), "a", "zz", id)).toBeNull();
	});
});
