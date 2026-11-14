import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TimelineElement } from "@/timeline";

// ⌥-drag copies kept the original's keyframe ids: picking a keyframe on one clip matched the other's too.
let copyElementWithFreshKeyframes: typeof import("@/timeline/element-copy").copyElementWithFreshKeyframes;
beforeAll(async () => {
	await installOpenCutWasm();
	({ copyElementWithFreshKeyframes } = await import("@/timeline/element-copy"));
});

const keyIds = (element: TimelineElement) => JSON.stringify(element.animations ?? {}).match(/"id":"[^"]+"/g) ?? ([] as string[]);

test("a copy gets its own keyframe ids", () => {
	const original = {
		id: "a", name: "a", type: "video", mediaId: "m", startTime: 0, duration: 120000, trimStart: 0, trimEnd: 0, params: {},
		animations: { opacity: { keys: [ { id: "k1", time: 0, value: 0, interpolation: "linear" }, { id: "k2", time: 60000, value: 1, interpolation: "linear" } ] } },
	} as unknown as TimelineElement;
	const copy = copyElementWithFreshKeyframes(original, "b");
	expect(copy.id).toBe("b");
	const before = keyIds(original), after = keyIds(copy);
	expect(after.length).toBe(before.length);
	expect(after.some((id) => before.includes(id))).toBe(false);
});
