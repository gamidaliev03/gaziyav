// Sound library: index, files (with HTTP Range, so previews and the editor can seek), favourites and recent. Catalog
// items not on this Mac yet are downloaded on first use and cached (remote.ts).
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getLibraryIndex, libraryRemote, remoteRows, resolveLibraryFile } from "@/library/server/index-store";
import { downloading, isOffline, keyOf, progressOf, queueState } from "@/content/server/cloud";
import { ensureCached, isCached, prefetchRows, prefetchTop } from "@/library/server/remote";
import { addRecent, getUserState, setFavourite } from "@/library/server/user-state";

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

const MIME: Record<string, string> = {
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".flac": "audio/flac",
};

function streamFile(req: Request, file: string): Response {
	const stat = fs.statSync(file);
	const size = stat.size;
	const headers: Record<string, string> = {
		"Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
		"Accept-Ranges": "bytes",
		"Cache-Control": "private, max-age=86400",
		ETag: `"${size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`,
	};
	const range = req.headers.get("range");
	const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
	if (m && (m[1] || m[2])) {
		let start: number;
		let end: number;
		if (m[1]) {
			start = Number(m[1]);
			end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
		} else {
			start = Math.max(0, size - Number(m[2]));
			end = size - 1;
		}
		if (start >= size || start > end) {
			return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
		}
		const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream;
		return new Response(body, {
			status: 206,
			headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
		});
	}
	const body = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream;
	return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
}

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id] = (await ctx.params).path;
	try {
		switch (head) {
			case "index":
				return json(getLibraryIndex());
			case "state":
				return json(getUserState());
			case "progress": {
				// The rows in view: how far each download is, and which ones are on this Mac now.
				const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 200);
				const out: { downloading: Record<string, number>; cached: string[]; offline: boolean; queue: ReturnType<typeof queueState> } = { downloading: {}, cached: [], offline: isOffline(), queue: queueState() };
				for (const id of ids) {
					const remote = libraryRemote(id);
					if (!remote) continue;
					const key = keyOf({ ...remote.row, part: remote.part });
					if (isCached(remote.part, remote.row)) out.cached.push(id);
					else if (downloading(key)) out.downloading[id] = progressOf([key])[key] ?? 0;
				}
				return json(out);
			}
			case "file": {
				const key = decodeURIComponent(id ?? "");
				let file = resolveLibraryFile(key);
				// Not downloaded yet: fetched now (the clip is already on the timeline and fills in when this answers).
				const remote = file ? null : libraryRemote(key);
				if (remote) {
					try {
						file = await ensureCached(remote.part, remote.row);
					} catch (error) {
						return json({ error: (error as Error).message }, 503);
					}
				}
				if (!file) return json({ error: "Sound not found — the file may have been removed from the library." }, 404);
				return streamFile(req, file);
			}
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		console.error("library:", error);
		return json({ error: "The sound library is unavailable. Restart the app." }, 500);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	try {
		const body = await req.json().catch(() => ({}));
		switch (head) {
			case "favourite":
				return json(setFavourite(body?.entry ?? {}, body?.on !== false));
			case "recent":
				return json(addRecent(body?.entry ?? {}));
			case "fetch": {
				// Start the download of one item (a clip was just added) without waiting for it.
				// The pointer resting on a row (`hover`) puts it first in the background queue; a clip added starts it now.
				const remote = libraryRemote(String(body?.id ?? ""));
				if (remote) void ensureCached(remote.part, remote.row, body?.hover ? { background: true, first: true } : undefined).catch(() => {});
				return json({ downloading: !!remote });
			}
			case "prefetch":
				// The Audio tab opened: the 20 most used files come down in the background.
				void prefetchTop(remoteRows());
				return json({ ok: true });
			case "prefetch-rows": {
				// The rows in view come down in the background (two at a time, paused while something heavier runs).
				const ids: string[] = Array.isArray(body?.ids) ? body.ids.slice(0, 60).map(String) : [];
				prefetchRows(ids.flatMap((id) => libraryRemote(id) ?? []));
				return json({ ok: true });
			}
			case "ensure": {
				// The export: every sound it uses on this Mac before a frame is made (it waits, it never leaves one out).
				const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
				const failed: string[] = [];
				await Promise.all(
					ids.map(async (id) => {
						const remote = libraryRemote(id);
						if (!remote) return;
						try {
							await ensureCached(remote.part, remote.row);
						} catch {
							failed.push(id);
						}
					}),
				);
				return json({ ok: failed.length === 0, failed });
			}
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		console.error("library:", error);
		return json({ error: "Could not save. Check free disk space." }, 500);
	}
}
