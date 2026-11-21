// The Claude connection (MCP). Two kinds of caller, both on 127.0.0.1 only:
// - Claude's MCP server (Resources/mcp/server.mjs): `call`, `result`, `heard`, `claim`, `cancel`, `tools`, `status`, with
//   the token from the app's folder;
// - the editor window: `next` (long poll for a call), `alive`, `done`, `hello`, `budget`, `compose`, `claude/*`, with the
//   app's X-Studio header.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { explain } from "@/studio/server/errors";
import { alive, busyLine, cancel, cancelAll, finish, heard, legacyTools, noteAddress, progressOf, result, setTools, status, submit, take, tokenOk, tools, unheard } from "@/mcp/server/hub";
import { claudeStatus, claudeTestState, connectClaude, refreshInstalled, revealSkillZip } from "@/mcp/server/claude";
import { budgetView, recordSpend, setLimit, setProjectBudget } from "@/mcp/server/budget";
import { compileForClaude } from "@/mcp/server/compose";
import { readNotes, saveNotes } from "@/mcp/server/notes";
import { searchStock, stockFile, stockKeys } from "@/mcp/server/stock";
import { isSourcePick } from "@/studio/server/providers/media-search";
import { keepPicture, memoryData, memoryText, noteTaste, pictureFile, refreshMemoryText, saveBrand, saveCharacter, saveVoice, setTargets } from "@/mcp/server/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

function local(req: Request): boolean {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}

