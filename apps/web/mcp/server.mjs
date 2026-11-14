// Gaziyav's MCP server for Claude (stdio, JSON-RPC 2.0, no dependencies). Claude Desktop / Claude Code start it;
// it starts Gaziyav when it is closed and hands every tool call to the open window, which runs it with the same
// tools as Gaziyav AI. Talks to 127.0.0.1 only, with the token from Gaziyav's folder. Logs go to stderr.
// A long call reports progress (notifications/progress) while it runs; a call cut by a restart of Gaziyav says so.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPPORT = process.env.GAZIYAV_SUPPORT_DIR || path.join(os.homedir(), "Library", "Application Support", "Gaziyav");
const DEFAULT_URL = process.env.GAZIYAV_URL || "http://127.0.0.1:47831";
/** Where the app said it listens (its folder's mcp/url, written at start): a test profile's app listens elsewhere. */
function noted() {
	if (process.env.GAZIYAV_URL) return "";
	try {
		const u = fs.readFileSync(path.join(SUPPORT, "mcp", "url"), "utf8").trim();
		return /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(u) ? u : "";
	} catch {
		return "";
	}
}
let BASE = noted() || DEFAULT_URL;
// Resources/mcp/server.mjs → the app bundle; a development copy falls back to the installed app.
const BUNDLE = process.env.GAZIYAV_APP || (/\.app\/Contents\/Resources\/mcp$/.test(HERE) ? path.resolve(HERE, "../../..") : "/Applications/Gaziyav.app");
const SKILL_DIR = path.join(HERE, "skill", "gaziyav-editing");
const VERSION = "2.0";
const TOOL_TIMEOUT_MS = 45 * 60_000;
// Claude Code's client gives up on a call after about 60 s: every call answers within this, done or «still running».
const ANSWER_MS = Number(process.env.GAZIYAV_ANSWER_MS) || 45_000;
// A generation's first answer comes sooner: a quick picture is back by then; a longer job answers «started» and lands
// by itself, so ten shots start in a couple of minutes instead of holding Claude 45 s each (Claude Code runs calls
// that change things one at a time).
const GENERATE_FIRST_MS = Number(process.env.GAZIYAV_GENERATE_FIRST_MS) || 15_000;
// Tools that only read: marked so Claude Code may run them beside each other.
const READ_TOOLS = new Set(["get_project", "look", "price_plan", "find_content", "sounds_like", "editing_guide", "status"]);
const STILL = Symbol("still running");
/** Which Claude app this is (initialize's clientInfo): the app keeps each one's calls and late results apart. */
let CLIENT = "claude";

const log = (...a) => process.stderr.write(`[gaziyav-mcp] ${a.join(" ")}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── Gaziyav ─────────────────────────

function token() {
	try {
		return fs.readFileSync(path.join(SUPPORT, "mcp", "token"), "utf8").trim();
	} catch {
		return "";
	}
}

class Gone extends Error {}
const API_TIMEOUT_MS = Number(process.env.GAZIYAV_API_TIMEOUT_MS) || 30_000;

async function api(route, init = {}) {
	for (let attempt = 0; attempt < 2; attempt++) {
		let res;
		try {
			// Never wait for ever: a stopped app (a sleeping Mac, SIGSTOP) or a server killed mid-answer leaves a socket that
			// never answers; a long poll gets its own wait plus a margin.
			const wait = Number(/[?&]wait=(\d+)/.exec(route)?.[1] ?? 0);
			res = await fetch(`${BASE}/api/mcp/${route}`, {
				...init,
				signal: AbortSignal.timeout(wait + API_TIMEOUT_MS),
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}`, ...(init.headers || {}) },
			});
		} catch {
			throw new Gone("Gaziyav isn't answering.");
		}
		// The first request makes the app write its token; read it again and retry once.
		if (res.status === 403 && attempt === 0) continue;
		const body = await res.json().catch(() => ({}));
		if (res.status === 404 && body.error === "Unknown call") throw new Gone("unknown call");
		if (!res.ok) throw new Error(body.error || `Gaziyav answered ${res.status}`);
		return body;
	}
	throw new Error("Gaziyav refused the connection (token). Quit and open Gaziyav, then call again.");
}

