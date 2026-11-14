// The recogniser with synthetic pointer streams (mobile, 14.11). NOT RUN YET: written before the release, run after it.
import { describe, expect, test } from "bun:test";
import { dragRoleFor } from "../timeline-bridge";
import { type Gesture, GestureRecognizer, inertiaSteps, pinchToWheelDelta, velocity } from "../recognizer";

const kinds = (g: Gesture[]) => g.map((x) => x.kind);

/** A finger's stream: down at (x0,y0), `steps` moves to (x1,y1) over `ms`, up. Returns every gesture in order. */
function stroke(rec: GestureRecognizer, { id = 1, x0 = 100, y0 = 100, x1 = 100, y1 = 100, t0 = 0, ms = 100, steps = 10, up = true } = {}) {
	const out: Gesture[] = [...rec.down({ id, x: x0, y: y0, t: t0 })];
	for (let i = 1; i <= steps; i++) {
		const f = i / steps;
		const t = t0 + ms * f;
		out.push(...rec.tick(t), ...rec.move({ id, x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, t }));
	}
	if (up) out.push(...rec.up({ id, x: x1, y: y1, t: t0 + ms }));
	return out;
}

describe("one finger", () => {
	test("a quick still press is one tap", () => {
		const rec = new GestureRecognizer();
		expect(kinds(stroke(rec, { ms: 120 }))).toEqual(["tap"]);
	});

	test("a wobble under the slop is still a tap (8 px)", () => {
		const rec = new GestureRecognizer();
		expect(kinds(stroke(rec, { x1: 106, y1: 104, ms: 150 }))).toEqual(["tap"]);
	});

	test("a still press held too long is not a tap: it is a long-press, once", () => {
		const rec = new GestureRecognizer();
		const g = stroke(rec, { ms: 800, steps: 20 });
		expect(kinds(g)).toEqual(["long-press"]);
	});

	test("a move past the slop is one drag-start, moves, one drag-end — no tap", () => {
		const rec = new GestureRecognizer();
		const g = stroke(rec, { x1: 200, ms: 200 });
		expect(g[0]).toMatchObject({ kind: "drag-start", x0: 100, y0: 100, afterLongPress: false });
		expect(kinds(g).filter((k) => k === "drag-start")).toHaveLength(1);
		expect(g.at(-1)).toMatchObject({ kind: "drag-end", x: 200 });
		expect(kinds(g)).not.toContain("tap");
	});

	test("the drag starts from the press point (no jump: x0 is the down, not the threshold crossing)", () => {
		const rec = new GestureRecognizer();
		const g = stroke(rec, { x1: 140, steps: 4 });
		const start = g.find((x) => x.kind === "drag-start");
		expect(start).toMatchObject({ x0: 100, x: 110 });
	});

	test("held, then moved: long-press, then a drag marked afterLongPress (the pick-up)", () => {
		const rec = new GestureRecognizer();
		const g: Gesture[] = [...rec.down({ id: 1, x: 50, y: 50, t: 0 })];
		g.push(...rec.tick(500));
		g.push(...rec.move({ id: 1, x: 80, y: 50, t: 520 }), ...rec.up({ id: 1, x: 80, y: 50, t: 600 }));
		expect(kinds(g)).toEqual(["long-press", "drag-start", "drag-end"]);
		expect(g[1]).toMatchObject({ afterLongPress: true });
	});

	test("a finger that moved first never long-presses later", () => {
		const rec = new GestureRecognizer();
		const g: Gesture[] = [...rec.down({ id: 1, x: 0, y: 0, t: 0 }), ...rec.move({ id: 1, x: 30, y: 0, t: 50 }), ...rec.tick(900)];
		expect(kinds(g)).toEqual(["drag-start"]);
	});

	test("the system takes the pointer mid-drag: drag-cancel, no drag-end (nothing commits)", () => {
		const rec = new GestureRecognizer();
		const g = stroke(rec, { x1: 200, up: false });
		g.push(...rec.cancel({ id: 1, x: 200, y: 100, t: 120 }));
		expect(kinds(g).at(-1)).toBe("drag-cancel");
		expect(kinds(g)).not.toContain("drag-end");
		expect(rec.phase()).toBe("idle");
	});

	test("release speed: a fling right at 2 px/ms", () => {
		const rec = new GestureRecognizer();
		const g = stroke(rec, { x0: 0, x1: 400, ms: 200, steps: 20 });
		const end = g.at(-1) as Extract<Gesture, { kind: "drag-end" }>;
		expect(end.vx).toBeCloseTo(2, 1);
		expect(Math.abs(end.vy)).toBeLessThan(0.01);
	});

	test("stopped before letting go: no fling", () => {
		const rec = new GestureRecognizer();
		const g = stroke(rec, { x0: 0, x1: 200, ms: 100, up: false });
		g.push(...rec.move({ id: 1, x: 200, y: 100, t: 400 }), ...rec.up({ id: 1, x: 200, y: 100, t: 401 }));
		const end = g.at(-1) as Extract<Gesture, { kind: "drag-end" }>;
		expect(Math.abs(end.vx)).toBeLessThan(0.05);
	});
});

