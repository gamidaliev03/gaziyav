import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// Several selected keys dragged together: they move as a group, stop at the clip's edges together, and the
// leading key moves first so none lands on a selected neighbour that hasn't moved yet (it would replace it).
let drag: typeof import("@/timeline/controllers/keyframe-drag-controller");

beforeAll(async () => {
	await installOpenCutWasm();
	drag = await import("@/timeline/controllers/keyframe-drag-controller");
});

describe("keyframe group drag", () => {
	test("the group stops at the clip's end and start together", () => {
		// Keys at 8 s and 9 s in a 10 s clip, dragged +3 s: they move 1 s, not both onto 10 s.
		expect(drag.clampKeyGroupDelta({ deltaTicks: 3, times: [8, 9], duration: 10 })).toBe(1);
		expect(drag.clampKeyGroupDelta({ deltaTicks: -5, times: [2, 6], duration: 10 })).toBe(-2);
		expect(drag.clampKeyGroupDelta({ deltaTicks: 1, times: [2, 6], duration: 10 })).toBe(1);
		expect(drag.clampKeyGroupDelta({ deltaTicks: 4, times: [], duration: 10 })).toBe(4);
		// A key left past a trimmed end: the group can still move left, and isn't forced anywhere.
		expect(drag.clampKeyGroupDelta({ deltaTicks: 1, times: [2, 12], duration: 10 })).toBe(0);
		expect(drag.clampKeyGroupDelta({ deltaTicks: -1, times: [2, 12], duration: 10 })).toBe(-1);
	});

	test("the leading key is moved first", () => {
		const keys = [{ keyframe: { time: 1 } }, { keyframe: { time: 3 } }, { keyframe: { time: 2 } }];
		const times = (moving: typeof keys) => moving.map((k) => k.keyframe.time);
		expect(times(drag.orderKeysForMove({ moving: keys, deltaTicks: 2 }))).toEqual([3, 2, 1]);
		expect(times(drag.orderKeysForMove({ moving: keys, deltaTicks: -2 }))).toEqual([1, 2, 3]);
	});
});