const post = (route, body) => api(route, { method: "POST", body: JSON.stringify({ client: CLIENT, ...body }) });

async function up() {
	try {
		const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
		if (res.status < 500) return true;
	} catch {}
	// (the app may have started again on the address it noted)
	const now = noted() || DEFAULT_URL;
	if (now !== BASE) {
		BASE = now;
		return up();
	}
	return false;
}

let launching = null;

/** Gaziyav running with a window that takes calls; started when it is closed. */
async function ensureApp() {
	if (await windowReady()) return;
	if (!launching) {
		launching = (async () => {
			if (!(await up())) {
				if (process.env.GAZIYAV_NO_LAUNCH === "1") {
					// (tests: the app is started by the test; wait for it to come back after a restart)
					for (let i = 0; i < 120 && !(await up()); i++) await sleep(500);
					if (!(await up())) throw new Error("Gaziyav isn't running. Open Gaziyav and call again.");
				} else {
					if (!fs.existsSync(BUNDLE)) throw new Error(`Gaziyav isn't installed at ${BUNDLE}. Tell the user to install it, then call again.`);
					log("starting", BUNDLE);
					// -g: in the background, so Gaziyav never takes the focus from what the user is doing.
					spawn("/usr/bin/open", ["-g", BUNDLE], { stdio: "ignore", detached: true }).unref();
				}
			}
			for (let i = 0; i < 240; i++) {
				if (await windowReady()) return;
				await sleep(500);
			}
			throw new Error("Gaziyav started but its window didn't connect (it may be locked: the user unlocks it). Call again in a minute.");
		})().finally(() => {
			launching = null;
		});
	}
	return launching;
}

async function windowReady() {
	if (!(await up())) return false;
	try {
		return (await api("status")).connected === true;
	} catch {
		return false;
	}
}

function cachedTools() {
	try {
		return JSON.parse(fs.readFileSync(path.join(SUPPORT, "mcp", "tools.json"), "utf8"));
	} catch {
		return null;
	}
}

/** A schema every Claude client takes: an object at the top, every array with its items, nothing unknown. */
function cleanSchema(s) {
	if (!s || typeof s !== "object") return { type: "object", properties: {} };
	const out = { ...s };
	if (out.type === "array" && !out.items) out.items = { type: "string" };
	if (out.properties) out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, cleanSchema(v)]));
	if (out.items) out.items = cleanSchema(out.items);
	if (Array.isArray(out.required)) {
		out.required = out.required.filter((k) => out.properties && k in out.properties);
		if (!out.required.length) delete out.required;
	}
	return out;
}

const GUIDE_TOOL = {
	name: "editing_guide",
	description: "Gaziyav's playbook for Claude: the loop, defaults per platform, and the details by topic (workflows, sound, motion, captions, color, export, post, ai, budget). Read it before the first edit of a chat; topic for one part.",
	inputSchema: { type: "object", properties: { topic: { type: "string", enum: ["start", "workflows", "sound", "motion", "captions", "color", "export", "post", "ai", "budget", "tools"], description: "Default start" } } },
	annotations: { title: "Editing guide", readOnlyHint: true },
};

async function toolList() {
	let list = null;
	if (await up()) list = (await api("tools").catch(() => ({}))).tools ?? null;
	// Claude asks for the list when it starts: don't open Gaziyav for that unless there is no list at all yet.
	if (!list) list = cachedTools();
	if (!list) {
		await ensureApp();
		for (let i = 0; i < 40 && !list; i++) {
			list = (await api("tools").catch(() => ({}))).tools ?? null;
			if (!list) await sleep(500);
		}
	}
	// (input examples ride in the schema's own `examples`: Claude reads them as part of the tool)
	const tools = (list ?? []).map((t) => ({ name: t.name, description: t.description, ...(READ_TOOLS.has(t.name) ? { annotations: { readOnlyHint: true } } : {}), inputSchema: { ...cleanSchema(t.parameters), ...(Array.isArray(t.examples) ? { examples: t.examples } : {}) }, ...(t.annotations ? { annotations: t.annotations } : {}) }));
	tools.push(GUIDE_TOOL, STATUS_TOOL);
	return tools;
}

