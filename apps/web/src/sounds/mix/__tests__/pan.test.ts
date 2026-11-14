import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TimelineElement } from "@/timeline";

let upsertPathKeyframe: typeof import("@/animation/keyframes").upsertPathKeyframe;
let resolveAnimationTarget: typeof import("@/timeline/animation-targets").resolveAnimationTarget;
let mediaTime: typeof import("@/wasm").mediaTime;
let P: typeof import("../pan");
const TICKS_PER_SECOND = 120000;

beforeAll(async () => {
	await installOpenCutWasm();
	({ upsertPathKeyframe } = await import("@/animation/keyframes"));
	({ resolveAnimationTarget } = await import("@/timeline/animation-targets"));
	({ mediaTime } = await import("@/wasm"));
	P = await import("../pan");
	expect((await import("@/wasm")).TICKS_PER_SECOND).toBe(TICKS_PER_SECOND);
});

const clip = (params: Record<string, unknown> = {}, animations?: unknown) =>
	({ id: "a", type: "audio", sourceType: "library", name: "Song", startTime: 0, duration: 4 * TICKS_PER_SECOND, trimStart: 0, trimEnd: 0, params: { volume: 0, ...params }, animations }) as unknown as Extract<TimelineElement, { type: "audio" }>;

/** The matrix on one stereo sample. */
const mix = (value: number, l: number, r: number) => {
	const m = P.panMatrix(value);
	return [m.ll * l + m.lr * r, m.rl * l + m.rr * r];
};

describe("Pan: left ↔ right", () => {
	test("centre is the clip as it is; old projects without a pan are centred", () => {
		expect(P.panMatrix(0)).toEqual(P.CENTRE);
		expect(P.readPan(clip())).toBe(0);
		expect(P.isPanned(clip())).toBe(false);
		expect(mix(0, 0.3, -0.7)).toEqual([0.3, -0.7]);
	});

	test("a mono source (L = R) moves as a whole and never gets louder", () => {
		expect(mix(-100, 1, 1)).toEqual([1, 0]);
		expect(mix(100, 1, 1)).toEqual([0, 1]);
		expect(mix(-50, 1, 1)).toEqual([1, 0.5]);
		for (let p = -100; p <= 100; p += 5) {
			const m = P.panMatrix(p);
			expect(m.ll + m.lr).toBeLessThanOrEqual(1 + 1e-9);
			expect(m.rl + m.rr).toBeLessThanOrEqual(1 + 1e-9);
		}
	});

	test("a stereo source panned hard left keeps both its channels, on the left", () => {
		expect(mix(-100, 1, 0)).toEqual([0.5, 0]);
		expect(mix(-100, 0, 1)).toEqual([0.5, 0]);
		expect(mix(100, 1, 0)).toEqual([0, 0.5]);
	});

	test("out of range and junk are clamped; writePanMatrix equals panMatrix", () => {
		expect(P.clampPan(250)).toBe(100);
		expect(P.clampPan(-1e9)).toBe(-100);
		expect(P.clampPan(Number.NaN)).toBe(0);
		expect(P.clampPan("left")).toBe(0);
		expect(P.readPan(clip({ pan: -30 }))).toBe(-30);
		for (const p of [-100, -37, 0, 12, 100]) expect(P.writePanMatrix(p, { ...P.CENTRE })).toEqual(P.panMatrix(p));
	});

	test("keyframe-able like the volume: the inspector's path resolves, keys interpolate", () => {
		const base = clip({ pan: 0 });
		const target = resolveAnimationTarget({ element: base, path: "pan" });
		expect(target).not.toBeNull();
		if (!target) return;
		let animations = upsertPathKeyframe({ animations: undefined, propertyPath: "pan", time: mediaTime({ ticks: 0 }), value: -100, channelLayout: target.channelLayout, coerceValue: target.coerceValue });
		animations = upsertPathKeyframe({ animations, propertyPath: "pan", time: mediaTime({ ticks: 2 * TICKS_PER_SECOND }), value: 100, channelLayout: target.channelLayout, coerceValue: target.coerceValue });
		const keyed = clip({ pan: 0 }, animations);
		expect(P.isPanned(keyed)).toBe(true);
		expect(P.panAt(keyed, 0)).toBeCloseTo(-100, 3);
		expect(P.panAt(keyed, 1)).toBeCloseTo(0, 3);
		expect(P.panAt(keyed, 2)).toBeCloseTo(100, 3);
		expect(P.panAt(keyed, 3.5)).toBeCloseTo(100, 3);
		// export: per sample, the same curve
		const values = P.renderPanValues(keyed, 48000 * 2, 48000);
		expect(values?.[0]).toBeCloseTo(-100, 3);
		expect(values?.[48000]).toBeCloseTo(0, 1);
		expect(P.renderPanValues(clip({ pan: 40 }), 100, 48000)).toBeNull();
		// preview: break-points from now to the clip's end, the flat tail dropped to its ends
		const points = P.buildPanAutomation(keyed, 0, 4);
		expect(points[0]).toEqual({ localTime: 0, pan: -100 });
		expect(points[points.length - 1].pan).toBeCloseTo(100, 3);
		expect(points.length).toBeLessThan(10);
		expect(P.buildPanAutomation(clip({ pan: 25 }), 1, 4)).toEqual([{ localTime: 1, pan: 25 }]);
	});
});
