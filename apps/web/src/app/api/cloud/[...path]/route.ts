// AI image and AI video on fal.ai for the editor: models, prices, generations and their results.
//   GET  /api/cloud/status            → { connected } (the fal key is set)
//   GET  /api/cloud/models/<kind>     → the catalog's models (shapes, lengths, prices); video: ?mode=text|image|…[&model=<id>
//                                       → also { resolved: { id, note? } | { error } }: the model that id means in that mode]
//   POST /api/cloud/estimate          → { cost } (US dollars)
//   POST /api/cloud/generate          → { jobId, cost, same? } (Claude's calls send once:true — the same request again is
//                                       that job, running or done 30 min; again:true makes a new take)
//   POST /api/cloud/cancel/<id>
//   GET  /api/cloud/job/<id>          → { state, progress, cost, error, files: [{path, name, kind}] }
//   GET  /api/cloud/file/<id>/<n>     → a finished file (kept on this Mac)
//   POST /api/cloud/reference         → { assetId, seconds } (raw bytes, or ?fileId=<a file of /api/studio/upload> with no body; ?kind=image|video|audio&type=…[&from=s&length=s])
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { cancelGeneration, estimate, generate, job, models, resolveVideoModel, resultFile, status, uploadReference, type GenerateInput, type Kind } from "@/cloud/server";
import { isVideoMode } from "@/fal/video";
import { explain, StudioError } from "@/studio/server/errors";
import { getFile } from "@/studio/server/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) => Response.json(data, { status });

// Same guard as /api/studio: only the app's own window; writes must carry X-Studio.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

const fail = (error: unknown) => json({ error: error instanceof StudioError ? error.message : explain(error) }, 400);
const kindOf = (k: string | undefined): Kind => (k === "image" || k === "audio" ? k : "video");

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id, n] = (await ctx.params).path;
	try {
		switch (head) {
			case "status":
				return json(await status());
			case "models": {
				const q = new URL(req.url).searchParams;
				const mode = q.get("mode") ?? undefined;
				const list = models(kindOf(id), mode);
				const named = q.get("model");
				// the one resolver of generate and price_plan: the id for this mode, a sibling said, or a refusal listing the mode's ids
				if (named && kindOf(id) === "video") return json({ ...list, resolved: resolveVideoModel(named, isVideoMode(mode) ? mode : "text") });
				return json(list);
			}
			case "job":
				return json(await job(String(id ?? "")));
			case "file": {
				const file = resultFile(String(id ?? ""), Number(n) || 0);
				const ext = path.extname(file).slice(1).toLowerCase();
				const type = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg" }[ext] ?? "application/octet-stream";
				return new Response(Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream, { headers: { "Content-Type": type, "Content-Length": String(fs.statSync(file).size), "Cache-Control": "no-store" } });
			}
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id] = (await ctx.params).path;
	try {
		switch (head) {
			case "cancel":
				cancelGeneration(String(id ?? ""));
				return json({ ok: true });
			case "estimate":
				return json({ cost: (await estimate((await req.json()) as GenerateInput)).cost });
			case "generate": {
				// `allowed`: what the user agreed to spend on the agent's step (the Generate tab's own button sends none).
				const { allowed, once, again, ...g } = (await req.json()) as GenerateInput & { allowed?: number; once?: boolean; again?: boolean };
				return json(await generate(g, allowed === undefined ? undefined : Number(allowed), { once: once === true, again: again === true }));
			}
			case "reference": {
				const u = new URL(req.url);
				const from = Number(u.searchParams.get("from"));
				const length = Number(u.searchParams.get("length"));
				const trim = u.searchParams.has("length") && Number.isFinite(from) && length > 0 ? { from, length } : undefined;
				const kind = kindOf(u.searchParams.get("kind") ?? "image");
				const type = u.searchParams.get("type") ?? "image/png";
				// A clip or sound that was sent by the streaming upload (/api/studio/upload): the piece is cut from the stored file.
				const fileId = u.searchParams.get("fileId");
				if (fileId) return json(await uploadReference(kind, type, { file: getFile(fileId).path }, trim));
				// A body is read into memory: a refusal comes before the first byte of one that is too big.
				const declared = Number(req.headers.get("content-length") ?? 0);
				if (declared > 1e9) throw new StudioError(kind === "image" ? "The reference picture is too big (30 MB at most)." : "This file is too big to send. Trim it on the timeline and pick the selected clip.");
				const bytes = Buffer.from(await req.arrayBuffer());
				return json(await uploadReference(kind, type, bytes, trim));
			}
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}
