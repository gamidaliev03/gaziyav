// A paid fal.ai job is never paid twice (review of stage 9, items 2 and 18): the time limit reached while the line is down
// keeps the row (a cancel would not reach fal either), so Retry follows the same request; with the line fine the limit
// still cancels the job and lets the row go; cancel() with the key removed is quiet. The network is a fetch stand-in.
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fal-paid-"));
process.env.LIPSYNC_HOME = dir;
// the key as the app hands it to the server (the slot main.js fills), whatever STUDIO_TEST was when fal/server.ts loaded
(globalThis as Record<string, unknown>).__gaziyavFalKey = "fake-fal-key-for-the-test";

const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const dropped = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
const QUEUE = "https://queue.fal.run";
const ENDPOINT = "fal-ai/flux/schnell";
const count = (log: string[], re: RegExp) => log.filter((l) => re.test(l)).length;

/** The queue API as fal has it: submit → status → result, cancel; `status` is asked on every poll. */
function net(log: string[], status: () => Response | Promise<Response>) {
	let n = 0;
	// (always a promise, as fetch is: cancel() chains .then on it)
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const u = new URL(url);
		log.push(`${init?.method ?? "GET"} ${u.pathname}`);
		if (init?.method === "POST") {
			const at = `${QUEUE}/${ENDPOINT}/requests/req-${++n}`;
			return json({ request_id: `req-${n}`, response_url: at, status_url: `${at}/status`, cancel_url: `${at}/cancel` });
		}
		if (u.pathname.endsWith("/cancel")) return json({ status: "CANCELLATION_REQUESTED" }, 202);
		if (u.pathname.endsWith("/status")) return status();
		return json({ images: [{ url: "https://v3.fal.media/files/picture.png" }] });
	}) as unknown as typeof fetch;
}

let runFal: typeof import("../server").runFal;
let cancel: typeof import("../server").cancel;
let paidMap: typeof import("@/ai/paid-jobs").paidMap;
beforeAll(async () => {
	({ runFal, cancel } = await import("../server"));
	({ paidMap } = await import("@/ai/paid-jobs"));
});
afterEach(() => {
	globalThis.fetch = realFetch;
});
afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
	// (the key slot is this file's alone: the «no API keys» test runs in the same process)
	delete (globalThis as Record<string, unknown>).__gaziyavFalKey;
	delete process.env.STUDIO_TEST_FAL_LIMIT;
	for (const [k, v] of Object.entries(ENV_BEFORE)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

const input = (name: string) => ({ prompt: `paid-run ${name} ${crypto.randomUUID()}`, image_size: "square" });
const keyOf = (i: Record<string, unknown>) => crypto.createHash("sha1").update(`${ENDPOINT}\n${JSON.stringify(i)}`).digest("hex");

describe("fal.ai: the time limit on a paid job", () => {
	test("reached while the line is down: no cancel is sent, the row stays, the error is the line's, Retry follows the same request", async () => {
		const i = input("dead line");
		const log: string[] = [];
		net(log, () => Promise.reject(dropped()));
		process.env.STUDIO_TEST_FAL_LIMIT = "1200";
		await expect(runFal(ENDPOINT, i, { timeoutSeconds: 1 })).rejects.toThrow(/couldn't connect|connection/i);
		expect(count(log, /\/cancel$/)).toBe(0);
		const row = paidMap<{ at: number; req: { requestId: string }; following?: boolean }>("fal").get(keyOf(i));
		expect(row?.req.requestId).toBe("req-1");
		expect(row?.following).toBe(false);
		net(log, () => json({ status: "COMPLETED" }));
		const r = await runFal<{ images: { url: string }[] }>(ENDPOINT, i, { timeoutSeconds: 1 });
		expect(r.images[0].url).toContain("picture.png");
		expect(count(log, /^POST/)).toBe(1);
		paidMap("fal").delete(keyOf(i));
	});
	test("reached with the line fine: the job is cancelled on fal and the row goes (Generate again is a new take)", async () => {
		const i = input("slow");
		const log: string[] = [];
		net(log, () => json({ status: "IN_PROGRESS" }));
		process.env.STUDIO_TEST_FAL_LIMIT = "600";
		await expect(runFal(ENDPOINT, i, { timeoutSeconds: 1 })).rejects.toThrow(/didn't finish/);
		await new Promise((r) => setTimeout(r, 50));
		expect(count(log, /\/cancel$/)).toBe(1);
		expect(paidMap("fal").has(keyOf(i))).toBe(false);
	});
});

describe("fal.ai: cancel() after the key was removed in Settings", () => {
	test("does nothing and does not reject (it used to be an unhandled rejection in the server)", async () => {
		(globalThis as Record<string, unknown>).__gaziyavFalKey = null;
		const log: string[] = [];
		net(log, () => json({ status: "IN_PROGRESS" }));
		try {
			await expect(cancel({ endpoint: ENDPOINT, requestId: "req-x", statusUrl: `${QUEUE}/x/status`, responseUrl: `${QUEUE}/x`, cancelUrl: `${QUEUE}/x/cancel` })).resolves.toBeUndefined();
			expect(count(log, /\/cancel$/)).toBe(0);
		} finally {
			(globalThis as Record<string, unknown>).__gaziyavFalKey = "fake-fal-key-for-the-test";
		}
	});
});
