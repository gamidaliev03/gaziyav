import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 10.11: Sonnet's music clip paid about four video generations twice. Claude's client gave up on a long `generate`
// («Request timed out»), the call went on in Gaziyav and was charged, Claude sent it again and the app ran it again.
// The real connector (mcp/server.mjs) runs against a stand-in app here: the retried call must join the running one.

const SERVER = path.join(import.meta.dir, "..", "..", "..", "mcp", "server.mjs");
let app: ReturnType<typeof Bun.serve>;
let child: ChildProcessWithoutNullStreams;
let support = "";
let posts = 0;
let doneAt = 0;
let jobMs = 1200; // how long the stand-in's «generation» takes
const answers = new Map<number, { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean } }>();

function rpc(msg: Record<string, unknown>) {
	child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
}
async function answer(id: number, ms = 15_000) {
	const t0 = Date.now();
	while (!answers.has(id)) {
		if (Date.now() - t0 > ms) throw new Error(`no answer to ${id}`);
		await Bun.sleep(25);
	}
	return answers.get(id);
}

beforeAll(() => {
	app = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/api/health") return Response.json({ ok: true });
			if (url.pathname === "/api/mcp/status") return Response.json({ connected: true });
			if (url.pathname === "/api/mcp/memo") return Response.json({ text: "" });
			if (url.pathname === "/api/mcp/call") {
				const body = (await req.json().catch(() => ({}))) as { args?: { fail?: string } };
				if (body.args?.fail) return Response.json({ id: "retry" });
				posts++;
				doneAt = Date.now() + jobMs;
				return Response.json({ id: `c${posts}` });
			}
			if (url.pathname === "/api/mcp/result") {
				if (url.searchParams.get("id") === "retry") return Response.json({ done: true, ok: false, content: "fal.ai didn't finish the picture. Press Retry, or pick another model in the Generate panel." });
				await Bun.sleep(50);
				if (Date.now() < doneAt) return Response.json({ done: false, progress: 0.5, stage: "Kling avatar · rendering" });
				return Response.json({ done: true, ok: true, content: `made video ${url.searchParams.get("id")} [rev 2]` });
			}
			return Response.json({ error: "?" }, { status: 404 });
		},
	});
	support = fs.mkdtempSync(path.join(os.tmpdir(), "gz-join-"));
	fs.mkdirSync(path.join(support, "mcp"));
	fs.writeFileSync(path.join(support, "mcp", "token"), "t");
	child = spawn("node", [SERVER], {
		// answers within 3 s here (45 s for Claude): a «generation» longer than that answers «still running»
		env: { ...process.env, GAZIYAV_URL: `http://127.0.0.1:${app.port}`, GAZIYAV_SUPPORT_DIR: support, GAZIYAV_NO_LAUNCH: "1", GAZIYAV_ANSWER_MS: "3000", GAZIYAV_GENERATE_FIRST_MS: "2000" },
	});
	let buf = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		buf += chunk;
		for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
			const line = buf.slice(0, nl);
			buf = buf.slice(nl + 1);
			const msg = JSON.parse(line);
			if (typeof msg.id === "number") answers.set(msg.id, msg);
		}
	});
});

afterAll(() => {
	child?.kill();
	app?.stop(true);
	fs.rmSync(support, { recursive: true, force: true });
});

