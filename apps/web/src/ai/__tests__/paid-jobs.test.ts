// A paid job outlives a restart of the server (the switch to the VPN starts Gaziyav again): the next Generate comes back to it.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paid-jobs-"));
process.env.LIPSYNC_HOME = dir;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("paid jobs on disk", () => {
	test("the file is written beside and renamed over (a kill mid-write never leaves half a file)", async () => {
		const { PaidMap } = await import("../paid-jobs");
		const file = path.join(dir, "paid-jobs.json");
		const writes = spyOn(fs, "writeFileSync");
		const renames = spyOn(fs, "renameSync");
		try {
			new PaidMap<{ at: number; taskId: string }>("argo").set("atomic", { at: Date.now(), taskId: "task_a" });
			const targets = writes.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith(dir));
			expect(targets.length).toBeGreaterThan(0);
			expect(targets.every((p) => p !== file && p.endsWith(".tmp"))).toBe(true);
			expect(renames.mock.calls.some((c) => String(c[1]) === file)).toBe(true);
		} finally {
			writes.mockRestore();
			renames.mockRestore();
		}
		expect(fs.existsSync(`${file}.tmp`)).toBe(false);
		expect(JSON.parse(fs.readFileSync(file, "utf8")).argo.atomic.taskId).toBe("task_a");
	});
	test("a new process takes the rows back, nothing follows them, old ones go, no secret is written", async () => {
		const { PaidMap } = await import("../paid-jobs");
		const a = new PaidMap<{ at: number; req: { requestId: string }; following?: boolean }>("fal");
		a.set("k1", { at: Date.now(), req: { requestId: "r1" }, following: true });
		a.set("old", { at: Date.now() - 4 * 3600 * 1000, req: { requestId: "r0" } });
		const kie = new PaidMap<{ at: number; taskId: string }>("kie");
		kie.set("t", { at: Date.now(), taskId: "task_1" });
		const text = fs.readFileSync(path.join(dir, "paid-jobs.json"), "utf8");
		expect(text).not.toContain("following");
		const b = new PaidMap<{ at: number; req: { requestId: string }; following?: boolean }>("fal");
		expect(b.get("k1")?.req.requestId).toBe("r1");
		expect(b.get("k1")?.following).toBe(false);
		expect(b.has("old")).toBe(false);
		expect(new PaidMap<{ at: number; taskId: string }>("kie").get("t")?.taskId).toBe("task_1");
		b.delete("k1");
		expect(new PaidMap("fal").has("k1")).toBe(false);
	});
});
