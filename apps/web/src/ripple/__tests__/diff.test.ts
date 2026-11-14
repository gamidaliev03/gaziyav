import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline/types";
import { applyRippleAdjustments, computeRippleAdjustments } from "..";

// The main-track magnet: whatever frees time on the main track closes up — a deleted clip, a trimmed end, a trimmed
// start, a clip dragged onto another track. A clip moved along the track is not a trim, and a roll frees nothing.
const S = 120000;
const clip = (id: string, start: number, duration: number) => ({ id, type: "video", startTime: start * S, duration: duration * S }) as never;
const tracks = (main: unknown[], overlay: unknown[] = []): SceneTracks =>
	({
		main: { id: "main", type: "video", elements: main },
		overlay: [{ id: "over", type: "video", elements: overlay }],
		audio: [],
	}) as never;
const ripple = (before: SceneTracks, after: SceneTracks) => {
	const adjustments = computeRippleAdjustments({ beforeTracks: before, afterTracks: after }).filter((a) => a.trackId === "main");
	return applyRippleAdjustments({ tracks: after, adjustments }).main.elements.map((e) => [e.id, e.startTime / S, (e.startTime + e.duration) / S]);
};

describe("main-track magnet", () => {
	test("trimming a clip's start closes the gap before it", () => {
		const before = tracks([clip("a", 0, 10), clip("b", 10, 6)]);
		const after = tracks([clip("a", 0, 10), clip("b", 11, 5)]);
		expect(ripple(before, after)).toEqual([["a", 0, 10], ["b", 10, 15]]);
	});

	test("a clip dragged onto another track leaves no gap", () => {
		const before = tracks([clip("a", 0, 10), clip("b", 10, 6)]);
		const after = tracks([clip("b", 10, 6)], [clip("a", 0, 10)]);
		expect(ripple(before, after)).toEqual([["b", 0, 6]]);
	});

	test("a deleted clip still closes up as before", () => {
		const before = tracks([clip("a", 0, 10), clip("b", 10, 6)]);
		const after = tracks([clip("b", 10, 6)]);
		expect(ripple(before, after)).toEqual([["b", 0, 6]]);
	});

	test("a roll (the cut moved: one clip's end and the next one's start together) closes nothing", () => {
		const before = tracks([clip("a", 0, 10), clip("b", 10, 6), clip("c", 16, 4)]);
		const later = tracks([clip("a", 0, 11), clip("b", 11, 5), clip("c", 16, 4)]);
		expect(ripple(before, later)).toEqual([["a", 0, 11], ["b", 11, 16], ["c", 16, 20]]);
		const earlier = tracks([clip("a", 0, 9), clip("b", 9, 7), clip("c", 16, 4)]);
		expect(ripple(before, earlier)).toEqual([["a", 0, 9], ["b", 9, 16], ["c", 16, 20]]);
	});

	test("a clip moved along the track is not a trim", () => {
		const before = tracks([clip("a", 0, 4), clip("b", 10, 6)]);
		const after = tracks([clip("a", 0, 4), clip("b", 12, 6)]);
		expect(ripple(before, after)).toEqual([["a", 0, 4], ["b", 12, 18]]);
	});
});