describe("a call Claude stopped waiting for", () => {
	test("the same call again joins it: one paid run, its result, then a fresh run once that answer was heard", async () => {
		rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
		await answer(1);
		const args = { kind: "video", prompt: "a puppet theatre, slow push in", model: "cheapest" };
		rpc({ id: 2, method: "tools/call", params: { name: "generate", arguments: args } });
		await Bun.sleep(200);
		rpc({ method: "notifications/cancelled", params: { requestId: 2, reason: "Request timed out" } });
		// Claude retries with the arguments in another order (the same call)
		rpc({ id: 3, method: "tools/call", params: { name: "generate", arguments: { model: "cheapest", prompt: args.prompt, kind: "video" } } });
		const third = await answer(3);
		expect(posts).toBe(1);
		expect(third?.result?.content?.[0]?.text).toContain("made video c1");
		expect(third?.result?.content?.[0]?.text).toContain("Nothing was run or charged twice");
		// the answer was heard: asking again is a new request (another take), run anew
		rpc({ id: 4, method: "tools/call", params: { name: "generate", arguments: args } });
		const fourth = await answer(4);
		expect(posts).toBe(2);
		expect(fourth?.result?.content?.[0]?.text).toContain("made video c2");
		expect(fourth?.result?.content?.[0]?.text).not.toContain("charged twice");
	});

	test("finished while nobody listened: the retry gets that answer without running again", async () => {
		const args = { kind: "image", prompt: "the band in a corridor" };
		rpc({ id: 5, method: "tools/call", params: { name: "generate", arguments: args } });
		await Bun.sleep(150);
		rpc({ method: "notifications/cancelled", params: { requestId: 5, reason: "Request timed out" } });
		await answer(5); // the server still finishes it (the client ignores this answer)
		const before = posts;
		rpc({ id: 6, method: "tools/call", params: { name: "generate", arguments: args } });
		const sixth = await answer(6);
		expect(posts).toBe(before);
		expect(sixth?.result?.content?.[0]?.text).toContain(`made video c${before}`);
	});

	test("a step longer than Claude's client waits answers «still running» in time; the same call again collects it (one run)", async () => {
		jobMs = 7000; // a 7 s lipsync, answers due within 3 s
		const args = { kind: "video", mode: "avatar", from: "20e4f07f", sound: "9c9e2398" };
		const before = posts;
		const t0 = Date.now();
		rpc({ id: 7, method: "tools/call", params: { name: "generate", arguments: args } });
		const seventh = await answer(7);
		expect(Date.now() - t0).toBeLessThan(5000);
		expect(seventh?.result?.isError).toBeFalsy();
		expect(seventh?.result?.content?.[0]?.text).toMatch(/^Still running in Gaziyav — Kling avatar · rendering 50%/);
		expect(seventh?.result?.content?.[0]?.text).toContain("send this very same call again");
		// meanwhile another call is not stuck behind it
		rpc({ id: 8, method: "tools/call", params: { name: "price_plan", arguments: { items: [] } } });
		await answer(8);
		// collected: the same job's result, no second run
		let text = "";
		for (let id = 9; id < 14 && !text.includes("made video"); id++) {
			rpc({ id, method: "tools/call", params: { name: "generate", arguments: args } });
			text = (await answer(id))?.result?.content?.[0]?.text ?? "";
		}
		expect(text).toContain(`made video c${before + 1}`);
		expect(posts).toBe(before + 2); // the generation once, the price_plan once
	}, 30_000);

	test("an app error written for its buttons reaches Claude in Claude's words", async () => {
		rpc({ id: 40, method: "tools/call", params: { name: "price_plan", arguments: { fail: "retry" } } });
		const text = (await answer(40))?.result?.content?.[0]?.text ?? "";
		expect(text).toBe("fal.ai didn't finish the picture. send the same call again, or use another model (price_plan {kind, mode} lists them).");
	});

	test("a call that never reaches Gaziyav (closed or locked) says so instead of «still running»", async () => {
		const dead = spawn("node", [SERVER], {
			env: { ...process.env, GAZIYAV_URL: "http://127.0.0.1:9", GAZIYAV_SUPPORT_DIR: support, GAZIYAV_NO_LAUNCH: "1", GAZIYAV_ANSWER_MS: "2000" },
		});
		let buf = "";
		const got = new Promise<string>((resolve) => {
			dead.stdout.setEncoding("utf8");
			dead.stdout.on("data", (chunk: string) => {
				buf += chunk;
				for (const line of buf.split("\n")) {
					if (line.includes('"id":2')) resolve(line);
				}
			});
		});
		dead.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_project", arguments: {} } })}\n`);
		const line = await got;
		dead.kill();
		expect(line).toContain("Gaziyav isn't answering yet");
		expect(line).toContain('"isError":true');
		expect(line).not.toContain("Still running");
	}, 15_000);
});

