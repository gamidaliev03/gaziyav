// A file the ffmpeg pass made and the server holds (its place could not be written: a full disk, a folder that is
// gone) goes into a folder without being made again: POST ?id=…&folder=…[&name=…] → {path} or {error}.
import { placeReady } from "@/export/server/files";
import { rejectForeign } from "@/export/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	const url = new URL(req.url);
	try {
		return Response.json({ path: placeReady(url.searchParams.get("id") ?? "", url.searchParams.get("folder") ?? "", url.searchParams.get("name") ?? undefined) });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "Couldn't save the file." });
	}
}
