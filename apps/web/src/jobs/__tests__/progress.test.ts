import { describe, expect, test } from "bun:test";
import { jobCenter, useJobsStore, type Job } from "../store";
import { withPending } from "../components/pending-media";
import { clipJobProgress } from "../components/clip-progress";

const bar = () => useJobsStore.getState().jobs.find((j) => j.id === "t")?.progress;

describe("one bar per job, never going back", () => {
	test("a dip within a stage holds the bar", () => {
		jobCenter.start({ id: "t", kind: "other", title: "T", stage: "a", progress: 0 });
		jobCenter.update("t", { progress: 0.4 });
		jobCenter.update("t", { progress: 0.35 });
		expect(bar()).toBe(0.4);
		jobCenter.update("t", { progress: 0.6 });
		expect(bar()).toBe(0.6);
		jobCenter.remove("t");
	});

	test("a new stage from 0 carries on from where the bar is and ends at 1", () => {
		jobCenter.start({ id: "t", kind: "other", title: "T", stage: "download", progress: 0 });
		const seen: number[] = [];
		for (const p of [0.2, 0.6, 1]) {
			jobCenter.update("t", { stage: "download", progress: p });
			seen.push(bar() ?? -1);
		}
		for (const p of [0, 0.5, 1]) {
			jobCenter.update("t", { stage: "cut", progress: p });
			seen.push(bar() ?? -1);
		}
		for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
		expect(seen.at(-1)).toBe(1);
		jobCenter.remove("t");
	});

	test("an unknown figure after a known one keeps the known one; finish is 1", () => {
		jobCenter.start({ id: "t", kind: "other", title: "T", progress: 0.3 });
		jobCenter.update("t", { progress: undefined, stage: "x" });
		expect(bar()).toBe(0.3);
		jobCenter.finish("t");
		expect(bar()).toBe(1);
		jobCenter.remove("t");
	});
});

const pending = (name: string): Job => ({
	id: `p-${name}`,
	kind: "youtube",
	title: name,
	status: "running",
	startedAt: 0,
	place: { media: { assetId: `a-${name}`, name, type: "video" } },
});

describe("a placeholder sits where its item will land", () => {
	const items = ["Alpha.mp4", "Delta.mp4", "Kilo.mp4"].map((name) => ({ id: name, name, type: "video", file: { size: 1 } }));
	test("by name, ascending and descending", () => {
		const asc = withPending(items, [pending("Charlie.mp4")], "name", "asc").map((r) => ("asset" in r ? r.asset.name : `[${r.pending.title}]`));
		expect(asc).toEqual(["Alpha.mp4", "[Charlie.mp4]", "Delta.mp4", "Kilo.mp4"]);
		const desc = withPending([...items].reverse(), [pending("Charlie.mp4")], "name", "desc").map((r) => ("asset" in r ? r.asset.name : `[${r.pending.title}]`));
		expect(desc).toEqual(["Kilo.mp4", "Delta.mp4", "[Charlie.mp4]", "Alpha.mp4"]);
	});
	test("an unsorted list: at the end", () => {
		const rows = withPending(items, [pending("Zulu.mp4")], "added", "asc");
		expect("pending" in rows[3]).toBe(true);
	});
});

describe("progress on the clip", () => {
	test("the running job on a clip, unknown as -1, none as null", () => {
		const jobs: Job[] = [
			{ id: "c", kind: "transcribe", title: "C", status: "running", startedAt: 0, progress: 0.25, place: { elements: ["e1", "e2"] } },
			{ id: "d", kind: "other", title: "D", status: "running", startedAt: 0, place: { elements: ["e3"] } },
			{ id: "e", kind: "other", title: "E", status: "done", startedAt: 0, progress: 1, place: { elements: ["e4"] } },
		];
		expect(clipJobProgress(jobs, "e2")).toBe(0.25);
		expect(clipJobProgress(jobs, "e3")).toBe(-1);
		expect(clipJobProgress(jobs, "e4")).toBe(null);
		expect(clipJobProgress(jobs, "zz")).toBe(null);
	});
});

describe("the aggregate (the activity ring and the Dock bar)", () => {
	test("mean of the measured running jobs; -1 when none is measured; null when idle", async () => {
		const { aggregateProgress } = await import("../store");
		const job = (id: string, status: Job["status"], progress?: number): Job => ({ id, kind: "other", title: id, status, startedAt: 0, progress });
		expect(aggregateProgress([])).toBe(null);
		expect(aggregateProgress([job("a", "done", 1)])).toBe(null);
		expect(aggregateProgress([job("a", "running")])).toBe(-1);
		expect(aggregateProgress([job("a", "running", 0.2), job("b", "running", 0.6), job("c", "running")])).toBe(0.4);
	});
});
