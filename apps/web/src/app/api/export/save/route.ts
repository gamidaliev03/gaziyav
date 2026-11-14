// Export → «Export to» a folder: POST the file with ?folder=…&name=… → {path} (a free name: «Video (2).mp4»).
import { saveToFolder } from "@/export/server/files";
import { rejectForeign } from "@/export/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	const url = new URL(req.url);
	try {
		const file = await saveToFolder({ body: req.body, folder: url.searchParams.get("folder") ?? "", name: url.searchParams.get("name") ?? "Export" });
		return Response.json({ path: file });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "Couldn't save the file." });
	}
}
