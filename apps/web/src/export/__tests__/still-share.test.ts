import { describe, expect, test } from "bun:test";
import type { SceneTracks } from "@/timeline/types";
import { timelineStillShare } from "../still-share";

const el = (type: string, startTime: number, duration: number) => ({ id: `${type}${startTime}`, type, startTime, duration });
const scene = (main: unknown[], overlay: unknown[] = []) => ({ main: { id: "m", type: "video", elements: main }, overlay: [{ id: "o", type: "video", elements: overlay }], audio: [] }) as unknown as SceneTracks;

describe("still share of the timeline (the Export window's size estimate)", () => {
	test("footage 0, a slideshow 1, a picture over a clip 0, a picture after the clip its share", () => {
		expect(timelineStillShare(scene([el("video", 0, 10)]))).toBe(0);
		expect(timelineStillShare(scene([el("image", 0, 5), el("image", 5, 5)]))).toBe(1);
		expect(timelineStillShare(scene([el("video", 0, 10)], [el("image", 2, 3)]))).toBe(0);
		expect(timelineStillShare(scene([el("video", 0, 6), el("image", 6, 6)]))).toBe(0.5);
		expect(timelineStillShare(null)).toBe(0);
	});
});
