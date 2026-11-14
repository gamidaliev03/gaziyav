import { describe, expect, test } from "bun:test";
import { planMainTrackReorder } from "@/timeline/group-move/main-reorder";
import type { TimelineElement } from "@/timeline";

// Dragging a clip along the magnetic main track threw it onto a new track above whenever it overlapped a neighbour
// (any drag on a packed track). It goes in at the nearest cut now; the rest closes up / moves along.
function el(id: string, start: number, duration: number): TimelineElement {
	return { id, name: id, type: "video", mediaId: "m", startTime: start, duration, trimStart: 0, trimEnd: 0, params: {} } as unknown as TimelineElement;
}
const spans = (elements: TimelineElement[]) => elements.map((e) => [e.id, Number(e.startTime), Number(e.duration)]);
const track = () => [el("a", 0, 100), el("b", 100, 50), el("c", 150, 80), el("d", 230, 20)];

describe("magnetic main track reorder", () => {
	test("a picture brought down from a layer track goes in at the cut; the clips after it move along (no overlap)", () => {
		// the picture sat on a layer track at 10–60; dropped near the cut after a (100)
		const picture = el("p", 10, 50);
		const plan = planMainTrackReorder({ elements: [...track(), picture], movingIds: new Set(["p"]), incomingIds: new Set(["p"]), pointerTime: 110 });
		expect(spans(plan?.elements ?? [])).toEqual([["a", 0, 100], ["p", 100, 50], ["b", 150, 50], ["c", 200, 80], ["d", 280, 20]]);
	});
	test("b dragged past the middle of c goes after c", () => {
		const plan = planMainTrackReorder({ elements: track(), movingIds: new Set(["b"]), pointerTime: 200 });
		expect(spans(plan?.elements ?? [])).toEqual([["a", 0, 100], ["c", 100, 80], ["b", 180, 50], ["d", 230, 20]]);
		expect(plan?.isNoop).toBe(false);
	});

	test("b dragged onto c but not past its middle stays where it was (no-op)", () => {
		const plan = planMainTrackReorder({ elements: track(), movingIds: new Set(["b"]), pointerTime: 180 });
		expect(spans(plan?.elements ?? [])).toEqual(spans(track()));
		expect(plan?.isNoop).toBe(true);
	});

	test("d dragged to the start goes first", () => {
		const plan = planMainTrackReorder({ elements: track(), movingIds: new Set(["d"]), pointerTime: 10 });
		expect(spans(plan?.elements ?? [])).toEqual([["d", 0, 20], ["a", 20, 100], ["b", 120, 50], ["c", 170, 80]]);
	});

	test("two clips move together, keeping their order", () => {
		const plan = planMainTrackReorder({ elements: track(), movingIds: new Set(["a", "b"]), pointerTime: 200 });
		expect(spans(plan?.elements ?? [])).toEqual([["c", 0, 80], ["a", 80, 100], ["b", 180, 50], ["d", 230, 20]]);
	});

	test("⌥: a copy goes in at the cut, the originals stay, the rest moves along", () => {
		const plan = planMainTrackReorder({
			elements: track(),
			movingIds: new Set(["b"]),
			pointerTime: 140,
			copyIds: new Map([["b", "b2"]]),
		});
		expect(spans(plan?.elements ?? [])).toEqual([
			["a", 0, 100],
			["b", 100, 50],
			["b2", 150, 50],
			["c", 200, 80],
			["d", 280, 20],
		]);
		expect(plan?.insertedIds).toEqual(["b2"]);
	});
});

test("⌥-drag of a layer picture onto the main track: a copy goes in at the cut, the original stays on its layer", () => {
	const main = [el("a", 0, 10), el("b", 10, 10)];
	const photo = el("p", 3, 5);
	const plan = planMainTrackReorder({
		elements: [...main, photo],
		movingIds: new Set(["p"]),
		incomingIds: new Set(["p"]),
		pointerTime: 9,
		copyIds: new Map([["p", "p2"]]),
	});
	expect(plan?.elements.map((e) => `${e.id}@${e.startTime}`)).toEqual(["a@0", "p2@10", "b@15"]);
	expect(plan?.insertedIds).toEqual(["p2"]);
});

// blind3 F1 (14.11): clip 10, ⇧ clip 12, ⌘ clip 15 dragged to the right on the magnetic main track kept their spacing:
// a 1 489-frame black gap at the drop. They land as one block in their timeline order; the row stays packed.
describe("a non-contiguous selection lands as one block (blind3 F1)", () => {
	const row = () => Array.from({ length: 20 }, (_, i) => el(`c${i}`, i * 750, 750));
	const packed = (elements: TimelineElement[]) => {
		const sorted = [...elements].sort((a, b) => a.startTime - b.startTime);
		let at = 0;
		for (const e of sorted) {
			if (e.startTime !== at) return false;
			at += e.duration;
		}
		return true;
	};
	test("10, 11, 12, 15 dropped after 17: no gap, the block in order, the total length kept", () => {
		const plan = planMainTrackReorder({ elements: row(), movingIds: new Set(["c10", "c11", "c12", "c15"]), pointerTime: 17 * 750 + 600 });
		const out = plan?.elements ?? [];
		expect(packed(out)).toBe(true);
		const order = [...out].sort((a, b) => a.startTime - b.startTime).map((e) => e.id);
		expect(order).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c13", "c14", "c16", "c17", "c10", "c11", "c12", "c15", "c18", "c19"]);
		expect(Math.max(...out.map((e) => e.startTime + e.duration))).toBe(20 * 750);
	});
	test("dragged to the left over the start, a ⌥ copy, and clips from two overlapping layers: always packed", () => {
		const left = planMainTrackReorder({ elements: row(), movingIds: new Set(["c5", "c9", "c14"]), pointerTime: 10 });
		expect(packed(left?.elements ?? [])).toBe(true);
		expect(left?.elements.slice(0, 3).map((e) => e.id)).toEqual(["c5", "c9", "c14"]);
		const copy = planMainTrackReorder({ elements: row(), movingIds: new Set(["c2", "c7"]), pointerTime: 4000, copyIds: new Map([["c2", "k2"], ["c7", "k7"]]) });
		expect(packed(copy?.elements ?? [])).toBe(true);
		expect(copy?.elements.length).toBe(22);
		const p = el("p", 100, 400);
		const q = el("q", 300, 400);
		const layers = planMainTrackReorder({ elements: [...row(), p, q], movingIds: new Set(["p", "q"]), incomingIds: new Set(["p", "q"]), pointerTime: 760 });
		expect(packed(layers?.elements ?? [])).toBe(true);
	});
});
