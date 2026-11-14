import { describe, expect, test } from "bun:test";
import { TOAST_BOTTOM_MIN_PX, TOAST_ROOM_PX, toastBottomFor } from "../toast-bottom";

describe("toasts above the timeline, never out of the window", () => {
	test("just above the timeline's top", () => {
		expect(toastBottomFor({ timelineTop: 500, timelineHeight: 300, windowHeight: 800 })).toBe(312);
	});
	test("a tall timeline: the toast keeps room under the window's top", () => {
		expect(toastBottomFor({ timelineTop: 40, timelineHeight: 760, windowHeight: 800 })).toBe(800 - TOAST_ROOM_PX);
	});
	test("never under the bottom edge", () => {
		expect(toastBottomFor({ timelineTop: 799, timelineHeight: 1, windowHeight: 800 })).toBe(TOAST_BOTTOM_MIN_PX);
		expect(toastBottomFor({ timelineTop: 100, timelineHeight: 50, windowHeight: 120 })).toBe(TOAST_BOTTOM_MIN_PX);
	});
	test("a hidden or off-screen timeline: the plain offset", () => {
		expect(toastBottomFor({ timelineTop: 0, timelineHeight: 0, windowHeight: 800 })).toBeNull();
		expect(toastBottomFor({ timelineTop: 900, timelineHeight: 200, windowHeight: 800 })).toBeNull();
		expect(toastBottomFor({ timelineTop: Number.NaN, timelineHeight: 200, windowHeight: 800 })).toBeNull();
	});
});
