import { describe, expect, test } from "bun:test";
import { mergeDenseRuns } from "@/timeline/dense-runs";

describe("runs of narrow clips", () => {
	test("clips that touch are one run; a gap of more than a pixel starts another", () => {
		const runs = mergeDenseRuns([
			{ left: 0, right: 0.7 },
			{ left: 0.7, right: 1.4 },
			{ left: 1.4, right: 2.1 },
			{ left: 3.05, right: 3.6 }, // 0.95 px after the last: the same run
			{ left: 6, right: 6.5 }, // 2.4 px after: a new one
		]);
		expect(runs).toEqual([
			{ left: 0, right: 3.6, count: 4 },
			{ left: 6, right: 6.5, count: 1 },
		]);
	});
	test("the order of the clips does not matter, and a clip inside another does not shorten the run", () => {
		const runs = mergeDenseRuns([
			{ left: 10, right: 12 },
			{ left: 0, right: 9.5 },
			{ left: 2, right: 3 },
		]);
		expect(runs).toEqual([{ left: 0, right: 12, count: 3 }]);
	});
	test("no clips, no runs; every clip is counted once", () => {
		expect(mergeDenseRuns([])).toEqual([]);
		const spans = Array.from({ length: 1791 }, (_, i) => ({ left: i * 0.73, right: (i + 1) * 0.73 }));
		const runs = mergeDenseRuns(spans);
		expect(runs.length).toBe(1);
		expect(runs[0].count).toBe(1791);
	});
});
