import { describe, expect, test } from "bun:test";
import { shiftToRange } from "../range";

describe("In→Out export of AI layers", () => {
	test("layers are shifted to the In point and cut at both edges", () => {
		const items = [
			{ id: "hook", kind: "HookTitle", from: 0, dur: 2.5, skip: 0, len: 2.5, props: {} },
			{ id: "lt", kind: "LowerThird", from: 2.9, dur: 3, skip: 0, len: 3, props: {} },
			{ id: "cta", kind: "CTA", from: 5.2, dur: 2, skip: 0, len: 2, props: {} },
		];
		const out = shiftToRange(items, 2, 3.5); // In 2 s, Out 5.5 s
		expect(out.map((i) => i.id)).toEqual(["hook", "lt", "cta"]);
		const [hook, lt, cta] = out;
		expect(hook.from).toBe(0);
		expect(hook.dur).toBeCloseTo(0.5);
		expect(hook.skip).toBeCloseTo(2); // its animation continues from 2 s in
		expect(hook.len).toBe(2.5);
		expect(lt.from).toBeCloseTo(0.9);
		expect(lt.dur).toBeCloseTo(2.6); // cut at Out
		expect(cta.from).toBeCloseTo(3.2);
		expect(cta.dur).toBeCloseTo(0.3);
		expect(shiftToRange(items, 7.5, 1)).toEqual([]);
	});
});
