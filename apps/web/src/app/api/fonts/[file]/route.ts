// Fonts that are not inside the app (src/fonts/remote-fonts.json): the file is downloaded the first time a text uses
// it, checked (size + SHA-256) and kept in the cache (library/server/remote.ts, Application Support/Gaziyav/
// MediaLibrary/Fonts), then served from there. The app carries only the base set (public/fonts/bundled).
import fs from "node:fs";
import { remoteFontRow } from "@/fonts/remote-catalog";
import { ensureCached } from "@/library/server/remote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
	// only the app's own window (the same guard as /api/library)
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return Response.json({ error: "Request refused" }, { status: 403 });
	const { file } = await ctx.params;
	const row = remoteFontRow(decodeURIComponent(file));
	if (!row) return Response.json({ error: "Unknown font" }, { status: 404 });
	try {
		const cached = await ensureCached("Fonts", row);
		return new Response(new Uint8Array(fs.readFileSync(cached)), {
			headers: { "Content-Type": "font/ttf", "Cache-Control": "public, max-age=31536000, immutable" },
		});
	} catch (error) {
		return Response.json({ error: (error as Error).message.replace(/the sound/i, "the font") }, { status: 503 });
	}
}
