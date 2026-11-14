import { describe, expect, test } from "bun:test";
import { buildCurve, getCurveTable, subCurve } from "@/retime/curve";
import { getClipTimeAtSourceTime, getSourceTimeAtClipTime, getTimelineDurationForSourceSpan } from "@/retime/resolve";
import { splitRetimeAtClipTime } from "@/retime/split";
import type { RetimeConfig } from "@/timeline";

const ramp = (preset: Parameters<typeof buildCurve>[0]): RetimeConfig => {
	const curve = buildCurve(preset);
	return { mode: "curve", curve, rate: getCurveTable(curve).rate };
};

describe("speed curves", () => {
	test("a flat curve is a constant speed", () => {
		const curve = { preset: "custom" as const, points: [{ x: 0, y: 2 }, { x: 1, y: 2 }] };
		const t = getCurveTable(curve);
		expect(t.k).toBeCloseTo(0.5, 6);
		const retime: RetimeConfig = { mode: "curve", curve, rate: t.rate };
		expect(getSourceTimeAtClipTime({ clipTime: 3, retime, duration: 5 })).toBeCloseTo(6, 4);
	});

	test("clip ↔ source mapping round-trips and is monotonic for every preset", () => {
		for (const preset of ["montage", "hero", "bullet", "jumpCut", "flashIn", "flashOut", "velocity"] as const) {
			const retime = ramp(preset);
			const D = 1000;
			let prev = -1;
			for (let i = 0; i <= 200; i++) {
				const c = (i / 200) * D;
				const s = getSourceTimeAtClipTime({ clipTime: c, retime, duration: D });
				expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
				prev = s;
				expect(getClipTimeAtSourceTime({ sourceTime: s, retime, duration: D })).toBeCloseTo(c, 0);
			}
			// The whole clip covers exactly the source span D · rate.
			expect(getSourceTimeAtClipTime({ clipTime: D, retime, duration: D })).toBeCloseTo(D * retime.rate, 3);
			expect(getTimelineDurationForSourceSpan({ sourceSpan: D * retime.rate, retime })).toBeCloseTo(D, 3);
		}
	});

	test("velocity races, then brakes to slow motion on the key moment", () => {
		const t = getCurveTable(buildCurve("velocity"));
		expect(t.speed(0.25)).toBeGreaterThan(4);
		expect(t.speed(0.54)).toBeLessThan(0.5);
		expect(t.speed(1)).toBeCloseTo(1, 3);
	});

	test("bullet time slows down in the middle", () => {
		const t = getCurveTable(buildCurve("bullet"));
		expect(t.minSpeed).toBeLessThan(0.2);
		expect(t.speed(0.5)).toBeLessThan(0.2);
		expect(t.speed(0.1)).toBeGreaterThan(3);
	});

	test("split keeps both halves on the same source frames", () => {
		const retime = ramp("hero");
		const D = 9000;
		const cut = 4000;
		const { left, right } = splitRetimeAtClipTime({ retime, splitClipTime: cut, duration: D });
		const sCut = getSourceTimeAtClipTime({ clipTime: cut, retime, duration: D });
		const total = getSourceTimeAtClipTime({ clipTime: D, retime, duration: D });
		// Left half: [0, cut] → [0, sCut]; right half: [cut, D] → [sCut, total].
		expect(getSourceTimeAtClipTime({ clipTime: cut, retime: left, duration: cut })).toBeCloseTo(sCut, -1);
		expect(sCut + getSourceTimeAtClipTime({ clipTime: D - cut, retime: right, duration: D - cut })).toBeCloseTo(total, -1);
		// Midpoints agree within 1 %.
		const mid = getSourceTimeAtClipTime({ clipTime: cut / 2, retime, duration: D });
		expect(Math.abs(getSourceTimeAtClipTime({ clipTime: cut / 2, retime: left, duration: cut }) - mid) / sCut).toBeLessThan(0.01);
	});

	test("subCurve renormalizes x to 0..1", () => {
		const c = subCurve(buildCurve("montage"), 0.25, 0.75);
		expect(c.points[0].x).toBe(0);
		expect(c.points[c.points.length - 1].x).toBe(1);
	});
});
