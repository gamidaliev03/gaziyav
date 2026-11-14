// The app's side of the Claude connection (MCP). Claude's MCP server (Resources/mcp/server.mjs, a separate process
// Claude starts — and kills and starts again whenever a call times out on its side) hands each tool call to this hub
// with the token from the app's folder; the editor window takes the calls (a long poll), runs them with Gaziyav AI's
// tools and posts the answer back. Everything stays on 127.0.0.1.
// The hub, not the MCP server, is the memory of Claude's calls (10.11: Claude's app killed the server 81 times and
// every join, every late result went with it): the same call again joins the one queued, running or finished unheard;
// a result nobody heard is handed out with the next answer; a call cut by a restart of Gaziyav is said to be lost.
// The calls that change things are kept on disk (mcp/calls.json) for that.
import { vpnShort } from "@/net/proxy";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { briefOf, callLabel, hhmm, stable } from "@/mcp/compact";

/** The model a call names, short («flux/schnell», «kling-video/v2.1»), for what runs now. */
const modelOf = (args: Args) => (typeof args.model === "string" && args.model && args.model !== "cheapest" ? ` [${args.model.split("/").slice(-2).join("/").slice(0, 40)}]` : "");
import { laneOf, readOnlyCall } from "@/mcp/surface";
import { agentHold, agentPauseLine } from "@/agentview/server/state";
import { supportDir } from "@/platform/paths";

export interface McpResult {
	ok: boolean;
	content: string;
	/** data: URLs (JPEG/PNG) the tool saw: preview frames, the timeline. */
	images?: string[];
}

type Args = Record<string, unknown>;

interface Call {
	id: string;
	tool: string;
	args: Args;
	/** Which Claude app sent it (Claude Code, Claude for Mac): one Claude never gets another's late results. */
	client: string;
	/** tool + its arguments in a stable order: the same call sent again has the same key. */
	key: string;
	readOnly: boolean;
	createdAt: number;
	takenAt?: number;
	/** Last sign of life from the window running it (long tools send one every few seconds). */
	aliveAt?: number;
	finishedAt?: number;
	/** What it is doing now (the job center's line), for Claude's progress. */
	stage?: string;
	progress?: number;
	result?: McpResult;
	/** Its answer reached Claude (the MCP server said so), or it was handed out with another answer. */
	heard?: boolean;
	/** A poll on behalf of a waiting Claude got the answer at this time (the MCP server confirms it soon after). */
	deliveringAt?: number;
	/** The last time someone waited for its answer. */
	polledAt?: number;
	/** Stopped by the user (Stop in Claude) or by Claude (status {cancel}): the window aborts it. */
	cancel?: string;
	/** Cut by a restart of Gaziyav: only reported, never joined. */
	lost?: boolean;
	/** Shown to Claude inside a batch answer that isn't complete yet: not listed again, still joined by the batch's re-send. */
	shown?: boolean;
}

export interface BridgeInfo {
	page: "editor" | "projects";
	projectId: string | null;
	lastSeen: number;
}

type Taker = { lanes: "all" | "background"; wake: () => boolean };

interface Hub {
	calls: Map<string, Call>;
	queue: string[];
	takers: Taker[];
	done: Map<string, Array<() => void>>;
	bridge: BridgeInfo | null;
	tools: unknown[] | null;
	/** Every tool name the window still answers (older names too): the schemas of before, for measurements. */
	legacy: unknown[] | null;
	/** The project Claude worked in last, per Claude app (the window refuses edits when another one is open). */
	projects: Map<string, { id: string; name: string }>;
	startedAt: number;
}

/** A window that runs a call and stops answering (reloaded, closed) fails it after this long. */
const SILENT_MS = 90_000;
/** The same call again joins a finished one whose answer nobody heard for this long. */
const JOIN_MS = 30 * 60_000;
/** An unheard result is still handed out (with the next answer, or by status) for this long. */
const KEEP_UNHEARD_MS = 3 * 3600_000;
/** A queued read nobody has waited for since this long is dropped (its Claude gave up: it would read for nobody). */
const STALE_READ_MS = Number(process.env.GAZIYAV_STALE_READ_MS) || 25_000;
/** An answer being handed to Claude counts as heard unless the MCP server fails to confirm it within this. */
const DELIVERY_MS = 8000;