function image(src) {
	const m = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(src);
	return m ? { type: "image", mimeType: m[1], data: m[2] } : { type: "image", mimeType: "image/jpeg", data: src };
}

/** What Claude should do next when a call fails for a reason it can act on (the app's texts are written for its buttons). */
function hint(text) {
	if (/No project is open/i.test(text)) return "";
	if (/No element|No clip|No media|Unknown parameter|No track/i.test(text) && !/get_project/.test(text)) return " (get_project lists the current ids.)";
	if (/key|Settings → AI/i.test(text) && /fal|kie|Argo/i.test(text)) return " (The user adds the key in Gaziyav → Settings → AI; meanwhile use free sources.)";
	return "";
}
const forClaude = (text) =>
	String(text)
		.replace(/[Pp]ress Retry|[Tt]ry again with Retry|[Cc]lick Retry/g, "send the same call again")
		.replace(/[Pp]ick another model( in [^.;)]+)?/g, "use another model (price_plan {kind, mode} lists them)");

async function callTool(name, args, entry = {}) {
	if (name === "editing_guide") return { content: [{ type: "text", text: guide(args?.topic) }] };
	await ensureApp();
	const { id, joined } = await post("call", { tool: name, args: args ?? {} });
	entry.hubId = id;
	entry.joined = joined === true;
	entry.submitted = true;
	const until = Date.now() + TOOL_TIMEOUT_MS;
	let lost = 0;
	while (Date.now() < until) {
		let r;
		try {
			// listen=0: nobody waits for it now (Claude got «still running»): the app may hand its result out with another answer.
			// A listened poll ends when Claude's answer is due, so a result landing later is never «being delivered» to nobody.
			const listening = entry.listeners > 0 && Date.now() < (entry.answerBy ?? 0);
			const wait = listening ? Math.max(300, Math.min(20_000, entry.answerBy - Date.now() - 150)) : 20_000;
			r = await api(`result?id=${id}&wait=${Math.round(wait)}&listen=${listening ? 1 : 0}`);
			lost = 0;
		} catch (error) {
			if (!(error instanceof Gone)) throw error;
			// Gaziyav restarted (an update, a crash) or the window reloaded while this ran: say so plainly.
			if (error.message === "unknown call") return { content: [{ type: "text", text: "Gaziyav restarted while this ran: the step may not have finished. Call get_project to see the project as it is, then do the step again if it's missing." }], isError: true };
			if (++lost > 60) return { content: [{ type: "text", text: "Gaziyav stopped answering while this ran. Open Gaziyav, then call get_project and do the step again if it's missing." }], isError: true };
			await sleep(2000);
			continue;
		}
		if (r.done) {
			// fetched for a Claude that isn't waiting any more: the app lists it with the next answer at once
			if (!(entry.listeners > 0) || Date.now() >= (entry.answerBy ?? 0)) post("heard", { undelivered: [id] }).catch(() => {});
			const raw = r.content || (r.ok ? "Done." : "Failed.");
			const text = r.ok === false ? `${forClaude(raw)}${hint(raw)}` : forClaude(raw);
			return { content: [{ type: "text", text }, ...(r.images ?? []).map(image)], isError: r.ok === false };
		}
		entry.queued = r.queued === true;
		if (typeof r.progress === "number") entry.progress = r.progress;
		if (typeof r.stage === "string") entry.stage = r.stage;
	}
	return { content: [{ type: "text", text: "Still working after 45 minutes; it goes on in Gaziyav. Call status later to see the result." }], isError: true };
}

// ───────────────────────── a retried call joins the one still running ─────────────────────────
// Claude's client gives up on a long call (a video generation, a lipsync, an export) after its own timeout and says
// «Request timed out», but the call goes on in Gaziyav, paid. Claude then sends the same call again: it joins the one
// already running (or gets its answer if it finished meanwhile) instead of running — and charging — it twice. The app
// does the join itself (it outlives this process, which Claude's app kills at every timeout); this map is the second
// layer, for a retry inside one life of this process.

