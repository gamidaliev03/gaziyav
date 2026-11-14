// The kept stretches of exports (export/server/build-cache.ts), for the app's own page:
//   GET                → { salt, bytes, count, limit }
//   GET ?key=…         → the entry's bytes, or 404
//   POST {keys:[…]}    → { have: { key: { head, bytes } } }
//   PUT ?key=…  (body) → { kept: true | false }
//   DELETE [?days=N]   → everything goes (or what was not used for N days) → { salt, bytes, count, limit }
import { rejectForeign } from "@/export/server/guard";
import { cacheClear, cacheGet, cacheHave, cacheInfo, cachePrune, cachePut } from "@/export/server/build-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	const key = new URL(req.url).searchParams.get("key");
	if (!key) return Response.json(cacheInfo());
	const body = cacheGet(key);
	if (!body) return new Response(null, { status: 404 });
	return new Response(new Uint8Array(body), { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
}

export async function POST(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	const body = (await req.json().catch(() => null)) as { keys?: unknown } | null;
	const keys = Array.isArray(body?.keys) ? body.keys.filter((k): k is string => typeof k === "string").slice(0, 50_000) : [];
	return Response.json({ have: cacheHave(keys) });
}

export async function PUT(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	const key = new URL(req.url).searchParams.get("key") ?? "";
	try {
		return Response.json({ kept: cachePut(key, new Uint8Array(await req.arrayBuffer())) });
	} catch {
		return Response.json({ kept: false });
	}
}

export async function DELETE(req: Request) {
	const blocked = rejectForeign(req);
	if (blocked) return blocked;
	const days = Number(new URL(req.url).searchParams.get("days"));
	return Response.json(Number.isFinite(days) && days > 0 ? cachePrune(days) : cacheClear());
}
