// Web image search for the Media panel: GET search, GET file (proxied download). No keys.
import { downloadWebImage, searchWebImages, WebImageError } from "@/media/web-images/server";

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
	const message = error instanceof WebImageError ? error.message : "Image search failed — try again.";
	return json({ error: message }, error instanceof WebImageError ? 400 : 500);
}

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	const url = new URL(req.url);
	try {
		if (head === "search") {
			const page = Math.max(1, Math.min(50, Number(url.searchParams.get("page")) || 1));
			return json(await searchWebImages(url.searchParams.get("q") ?? "", page));
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