const JOIN_MS = 30 * 60_000;
const calls = new Map(); // tool + arguments → { promise, settledAt, unheard, startedAt, progress, stage, queued, hubId, listeners }
const byRequest = new Map(); // JSON-RPC id → that key
const gaveUp = new Set(); // JSON-RPC ids the client stopped waiting for

function stable(v) {
	if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
	if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
	return JSON.stringify(v ?? null);
}

/** One call's entry: the one running (or finished unheard) for the same tool + arguments, else a new run. */
function entryFor(name, args) {
	const key = `${name}\u0000${stable(args ?? {})}`;
	const now = Date.now();
	for (const [k, c] of calls) if (c.settledAt && now - c.settledAt > JOIN_MS) calls.delete(k);
	const known = calls.get(key);
	// Running, or finished while nobody was listening (an earlier try got «still running» or gave up): hand that one over.
	if (known && (!known.settledAt || known.unheard)) return { entry: known, joined: true };
	const fresh = { promise: null, settledAt: 0, unheard: false, startedAt: now, listeners: 0 };
	fresh.promise = callTool(name, args, fresh)
		.catch((error) => ({ content: [{ type: "text", text: `Error: ${error.message || error}` }], isError: true }))
		.finally(() => {
			fresh.settledAt = Date.now();
		});
	calls.set(key, fresh);
	return { entry: fresh, joined: false };
}

/** The lines Claude hasn't heard yet (finished, failed or lost calls) and what runs now; claimed: they go out with this answer. */
async function pending(except = "") {
	try {
		if (!(await up())) return { unheard: [], busy: "" };
		return await post("claim", { except });
	} catch {
		return { unheard: [], busy: "" };
	}
}

/** An answer as Claude gets it: the late results first, the busy line on a project read. */
function withNotes(result, notes, name) {
	const lines = [];
	if (notes.unheard?.length) lines.push(`Finished while you weren't listening:\n${notes.unheard.map((u) => `${u.line}`).join("\n")}`);
	if (name === "get_project" && notes.busy) lines.push(`Busy: ${notes.busy} (status shows it).`);
	if (!lines.length) return result;
	const note = `${lines.join("\n")}\n---\n`;
	const [first, ...rest] = result.content ?? [];
	return { ...result, content: first?.type === "text" ? [{ ...first, text: note + first.text }, ...rest] : [{ type: "text", text: note }, ...(result.content ?? [])] };
}

/** Tell the app Claude got these answers (and the in-process copies of them are heard too). */
function ack(ids) {
	const list = ids.filter(Boolean);
	if (!list.length) return;
	for (const c of calls.values()) if (list.includes(c.hubId)) c.unheard = false;
	post("heard", { ids: list }).catch(() => {});
}

async function runCall(requestId, name, args, progress) {
	if (name === "status") return statusTool(args ?? {});
	if (name === "generate" && Array.isArray(args?.items)) return generateMany(requestId, args, progress);
	const { entry, joined } = entryFor(name, args);
	entry.unheard = false;
	entry.listeners++;
	if (requestId !== undefined) byRequest.set(requestId, entry);
	let tick = 0;
	const keep =
		progress === undefined
			? null
			: setInterval(() => {
					tick++;
					// (progress must grow with every notification: the count; the percent goes in the message)
					const pct = typeof entry.progress === "number" ? ` ${Math.round(entry.progress * 100)}%` : "";
					send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: progress, progress: tick, message: `${entry.stage ?? "working"}${pct}` } });
				}, 15_000);
	try {
		const window = !joined && !entry.joined && name === "generate" ? GENERATE_FIRST_MS : ANSWER_MS;
		entry.answerBy = Math.max(entry.answerBy ?? 0, Date.now() + window);
		const result = await Promise.race([entry.promise, sleep(window).then(() => STILL)]);
		if (gaveUp.has(requestId)) {
			// The client stopped waiting meanwhile: whatever this was stays unheard (the next answer hands it out).
			entry.unheard = true;
			if (result !== STILL && entry.hubId) post("heard", { undelivered: [entry.hubId] }).catch(() => {});
			return stillRunning(name, entry);
		}
		const notes = await pending(entry.hubId ?? "");
		if (result === STILL) {
			entry.unheard = true;
			return withNotes(stillRunning(name, entry), notes, name);
		}
		ack([entry.hubId]);
		if (!joined && !entry.joined) return withNotes(result, notes, name);
		const [first, ...rest] = result.content ?? [];
		// (an answer that itself says the work goes on — «still analysing 50 %», «Still separating» — has not «finished»)
		if (first?.type === "text" && /still (analys|separat|running|working|listening)/i.test(first.text.slice(0, 400))) return withNotes(result, notes, name);
		const note = "(The same call, started earlier, has finished: this is its result. Nothing was run or charged twice.)\n";
		return withNotes({ ...result, content: first?.type === "text" ? [{ ...first, text: note + first.text }, ...rest] : [{ type: "text", text: note }, ...(result.content ?? [])] }, notes, name);
	} finally {
		entry.listeners--;
		if (keep) clearInterval(keep);
		if (requestId !== undefined) byRequest.delete(requestId);
		gaveUp.delete(requestId);
	}
}

