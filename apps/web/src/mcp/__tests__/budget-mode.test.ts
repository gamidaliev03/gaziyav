// A7 and C2 on the server side: the taste profile's budget mode is "balance" by default (no per-video cap; a budget the
// user names caps a video), naming a per-video budget in the profile makes it the cap, and a generation's price is
// counted once however many calls hand its result back.
import { beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-budget-mode-"));
let B: typeof import("../server/budget");
let T: typeof import("@/production/taste");
let store: typeof import("@/production/server/store");
beforeAll(async () => {
	process.env.STUDIO_SUPPORT_DIR = dir;
	process.env.STUDIO_DATA_DIR = path.join(dir, "Studio");
	B = await import("../server/budget");
	T = await import("@/production/taste");
	store = await import("@/production/server/store");
});

describe("the budget mode", () => {
	test("balance by default: no cap until the user names this video's budget", () => {
		expect(T.DEFAULT_TASTE.budgetMode).toBe("balance");
		expect(T.normalizeTaste({ budget: 1 }).budgetMode).toBe("balance");
		const v = B.budgetView("mode-p1");
		expect(v.mode).toBe("balance");
		expect(v.capped).toBe(false);
		expect(B.setProjectBudget("mode-p1", 5).capped).toBe(true);
	});

	test("a per-video budget named in the profile is the cap of every video", () => {
		const t = T.mergeTaste(T.DEFAULT_TASTE, { budget: 3 });
		expect(t.budgetMode).toBe("video");
		expect(T.describeTaste(t)).toMatch(/budget \$3\/video/);
		expect(T.describeTaste(T.DEFAULT_TASTE)).toMatch(/no per-video cap/);
		store.writeTaste(t);
		expect(B.budgetView("mode-p2")).toMatchObject({ mode: "video", capped: true, budget: 3, left: 3 });
		store.writeTaste(T.DEFAULT_TASTE);
		expect(B.budgetView("mode-p2").capped).toBe(false);
	});
});

describe("a generation is counted once", () => {
	test("the same job handed back by a second call adds nothing", () => {
		B.recordSpend("once-p", { what: "a 5 s video", usd: 0.108, api: "fal", job: "gen-1" });
		const v = B.recordSpend("once-p", { what: "a 5 s video (the same call again)", usd: 0.108, api: "fal", job: "gen-1" });
		expect(v.spent).toBeCloseTo(0.108, 6);
		expect(B.recordSpend("once-p", { what: "another take", usd: 0.108, api: "fal", job: "gen-2" }).spent).toBeCloseTo(0.216, 6);
	});
});
