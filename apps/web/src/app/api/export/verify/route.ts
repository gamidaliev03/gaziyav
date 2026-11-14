// The editor looks at a written export before it says «Done» (export/server/verify.ts).
import path from "node:path";
import { rejectForeign } from "@/export/server/guard";
import { noteProven } from "@/export/server/proven";
import { verifyExport } from "@/export/server/verify";

export const runtime = "nodejs";

export async function POST(request: Request) {
	const foreign = rejectForeign(request);
	if (foreign) return foreign;
	const body = (await request.json().catch(() => null)) as { file?: unknown; expect?: Record<string, unknown> } | null;
	const file = typeof body?.file === "string" ? body.file : "";
	if (!path.isAbsolute(file)) return Response.json({ error: "Expected the exported file's path." }, { status: 400 });
	const e = body?.expect ?? {};
	const result = await verifyExport(file, {
		seconds: Number(e.seconds) || 0,
		fps: Number(e.fps) || null,
		audio: e.audio === true,
		video: e.video !== false,
	});
	// a file that passed may be played back by the window (/api/export/proven: the premiere of a finished film)
	if (result.ok) noteProven(file);
	return Response.json(result);
}
