import { describe, expect, test } from "bun:test";
import type { TimelineElement } from "@/timeline/types";
import { fadeLimit, fadeOf, fadeParams } from "../fades";

const el = (type: string, params: Record<string, unknown> = {}) => ({ id: "x", type, startTime: 0, duration: 120000 * 8, params }) as unknown as TimelineElement;

describe("fade handles", () => {
	test("a video clip fades its picture and its sound together; 0 takes both away", () => {
		expect(fadeParams(el("video"), "in", 1.5)).toEqual({ fadeIn: 1.5, "anim.in": "fade", "anim.inDuration": 1.5 });
		expect(fadeParams(el("video", { "anim.out": "fade" }), "out", 0)).toEqual({ fadeOut: 0, "anim.out": "none" });
	});
	test("audio fades its sound only, a picture its picture only", () => {
		expect(fadeParams(el("audio"), "out", 2)).toEqual({ fadeOut: 2 });
		expect(fadeParams(el("image"), "in", 0.5)).toEqual({ "anim.in": "fade", "anim.inDuration": 0.5 });
	});
	test("another In animation keeps its kind and takes the length", () => {
		expect(fadeParams(el("video", { "anim.in": "pop" }), "in", 1)).toEqual({ fadeIn: 1, "anim.inDuration": 1 });
		expect(fadeParams(el("video", { "anim.in": "pop" }), "in", 0)).toEqual({ fadeIn: 0 });
	});
	test("the shown fade: the picture's fade animation, else the sound's", () => {
		expect(fadeOf(el("video", { "anim.in": "fade", "anim.inDuration": 0.8, fadeIn: 2 }), "in")).toBe(0.8);
		expect(fadeOf(el("audio", { fadeOut: 1.2 }), "out")).toBe(1.2);
		expect(fadeOf(el("video"), "out")).toBe(0);
	});
	test("a fade may take all the clip the other side leaves, never more (they never cross)", () => {
		expect(fadeLimit(5, 0)).toBe(5);
		expect(fadeLimit(5, 0.5)).toBe(4.5);
		expect(fadeLimit(5, 5)).toBe(0);
		expect(fadeLimit(60, 0)).toBe(10); // the handle's own ceiling
		expect(fadeLimit(5, 9)).toBe(0); // an old project's longer other fade
		expect(fadeLimit(0, 0)).toBe(0);
		expect(fadeLimit(5, Number.NaN)).toBe(5);
	});
});