describe("two and three fingers", () => {
	test("a second finger during a drag cancels it and starts the two-finger gesture", () => {
		const rec = new GestureRecognizer();
		const g = stroke(rec, { x1: 160, up: false });
		g.push(...rec.down({ id: 2, x: 300, y: 100, t: 110 }));
		expect(kinds(g).slice(-2)).toEqual(["drag-cancel", "two-start"]);
	});

	test("pinch out: scale ratios multiply to the distance ratio; the midpoint stays", () => {
		const rec = new GestureRecognizer();
		rec.down({ id: 1, x: 100, y: 200, t: 0 });
		rec.down({ id: 2, x: 200, y: 200, t: 5 });
		let scale = 1;
		let dx = 0;
		for (let i = 1; i <= 10; i++) {
			for (const g of [...rec.move({ id: 1, x: 100 - 5 * i, y: 200, t: 10 * i }), ...rec.move({ id: 2, x: 200 + 5 * i, y: 200, t: 10 * i + 1 })]) {
				if (g.kind === "two") {
					scale *= g.scale;
					dx += g.dx;
				}
			}
		}
		expect(scale).toBeCloseTo(200 / 100, 5);
		expect(Math.abs(dx)).toBeLessThan(1e-9);
	});

	test("two-finger pan: the midpoint's moves add up, the scale stays 1, a fling at the end", () => {
		const rec = new GestureRecognizer();
		rec.down({ id: 1, x: 100, y: 100, t: 0 });
		rec.down({ id: 2, x: 150, y: 100, t: 0 });
		let dy = 0;
		let scale = 1;
		const out: Gesture[] = [];
		for (let i = 1; i <= 10; i++) {
			out.push(...rec.move({ id: 1, x: 100, y: 100 - 10 * i, t: 10 * i }), ...rec.move({ id: 2, x: 150, y: 100 - 10 * i, t: 10 * i }));
		}
		for (const g of out) if (g.kind === "two") (dy += g.dy), (scale *= g.scale);
		expect(dy).toBeCloseTo(-100, 5);
		expect(scale).toBeCloseTo(1, 5);
		const end = rec.up({ id: 1, x: 100, y: 0, t: 101 });
		expect(end[0]).toMatchObject({ kind: "two-end" });
		expect((end[0] as Extract<Gesture, { kind: "two-end" }>).vy).toBeLessThan(-0.5);
		expect(kinds(rec.up({ id: 2, x: 150, y: 0, t: 102 }))).toEqual([]);
	});

	test("two-finger tap = multi-tap 2; three-finger tap = multi-tap 3; never a one-finger tap", () => {
		const rec = new GestureRecognizer();
		const two = [...rec.down({ id: 1, x: 0, y: 0, t: 0 }), ...rec.down({ id: 2, x: 40, y: 0, t: 20 }), ...rec.up({ id: 1, x: 0, y: 0, t: 120 }), ...rec.up({ id: 2, x: 40, y: 0, t: 130 })];
		expect(two.filter((g) => g.kind === "multi-tap")).toEqual([{ kind: "multi-tap", fingers: 2 }]);
		expect(kinds(two)).not.toContain("tap");
		const three = [
			...rec.down({ id: 1, x: 0, y: 0, t: 1000 }),
			...rec.down({ id: 2, x: 40, y: 0, t: 1010 }),
			...rec.down({ id: 3, x: 80, y: 0, t: 1020 }),
			...rec.up({ id: 1, x: 0, y: 0, t: 1150 }),
			...rec.up({ id: 2, x: 40, y: 0, t: 1160 }),
			...rec.up({ id: 3, x: 80, y: 0, t: 1170 }),
		];
		expect(three.filter((g) => g.kind === "multi-tap")).toEqual([{ kind: "multi-tap", fingers: 3 }]);
	});

	test("a slow or moving two-finger touch is not a tap (no surprise undo)", () => {
		const rec = new GestureRecognizer();
		const slow = [...rec.down({ id: 1, x: 0, y: 0, t: 0 }), ...rec.down({ id: 2, x: 40, y: 0, t: 0 }), ...rec.up({ id: 1, x: 0, y: 0, t: 600 }), ...rec.up({ id: 2, x: 40, y: 0, t: 600 })];
		expect(kinds(slow)).not.toContain("multi-tap");
		const moved = [...rec.down({ id: 1, x: 0, y: 0, t: 1000 }), ...rec.down({ id: 2, x: 40, y: 0, t: 1000 }), ...rec.move({ id: 1, x: 0, y: 30, t: 1050 }), ...rec.up({ id: 1, x: 0, y: 30, t: 1100 }), ...rec.up({ id: 2, x: 40, y: 0, t: 1100 })];
		expect(kinds(moved)).not.toContain("multi-tap");
	});

	test("pointercancel of a two-finger gesture ends it without a fling and is no tap", () => {
		const rec = new GestureRecognizer();
		rec.down({ id: 1, x: 0, y: 0, t: 0 });
		rec.down({ id: 2, x: 40, y: 0, t: 0 });
		expect(rec.cancel({ id: 1, x: 0, y: 0, t: 50 })).toEqual([{ kind: "two-end", vx: 0, vy: 0 }]);
		expect(kinds(rec.up({ id: 2, x: 40, y: 0, t: 60 }))).toEqual([]);
		expect(rec.phase()).toBe("idle");
	});
});