// 10.11 morning: Claude's app KILLED the connector at every timed-out call (81 times) and started it again, so the join
// above (in the connector's memory) never fired, late paid results were never handed back, Claude probed with sleep/ls/ps
// because nothing said what Gaziyav was busy with, and the owner's Stop didn't stop queued work. Here the app's real
// hub (route.ts + hub.ts) runs behind the real connector, with a stand-in window that takes calls the way bridge.tsx does.
// GZ_BEFORE_ROUTE / GZ_BEFORE_CONNECTOR point at the code as it was, for the red run.
describe("the app keeps Claude's calls (the connector is killed and started again)", () => {
	const ROUTE = process.env.GZ_BEFORE_ROUTE || path.join(import.meta.dir, "..", "..", "app", "api", "mcp", "[...path]", "route.ts");
	const CONNECTOR = process.env.GZ_BEFORE_CONNECTOR || SERVER;
	let real: ReturnType<typeof Bun.serve>;
	let dir = "";
	let windowOn = true;
	const ran: Array<{ tool: string; tag?: string; stopped?: boolean }> = [];

	type Rpc = { send: (m: Record<string, unknown>) => void; answer: (id: number, ms?: number) => Promise<string>; kill: () => void };
	function connector(): Rpc {
		const proc = spawn("node", [CONNECTOR], {
			env: { ...process.env, GAZIYAV_URL: `http://127.0.0.1:${real.port}`, GAZIYAV_SUPPORT_DIR: dir, GAZIYAV_NO_LAUNCH: "1", GAZIYAV_ANSWER_MS: "1500", GAZIYAV_GENERATE_FIRST_MS: "800" },
		});
		const got = new Map<number, string>();
		let buf = "";
		proc.stdout.setEncoding("utf8");
		proc.stdout.on("data", (chunk: string) => {
			buf += chunk;
			for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
				const msg = JSON.parse(buf.slice(0, nl));
				buf = buf.slice(nl + 1);
				if (typeof msg.id === "number") got.set(msg.id, (msg.result?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n") || JSON.stringify(msg.error ?? msg.result));
			}
		});
		const send = (m: Record<string, unknown>) => proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
		send({ id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } } });
		return {
			send,
			answer: async (id, ms = 8000) => {
				const t0 = Date.now();
				while (!got.has(id)) {
					if (Date.now() - t0 > ms) throw new Error(`no answer to ${id}`);
					await Bun.sleep(20);
				}
				return got.get(id) as string;
			},
			kill: () => proc.kill("SIGKILL"),
		};
	}
	const call = (c: Rpc, id: number, name: string, args: Record<string, unknown>) => c.send({ id, method: "tools/call", params: { name, arguments: args } });

	/** The window: takes calls like bridge.tsx (only background ones while a change runs), heartbeats, obeys a cancel. */
	async function windowLoop() {
		const base = `http://127.0.0.1:${real.port}/api/mcp`;
		const H = { "X-Studio": "1", "Content-Type": "application/json" };
		let foreground: Promise<void> | null = null;
		while (windowOn) {
			const res = await fetch(`${base}/next?page=editor&project=p1&lanes=${foreground ? "background" : "all"}&wait=${foreground ? 300 : 1500}`, { headers: H }).catch(() => null);
			if (!res || res.status !== 200) {
				await Bun.sleep(50);
				continue;
			}
			const c = (await res.json()) as { id: string; tool: string; args: Record<string, unknown> };
			const job = (async () => {
				const hold = Number(/hold (\d+)/.exec(String(c.args.prompt ?? ""))?.[1] ?? (c.args.ops as Array<{ hold?: number }> | undefined)?.[0]?.hold ?? 0);
				const tag = String(/tag (\w+)/.exec(String(c.args.prompt ?? ""))?.[1] ?? (c.args.ops as Array<{ tag?: string }> | undefined)?.[0]?.tag ?? "");
				const entry = { tool: c.tool, tag };
				ran.push(entry);
				let stopped = "";
				const t0 = Date.now();
				while (Date.now() - t0 < hold && !stopped) {
					const a = (await (await fetch(`${base}/alive`, { method: "POST", headers: H, body: JSON.stringify({ id: c.id, stage: "fake fal · rendering", progress: (Date.now() - t0) / hold }) })).json()) as { cancel?: string };
					if (a.cancel) stopped = a.cancel;
					await Bun.sleep(100);
				}
				Object.assign(entry, stopped ? { stopped: true } : {});
				const content = stopped ? `Stopped: ${c.tool} (${stopped})` : c.tool === "generate" ? `{"media":"ab12cd34","name":"AI shot.mp4","model":"Fake [fake/v] on fal.ai","costUsd":0.05,"placedAt":2} [rev 3]` : c.tool === "get_project" ? `"Reel" 1080×1920 · tracks … [rev 3]` : `${c.tool} done [rev 3]`;
				await fetch(`${base}/done`, { method: "POST", headers: H, body: JSON.stringify({ id: c.id, ok: !stopped, content, project: { id: "p1", name: "Reel" } }) });
			})();
			if (c.tool !== "generate" && c.tool !== "get_project" && c.tool !== "status") foreground = job.finally(() => (foreground = null));
		}
	}

	beforeAll(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-hub-"));
		process.env.STUDIO_SUPPORT_DIR = dir;
		process.env.GAZIYAV_STALE_READ_MS = "1500";
		const route = (await import(ROUTE)) as { GET: (r: Request, c: unknown) => Promise<Response>; POST: (r: Request, c: unknown) => Promise<Response> };
		real = Bun.serve({
			port: 0,
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/api/health") return Response.json({ ok: true });
				const parts = url.pathname.replace(/^\/api\/mcp\//, "").split("/");
				const ctx = { params: Promise.resolve({ path: parts }) };
				return req.method === "POST" ? route.POST(req, ctx) : route.GET(req, ctx);
			},
		});
		void windowLoop();
	});
	afterAll(() => {
		windowOn = false;
		real?.stop(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("the same call after the connector was killed joins the one running in the app: one paid run, its result", async () => {
		const a = connector();
		const args = { kind: "video", prompt: "hold 2500 tag join Mia sings on the roof" };
		call(a, 1, "generate", args);
		expect(await a.answer(1)).toContain("Still running");
		a.kill(); // Claude's app: «Request timed out» → Closing Gaziyav · Killing utility process
		const b = connector();
		let text = "";
		for (let id = 2; id < 9 && !text.includes("media"); id++) {
			call(b, id, "generate", { prompt: args.prompt, kind: "video" });
			text = await b.answer(id);
		}
		b.kill();
		expect(text).toContain("ab12cd34");
		expect(ran.filter((r) => r.tag === "join").length).toBe(1);
	}, 30_000);

	test("a result that finished while no connector listened comes first in the next answer of any call, once", async () => {
		const a = connector();
		call(a, 1, "generate", { kind: "image", mode: "avatar", start: 145.1, prompt: "hold 1200 tag late the singer" });
		expect(await a.answer(1)).toContain("Still running");
		a.kill();
		await Bun.sleep(1600); // it finishes in the app with nobody there
		const b = connector();
		call(b, 2, "get_project", {});
		const first = await b.answer(2);
		expect(first).toMatch(/^Finished while you weren't listening:\n✓ generate image @145\.1 «[^»]+» → media ab12cd34 placed @2 \(\$0\.05 fal\.ai\)/);
		call(b, 3, "get_project", {});
		expect(await b.answer(3)).not.toContain("Finished while");
		b.kill();
	}, 30_000);

	test("status answers at once while the window is busy with a change; Stop drops a queued call, said in the next answer", async () => {
		const c = connector();
		call(c, 1, "edit", { ops: [{ op: "split", time: 3, hold: 3000, tag: "busy" }] });
		// (a fresh connector on a loaded Mac takes a while to hand its first call over: wait till the window holds the
		// change, not a fixed 300 ms — a status asked before the calls arrived said «Nothing of yours runs now», and the
		// queued edit this test then never stopped ran inside the next test's count)
		for (let i = 0; i < 100 && !ran.some((r) => r.tag === "busy"); i++) await Bun.sleep(50);
		call(c, 2, "edit", { ops: [{ op: "split", time: 5, tag: "queued" }] });
		await Bun.sleep(200);
		let s = "";
		for (let id = 30; id < 36 && !s.includes("waiting its turn"); id++) {
			if (id > 30) await Bun.sleep(150);
			const t0 = Date.now();
			call(c, id, "status", {});
			s = await c.answer(id);
			expect(Date.now() - t0).toBeLessThan(1000); // every status answers at once
		}
		expect(s).toContain("edit (1 step) — fake fal · rendering");
		expect(s).toContain("edit (1 step) — waiting its turn");
		c.send({ method: "notifications/cancelled", params: { requestId: 2, reason: "User cancelled" } });
		// the next answer handed out (the busy edit's «still running») says the stopped one never ran
		expect(await c.answer(1)).toContain("Finished while you weren't listening:\n✗ Not run: edit (1 step) was stopped (the user pressed Stop) before it started; nothing was charged.");
		await Bun.sleep(3500); // the busy one ends; the stopped one must never run
		expect(ran.some((r) => r.tag === "queued")).toBe(false);
		call(c, 4, "get_project", {});
		const next = await c.answer(4);
		expect(next).toContain("✓ edit (1 step) → edit done"); // the busy one finished unheard: handed out here
		expect(next).not.toContain("Not run"); // once
		c.kill();
	}, 30_000);

	test("generate {items}: every shot starts at once, one answer with what finished and what runs; the same call collects the rest", async () => {
		const c = connector();
		await c.answer(0); // (timed from a connector that is up: on a loaded Mac node's own start took over a second)
		const before = ran.length;
		const items = [{ prompt: "hold 200 tag shot1 the band" }, { prompt: "hold 4000 tag shot2 the stage" }, { prompt: "hold 300 tag shot3 the crowd", start: 4 }];
		call(c, 1, "generate", { kind: "video", mode: "image", from: "20e4f07f", items });
		const t0 = Date.now();
		const first = await c.answer(1);
		expect(Date.now() - t0).toBeLessThan(2500);
		expect(first).toContain("3 shot(s): 2 done, 0 failed, 1 still running.");
		expect(first).toMatch(/1 ✓ .*ab12cd34/);
		expect(first).toContain("2 … still running");
		expect(ran.slice(before).map((r) => r.tag).sort()).toEqual(["shot1", "shot2", "shot3"]); // all three started at once
		let text = first;
		for (let id = 2; id < 8 && !text.includes("3 done"); id++) {
			call(c, id, "generate", { kind: "video", mode: "image", from: "20e4f07f", items });
			text = await c.answer(id);
		}
		expect(text).toContain("3 shot(s): 3 done");
		// collected, no shot ran twice (counted by the shots' own tags: a call another test left queued is not a shot)
		expect(ran.slice(before).map((r) => r.tag).filter((t) => /^shot/.test(String(t))).sort()).toEqual(["shot1", "shot2", "shot3"]);
		c.kill();
	}, 30_000);

	test("a running generation is stopped by Stop (the window aborts it); a queued read nobody waits for is dropped", async () => {
		const c = connector();
		call(c, 1, "generate", { kind: "video", prompt: "hold 6000 tag stopme" });
		await c.answer(1); // «still running»
		call(c, 2, "generate", { kind: "video", prompt: "hold 6000 tag stopme" });
		await Bun.sleep(300);
		c.send({ method: "notifications/cancelled", params: { requestId: 2, reason: "AbortError: This operation was aborted" } });
		await Bun.sleep(1500);
		expect(ran.find((r) => r.tag === "stopme")?.stopped).toBe(true);
		// a frame grab (a read that needs the player) queued behind a change, its Claude gone
		call(c, 3, "edit", { ops: [{ op: "split", time: 3, hold: 2500, tag: "busy2" }] });
		await Bun.sleep(200);
		call(c, 4, "look", { at: [1], tag: "stale" });
		await Bun.sleep(100);
		c.kill();
		await Bun.sleep(4000);
		expect(ran.filter((r) => r.tool === "look").length).toBe(0);
	}, 30_000);
});

// 10.11 11:58: the owner quit Gaziyav while a lipsync was queued; after the restart nothing said it never ran.
describe("a restart of Gaziyav", () => {
	test("what was queued or running is reported lost (once), a finished unheard result comes back and is still joined", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-restart-"));
		process.env.STUDIO_SUPPORT_DIR = dir;
		const g = globalThis as { __gaziyavMcpHub?: unknown };
		const HUB = "../server/hub.ts"; // (a fresh module per «life» of the app: ?life=n)
		const keep = g.__gaziyavMcpHub;
		try {
			g.__gaziyavMcpHub = undefined;
			const a = await import(`${HUB}?life=1`);
			const queued = a.submit("generate", { kind: "video", mode: "avatar", start: 96.29 }, "claude-code").id;
			const running = a.submit("generate", { kind: "image", prompt: "the girl in pink pajamas" }, "claude-code").id;
			const doneId = a.submit("generate", { kind: "video", prompt: "the crowd jumps" }, "claude-code").id;
			const taken = await a.take({ page: "editor", projectId: "p1" }, 10);
			expect(taken?.id).toBe(queued);
			await a.take({ page: "editor", projectId: "p1" }, 10);
			await a.take({ page: "editor", projectId: "p1" }, 10);
			a.finish(doneId, { ok: true, content: `{"media":"77aa88bb","costUsd":0.09,"model":"Seedance [x] on fal.ai","placedAt":12}` });
			// …and the app quits. The next life of the hub reads the journal.
			g.__gaziyavMcpHub = undefined;
			const b = await import(`${HUB}?life=2`);
			void running;
			// the same paid call again after the restart gets the finished one, not a second run
			expect(b.submit("generate", { prompt: "the crowd jumps", kind: "video" }, "claude-code")).toEqual({ id: doneId, joined: true });
			// a call cut by the restart is never joined: sent again, it runs anew
			expect(b.submit("generate", { kind: "image", prompt: "the girl in pink pajamas" }, "claude-code").joined).toBe(false);
			const lines = b.unheard("claude-code", "", true).map((u: { line: string }) => u.line).join("\n");
			expect(lines).toMatch(/✗ generate avatar @96\.29: cut by the \d\d:\d\d restart of Gaziyav while it ran/);
			expect(lines).toMatch(/✗ generate image «the girl in pink…»: cut by the \d\d:\d\d restart/);
			expect(lines).toContain("✓ generate video «the crowd jumps» → media 77aa88bb placed @12 ($0.09 fal.ai)");
			expect(b.unheard("claude-code")).toEqual([]); // handed out once
			// a queued call that never started: «not started, nothing charged»
			g.__gaziyavMcpHub = undefined;
			const c = await import(`${HUB}?life=3`);
			c.submit("edit", { ops: [{ op: "split", time: 3 }] }, "claude-code");
			g.__gaziyavMcpHub = undefined;
			const d = await import(`${HUB}?life=4`);
			expect(d.unheard("claude-code").map((u: { line: string }) => u.line)).toContainEqual(expect.stringMatching(/^✗ edit \(1 step\): lost in the \d\d:\d\d restart of Gaziyav, not started, nothing charged\. Send it again\.$/));
		} finally {
			g.__gaziyavMcpHub = keep;
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