/** A long step's answer before Claude's client gives up on it (about 60 s): where it is and how to collect it. */
function stillRunning(name, entry) {
	const secs = Math.round((Date.now() - entry.startedAt) / 1000);
	if (!entry.submitted)
		return {
			content: [{ type: "text", text: `Gaziyav isn't answering yet (${secs} s): it is starting, locked, or closed. Send the same call again in a minute; if it says this twice, tell the user in one line that Gaziyav needs to be opened (or unlocked). Never look into it with shell or file tools.` }],
			isError: true,
		};
	const pct = typeof entry.progress === "number" ? ` ${Math.round(entry.progress * 100)}%` : "";
	const where = entry.queued ? "waiting its turn in Gaziyav (another change or a render runs first)" : `running in Gaziyav${entry.stage ? ` — ${entry.stage}` : ""}${pct}`;
	const lands = name === "generate" ? " A generation lands by itself where you asked (the timeline, or Media with place:false); its result comes with your next answer (or status). Start the other shots meanwhile." : "";
	return {
		content: [
			{
				type: "text",
				text: `Still ${where}, ${secs} s so far. Nothing is lost and nothing will run or be charged twice. Go on with other steps (reading the project, pricing, other generations work now). To collect this result, send this very same call again (same arguments); it waits up to ${Math.round(ANSWER_MS / 1000)} s each time.${lands}`,
			},
		],
	};
}

/**
 * The client stopped waiting for a call. Its own timeout («Request timed out»): the call goes on and its answer is
 * handed out later. Anything else is the user's Stop: the call is stopped in Gaziyav (a queued one never runs and is
 * never charged; a generation the provider hasn't started is cancelled there).
 */
function cancelled(requestId, reason, one) {
	const entry = one ?? byRequest.get(requestId);
	byRequest.delete(requestId);
	if (requestId !== undefined) gaveUp.add(requestId);
	if (!entry) return;
	entry.unheard = true;
	if (/time(d)?\s*out|timeout/i.test(String(reason ?? ""))) return;
	if (entry.many) {
		for (const r of entry.many) cancelled(Symbol("shot"), reason, r.entry);
		return;
	}
	const stop = () => (entry.hubId ? post("cancel", { id: entry.hubId, reason: "the user pressed Stop" }).catch(() => {}) : null);
	if (entry.hubId) stop();
	else entry.promise.finally(stop);
}

// ───────────────────────── status: what Gaziyav is busy with, answered without the window ─────────────────────────

const STATUS_TOOL = {
	name: "status",
	description: "What Gaziyav is doing now, answered at once even while the window is busy: the calls running (tool, model or stage, %, seconds), how many wait, and the results that finished since your last answer (handed out once). Call it instead of waiting, sleeping or looking with shell tools. cancel: a call's id from this list, or \"all\" (the user said stop: queued calls never run, a generation the provider hasn't started is cancelled, nothing more is charged).",
	inputSchema: { type: "object", properties: { cancel: { type: "string", description: "A running call's id from status, or \"all\"" } } },
	annotations: { title: "Status", readOnlyHint: true },
};

