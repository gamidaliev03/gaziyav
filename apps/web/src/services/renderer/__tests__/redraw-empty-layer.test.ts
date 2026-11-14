// polish3 (11.11): a video layer that is on screen but came back without a frame left a still preview picture with
// that layer missing, until the playhead moved. The still frame is now drawn again once, through the late-layer path.
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let resolve: typeof import("@/services/renderer/resolve");
beforeAll(async () => {
	await installOpenCutWasm();
	resolve = await import("@/services/renderer/resolve");
});

describe("an empty video layer on a still frame asks for one redraw", () => {
	test("a paused frame (budget set) gets a late promise that settles shortly", async () => {
		const budget = { ms: 30, late: [] as Promise<unknown>[] };
		expect(resolve.redrawOnceWithout({ budget }, "broll-a", 2)).toBe(true);
		expect(budget.late.length).toBe(1);
		const t0 = performance.now();
		await budget.late[0];
		expect(performance.now() - t0).toBeGreaterThanOrEqual(resolve.EMPTY_LAYER_REDRAW_MS - 20);
	});

	test("once per decoder and moment: no redraw loop when the layer stays empty", () => {
		const budget = { ms: 30, late: [] as Promise<unknown>[] };
		expect(resolve.redrawOnceWithout({ budget }, "broll-b", 3)).toBe(true);
		expect(resolve.redrawOnceWithout({ budget }, "broll-b", 3)).toBe(false);
		expect(budget.late.length).toBe(1);
		// another moment of the same clip asks again
		expect(resolve.redrawOnceWithout({ budget }, "broll-b", 3.04)).toBe(true);
	});

	test("playback and export (no budget) are left alone", () => {
		expect(resolve.redrawOnceWithout({}, "broll-c", 1)).toBe(false);
	});
});
