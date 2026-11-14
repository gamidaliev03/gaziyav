import { afterAll, beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// A 120 Hz display: requestAnimationFrame every 8.33 ms, driven by hand.
const globals = globalThis as unknown as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
const original = { raf: globals.requestAnimationFrame, caf: globals.cancelAnimationFrame };
let pending: ((t: number) => void) | null = null;
let clock = 0;
const realNow = performance.now.bind(performance);

let PlaybackManager: typeof import("../playback-manager").PlaybackManager;
beforeAll(async () => {
	await installOpenCutWasm();
	({ PlaybackManager } = await import("../playback-manager"));
	globals.requestAnimationFrame = (cb: (t: number) => void) => {
		pending = cb;
		return 1;
	};
	globals.cancelAnimationFrame = () => {
		pending = null;
	};
	performance.now = () => clock;
});
afterAll(() => {
	globals.requestAnimationFrame = original.raf;
	globals.cancelAnimationFrame = original.caf;
	performance.now = realNow;
});

test("a 30 fps project on a 120 Hz screen notifies once per project frame, not per refresh", () => {
	const editor = {
		project: { getActive: () => ({ settings: { fps: { numerator: 30, denominator: 1 } } }) },
		timeline: { getTotalDuration: () => 10 * 120000 * 1000, subscribe: () => () => {} },
		scenes: { subscribe: () => () => {} },
	};
	const playback = new PlaybackManager(editor as never);
	const times: number[] = [];
	playback.onUpdate((t) => times.push(t));
	playback.play();
	for (let i = 0; i < 120; i++) {
		clock += 1000 / 120;
		pending?.(clock);
	}
	playback.pause();
	// One second of playback: 30 different frames (±1 for rounding at the edges), each reported once.
	expect(times.length).toBeGreaterThanOrEqual(29);
	expect(times.length).toBeLessThanOrEqual(31);
	expect(new Set(times).size).toBe(times.length);
});
