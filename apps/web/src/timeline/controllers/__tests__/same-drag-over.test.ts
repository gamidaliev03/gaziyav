import { expect, test } from "bun:test";
import { sameDragOver } from "@/timeline/controllers/drag-drop-controller";
import type { MediaTime } from "@/wasm";

const t = (n: number) => n as MediaTime;
const base = {
	dropTarget: { trackIndex: 1, isNewTrack: false, insertPosition: null, xPosition: t(1000), targetElement: { elementId: "e", trackId: "k" } },
	elementType: "video" as const,
	ghost: { duration: t(5000), count: 1 },
	forbidden: false,
	cut: { trackId: "k", fromElementId: "a", toElementId: "b", trackIndex: 1, time: t(2000) },
};

test("the drop state is compared field by field: equal copies are the same, any shown change is not", () => {
	const copy = () => JSON.parse(JSON.stringify(base));
	expect(sameDragOver(base, copy())).toBe(true);
	expect(sameDragOver(base, { ...copy(), dropTarget: { ...base.dropTarget, xPosition: t(1001) } })).toBe(false);
	expect(sameDragOver(base, { ...copy(), dropTarget: { ...base.dropTarget, targetElement: null } })).toBe(false);
	expect(sameDragOver(base, { ...copy(), ghost: { duration: t(5000), count: 2 } })).toBe(false);
	expect(sameDragOver(base, { ...copy(), cut: { ...base.cut, time: t(2001) } })).toBe(false);
	expect(sameDragOver(base, { ...copy(), cut: null })).toBe(false);
	expect(sameDragOver(base, { ...copy(), forbidden: true })).toBe(false);
	expect(sameDragOver({ ...base, dropTarget: null }, { ...copy(), dropTarget: null })).toBe(true);
});
