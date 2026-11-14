// A paid kie.ai task is never paid twice (review of stage 9, items 2–4): a 502/504 on createTask is not a second task; the
// 30-minute limit reached on a dead line, Stop, and a task still running at the limit all keep the row, so the next
// Generate follows the same task instead of creating another. The network is a fetch stand-in; nothing leaves the Mac.
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kie-paid-"));
process.env.LIPSYNC_HOME = dir;
(globalThis as Record<string, unknown>).__gaziyavKieKey = "fake-kie-key-for-the-test";

type Fake = (url: string, init?: RequestInit) => Promise<Response> | Response;
const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const dropped = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
const posts = (log: string[]) => log.filter((l) => l.startsWith("POST")).length;

/** The stand-in: `create` answers createTask, `poll` answers recordInfo; every request is logged as «METHOD path». */
function net(log: string[], o: { create?: () => Response | Promise<Response>; poll: () => Response | Promise<Response> }) {
	const fake: Fake = async (url, init) => {
		const u = new URL(url);
		log.push(`${init?.method ?? "GET"} ${u.pathname}`);
		if (u.pathname.endsWith("/createTask")) return (o.create ?? (() => json({ code: 200, data: { taskId: `task_${posts(log)}` } })))();
		if (u.pathname.endsWith("/recordInfo")) return o.poll();
		return json({ code: 404, msg: "no such path" });
	};
	globalThis.fetch = fake as unknown as typeof fetch;
}
const success = () => json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://files.kie.test/picture.png"] }) } });
const generating = () => json({ code: 200, data: { state: "generating" } });

let runKie: typeof import("../server").runKie;
let paidMap: typeof import("@/ai/paid-jobs").paidMap;
beforeAll(async () => {
	({ runKie } = await import("../server"));
	({ paidMap } = await import("@/ai/paid-jobs"));
});
afterEach(() => {
	globalThis.fetch = realFetch;
});
afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
	// (the key slot is this file's alone: the «no API keys» test runs in the same process)
	delete (globalThis as Record<string, unknown>).__gaziyavKieKey;
	delete process.env.STUDIO_TEST_KIE_LIMIT;
	for (const [k, v] of Object.entries(ENV_BEFORE)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

const input = (name: string) => ({ prompt: `paid-run ${name} ${crypto.randomUUID()}`, image_size: "1:1" });
const keyOf = (model: string, i: Record<string, unknown>) => crypto.createHash("sha1").update(`${model}\n${JSON.stringify(i)}`).digest("hex");
const MODEL = "google/nano-banana";

describe("kie.ai: createTask is repeated only when nothing could have been created", () => {
	test("a 502 from the gateway after the task may exist: an error with Retry, one createTask, not two", async () => {
		const log: string[] = [];
		net(log, { create: () => json({ detail: "bad gateway" }, 502), poll: success });
		await expect(runKie(MODEL, input("502"))).rejects.toThrow(/HTTP 502|failed on its side/);
		expect(posts(log)).toBe(1);
	});
	test("a 503 and a connection that never opened are repeated (kie surely did nothing)", async () => {
		const log: string[] = [];
		let n = 0;
		net(log, { create: () => (++n === 1 ? json({ detail: "busy" }, 503) : json({ code: 200, data: { taskId: "task_503" } })), poll: success });
		expect((await runKie(MODEL, input("503"))).urls.length).toBe(1);
		expect(posts(log)).toBe(2);
		const log2: string[] = [];
		let m = 0;
		net(log2, { create: () => (++m === 1 ? Promise.reject(refused()) : json({ code: 200, data: { taskId: "task_refused" } })), poll: success });
		expect((await runKie(MODEL, input("refused"))).urls.length).toBe(1);
		expect(posts(log2)).toBe(2);
	});
});

describe("kie.ai: a task that may still bill is kept, and the next Generate comes back to it", () => {
	test("the time limit reached while the line is down: the row stays, the error is the line's, Retry follows the same task", async () => {
		const i = input("dead line");
		const key = keyOf(MODEL, i);
		const log: string[] = [];
		net(log, { poll: () => Promise.reject(dropped()) });
		process.env.STUDIO_TEST_KIE_LIMIT = "1200";
		await expect(runKie(MODEL, i, { timeoutSeconds: 1 })).rejects.toThrow(/couldn't connect|connection/i);
		const row = paidMap<{ at: number; taskId: string; following?: boolean }>("kie").get(key);
		expect(row?.taskId).toBe("task_1");
		expect(row?.following).toBe(false);
		// the line is back: the same request follows task_1 — no second createTask
		net(log, { poll: success });
		const r = await runKie(MODEL, i, { timeoutSeconds: 1 });
		expect(r.urls).toEqual(["https://files.kie.test/picture.png"]);
		expect(posts(log)).toBe(1);
		paidMap("kie").delete(key);
	});
	test("Stop: kie can't cancel, so the row stays and the same Generate within 3 h returns that task's result", async () => {
		const i = input("stop");
		const key = keyOf(MODEL, i);
		const log: string[] = [];
		const abort = new AbortController();
		net(log, {
			poll: () => {
				setTimeout(() => abort.abort(), 20);
				return generating();
			},
		});
		await expect(runKie(MODEL, i, { signal: abort.signal, timeoutSeconds: 5 })).rejects.toThrow("Cancelled");
		expect(paidMap("kie").get(key)?.following).toBe(false);
		net(log, { poll: success });
		expect((await runKie(MODEL, i, { timeoutSeconds: 5 })).urls.length).toBe(1);
		expect(posts(log)).toBe(1);
		paidMap("kie").delete(key);
	});
	test("a task still running at the limit: it may finish and bill, so the row stays and Retry keeps waiting for it", async () => {
		const i = input("running");
		const key = keyOf(MODEL, i);
		const log: string[] = [];
		net(log, { poll: generating });
		process.env.STUDIO_TEST_KIE_LIMIT = "700";
		await expect(runKie(MODEL, i, { timeoutSeconds: 1 })).rejects.toThrow(/didn't finish[\s\S]*keep waiting/);
		expect(paidMap("kie").get(key)?.following).toBe(false);
		net(log, { poll: success });
		expect((await runKie(MODEL, i, { timeoutSeconds: 1 })).urls.length).toBe(1);
		expect(posts(log)).toBe(1);
		paidMap("kie").delete(key);
	});
	test("a task that never left the queue is let go: nothing was charged, the next press is a new task", async () => {
		const i = input("queued");
		const key = keyOf(MODEL, i);
		const log: string[] = [];
		net(log, { poll: () => json({ code: 200, data: { state: "waiting" } }) });
		process.env.STUDIO_TEST_KIE_LIMIT = "700";
		await expect(runKie(MODEL, i, { timeoutSeconds: 1 })).rejects.toThrow(/never started/);
		expect(paidMap("kie").has(key)).toBe(false);
		net(log, { poll: success });
		await runKie(MODEL, i, { timeoutSeconds: 1 });
		expect(posts(log)).toBe(2);
		paidMap("kie").delete(key);
	});
});
