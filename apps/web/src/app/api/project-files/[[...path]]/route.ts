// The projects' disk copies (services/storage/server/project-files.ts): GET = the list, GET <id> = one copy ("null"
// when there is none), POST <id> = write it, DELETE <id> = the project was deleted for good.
import { listProjectFiles, listProjectVersions, readProjectFile, readProjectVersion, removeProjectFile, writeProjectFile } from "@/services/storage/server/project-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

// Only the app's own window: other sites and DNS-rebinding hosts are refused, writes carry the X-Studio header.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

const fail = (error: unknown) => json({ error: error instanceof Error ? error.message : String(error) }, 500);

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [id, sub, file] = (await ctx.params).path ?? [];
	try {
		if (!id) return json(listProjectFiles());
		// GET <id>/versions = the versions kept by time outside the copy; GET <id>/versions/<file> = one of them
		if (sub === "versions" && !file) return json(listProjectVersions(id));
		if (sub === "versions") return new Response(readProjectVersion(id, file) ?? "null", { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
		return new Response(readProjectFile(id) ?? "null", { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
	} catch (error) {
		return fail(error);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [id] = (await ctx.params).path ?? [];
	try {
		if (!id) return json({ error: "No project" }, 400);
		writeProjectFile(id, await req.text());
		return json({ ok: true });
	} catch (error) {
		return fail(error);
	}
}

export async function DELETE(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [id] = (await ctx.params).path ?? [];
	try {
		if (id) removeProjectFile(id);
		return json({ ok: true });
	} catch (error) {
		return fail(error);
	}
}
