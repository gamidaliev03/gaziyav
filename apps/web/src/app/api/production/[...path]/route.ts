// Claude's production desk on the server (the app's own window only, 127.0.0.1, X-Studio on writes):
//   POST upload?key=&name=      raw media body → kept as the source of a brief, analysis queued (background)
//   POST analyze {key, front}   queue a brief for a source already here (or {need:"upload"})
//   POST status {keys}          → per key: ready / progress / stage / error
//   POST briefs {keys}          → the full briefs
//   GET  taste · POST taste {set} · POST learn {key, value}
//   POST sounds {mood, seconds, sfx}   → library music (with its beat grid) and sounds
//   POST measure {parts, total, speech, sections} → loudness of the mix, speech vs music, sections, holes
//   POST judge {frames:[{t, data}]}     → rendered frames judged (Apple Vision)
//   GET  project?id= · POST project {id, …patch}
//   GET  gate?project=          → {blocked: null | "why"} for Claude's export / post
//   POST quiet {playing, exporting}     → analysis stands still while the user plays or exports
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { analysisState, requestAnalysis } from "@/production/server/analyze";
import { originalFor } from "@/production/server/originals";
import { judgeRendered, measureMix, pickSounds } from "@/production/server/measure";
import { noteSource, pruneSources, readBrief, readProject, readTaste, setQuiet, sourcePath, sourceSlot, writeProject, writeTaste } from "@/production/server/store";
import { learnTaste, mergeTaste } from "@/production/taste";
import { explain } from "@/studio/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

const KEY = /^[a-z0-9_-]{6,120}$/i;

function stateOf(key: string) {
	const st = analysisState(key);
	if (st?.status === "done") return { key, ready: true, progress: 1, stage: "ready" };
	if (!st) return { key, ready: false, progress: 0, stage: sourcePath(key) ? "waiting" : "not here", missing: !sourcePath(key) };
	return { key, ready: false, progress: Math.round(st.progress * 100) / 100, stage: st.stage, ...(st.error ? { error: st.error } : {}) };
}

let pruned = false;

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	const q = new URL(req.url).searchParams;
	try {
		if (head === "taste") return json({ taste: readTaste() });
		if (head === "project") return json({ record: readProject(q.get("id") ?? "") });
		if (head === "gate") {
			const record = readProject(q.get("project") ?? "");
			const failed = (record.review?.hardFailed ?? []).filter((id) => !record.waived.includes(id));
			return json({ blocked: failed.length ? `Review found hard failures: ${failed.join(", ")} — fix them (review {fix:true}) or waive them (review {waive:[…]}), then export.` : null, score: record.review?.score ?? null });
		}
		if (head === "brief") {
			const key = q.get("key") ?? "";
			return json({ state: stateOf(key), brief: readBrief(key) });
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	const q = new URL(req.url).searchParams;
	try {
		if (!pruned) {
			pruned = true;
			pruneSources();
		}
		if (head === "upload") {
			const key = q.get("key") ?? "";
			const name = q.get("name") || "media";
			if (!KEY.test(key)) return json({ error: "Bad key" }, 400);
			if (!sourcePath(key)) {
				if (!req.body) return json({ error: "Empty file" }, 400);
				const file = sourceSlot(key, name);
				await pipeline(Readable.fromWeb(req.body as never), fs.createWriteStream(file));
				if (fs.statSync(file).size === 0) return json({ error: "Empty file" }, 400);
				noteSource(key, file);
			} else await req.body?.cancel().catch(() => {});
			requestAnalysis({ key, file: sourcePath(key)!, name, front: q.get("front") === "1" });
			return json(stateOf(key));
		}
		const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
		switch (head) {
			case "analyze": {
				const key = String(body.key ?? "");
				// the user's own file used where it is: read there (no upload); else an upload made before
				const file = sourcePath(key) ?? originalFor(body.source);
				if (!file) return json({ key, need: "upload" });
				requestAnalysis({ key, file, name: String(body.name ?? "media"), front: body.front === true });
				return json(stateOf(key));
			}
			case "status":
				return json({ states: (Array.isArray(body.keys) ? body.keys : []).map((k) => stateOf(String(k))) });
			case "briefs": {
				const out: Record<string, unknown> = {};
				for (const k of Array.isArray(body.keys) ? body.keys : []) out[String(k)] = readBrief(String(k));
				return json({ briefs: out });
			}
			case "taste": {
				const next = mergeTaste(readTaste(), (body.set && typeof body.set === "object" ? body.set : {}) as Record<string, unknown>);
				writeTaste(next);
				return json({ taste: next });
			}
			case "learn": {
				const key = String(body.key ?? "");
				const value = body.value as string | number | boolean;
				if (!/^[a-z]+(\.[a-zA-Z]+)?$/.test(key) || value === undefined) return json({ error: "Bad change" }, 400);
				const next = learnTaste(readTaste(), key, value);
				writeTaste(next);
				return json({ taste: next });
			}
			case "sounds":
				return json(await pickSounds({ mood: String(body.mood ?? ""), seconds: Number(body.seconds) || 30, sfx: (body.sfx ?? {}) as Record<string, string> }));
			case "measure":
				return json(await measureMix(body as unknown as Parameters<typeof measureMix>[0]));
			case "judge":
				return json({ frames: await judgeRendered((Array.isArray(body.frames) ? body.frames : []).slice(0, 40) as Array<{ t: number; data: string }>) });
			case "project": {
				const id = String(body.id ?? "");
				if (!id) return json({ error: "No project" }, 400);
				const record = readProject(id);
				const patch = (body.patch ?? {}) as Partial<typeof record>;
				const next = {
					...record,
					...patch,
					waived: Array.isArray(patch.waived) ? [...new Set([...record.waived, ...patch.waived])] : record.waived,
					provenance: Array.isArray(patch.provenance) ? [...record.provenance.filter((p) => !patch.provenance!.some((n) => n.media === p.media)), ...patch.provenance] : record.provenance,
				};
				writeProject(id, next);
				return json({ record: next });
			}
			case "quiet":
				setQuiet({ playing: body.playing === true, exporting: body.exporting === true });
				return json({ ok: true });
			default:
				return json({ error: "Unknown request" }, 404);
		}
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}
