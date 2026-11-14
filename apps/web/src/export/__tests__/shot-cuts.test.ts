import { describe, expect, test } from "bun:test";
import { shotCuts } from "../shot-cuts";

const T = 120000;
const clip = (id: string, mediaId: string, start: number, duration: number, trimStart = 0, extra: Record<string, unknown> = {}) =>
	({ id, type: "video", name: id, mediaId, startTime: start * T, duration: duration * T, trimStart: trimStart * T, trimEnd: 0, ...extra }) as never;
const tracks = (main: unknown[], overlay: unknown[] = []) =>
	({ main: { id: "m", name: "Main", type: "video", elements: main, muted: false, hidden: false }, overlay, audio: [] }) as never;

describe("shotCuts (Smooth frames never blends across a cut)", () => {
	test("three shots back to back: two cuts", () => {
		expect(shotCuts(tracks([clip("a", "red", 0, 2), clip("b", "green", 2, 2), clip("c", "blue", 4, 2)]), T)).toEqual([2, 4]);
	});
	test("a razor split that goes on in the same source is no cut; a jump inside one source is", () => {
		expect(shotCuts(tracks([clip("a", "red", 0, 2, 0), clip("b", "red", 2, 2, 2)]), T)).toEqual([]);
		expect(shotCuts(tracks([clip("a", "red", 0, 2, 0), clip("b", "red", 2, 2, 5)]), T)).toEqual([2]);
	});
	test("a gap: the shot's end and the next start are both cuts", () => {
		expect(shotCuts(tracks([clip("a", "red", 0, 2), clip("b", "green", 3, 2)]), T)).toEqual([2, 3]);
	});
	test("an overlay video starting and ending is a cut; a hidden track is not", () => {
		const over = { id: "o", name: "V2", type: "video", elements: [clip("x", "pip", 1, 1)], muted: false, hidden: false };
		expect(shotCuts(tracks([clip("a", "red", 0, 4)], [over]), T)).toEqual([1, 2]);
		expect(shotCuts(tracks([clip("a", "red", 0, 4)], [{ ...over, hidden: true }]), T)).toEqual([]);
	});
	test("In→Out: only the cuts inside, counted from the In point", () => {
		expect(shotCuts(tracks([clip("a", "red", 0, 2), clip("b", "green", 2, 2), clip("c", "blue", 4, 2)]), T, { start: 1 * T, end: 3 * T })).toEqual([1]);
	});
});