const g = globalThis as unknown as { __gaziyavMcpHub?: Hub };
if (!g.__gaziyavMcpHub) {
	g.__gaziyavMcpHub = { calls: new Map(), queue: [], takers: [], done: new Map(), bridge: null, tools: null, legacy: null, projects: new Map(), startedAt: Date.now() };
	restore(g.__gaziyavMcpHub);
}
const hub: Hub = g.__gaziyavMcpHub;

export function mcpDir(): string {
	const dir = path.join(supportDir(), "mcp");
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	return dir;
}

/** The shared secret Claude's MCP server reads from the app's folder (created on first use, owner-only). */
let cachedToken = "";

export function mcpToken(): string {
	if (cachedToken) return cachedToken;
	const file = path.join(mcpDir(), "token");
	try {
		const t = fs.readFileSync(file, "utf8").trim();
		if (/^[0-9a-f]{64}$/.test(t)) {
			cachedToken = t;
			return t;
		}
	} catch {}
	const t = crypto.randomBytes(32).toString("hex");
	fs.writeFileSync(file, t, { mode: 0o600 });
	cachedToken = t;
	return t;
}

export function tokenOk(req: Request): boolean {
	const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
	const want = mcpToken();
	const a = Buffer.from(given), b = Buffer.from(want);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ───────────────────────── on disk: what a restart must not forget ─────────────────────────

function journal() {
	return path.join(supportDir(), "mcp", "calls.json");
}

/** Claude's calls that change things, unfinished or finished unheard: written on every change of their state. */
function save() {
	const now = Date.now();
	const keep = [...hub.calls.values()].filter((c) => !c.readOnly && (!c.result || (!c.heard && now - (c.finishedAt ?? now) < KEEP_UNHEARD_MS)));
	try {
		mcpDir();
		const rows = keep.map((c) => ({ ...c, args: c.args, result: c.result ? { ok: c.result.ok, content: c.result.content.slice(0, 6000) } : undefined }));
		fs.writeFileSync(journal(), JSON.stringify(rows), { mode: 0o600 });
	} catch {}
}

/** After a restart: unheard results come back (joinable, handed out); what was queued or running is reported lost. */
function restore(h: Hub) {
	let rows: Call[] = [];
	try {
		rows = JSON.parse(fs.readFileSync(journal(), "utf8")) as Call[];
	} catch {
		return;
	}
	const now = Date.now();
	const at = hhmm(h.startedAt);
	for (const c of Array.isArray(rows) ? rows : []) {
		if (!c?.id || !c.tool || c.readOnly) continue;
		if (c.result) {
			if (!c.heard && now - (c.finishedAt ?? 0) < KEEP_UNHEARD_MS) h.calls.set(c.id, { ...c, deliveringAt: undefined });
			continue;
		}
		const label = callLabel(c.tool, c.args ?? {});
		const content = c.takenAt
			? `${label}: cut by the ${at} restart of Gaziyav while it ran${c.tool === "generate" ? "; a paid generation that had started may still land in Media (get_project {media:\"new\"} shows it)" : ": send it again if get_project shows it missing"}.`
			: `${label}: lost in the ${at} restart of Gaziyav, not started, nothing charged. Send it again.`;
		h.calls.set(c.id, { ...c, lost: true, finishedAt: now, result: { ok: false, content } });
	}
	try {
		fs.writeFileSync(journal(), "[]", { mode: 0o600 });
	} catch {}
	g.__gaziyavMcpHub = h;
	const lost = [...h.calls.values()].filter((c) => c.lost).length;
	if (h.calls.size) studioLog(`[mcp] after the restart: ${h.calls.size - lost} unheard result(s) kept, ${lost} call(s) lost`);
}

/** One line in the app's log (logs/studio.log, next to the shell's): every call of Claude's, how long it waited and ran. */
function studioLog(line: string) {
	try {
		const dir = path.join(supportDir(), "logs");
		fs.mkdirSync(dir, { recursive: true });
		fs.appendFileSync(path.join(dir, "studio.log"), `${new Date().toISOString()} ${line}\n`);
	} catch {}
}

// ───────────────────────── the calls ─────────────────────────

function sweep() {
	const now = Date.now();
	for (const [id, c] of hub.calls) {
		if (c.result) {
			const age = now - (c.finishedAt ?? c.createdAt);
			if (age > KEEP_UNHEARD_MS || ((c.heard || c.readOnly) && age > 5 * 60_000)) hub.calls.delete(id);
		} else if (c.takenAt && now - (c.aliveAt ?? c.takenAt) > SILENT_MS) {
			finish(id, { ok: false, content: "Gaziyav stopped answering while doing this (the window was reloaded or closed). Call get_project and try again." });
		} else if (!c.takenAt && c.readOnly && now - (c.polledAt ?? c.createdAt) > STALE_READ_MS) {
			c.heard = true;
			finish(id, { ok: false, content: "Not run: nobody was waiting for this read any more." });
		}
	}
}

/** A call from Claude: the id of the same call already queued, running or finished unheard, else a new one. */
export function submit(tool: string, args: Args, client = ""): { id: string; joined: boolean } {
	sweep();
	const key = `${tool}\u0000${stable(args)}`;
	const now = Date.now();
	for (const c of hub.calls.values()) {
		if (c.key !== key || c.client !== client || c.lost) continue;
		if (!c.result || (!c.heard && now - (c.finishedAt ?? now) < JOIN_MS)) {
			c.polledAt = now;
			return { id: c.id, joined: true };
		}
	}
	const id = crypto.randomBytes(8).toString("hex");
	hub.calls.set(id, { id, tool, args, client, key, readOnly: readOnlyCall(tool, args), createdAt: now, polledAt: now });
	// «Pause» in the editor (agentview): a call that would change the project is answered at once and never runs. Its
	// answer counts as heard, so the same call sent again after «Continue» is a new one.
	const held = agentHold(tool, args);
	if (held) {
		(hub.calls.get(id) as Call).heard = true;
		finish(id, { ok: false, content: held });
		return { id, joined: false };
	}
	hub.queue.push(id);
	for (const t of [...hub.takers]) if (t.wake()) break;
	if (!readOnlyCall(tool, args)) save();
	return { id, joined: false };
}

/** The next call for the window (null after `ms` without one). lanes "background": only calls that run beside others. */
export function take(info: Omit<BridgeInfo, "lastSeen">, ms: number, signal?: AbortSignal, lanes: "all" | "background" = "all"): Promise<(Call & { expect?: { id: string; name: string } }) | null> {
	hub.bridge = { ...info, lastSeen: Date.now() };
	sweep();
	const grab = () => {
		for (const [i, id] of hub.queue.entries()) {
			const c = hub.calls.get(id);
			if (!c || c.result) continue;
			if (lanes === "background" && laneOf(c.tool, c.args) !== "background") continue;
			hub.queue.splice(i, 1);
			c.takenAt = c.aliveAt = Date.now();
			if (!c.readOnly) save();
			const expect = hub.projects.get(c.client);
			return { ...c, ...(expect ? { expect } : {}) };
		}
		hub.queue = hub.queue.filter((id) => hub.calls.get(id) && !hub.calls.get(id)?.result);
		return null;
	};
	const now = grab();
	if (now) return Promise.resolve(now);
	return new Promise((resolve) => {
		const taker: Taker = {
			lanes,
			wake: () => {
				const c = grab();
				if (!c) return false;
				done();
				resolve(c);
				return true;
			},
		};
		const done = () => {
			clearTimeout(timer);
			hub.takers = hub.takers.filter((t) => t !== taker);
			if (hub.bridge) hub.bridge.lastSeen = Date.now();
		};
		const timer = setTimeout(() => {
			done();
			resolve(null);
		}, ms);
		hub.takers.push(taker);
		// A poll the window dropped (it navigated) must not take the next call.
		signal?.addEventListener("abort", () => {
			done();
			resolve(null);
		});
	});
}

/** The window's heartbeat for a running call; the answer says when to stop it. */
export function alive(id: string, info: { stage?: unknown; progress?: unknown } = {}): { cancel?: string } {
	const c = hub.calls.get(id);
	if (c) {
		c.aliveAt = Date.now();
		if (typeof info.stage === "string") c.stage = info.stage.slice(0, 160);
		if (typeof info.progress === "number" && Number.isFinite(info.progress)) c.progress = Math.max(0, Math.min(1, info.progress));
	}
	if (hub.bridge) hub.bridge.lastSeen = Date.now();
	if (c?.cancel && !c.result) return { cancel: c.cancel };
	// A read waiting in the window for its turn that nobody waits for any more is not worth running.
	if (c && !c.result && c.readOnly && info.stage === "waiting" && Date.now() - (c.polledAt ?? c.createdAt) > STALE_READ_MS) return { cancel: "nobody was waiting for this read any more" };
	return {};
}

/** A running call's progress (null: done or unknown). */
export function progressOf(id: string): { stage?: string; progress?: number; queued?: boolean } | null {
	const c = hub.calls.get(id);
	if (!c || c.result) return null;
	return { ...(c.stage ? { stage: c.stage } : {}), ...(c.progress !== undefined ? { progress: c.progress } : {}), ...(!c.takenAt ? { queued: true } : {}) };
}

export function finish(id: string, result: McpResult, project?: { id: string; name: string } | null) {
	const c = hub.calls.get(id);
	if (!c || c.result) return;
	c.result = result;
	c.finishedAt = Date.now();
	// Claude's project: where its last change (or opening) succeeded; a refused edit or a read in another project doesn't
	// move it (Claude's next edit there would land in the user's other video).
	if (project?.id && c.takenAt && result.ok && (!c.readOnly || !hub.projects.has(c.client))) hub.projects.set(c.client, project);
	hub.queue = hub.queue.filter((x) => x !== id);
	const s = (ms: number) => `${Math.round(ms / 100) / 10} s`;
	const waited = (c.takenAt ?? c.finishedAt) - c.createdAt;
	const ran = c.takenAt ? c.finishedAt - c.takenAt : 0;
	studioLog(`[mcp] ${callLabel(c.tool, c.args)} · waited ${s(waited)} · ran ${s(ran)} · ${c.cancel ? `stopped (${c.cancel})` : result.ok ? "ok" : `failed: ${result.content.replace(/\s+/g, " ").slice(0, 160)}`}`);
	for (const wake of hub.done.get(id) ?? []) wake();
	hub.done.delete(id);
	if (!c.readOnly) save();
}

/** The call's answer, or null when it is still running after `ms` (the MCP server asks again). listen: for a waiting Claude. */
export function result(id: string, ms: number, listen = true, signal?: AbortSignal): Promise<McpResult | null | undefined> {
	sweep();
	const c = hub.calls.get(id);
	if (!c) return Promise.resolve(undefined);
	const got = () => {
		const x = hub.calls.get(id);
		// (a poll whose connector is gone, killed by Claude's app, delivers nothing)
		if (listen && x && !signal?.aborted) {
			x.polledAt = Date.now();
			if (x.result) x.deliveringAt = Date.now();
		}
		return x?.result ?? null;
	};
	if (listen) c.polledAt = Date.now();
	if (c.result) return Promise.resolve(got());
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			hub.done.set(id, (hub.done.get(id) ?? []).filter((w) => w !== wake));
			resolve(got());
		}, ms);
		const wake = () => {
			clearTimeout(timer);
			resolve(got());
		};
		hub.done.set(id, [...(hub.done.get(id) ?? []), wake]);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			hub.done.set(id, (hub.done.get(id) ?? []).filter((w) => w !== wake));
			resolve(null);
		});
	});
}

