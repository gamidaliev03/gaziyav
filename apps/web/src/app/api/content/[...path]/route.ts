// The content cloud's cache (Settings: its size, Clear) and its pause (background downloads wait while the timeline
// plays, a video exports or an AI job runs). Localhost only, like every studio route.
import fs from "node:fs";
import path from "node:path";
import { cacheInfo, clearCache, ensureCached, setPaused } from "@/content/server/cloud";
import { bundledFileOf, CONTENT_TYPES, cloudFileOf } from "@/content/server/files";

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

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, ...rest] = (await ctx.params).path;
	if (head === "cache") return json(cacheInfo());
	if (head === "file") {
		// /api/content/file/<part…>/<file>: the file from the cache, downloaded first (a sticker added, a graphic shown).
		const file = decodeURIComponent(rest.at(-1) ?? "");
		const cloud = cloudFileOf(rest.slice(0, -1).map(decodeURIComponent).join("/"), file);
		if (!cloud) return json({ error: "Not found" }, 404);
		// The full build carries the file inside: no cache, no network.
		const inside = bundledFileOf(cloud);
		if (inside) {
			return new Response(fs.readFileSync(inside.path), {
				headers: { "Content-Type": inside.type, ...(inside.encoding ? { "Content-Encoding": inside.encoding } : {}), "Cache-Control": "private, max-age=604800" },
			});
		}
		try {
			const local = await ensureCached(cloud);
			return new Response(fs.readFileSync(local), {
				headers: { "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "private, max-age=604800" },
			});
		} catch (error) {
			return json({ error: (error as Error).message }, 503);
		}
	}
	return json({ error: "Unknown request" }, 404);
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	const body = await req.json().catch(() => ({}));
	if (head === "pause") {
		setPaused(String(body?.reason ?? "busy"), body?.on !== false);
		return json({ ok: true });
	}
	if (head === "ensure") {
		// The export: every cloud file it uses (stickers…) on this Mac before a frame is made.
		const files: Array<{ part?: string; file?: string }> = Array.isArray(body?.files) ? body.files : [];
		const failed: string[] = [];
		await Promise.all(
			files.map(async (f) => {
				const cloud = cloudFileOf(String(f.part ?? ""), String(f.file ?? ""));
				if (!cloud || bundledFileOf(cloud)) return;
				try {
					await ensureCached(cloud);
				} catch {
					failed.push(`${f.part}/${f.file}`);
				}
			}),
		);
		return json({ ok: failed.length === 0, failed });
	}
	return json({ error: "Unknown request" }, 404);
}

export async function DELETE(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	if (head === "cache") return json({ freed: clearCache() });
	return json({ error: "Unknown request" }, 404);
}
