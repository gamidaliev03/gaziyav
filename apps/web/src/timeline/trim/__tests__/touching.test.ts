import { describe, expect, test } from "bun:test";
import { touchingEdges } from "../touching";

describe("touchingEdges: the edges that lie on a cut", () => {
	test("three clips back to back, then a gap, then a free clip", () => {
		const m = touchingEdges([
			{ id: "c", startTime: 200, duration: 100 },
			{ id: "a", startTime: 0, duration: 100 },
			{ id: "b", startTime: 100, duration: 100 },
			{ id: "d", startTime: 400, duration: 50 },
		]);
		expect([m.get("a"), m.get("b"), m.get("c"), m.get("d")]).toEqual(["r", "lr", "l", undefined]);
	});
	test("one tick apart is still a cut, two are a gap", () => {
		expect(touchingEdges([{ id: "a", startTime: 0, duration: 100 }, { id: "b", startTime: 101, duration: 5 }]).get("b")).toBe("l");
		expect(touchingEdges([{ id: "a", startTime: 0, duration: 100 }, { id: "b", startTime: 102, duration: 5 }]).size).toBe(0);
	});
});