/** Claude got these answers; `undelivered`: fetched, but the MCP server had nobody to give them to (list them now). */
export function heard(ids: string[], undelivered: string[] = [], shown: string[] = []) {
	for (const id of undelivered) {
		const c = hub.calls.get(String(id));
		if (c) c.deliveringAt = undefined;
	}
	for (const id of shown) {
		const c = hub.calls.get(String(id));
		if (c) c.shown = true;
	}
	let changed = false;
	for (const id of ids) {
		const c = hub.calls.get(String(id));
		if (c && !c.heard) {
			c.heard = true;
			changed = changed || !c.readOnly;
		}
	}
	if (changed) save();
}

/** Stop a call: one still queued finishes at once («Not run … nothing charged»); a running one is aborted by the window. */
export function cancel(id: string, reason = "stopped"): boolean {
	const c = hub.calls.get(id);
	if (!c || c.result) return false;
	c.cancel = reason.slice(0, 120);
	if (!c.takenAt) finish(id, { ok: false, content: `Not run: ${callLabel(c.tool, c.args)} was stopped (${c.cancel}) before it started; nothing was charged.` });
	return true;
}

/** Stop every call of this Claude that changes something (status {cancel:"all"}, the user's «stop»). */
export function cancelAll(client = "", reason = "stopped"): number {
	let n = 0;
	for (const c of hub.calls.values()) if (c.client === client && !c.result && !c.readOnly && cancel(c.id, reason)) n++;
	return n;
}