describe("helpers", () => {
	test("velocity over the window only", () => {
		const v = velocity([{ t: 0, x: 0, y: 0 }, { t: 500, x: 0, y: 0 }, { t: 550, x: 50, y: 0 }, { t: 600, x: 100, y: 0 }], 100);
		expect(v.vx).toBeCloseTo(1, 5);
	});

	test("inertia slows down and stops; the glide is finite", () => {
		const steps = inertiaSteps({ vx: 2, vy: 0 });
		expect(steps.length).toBeGreaterThan(10);
		expect(steps.length).toBeLessThanOrEqual(180);
		expect(steps[0].dx).toBeGreaterThan(steps.at(-1)!.dx);
		const total = steps.reduce((s, x) => s + x.dx, 0);
		expect(total).toBeLessThan((2 * 16) / (1 - 0.95) + 1); // the geometric series' sum
		expect(inertiaSteps({ vx: 0.01, vy: 0 })).toEqual([]);
	});

	test("pinch → ⌘-wheel: the timeline's exp(-delta/300) gives the pinch's scale back", () => {
		for (const s of [0.8, 1.05, 1.3]) expect(Math.exp(-pinchToWheelDelta(s) / 300)).toBeCloseTo(s, 9);
		expect(pinchToWheelDelta(1)).toBe(0);
		expect(pinchToWheelDelta(0)).toBe(0);
	});
});

describe("what a one-finger drag does on the timeline", () => {
	const clip = { native: false, trimHandle: false, elementId: "c1" };
	test("a swipe over an unselected clip scrolls — never moves it", () => expect(dragRoleFor(clip, false, false)).toBe("pan"));
	test("a selected clip moves", () => expect(dragRoleFor(clip, true, false)).toBe("move"));
	test("held then dragged: picked up, moves even unselected", () => expect(dragRoleFor(clip, false, true)).toBe("move"));
	test("a selected clip's fat trim handle trims", () => expect(dragRoleFor({ ...clip, trimHandle: true }, true, false)).toBe("trim"));
	test("an unselected clip's edge scrolls (a swipe never trims by accident)", () => expect(dragRoleFor({ ...clip, trimHandle: true }, false, false)).toBe("pan"));
	test("empty track scrolls", () => expect(dragRoleFor({ native: false, trimHandle: false, elementId: null }, false, false)).toBe("pan"));
	test("a pointer-native part keeps the finger", () => expect(dragRoleFor({ native: true, trimHandle: false, elementId: "c1" }, true, false)).toBe("native"));
});