async function statusTool(args) {
	if (!(await up())) return { content: [{ type: "text", text: "Gaziyav isn't running (or is starting). Any call opens it; tell the user in one line if it doesn't come up." }], isError: true };
	try {
		let stopped = "";
		if (args.cancel) {
			const r = args.cancel === "all" ? await post("cancel", { all: true, reason: "stopped by Claude (status cancel)" }) : await post("cancel", { id: String(args.cancel), reason: "stopped by Claude (status cancel)" });
			stopped = args.cancel === "all" ? `Stopping ${r.stopped ?? 0} call(s): queued ones never run (nothing charged); running ones stop now and say what was charged.\n` : r.ok ? `Stopping ${args.cancel}.\n` : `Nothing to stop with id ${args.cancel} (finished already, or not one of yours).\n`;
		}
		const s = await api(`status?full=1&client=${encodeURIComponent(CLIENT)}`);
		const notes = await post("claim", {});
		const running = (s.running ?? []).map((c) => `${c.id} ${c.label}${c.queued ? " — waiting its turn" : c.stage ? ` — ${c.stage}` : ""}${typeof c.progress === "number" ? ` ${Math.round(c.progress * 100)}%` : ""} · ${c.seconds >= 90 ? `${Math.round(c.seconds / 60)} min` : `${c.seconds} s`}${c.cancelling ? " (stopping)" : ""}`);
		const lines = [
			stopped.trim(),
			s.connected ? `Window: ${s.page === "editor" ? "the editor" : "the projects page"}${s.projectId ? ` (project ${String(s.projectId).slice(0, 8)})` : ""}.` : "Window: not connected (Gaziyav is starting, locked or its window is closed).",
			running.length ? `Running or waiting (${running.length}):\n${running.join("\n")}` : "Nothing of yours runs now.",
			s.paused ? String(s.paused) : "",
			notes.unheard?.length ? `Finished since your last answer:\n${notes.unheard.map((u) => u.line).join("\n")}` : "",
		].filter(Boolean);
		return { content: [{ type: "text", text: lines.join("\n") }] };
	} catch (error) {
		return { content: [{ type: "text", text: `Error: ${error.message || error}` }], isError: true };
	}
}

// ───────────────────────── several shots in one call ─────────────────────────

/**
 * generate {items:[…]}: every shot starts at once as its own call (each joins and is never charged twice), one answer
 * within 45 s with what finished and what still runs; the same call again collects the rest.
 */
