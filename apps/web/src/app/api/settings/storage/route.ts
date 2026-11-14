// Settings → cache sizes (GET) and clearing them (POST {kinds?, olderThanDays?}). Local app API only.
import { rejectForeign } from "@/export/server/guard";
import { type CacheKind, clearCaches, storageReport } from "@/settings/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	return Response.json(storageReport());
}

export async function POST(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	const body = (await req.json().catch(() => ({}))) as { kinds?: unknown; olderThanDays?: unknown };
	const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k): k is CacheKind => k === "render" || k === "transcripts" || k === "export") : undefined;
	const days = Number(body.olderThanDays);
	return Response.json(clearCaches({ kinds, olderThanDays: Number.isFinite(days) && days > 0 ? days : undefined }));
}
