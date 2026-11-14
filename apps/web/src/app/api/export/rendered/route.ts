// A render on disk (see export/server/rendered-file.ts) for the page, as a blob the browser keeps on disk too.
import { rejectForeign } from "@/export/server/guard";
import { isRenderedFile, renderedStream } from "@/export/server/rendered-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	const from = new URL(req.url).searchParams.get("from") ?? "";
	if (!isRenderedFile(from)) return Response.json({ error: "The rendered file is gone. Export again." }, { status: 400 });
	return new Response(renderedStream(from), { headers: { "Content-Type": "video/mp4" } });
}
