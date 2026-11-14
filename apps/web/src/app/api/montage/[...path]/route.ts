// Local API of Remotion AI Compositions (the app's own server; nothing here is reachable from outside the Mac).
// POST agent → a run with a live log (GET/DELETE runs/<id>); GET asset/<name> serves what a run found
// (content-addressed, read-only, also to the export renderer's page on another local port).
import fs from "node:fs";
import { explain, StudioError } from "@/studio/server/errors";
import { cancelJob, getJob } from "@/studio/server/jobs";
import { cancelRun, getRun, startAgent } from "@/montage/server/agent";
import { assetFile, putMedia } from "@/montage/server/assets";
import type { PlanRequest } from "@/montage/server/plan";
import { startComposite, startLayerProxy, startLayerRender } from "@/montage/server/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

function fail(error: unknown) {
	if (error instanceof TypeError) return json({ error: "Bad request to the app. Reload the window (⌘⇧P) and try again." }, 400);
	return json({ error: error instanceof StudioError ? error.message : explain(error) }, 400);
}

// Same guard as /api/studio: only the app's own window, writes must carry X-Studio.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

const ASSET_TYPES: Record<string, string> = { json: "application/json", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

/** An asset a run stored: unguessable content-hash names, read-only; the renderer's page (other local port) may read it. */
function asset(req: Request, name: string): Response {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return json({ error: "Request refused" }, 403);
	const file = assetFile(name);
	if (!file) return json({ error: "Asset not found" }, 404);
	const ext = name.split(".").pop() ?? "";
	const headers: Record<string, string> = {
		"Content-Type": ASSET_TYPES[ext] ?? "application/octet-stream",
		"Cache-Control": "private, max-age=31536000, immutable",
		"Accept-Ranges": "bytes",
		// An SVG is a picture here, never a page that runs code.
		...(ext === "svg" ? { "Content-Security-Policy": "script-src 'none'" } : {}),
		...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
	};
	const size = fs.statSync(file).size;
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
	if (range && (range[1] || range[2])) {
		const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
		const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
		if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
		const fd = fs.openSync(file, "r");
		const buf = Buffer.alloc(end - start + 1);
		fs.readSync(fd, buf, 0, buf.length, start);
		fs.closeSync(fd);
		return new Response(buf, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(buf.length) } });
	}
	return new Response(fs.readFileSync(file), { headers: { ...headers, "Content-Length": String(size) } });
}

export async function GET(req: Request, ctx: Ctx) {
	const [head, id] = (await ctx.params).path;
	if (head === "asset") return asset(req, decodeURIComponent(id ?? ""));
	const denied = forbidden(req);
	if (denied) return denied;
	if (head === "runs") {
		const run = getRun(id ?? "");
		return run ? json(run) : json({ error: "This AI run is gone — the app may have restarted. Start it again." }, 404);
	}
	if (head === "jobs") {
		const job = getJob(id ?? "");
		return job ? json(job) : json({ error: "Job not found — the app may have restarted. Start it again." }, 404);
	}
	return json({ error: "Unknown request" }, 404);
}

export async function DELETE(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id] = (await ctx.params).path;
	if (head === "runs") return json({ cancelled: cancelRun(id ?? "") });
	if (head === "jobs") return json({ cancelled: cancelJob(id ?? "") });
	return json({ error: "Unknown request" }, 404);
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const route = (await ctx.params).path.join("/");
	try {
		// The user's own photo, logo or clip (or a picture picked to replace one): stored and described for the agent.
		if (route === "media") {
			const bytes = Buffer.from(await req.arrayBuffer());
			if (!bytes.length) return json({ error: "The file is empty." }, 400);
			return json(await putMedia(bytes).catch((e) => Promise.reject(new StudioError(`Gaziyav AI can't use this file: ${(e as Error).message}.`))));
		}
		const body = await req.json().catch(() => ({}));
		switch (route) {
			case "agent": {
				const host = (req.headers.get("host") ?? "127.0.0.1").toLowerCase();
				return json(startAgent(body as PlanRequest, `http://${host}`));
			}
			case "layers":
				return json(startLayerRender(body));
			case "layer-proxy":
				return json(startLayerProxy(body));
			case "composite":
				return json(startComposite(body));
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}
