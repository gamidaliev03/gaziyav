import { describe, expect, test } from "bun:test";
import { remapBeats, resizeBeats, splitBeats } from "../beats";

describe("beat marks when a clip is cut", () => {
	test("each half keeps the marks over its own picture, measured from its own start", () => {
		const { left, right } = splitBeats({ beats: [0, 2_000_000, 5_000_000, 8_000_000], at: 5_000_000, duration: 10_000_000 });
		expect(left).toEqual([0, 2_000_000]);
		expect(right).toEqual([0, 3_000_000]);
	});

	test("a mark on the cut belongs to the right half only, and empty halves carry nothing", () => {
		expect(splitBeats({ beats: [1_000_000], at: 1_000_000, duration: 2_000_000 })).toEqual({ left: undefined, right: [0] });
		expect(splitBeats({ beats: undefined, at: 1_000_000, duration: 2_000_000 })).toEqual({ left: undefined, right: undefined });
		expect(splitBeats({ beats: [9_000_000], at: 1_000_000, duration: 2_000_000 })).toEqual({ left: undefined, right: undefined });
	});

	test("a trim keeps a mark on its frame of the picture", () => {
		// Trimming the left edge by 1 s slides every mark 1 s left; the mark at 0 goes with the cut-off picture.
		expect(resizeBeats({ beats: [0, 2_000_000, 5_000_000], side: "left", clipDelta: 1_000_000, newDuration: 9_000_000 })).toEqual([
			1_000_000, 4_000_000,
		]);
		// The right edge leaves the marks where they are and drops the ones past the new end.
		expect(resizeBeats({ beats: [0, 2_000_000, 5_000_000, 9_000_000], side: "right", clipDelta: -2_000_000, newDuration: 8_000_000 })).toEqual([
			0, 2_000_000, 5_000_000,
		]);
		expect(resizeBeats({ beats: [0, 5_000_000], side: "right", clipDelta: 1_000_000, newDuration: 11_000_000 })).toEqual([0, 5_000_000]);
	});

	test("a trim start or a speed change remaps the marks like the keyframes", () => {
		expect(
			remapBeats({
				beats: [0, 2_000_000, 5_000_000],
				before: { trimStart: 0, retime: undefined },
				after: { trimStart: 1_000_000, retime: undefined },
				duration: 9_000_000,
			}),
		).toEqual([1_000_000, 4_000_000]);
		expect(
			remapBeats({
				beats: [0, 2_000_000, 5_000_000],
				before: { trimStart: 0, retime: { rate: 1 } },
				after: { trimStart: 0, retime: { rate: 2 } },
				duration: 5_000_000,
			}),
		).toEqual([0, 1_000_000, 2_500_000]);
	});
});
