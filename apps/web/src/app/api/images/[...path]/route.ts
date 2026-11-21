// Web search for the Media, Music and Sounds panels (and the chat's tools): GET search (pictures), clips, audio (music or
// sounds), sources (the switch and what is searched), file / audio-file (proxied downloads); POST source (the switch).
import { downloadWebImage, searchWebImages, WebImageError } from "@/media/web-images/server";
import { searchStock } from "@/mcp/server/stock";
import { downloadWebAudio, isSearchKind, isSourcePick, searchWebAudio, setPick, sourcesView, type SourcePick } from "@/studio/server/providers/media-search";
import { StudioError } from "@/studio/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

// Same guard as the other local APIs: only the app's own window, writes need X-Studio.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request rejected" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request rejected" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request rejected" }, 403);
	return null;
}

function failure(error: unknown) {
	const known = error instanceof WebImageError || error instanceof StudioError;
	const message = known ? (error as Error).message : "Image search failed — try again.";
	return json({ error: message }, known ? 400 : 500);
}

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	const url = new URL(req.url);
	try {
		const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page")) || 1));
		const source = url.searchParams.get("source");
		const pick: SourcePick | undefined = isSourcePick(source) ? source : undefined;
		if (head === "search") return json(await searchWebImages(url.searchParams.get("q") ?? "", page, pick));
		if (head === "clips") return json(await searchStock(url.searchParams.get("q") ?? "", url.searchParams.get("vertical") !== "0", pick));
		if (head === "audio") return json(await searchWebAudio(url.searchParams.get("q") ?? "", url.searchParams.get("kind") === "sound" ? "sound" : "music", page, pick));
		if (head === "sources") {
			const kind = url.searchParams.get("kind");
			return json(await sourcesView(isSearchKind(kind) ? kind : "picture"));
		}
		if (head === "audio-file") {
			const { bytes, type } = await downloadWebAudio(url.searchParams.get("u") ?? "");
			return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
		}
		if (head === "file") {
			const { bytes, type } = await downloadWebImage(url.searchParams.get("u") ?? "");
			return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
		}
		return json({ error: "Not found" }, 404);
	} catch (error) {
		return failure(error);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	try {
		if (head === "source") {
			const body = (await req.json().catch(() => ({}))) as { kind?: unknown; pick?: unknown };
			if (!isSearchKind(body.kind) || !isSourcePick(body.pick)) return json({ error: "This source isn't offered for that." }, 400);
			setPick(body.kind, body.pick);
			return json(await sourcesView(body.kind));
		}
		return json({ error: "Not found" }, 404);
	} catch (error) {
		return failure(error);
	}
}
