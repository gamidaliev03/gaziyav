// «Claude at work», the app's side: Pause, Continue and Stop as Claude's connector meets them — through the real hub
// (mcp/server/hub.ts) and the window's own route, with a folder of the test's own for the hub's files.
import { beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-agentview-"));
let hub: typeof import("@/mcp/server/hub");
let state: typeof import("../server/state");
let route: typeof import("@/app/api/agentview/route");

beforeAll(async () => {
	process.env.STUDIO_SUPPORT_DIR = dir;
	process.env.STUDIO_DATA_DIR = path.join(dir, "Studio");
	hub = await import("@/mcp/server/hub");
	state = await import("../server/state");
	route = await import("@/app/api/agentview/route");
	state.setPaused(false);
});

const WINDOW = { host: "127.0.0.1:3881", "x-studio": "1", "content-type": "application/json" };
const post = async (body: unknown, headers: Record<string, string> = WINDOW) => {
	const res = await route.POST(new Request("http://127.0.0.1:3881/api/agentview", { method: "POST", headers, body: JSON.stringify(body) }));
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const get = async (headers: Record<string, string> = WINDOW) => {
	const res = await route.GET(new Request("http://127.0.0.1:3881/api/agentview", { headers }));
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const EDIT = { ops: [{ op: "split", time: 3 }] };
const window_ = { page: "editor" as const, projectId: "p1" };

describe("pause", () => {
	test("only the app's own window may press the buttons", async () => {
		expect((await get({ host: "127.0.0.1:3881" })).status).toBe(403);
		expect((await post({ pause: true }, { host: "evil.example", "x-studio": "1" })).status).toBe(403);
		expect((await post({ pause: true }, { ...WINDOW, origin: "http://evil.example" })).status).toBe(403);
		expect(state.agentPaused()).toBe(false);
	});

	test("not paused: a change is queued for the window as before; status says not paused", async () => {
		const a = hub.submit("edit", EDIT, "claude-a");
		expect(a.joined).toBe(false);
		expect(await hub.result(a.id, 30)).toBeNull();
		expect(hub.status("claude-a", true)).toMatchObject({ paused: "" });
		// Pause: what waits in the queue and would change the project is answered now, honestly
		const view = await post({ pause: true });
		expect(view.body).toMatchObject({ paused: true, by: "pause" });
		const r = await hub.result(a.id, 30);
		expect(r?.ok).toBe(false);
		expect(r?.content).toMatch(/^Not run: edit \(1 step\) was stopped \(the user paused editing in Gaziyav: wait for them and send the same call again when they say to continue\) before it started; nothing was charged\.$/);
		// …and that answer is never joined: the same call again is a new one (here, while paused: the pause answer)
		const again = hub.submit("edit", EDIT, "claude-a");
		expect(again.id).not.toBe(a.id);
		expect((await hub.result(again.id, 30))?.content).toBe(state.PAUSED_ANSWER);
	});

	test("paused: a change gets the answer at once and never reaches the window; a read still goes through", async () => {
		const t0 = Date.now();
		const b = hub.submit("place", { item: "music:calm-04", at: 0 }, "claude-a");
		const r = await hub.result(b.id, 1000);
		expect(Date.now() - t0).toBeLessThan(200);
		expect(r).toEqual({
			ok: false,
			content:
				"The user paused editing in Gaziyav. This call was not run: nothing was changed and nothing was charged. Calls that only read or look still work (get_project, look, analyze, find_content, price_plan, status). Don't retry in a loop: tell the user in one line that you are waiting for them, and send this same call again when they say to continue.",
		});
		expect(hub.status("claude-a", true)).toMatchObject({ running: [] });
		// what the status tool prints: the state, what was not run, what to do
		expect((hub.status("claude-a", true) as { paused: string }).paused).toMatch(
			/^Editing is paused: the user pressed Pause in Gaziyav at \d\d:\d\d\. Your calls that change the project are not run until they press Continue there; calls that only read or look still work\. Not run so far: edit \(1 step\), place music:calm-04 @0\. Don't retry in a loop: tell the user you are waiting, and send the held call again when they say to continue\.$/,
		);
		// nothing of it is left to hand out later («Finished while you weren't listening»)
		expect(hub.unheard("claude-a")).toEqual(hub.unheard("claude-a").filter((u) => !/paused editing/.test(u.line)));
		for (const [tool, args] of [["export", { platform: "reels" }], ["generate", { kind: "image", prompt: "x" }], ["undo", {}], ["post", { confirm: true }], ["project", { action: "open", id: "p2" }]] as Array<[string, Record<string, unknown>]>) {
			const held = await hub.result(hub.submit(tool, args, "claude-a").id, 200);
			expect([tool, held?.content]).toEqual([tool, state.PAUSED_ANSWER]);
		}
		const read = hub.submit("get_project", {}, "claude-a");
		expect(await hub.result(read.id, 30)).toBeNull();
		const taken = await hub.take(window_, 50);
		expect(taken?.tool).toBe("get_project");
		hub.finish(read.id, { ok: true, content: "Project «A» … [rev 3]" });
		expect((await hub.result(read.id, 30))?.ok).toBe(true);
		for (const [tool, args] of [["look", { what: "frames" }], ["sounds_like", { query: "applause" }], ["price_plan", {}], ["generate", { kind: "video", quote: true }]] as Array<[string, Record<string, unknown>]>) {
			const id = hub.submit(tool, args, "claude-a").id;
			expect([tool, await hub.result(id, 20)]).toEqual([tool, null]);
			hub.finish(id, { ok: true, content: "ok" });
		}
	});

	test("the window hears what Claude is waiting to do", async () => {
		const view = (await get()).body as { paused: boolean; held: Array<{ tool: string; args: Record<string, unknown> }> };
		expect(view.paused).toBe(true);
		expect(view.held.map((h) => h.tool)).toEqual(["place", "export", "generate", "undo", "post", "project"].slice(-5));
		expect(view.held[view.held.length - 1].args).toEqual({ action: "open", id: "p2" });
	});

	test("Continue: the same call sent again is a new one and reaches the window", async () => {
		expect((await post({ pause: false })).body).toMatchObject({ paused: false, by: null, held: [] });
		const again = hub.submit("place", { item: "music:calm-04", at: 0 }, "claude-a");
		expect(again.joined).toBe(false);
		expect(await hub.result(again.id, 30)).toBeNull();
		const taken = await hub.take(window_, 50);
		expect(taken?.id).toBe(again.id);
		hub.finish(again.id, { ok: true, content: "Placed music [rev 4]" });
		expect(hub.status("claude-a", true)).toMatchObject({ paused: "" });
	});
});

describe("stop", () => {
	test("cancels what runs and what waits, of every Claude, through the hub's own cancel — and pauses", async () => {
		const running = hub.submit("export", { platform: "youtube" }, "claude-a");
		const takenCall = await hub.take(window_, 50, undefined, "all");
		expect(takenCall?.id).toBe(running.id);
		const waiting = hub.submit("edit", { ops: [{ op: "trim", id: "clip 2", end: 4 }] }, "claude-b");
		const r = await post({ stop: true });
		expect(r.body).toMatchObject({ paused: true, by: "stop" });
		expect((r.body.stopped as Array<{ id: string; tool: string; running: boolean }>).sort((x, y) => Number(y.running) - Number(x.running))).toEqual([
			{ id: running.id, tool: "export", running: true },
			{ id: waiting.id, tool: "edit", running: false },
		]);
		// the one waiting never runs; the one running is told to stop at the window's next sign of life
		expect((await hub.result(waiting.id, 30))?.content).toMatch(/^Not run: edit \(1 step\) was stopped \(the user pressed Stop in Gaziyav\) before it started; nothing was charged\.$/);
		expect(hub.alive(running.id, {})).toEqual({ cancel: "the user pressed Stop in Gaziyav" });
		hub.finish(running.id, { ok: false, content: "Stopped: export youtube (the user pressed Stop in Gaziyav) after 4 s. What it changed before it stopped stays (undo takes it back)." });
		// and the next change waits for the person
		expect((await hub.result(hub.submit("edit", EDIT, "claude-a").id, 200))?.content).toBe(state.pausedAnswer("stop"));
		expect(state.pausedAnswer("stop")).toStartWith("The user pressed Stop in Gaziyav: editing is paused. This call was not run: nothing was changed and nothing was charged.");
		expect((hub.status("claude-b", true) as { paused: string }).paused).toStartWith("Editing is paused: the user pressed Stop in Gaziyav at ");
		await post({ pause: false });
	});

	test("nothing is paused after a restart of the app (the state lives in its memory only)", () => {
		expect(fs.existsSync(path.join(dir, "mcp", "agentview.json"))).toBe(false);
		expect(JSON.parse(fs.readFileSync(path.join(dir, "mcp", "calls.json"), "utf8")).filter((c: { result?: { content?: string } }) => /paused editing/.test(c.result?.content ?? ""))).toEqual([]);
	});
});