/** Claude's calls with no answer yet, queued or running, of every Claude app: the editor's Stop and Pause (agentview). */
export const openCalls = () => [...hub.calls.values()].filter((c) => !c.result).map((c) => ({ id: c.id, tool: c.tool, args: c.args, readOnly: c.readOnly, taken: !!c.takenAt }));

/** Claude's finished calls nobody heard (and lost ones), as lines; `claim` marks them heard (they go into an answer now). */
export function unheard(client = "", except = "", claim = false): Array<{ id: string; line: string }> {
	sweep();
	const now = Date.now();
	const list = [...hub.calls.values()]
		.filter((c) => c.client === client && c.result && !c.heard && !c.shown && !c.readOnly && c.id !== except && !(c.deliveringAt && now - c.deliveringAt < DELIVERY_MS))
		.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
	const out = list.map((c) => ({ id: c.id, line: c.lost ? `✗ ${c.result?.content ?? ""}` : briefOf(c.tool, c.args, c.result as McpResult, c.finishedAt ?? now) }));
	if (claim && list.length) heard(list.map((c) => c.id));
	return out;
}

/** What runs or waits now for this Claude, as a short line («generate avatar @145.1 64% 2 min · 2 waiting»); "" when idle. */
export function busyLine(client = "", except = ""): string {
	const now = Date.now();
	const mine = [...hub.calls.values()].filter((c) => c.client === client && !c.result && c.id !== except);
	const running = mine.filter((c) => c.takenAt);
	const queued = mine.length - running.length;
	const secs = (c: Call) => {
		const s = Math.round((now - (c.takenAt ?? c.createdAt)) / 1000);
		return s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`;
	};
	const parts = running.slice(0, 6).map((c) => `${callLabel(c.tool, c.args)}${modelOf(c.args)}${c.stage && c.stage !== "waiting" ? ` — ${c.stage.slice(0, 60)}` : c.stage === "waiting" ? " (waiting its turn)" : ""}${c.progress !== undefined ? ` ${Math.round(c.progress * 100)}%` : ""} ${secs(c)}`);
	if (running.length > 6) parts.push(`+${running.length - 6} more`);
	if (queued) parts.push(`${queued} call${queued > 1 ? "s" : ""} waiting`);
	return parts.join(" · ");
}

export function status(client?: string, full = false) {
	const b = hub.bridge && Date.now() - hub.bridge.lastSeen < 40_000 ? hub.bridge : null;
	// hammering them (IDEAL reliable §3)
	const vpn = vpnShort();
	const base = { connected: !!b, page: b?.page ?? null, projectId: b?.projectId ?? null, queued: hub.queue.length, offline: vpn ? "VPN" : null, offlineWhy: vpn };
	if (!full) return base;
	const now = Date.now();
	const running = [...hub.calls.values()]
		.filter((c) => c.client === (client ?? "") && !c.result)
		.map((c) => ({ id: c.id, label: `${callLabel(c.tool, c.args)}${modelOf(c.args)}`, queued: !c.takenAt, stage: c.stage ?? null, progress: c.progress ?? null, seconds: Math.round((now - (c.takenAt ?? c.createdAt)) / 1000), cancelling: !!c.cancel }));
	return { ...base, running, startedAt: hub.startedAt, paused: agentPauseLine() };
}

/** The tools the window offers (Gaziyav AI's plus the project ones), kept on disk for when the app is closed. */
export function setTools(tools: unknown[], legacy?: unknown[]) {
	hub.tools = tools;
	if (legacy) hub.legacy = legacy;
	try {
		fs.writeFileSync(path.join(mcpDir(), "tools.json"), JSON.stringify(tools));
	} catch {}
}

export function tools(): unknown[] | null {
	if (hub.tools) return hub.tools;
	try {
		return JSON.parse(fs.readFileSync(path.join(mcpDir(), "tools.json"), "utf8")) as unknown[];
	} catch {
		return null;
	}
}

export const legacyTools = () => hub.legacy;

/** Where this app listens, for Claude's MCP server (it reads it from the app's folder before its default port). */
export function noteAddress() {
	const port = Number(process.env.PORT);
	if (!port) return;
	try {
		const file = path.join(mcpDir(), "url");
		const url = `http://127.0.0.1:${port}`;
		if ((() => { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } })() !== url) fs.writeFileSync(file, url, { mode: 0o600 });
	} catch {}
}