async function generateMany(requestId, args, progress) {
	const { items, ...shared } = args;
	const shots = items.slice(0, 8).map((one) => ({ ...shared, ...(one && typeof one === "object" ? one : {}) }));
	const runs = shots.map((a) => {
		const { entry, joined } = entryFor("generate", a);
		entry.unheard = false;
		entry.listeners++;
		return { a, entry, joined };
	});
	if (requestId !== undefined) byRequest.set(requestId, { unheard: false, promise: Promise.resolve(), hubId: null, many: runs });
	try {
		const all = Promise.all(runs.map((r) => r.entry.promise));
		await Promise.race([all, sleep(ANSWER_MS)]);
		const notes = await pending();
		const lines = [];
		let failed = 0;
		let still = runs.filter((r) => !r.entry.settledAt).length;
		const complete = still === 0;
		still = 0;
		for (const [i, r] of runs.entries()) {
			const done = r.entry.settledAt ? await r.entry.promise : null;
			const label = `${i + 1}${r.a.start !== undefined ? ` @${r.a.start}` : ""}`;
			if (!done) {
				still++;
				r.entry.unheard = true;
				const pct = typeof r.entry.progress === "number" ? ` ${Math.round(r.entry.progress * 100)}%` : "";
				lines.push(`${label} … ${r.entry.submitted ? `still running${r.entry.stage ? ` — ${r.entry.stage}` : ""}${pct}` : "not sent yet (Gaziyav is starting)"}`);
				continue;
			}
			// The batch heard once it is whole; till then its shots stay joinable (the same call again collects, runs nothing).
			if (complete) ack([r.entry.hubId]);
			else {
				r.entry.unheard = true;
				if (r.entry.hubId) post("heard", { shown: [r.entry.hubId] }).catch(() => {});
			}
			const text = (done.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(" ").replace(/\s+/g, " ");
			if (done.isError) failed++;
			lines.push(`${label} ${done.isError ? "✗" : "✓"} ${done.isError ? text.slice(0, 260) : shotLine(text)}`);
		}
		const head = `${runs.length} shot(s): ${runs.length - still - failed} done, ${failed} failed, ${still} still running.${still ? " Send this very same call again to collect the rest (nothing runs or is charged twice); meanwhile go on with other steps." : ""}`;
		return withNotes({ content: [{ type: "text", text: `${head}\n${lines.join("\n")}` }], isError: failed === runs.length }, notes, "generate");
	} finally {
		for (const r of runs) r.entry.listeners--;
		if (requestId !== undefined) byRequest.delete(requestId);
		gaveUp.delete(requestId);
	}
}

/**
 * One shot of a batch in one line: what it is called, its id, its length, what it cost, where it landed. (The line
 * used to be the answer's JSON cut at 260 characters — mid-word, before the id of the clip it placed.)
 */
function shotLine(text) {
	try {
		const j = JSON.parse(text.replace(/\s*\[rev \d+\]\s*$/, ""));
		if (!j || typeof j !== "object" || !j.media) return text.slice(0, 260);
		const placed = j.placed && typeof j.placed === "object" ? `clip ${j.placed.id} @${j.placed.start}` : typeof j.placed === "string" ? j.placed : j.note ? String(j.note) : "";
		return [`media ${String(j.media).slice(0, 8)} «${String(j.name ?? "").slice(0, 44)}»`, typeof j.seconds === "number" ? `${j.seconds} s` : "", j.model ? String(j.model).replace(/ \[[^\]]+\]/, "") : "", typeof j.costUsd === "number" ? `$${j.costUsd}` : "", placed, j.next ? String(j.next).slice(0, 60) : ""].filter(Boolean).join(" · ");
	} catch {
		return text.slice(0, 260);
	}
}

// ───────────────────────── the playbook ─────────────────────────

function readSkill(file) {
	try {
		return fs.readFileSync(path.join(SKILL_DIR, file), "utf8").replace(/^---[\s\S]*?---\s*/, "");
	} catch {
		return "";
	}
}

const TOPICS = { workflows: "workflows.md", sound: "sound.md", motion: "motion.md", captions: "captions.md", color: "graphics.md", export: "export-post.md", post: "export-post.md", ai: "ai.md", budget: "ai.md", tools: "tools.md" };

function guide(topic) {
	const t = String(topic ?? "start");
	const text = t === "start" ? readSkill("SKILL.md") : readSkill(path.join("references", TOPICS[t] ?? "workflows.md"));
	return text || "The guide is missing from this copy of Gaziyav; follow the instructions you got on connect.";
}

/** What Gaziyav remembers about this user (the app keeps memory.txt fresh). */
function memory() {
	try {
		return fs.readFileSync(path.join(SUPPORT, "mcp", "memory.txt"), "utf8").trim();
	} catch {
		return "";
	}
}

const INSTRUCTIONS = `Gaziyav is the user's video editor on this Mac. These tools edit its open project like its own buttons: every call can be undone and is saved by itself, and the user can change the result by hand.
Rules: work only through these tools — never read, search or change Gaziyav's code, its app bundle or its data folders, never use shell or file tools on a project, never sleep, ls or ps to check on it: status says what runs and what finished. Don't stop to ask for material: find it (the user's files → the library → web pictures → a YouTube piece → AI) and say at the end what came from where. Pictures pasted into the chat don't reach Gaziyav: ask once to save them to the Desktop, then import. Money: everything generated is paid, a voice too; the balance is the limit, or a budget the user names (price_plan {budget} first) — no confirmations; the cheapest model that holds the quality; report the spend per provider.
Do what was asked, and only that. A change to the open project («убери паузы», «титр на 0:05») is one edit call and one look: no review, no export, nothing improved on the side; the thing the user names is the one that is there or selected. Talk while you work: one line before each slow step; answer each user message at once in one line.
Can do: projects in any aspect; import files, YouTube, web pictures; cut by words and beats, trim, speed, reframe to vertical; captions; titles, motion templates and your own Remotion graphics; transitions, effects, colour looks; music and sound effects with ducking; hear a song by its parts (bars, sung phrases, drums, bass, the rest); the scenes of a long film and its YouTube chapters; AI pictures, video, voice, lipsync to a song, dubbing, face swap; look at frames; export per platform; post to Shorts, Reels and TikTok after the user's yes.
Loop for a new video: project → get_project (once; then get_project {since}) → analyze (a song: analyze {what:"music"} first) → plan → edit / apply_plan in few calls → review/fix → look → export → post after one yes → report.
Long steps: generate {items:[…]} starts up to 8 shots at once; a generation answers within ~15 s (done, or started: it lands by itself); «Still running…» = go on and send the very same call again later to collect it — it never runs or charges twice. Never re-send a paid call with changed arguments. Answers end with [rev N]; "The user…" lines (edits by hand, paused, went back) are theirs: follow them. Targets can be words: "selected", "music", "captions", "title at 0:05", "clip 2". Ask sounds_like in English (the hearing model reads English only).`;

