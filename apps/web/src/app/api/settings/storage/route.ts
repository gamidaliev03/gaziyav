// Settings → cache sizes (GET), clearing them (POST {kinds?, olderThanDays?}) and keeping them under a size
// (POST {limitBytes}: the oldest entries make room). Local app API only.
import { rejectForeign } from "@/export/server/guard";
import { type CacheKind, clearCaches, storageReport, trimCaches } from "@/settings/server/storage";

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
	const body = (await req.json().catch(() => ({}))) as { kinds?: unknown; olderThanDays?: unknown; limitBytes?: unknown };
	const limit = Number(body.limitBytes);
	if (body.limitBytes != null) return Number.isFinite(limit) && limit >= 0 ? Response.json(trimCaches({ limitBytes: limit })) : Response.json({ error: "limitBytes must be a number" }, { status: 400 });
	const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k): k is CacheKind => k === "render" || k === "transcripts" || k === "export") : undefined;
	const days = Number(body.olderThanDays);
	return Response.json(clearCaches({ kinds, olderThanDays: Number.isFinite(days) && days > 0 ? days : undefined }));
}