/** The app's own window: same origin, and the X-Studio header a web page can't send without a CORS preflight. */
function fromWindow(req: Request): boolean {
	if (!local(req)) return false;
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${req.headers.get("host")}`) return false;
	return req.headers.get("x-studio") === "1";
}

const MCP_ROUTES = new Set(["call", "result", "tools", "status", "memo", "heard", "claim", "cancel"]);
noteAddress();

export async function GET(req: Request, ctx: Ctx) {
	const [head, sub] = (await ctx.params).path;
	const q = new URL(req.url).searchParams;
	try {
		if (MCP_ROUTES.has(head)) {
			if (!local(req) || !tokenOk(req)) return json({ error: "Request refused" }, 403);
			if (head === "status") return json(status(q.get("client") ?? "", q.get("full") === "1"));
			// What Claude gets on connect: the memory as it is now (the taste profile changes without a memory write).
			if (head === "memo") return json({ text: refreshMemoryText() });
			if (head === "tools") return json({ tools: q.get("legacy") === "1" ? legacyTools() : tools() });
			if (head === "result") {
				const id = q.get("id") ?? "";
				const r = await result(id, Math.min(25_000, Number(q.get("wait")) || 20_000), q.get("listen") !== "0", req.signal);
				if (r === undefined) return json({ error: "Unknown call" }, 404);
				return json(r ? { done: true, ...r } : { done: false, ...(progressOf(id) ?? {}) });
			}
		}
		if (!fromWindow(req)) return json({ error: "Request refused" }, 403);
		if (head === "next") {
			const page = q.get("page") === "editor" ? "editor" : "projects";
			const lanes = q.get("lanes") === "background" ? "background" : "all";
			const call = await take({ page, projectId: q.get("project") || null }, Math.min(25_000, Number(q.get("wait")) || 25_000), req.signal, lanes);
			return call ? json({ id: call.id, tool: call.tool, args: call.args, ...(call.expect ? { expect: call.expect } : {}) }) : new Response(null, { status: 204 });
		}
		if (head === "budget") return json(budgetView(q.get("project")));
		if (head === "stock" && sub === "file") return await stockFile(String(q.get("item") ?? ""));
		if (head === "stock" && sub === "keys") return json(stockKeys());
		if (head === "stock") {
			const source = q.get("source");
			return json(await searchStock(String(q.get("q") ?? ""), q.get("vertical") !== "0", isSourcePick(source) ? source : undefined));
		}
		if (head === "notes") return json(readNotes(q.get("project") ?? ""));
		if (head === "memory" && sub === "file") {
			const full = pictureFile(String(q.get("path") ?? ""));
			const ext = path.extname(full).slice(1).toLowerCase();
			return new Response(new Uint8Array(fs.readFileSync(full)), { headers: { "Content-Type": ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" } });
		}
		if (head === "memory") return json({ text: memoryText(), ...memoryData() });
		if (head === "claude" && sub === "status") return json(claudeStatus());
		if (head === "claude" && sub === "test-state" && process.env.STUDIO_TEST === "1") return json(claudeTestState());
		if (head === "movies") {
			// Where export puts files when Claude names no folder.
			const folder = path.join(os.homedir(), "Movies", "Gaziyav");
			fs.mkdirSync(folder, { recursive: true });
			return json({ folder });
		}
		if (head === "filecheck" && q.get("file")) {
			// Frames of a Media file at its own seconds (the window uploaded it to the app's file store: `file` is that id).
			const { framesAt } = await import("@/mcp/server/filecheck");
			const { getFile } = await import("@/studio/server/files");
			const at = String(q.get("at") ?? "").split(",").map(Number).filter((x) => Number.isFinite(x) && x >= 0);
			return json({ frames: await framesAt(getFile(String(q.get("file"))).path, at.length ? at : [0]) });
		}
		if (head === "filecheck") {
			// The file an export wrote, measured as a file: length, picture, loudness, black and silent stretches, 3 frames.
			const { checkFile, checkLine } = await import("@/mcp/server/filecheck");
			const check = await checkFile(String(q.get("path") ?? ""), Math.min(3, Math.max(0, Number(q.get("frames") ?? 3))));
			return json({ line: checkLine(check, { seconds: Number(q.get("seconds")) || undefined }), frames: check.frames, check: { ...check, frames: undefined } });
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const [head, sub] = (await ctx.params).path;
	try {
		const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
		if (MCP_ROUTES.has(head)) {
			if (!local(req) || !tokenOk(req)) return json({ error: "Request refused" }, 403);
			const client = String(body.client ?? "").slice(0, 80);
			if (head === "call") {
				const tool = String(body.tool ?? "");
				if (!/^[a-z_]{2,40}$/.test(tool)) return json({ error: "Unknown tool" }, 400);
				const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
				return json(submit(tool, args, client));
			}
			// Claude got these answers (the MCP server says so after handing them over).
			if (head === "heard") {
				heard(Array.isArray(body.ids) ? body.ids.map(String) : [], Array.isArray(body.undelivered) ? body.undelivered.map(String) : [], Array.isArray(body.shown) ? body.shown.map(String) : []);
				return json({ ok: true });
			}
			// What finished unheard (handed out now, with the answer being given) and what still runs.
			if (head === "claim") {
				const except = String(body.except ?? "");
				return json({ unheard: unheard(client, except, body.claim !== false), busy: busyLine(client, except) });
			}
			if (head === "cancel") {
				const reason = String(body.reason ?? "stopped by the user");
				if (body.all === true) return json({ ok: true, stopped: cancelAll(client, reason) });
				return json({ ok: cancel(String(body.id ?? ""), reason) });
			}
			return json({ error: "Unknown request" }, 404);
		}
		if (!fromWindow(req)) return json({ error: "Request refused" }, 403);
		if (head === "alive") {
			return json({ ok: true, ...alive(String(body.id ?? ""), { stage: body.stage, progress: body.progress }) });
		}
		if (head === "done") {
			const images = Array.isArray(body.images) ? body.images.filter((x): x is string => typeof x === "string").slice(0, 8) : undefined;
			const project = body.project && typeof body.project === "object" ? (body.project as { id?: unknown; name?: unknown }) : null;
			finish(String(body.id ?? ""), { ok: body.ok !== false, content: String(body.content ?? ""), images }, project?.id ? { id: String(project.id), name: String(project.name ?? "") } : null);
			return json({ ok: true });
		}
		if (head === "hello") {
			if (Array.isArray(body.tools)) setTools(body.tools, Array.isArray(body.legacy) ? body.legacy : undefined);
			noteAddress();
			// An app update: a skill an older Gaziyav put into Claude Code is replaced by this one's.
			refreshInstalled();
			refreshMemoryText();
			return json({ ok: true });
		}
		if (head === "budget") {
			const project = String(body.project ?? "");
			if (body.spend && typeof body.spend === "object") {
				const s = body.spend as Record<string, unknown>;
				return json(recordSpend(project, { what: String(s.what ?? ""), usd: Number(s.usd) || 0, api: String(s.api ?? "fal"), ...(typeof s.job === "string" ? { job: s.job } : {}) }));
			}
			if (typeof body.limit === "number") return json(setLimit(body.limit));
			if (body.budget === null || typeof body.budget === "number") return json(setProjectBudget(project, body.budget as number | null));
			return json(budgetView(project));
		}
		if (head === "notes") {
			const project = String(body.project ?? "");
			return json(saveNotes(project, { notes: body.notes, name: body.name, castMedia: body.castMedia as never }));
		}
		if (head === "memory") {
			if (sub === "picture") {
				// A picture of a character or a logo, sent by the window (base64), kept in the library.
				const bytes = Buffer.from(String(body.data ?? ""), "base64");
				if (!bytes.length || bytes.length > 25e6) return json({ error: "The picture is empty or over 25 MB." }, 400);
				return json({ file: keepPicture(String(body.owner ?? "cast"), bytes, String(body.ext ?? "png")) });
			}
			if (body.character) return json({ cast: saveCharacter(body.character as never), text: memoryText() });
			if (body.brand) return json({ brands: saveBrand(body.brand as never), text: memoryText() });
			if (body.voice) return json({ voices: saveVoice(body.voice as never), text: memoryText() });
			if (body.taste && typeof body.taste === "object") {
				const t = body.taste as { kind?: string; items?: Array<{ cat: string; value: string }> };
				noteTaste(t.kind === "undone" ? "undone" : "kept", Array.isArray(t.items) ? t.items : []);
				return json({ ok: true });
			}
			if (Array.isArray(body.targets)) {
				setTargets(body.targets.map(String));
				return json({ ok: true });
			}
			return json({ text: memoryText(), ...memoryData() });
		}
		if (head === "compose") {
			const r = compileForClaude(String(body.code ?? ""), String(body.component ?? ""));
			return json(r);
		}
		if (head === "claude") {
			// The user's press in Settings → Claude: connect everything there is on this Mac.
			if (sub === "connect") return json({ ok: true, ...connectClaude(), ...claudeStatus() });
			if (sub === "reveal-skill") return json({ ok: true, file: revealSkillZip(), ...claudeStatus() });
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}
