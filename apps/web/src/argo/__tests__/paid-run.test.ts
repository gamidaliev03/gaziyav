// A paid ArgoLink job is never paid twice (review of stage 9, items 2 and 3): the time limit reached while the line is
// down keeps the row (the job may finish and bill meanwhile), Stop keeps it too (ArgoLink has no cancel): the next Generate
// follows the same job instead of starting another. The network is a fetch stand-in; nothing leaves the Mac.
const ENV_BEFORE = { STUDIO_TEST: process.env.STUDIO_TEST, STUDIO_FAKE_TIMEOUT: process.env.STUDIO_FAKE_TIMEOUT };
process.env.STUDIO_TEST = "1";
process.env.STUDIO_FAKE_TIMEOUT = "5";
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

// (a poll that is retried a few times before it counts as a miss takes seconds, on purpose)
setDefaultTimeout(30_000);
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argo-paid-"));
process.env.LIPSYNC_HOME = dir;
(globalThis as Record<string, unknown>).__gaziyavArgoKey = "fake-argo-key-for-the-test";

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const dropped = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
const posts = (log: string[]) => log.filter((l) => l.startsWith("POST")).length;

function net(log: string[], poll: () => Response | Promise<Response>) {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const u = new URL(url);
		log.push(`${init?.method ?? "GET"} ${u.pathname}`);
		if (u.pathname === "/v1/videos/generations") return json({ request_id: `req_${posts(log)}` });
		if (/^\/v1\/videos\/req_/.test(u.pathname)) return poll();
		return json({ error: { message: "no such path" } }, 404);
	}) as unknown as typeof fetch;
}
const done = () => json({ status: "done", video: { url: "https://files.argo.test/clip.mp4" }, usage: { billed_seconds: 5 } });

let runArgo: typeof import("../server").runArgo;
let paidMap: typeof import("@/ai/paid-jobs").paidMap;
beforeAll(async () => {
	({ runArgo } = await import("../server"));
	({ paidMap } = await import("@/ai/paid-jobs"));
});
afterEach(() => {
	globalThis.fetch = realFetch;
});
afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
	// (the key slot is this file's alone: the «no API keys» test runs in the same process)
	delete (globalThis as Record<string, unknown>).__gaziyavArgoKey;
	delete process.env.STUDIO_TEST_KIE_LIMIT;
	for (const [k, v] of Object.entries(ENV_BEFORE)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

const ENDPOINT = "argolink/seedance-2.0-mini#text";
const input = (name: string) => ({ prompt: `paid-run ${name} ${crypto.randomUUID()}`, duration: 5, resolution: "720p" });
const keyOf = (i: Record<string, unknown>) => crypto.createHash("sha1").update(`seedance-2.0-mini\n${JSON.stringify(i)}`).digest("hex");

describe("ArgoLink: a job that may still bill is kept, and the next Generate comes back to it", () => {
	test("the time limit reached while the line is down: the row stays, the error is the line's, Retry follows the same job", async () => {
		const i = input("dead line");
		const log: string[] = [];
		net(log, () => Promise.reject(dropped()));
		process.env.STUDIO_TEST_KIE_LIMIT = "1200";
		await expect(runArgo(ENDPOINT, i, { timeoutSeconds: 1 })).rejects.toThrow(/couldn't connect|connection/i);
		const row = paidMap<{ at: number; requestId: string; following?: boolean }>("argo").get(keyOf(i));
		expect(row?.requestId).toBe("req_1");
		expect(row?.following).toBe(false);
		net(log, done);
		const r = await runArgo(ENDPOINT, i, { timeoutSeconds: 1 });
		expect(r.urls).toEqual(["https://files.argo.test/clip.mp4"]);
		expect(r.usd).toBeCloseTo(5 * 0.0643, 6);
		expect(posts(log)).toBe(1);
		paidMap("argo").delete(keyOf(i));
	});
	test("Stop: no cancel on ArgoLink, the row stays, the same Generate within 3 h returns that job's result", async () => {
		const i = input("stop");
		const log: string[] = [];
		const abort = new AbortController();
		net(log, () => {
			setTimeout(() => abort.abort(), 20);
			return json({ status: "pending" });
		});
		await expect(runArgo(ENDPOINT, i, { signal: abort.signal, timeoutSeconds: 5 })).rejects.toThrow("Cancelled");
		expect(paidMap("argo").get(keyOf(i))?.following).toBe(false);
		net(log, done);
		expect((await runArgo(ENDPOINT, i, { timeoutSeconds: 5 })).urls.length).toBe(1);
		expect(posts(log)).toBe(1);
		paidMap("argo").delete(keyOf(i));
	});
	test("the limit reached with the line fine on a pending job: not charged by ArgoLink's rule, the row goes", async () => {
		const i = input("pending");
		const log: string[] = [];
		net(log, () => json({ status: "pending" }));
		process.env.STUDIO_TEST_KIE_LIMIT = "600";
		await expect(runArgo(ENDPOINT, i, { timeoutSeconds: 1 })).rejects.toThrow(/didn't finish/);
		expect(paidMap("argo").has(keyOf(i))).toBe(false);
	});
});
