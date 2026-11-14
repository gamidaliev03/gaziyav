import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

let R: typeof import("../row");
let B: typeof import("../row-band");
beforeAll(async () => {
	await installOpenCutWasm();
	R = await import("../row");
	B = await import("../row-band");
});
const insertIntoRow = (a: { elements: readonly TimelineElement[]; at: number; items: { startTime: number; duration: number }[] }) => R.insertIntoRow(a as never) as { moved: TimelineElement[]; starts: number[] };
const rowCutAtCursor: typeof import("../row").rowCutAtCursor = (a) => R.rowCutAtCursor(a);
const rowCutAtPlayhead: typeof import("../row").rowCutAtPlayhead = (a) => R.rowCutAtPlayhead(a);
const rowEnd: typeof import("../row").rowEnd = (a) => R.rowEnd(a);
const mainRowBand: typeof import("../row-band").mainRowBand = (...a) => B.mainRowBand(...a);

const S = 120000;
const clip = (id: string, s: number, d = 8) => ({ id, type: "video", startTime: s * S, duration: d * S, trimStart: 0, trimEnd: 0, params: {} }) as unknown as TimelineElement;
// a row of three: A 0–8, B 8–14, C 14–24
const row = [clip("A", 0), clip("B", 8, 6), clip("C", 14, 10)];

describe("rule A: a drop on the main row lands at the nearer edge of the clip under it", () => {
	test("left half → before it, right half → after it", () => {
		const at = (s: number) => rowCutAtCursor({ elements: row, time: s * S }) / S;
		expect([0.5, 3.9].map(at)).toEqual([0, 0]);
		expect([4.1, 7.9, 8.5, 10.9].map(at)).toEqual([8, 8, 8, 8]);
		expect([11.1, 13.9, 18.9].map(at)).toEqual([14, 14, 14]);
		expect([19.1, 23.9].map(at)).toEqual([24, 24]);
	});
	test("past the last clip → the row's end; an empty row → 0", () => {
		expect(rowCutAtCursor({ elements: row, time: 90 * S }) / S).toBe(24);
		expect(Number(rowCutAtCursor({ elements: [], time: 7 * S }))).toBe(0);
	});
	test("the order of the clips in the list does not matter", () => {
		expect(rowCutAtCursor({ elements: [row[2], row[0], row[1]], time: 12 * S }) / S).toBe(14);
	});
});

describe("rule B: «+» goes at the cut after the clip under the playhead", () => {
	const half = Math.floor(S / 60);
	const at = (s: number) => rowCutAtPlayhead({ elements: row, time: Math.round(s * S), tolerance: half }) / S;
	test("inside a clip → after it, however near its start", () => {
		expect([0.1, 4, 7.9].map(at)).toEqual([8, 8, 8]);
		expect([8.2, 13].map(at)).toEqual([14, 14]);
	});
	test("on a cut (within half a frame) → that cut", () => {
		expect(at(8)).toBe(8);
		expect(rowCutAtPlayhead({ elements: row, time: 14 * S - half + 1, tolerance: half }) / S).toBe(14);
		expect(at(0)).toBe(0);
	});
	test("at or past the end → the end; an empty row → 0", () => {
		expect([24, 30].map(at)).toEqual([24, 24]);
		expect(Number(rowCutAtPlayhead({ elements: [], time: 5 * S }))).toBe(0);
	});
	test("five presses lay five clips in a row: each lands at the end the playhead was moved to", () => {
		let els: TimelineElement[] = [];
		let playhead = 0;
		for (let i = 0; i < 5; i++) {
			const cut = rowCutAtPlayhead({ elements: els, time: playhead, tolerance: half });
			const item = { startTime: cut, duration: (3 + i) * S };
			const { moved, starts } = insertIntoRow({ elements: els, at: cut, items: [item] });
			els = [...moved, clip(`N${i}`, starts[0] / S, 3 + i)];
			playhead = starts[0] + item.duration;
		}
		const sorted = [...els].sort((a, b) => a.startTime - b.startTime).map((e) => [e.id, e.startTime / S]);
		expect(sorted).toEqual([["N0", 0], ["N1", 3], ["N2", 7], ["N3", 12], ["N4", 18]]);
		expect(rowEnd(els) / S).toBe(25);
	});
});

describe("going in: the row moves on by what went in, nothing is covered", () => {
	test("one item at a cut in the middle", () => {
		const { moved, starts } = insertIntoRow({ elements: row, at: 8 * S, items: [{ startTime: 0, duration: 5 * S }] });
		expect(moved.map((e) => [e.id, e.startTime / S])).toEqual([["A", 0], ["B", 13], ["C", 19]]);
		expect(starts.map((s) => s / S)).toEqual([8]);
	});
	test("several items in their order, at 0", () => {
		const { moved, starts } = insertIntoRow({ elements: row, at: 0, items: [{ startTime: 0, duration: 2 * S }, { startTime: 0, duration: 3 * S }] });
		expect(moved.map((e) => e.startTime / S)).toEqual([5, 13, 19]);
		expect(starts.map((s) => s / S)).toEqual([0, 2]);
	});
	test("at the end: nothing moves (the same objects)", () => {
		const { moved } = insertIntoRow({ elements: row, at: 24 * S, items: [{ startTime: 0, duration: 2 * S }] });
		expect(moved.every((e, i) => e === row[i])).toBe(true);
	});
});

describe("the main row's band (a drop anywhere in it is the row)", () => {
	const h = (type: string) => (type === "video" ? 65 : 25);
	const t = (overlay: number) => ({ overlay: Array.from({ length: overlay }, (_, i) => ({ id: `o${i}`, type: "text", elements: [] })), main: { id: "m", type: "video", elements: [] } }) as unknown as SceneTracks;
	test("no track above: from 0 to the middle of the gap below", () => {
		expect(mainRowBand(t(0), h as never, 6)).toEqual({ top: 0, bottom: 68, middle: 32.5 });
	});
	test("two tracks above: from the middle of the gap above", () => {
		expect(mainRowBand(t(2), h as never, 6)).toEqual({ top: 59, bottom: 130, middle: 94.5 });
	});
});
