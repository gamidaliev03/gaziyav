// A saved export that passed its check, for a <video> of the app's window: GET ?file=<its path>, with byte ranges
// (a player seeks). Only files verified in this run of the app (export/server/proven.ts); a link carries no header.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { rejectForeign } from "@/export/server/guard";
import { isProven } from "@/export/server/proven";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".gif": "image/gif", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".flac": "audio/flac", ".wav": "audio/wav" };

export async function GET(req: Request) {
	const blocked = rejectForeign(req, { header: false });
	if (blocked) return blocked;
	const file = new URL(req.url).searchParams.get("file") ?? "";
	let size = 0;
	try {
		if (!path.isAbsolute(file) || !isProven(file)) throw new Error("not a verified export");
		size = fs.statSync(file).size;
	} catch {
		return new Response("This export can't be played from here.", { status: 404 });
	}
	const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
	if (range && (range[1] || range[2])) {
		// «bytes=a-b», «bytes=a-», «bytes=-n» (the last n)
		const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
		const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
		if (!(start <= end) || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
		const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
		return new Response(body, { status: 206, headers: { "content-type": type, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "cache-control": "no-store" } });
	}
	const body = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
	return new Response(body, { headers: { "content-type": type, "content-length": String(size), "accept-ranges": "bytes", "cache-control": "no-store" } });
}