// ───────────────────────── JSON-RPC over stdio ─────────────────────────

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function send(msg) {
	process.stdout.write(`${JSON.stringify(msg)}\n`);
}

const PROMPTS = [
	{ name: "make_video", title: "Make a video in Gaziyav", description: "A finished, checked video from a one-line brief.", arguments: [{ name: "brief", description: "What to make: platform, length, material, style", required: true }] },
	{ name: "fix_video", title: "Fix the open video", description: "Small changes to the open project, fast.", arguments: [{ name: "changes", description: "What to change", required: true }] },
];

async function handle(msg) {
	const { id, method, params } = msg;
	switch (method) {
		case "initialize": {
			CLIENT = String(params?.clientInfo?.name || "claude").slice(0, 60);
			// The memory as it is now when Gaziyav runs (the taste profile changes by itself), else the last one written.
			const mem = (await up()) ? await api("memo").then((r) => String(r.text ?? "").trim() || memory()).catch(() => memory()) : memory();
			return {
				protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
				capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
				serverInfo: { name: "gaziyav", title: "Gaziyav", version: VERSION },
				// The essentials ride along: Claude knows what it can do and the rules from the first call; the full
				// playbook is one call away (editing_guide).
				instructions: `${INSTRUCTIONS}${mem ? `\n\n${mem}` : ""}`,
			};
		}
		case "ping":
			return {};
		case "tools/list":
			return { tools: await toolList() };
		case "tools/call":
			return await runCall(id, params?.name, params?.arguments, params?._meta?.progressToken);
		case "notifications/cancelled":
			cancelled(params?.requestId, params?.reason);
			return undefined;
		case "prompts/list":
			return { prompts: PROMPTS };
		case "prompts/get": {
			const fix = params?.name === "fix_video";
			const say = fix ? `Change the open Gaziyav project: ${params?.arguments?.changes ?? ""}\nRead get_project {since} (or get_project once), make all the changes in one edit call, look at the changed frames, done.` : `Make this in Gaziyav: ${params?.arguments?.brief ?? ""}`;
			return { description: fix ? "Fix the open video" : "Make a video in Gaziyav", messages: [{ role: "user", content: { type: "text", text: `${fix ? "" : `${guide("start")}\n\n---\n`}${say}` } }] };
		}
		case "resources/list":
			return { resources: [] };
		default:
			if (id === undefined) return undefined; // a notification
			throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
	}
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let nl = buffer.indexOf("\n");
	while (nl >= 0) {
		const line = buffer.slice(0, nl).trim();
		buffer = buffer.slice(nl + 1);
		nl = buffer.indexOf("\n");
		if (!line) continue;
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
			continue;
		}
		if (msg.method === undefined) continue; // a response to us (we send no requests)
		Promise.resolve(handle(msg))
			.then((result) => {
				if (msg.id !== undefined && result !== undefined) send({ jsonrpc: "2.0", id: msg.id, result });
			})
			.catch((error) => {
				if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: error.code || -32603, message: String(error.message || error) } });
			});
	}
});
process.stdin.on("end", () => process.exit(0));
log(`ready (${BASE})`);
