// A finished export handed to the Save dialog: GET ?id=… (the random id is the key; a download link carries no
// header). The file stays for «Save again» until the app quits.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { readyFile } from "@/export/server/files";
import { rejectForeign } from "@/export/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".gif": "image/gif",
	".mp3": "audio/mpeg",
	".m4a": "audio/mp4",
	".flac": "audio/flac",
	".wav": "audio/wav",
};

export async function GET(req: Request) {
	const blocked = rejectForeign(req, { header: false });
	if (blocked) return blocked;
	const file = readyFile(new URL(req.url).searchParams.get("id") ?? "");
	if (!file) return new Response("This export is gone: export it again.", { status: 404 });
	const name = path.basename(file);
	const body = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
	return new Response(body, {
		headers: {
			"content-type": TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream",
			"content-length": String(fs.statSync(file).size),
			"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
			"cache-control": "no-store",
		},
	});
}
