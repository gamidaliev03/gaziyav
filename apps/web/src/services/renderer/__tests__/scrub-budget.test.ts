import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// Scrubbing with many video layers: a layer whose decoder is still seeking after the budget shows its last frame (its
// seek goes to `late`, the frame is drawn again when it ends); a layer with no frame yet waits; nothing is waited for
// outside a scrub.
let resolve: typeof import("@/services/renderer/resolve");
beforeAll(async () => {
	await installOpenCutWasm();
	resolve = await import("@/services/renderer/resolve");
});
const after = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

test("a seek within the budget gives the new frame; a slower one the last frame, its seek kept in late", async () => {
	const budget = { ms: 20, late: [] as Promise<unknown>[] };
	expect(await resolve.frameWithin({ budget }, after(2, "new"), () => "last")).toBe("new");
	expect(budget.late.length).toBe(0);
	const slow = after(60, "new");
	expect(await resolve.frameWithin({ budget }, slow, () => "last")).toBe("last");
	expect(budget.late).toEqual([slow]);
	expect(await budget.late[0]).toBe("new");
});

test("a layer that never showed a frame waits for its seek; outside a scrub every layer is waited for", async () => {
	const budget = { ms: 10, late: [] as Promise<unknown>[] };
	expect(await resolve.frameWithin({ budget }, after(30, "first"), () => null)).toBe("first");
	expect(budget.late.length).toBe(0);
	expect(await resolve.frameWithin({}, after(30, "exact"), () => "last")).toBe("exact");
});
