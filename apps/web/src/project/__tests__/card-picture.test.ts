import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline/types";
import { cardIsOld, firstClipPicture } from "../card-picture";

const clip = (id: string, mediaId: string, startTime: number, extra = {}) => ({ id, type: "video", mediaId, startTime, duration: 5, ...extra });
const tracks = (main: unknown[], overlay: unknown[][] = []) =>
	({ main: { type: "video", elements: main, hidden: false }, overlay: overlay.map((elements) => ({ type: "video", elements, hidden: false })), audio: [] }) as unknown as SceneTracks;
const assets = [
	{ id: "old", thumbnailUrl: "data:old" },
	{ id: "new", thumbnailUrl: "data:new" },
	{ id: "bare" },
];

describe("a project card's picture", () => {
	test("the timeline's first clip, not the first file in Media", () => {
		expect(firstClipPicture({ tracks: tracks([clip("a", "new", 0)]), assets })).toBe("data:new");
	});
	test("the earliest clip wherever it sits; the main track wins a tie", () => {
		expect(firstClipPicture({ tracks: tracks([clip("a", "old", 4)], [[clip("b", "new", 1)]]), assets })).toBe("data:new");
		expect(firstClipPicture({ tracks: tracks([clip("a", "new", 0)], [[clip("b", "old", 0)]]), assets })).toBe("data:new");
	});
	test("skips hidden clips, hidden tracks and clips with no picture", () => {
		expect(firstClipPicture({ tracks: tracks([clip("a", "old", 0, { hidden: true }), clip("b", "new", 5)]), assets })).toBe("data:new");
		expect(firstClipPicture({ tracks: tracks([clip("a", "bare", 0), clip("b", "new", 5)]), assets })).toBe("data:new");
		const hiddenTrack = tracks([clip("a", "new", 5)], [[clip("b", "old", 0)]]);
		(hiddenTrack.overlay[0] as { hidden: boolean }).hidden = true;
		expect(firstClipPicture({ tracks: hiddenTrack, assets })).toBe("data:new");
	});
	test("nothing to show on an empty timeline", () => {
		expect(firstClipPicture({ tracks: tracks([]), assets })).toBeUndefined();
	});
	test("old: no date (saved before the date existed) or changed after the picture", () => {
		const updatedAt = new Date(2026, 10, 7, 12, 0, 0);
		expect(cardIsOld({ updatedAt })).toBe(true);
		expect(cardIsOld({ updatedAt, thumbnailAt: new Date(updatedAt.getTime() - 60_000) })).toBe(true);
		expect(cardIsOld({ updatedAt, thumbnailAt: new Date(updatedAt.getTime() - 1000) })).toBe(false);
		expect(cardIsOld({ updatedAt, thumbnailAt: new Date(updatedAt.getTime() + 1000) })).toBe(false);
	});
});
