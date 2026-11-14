// The song's score by parts (hear/score-server.ts), on the app's own server:
//   POST /api/hear/score { fileId, cachedOnly?, words? } → a job (result { key, score }) or { key, score|null }
//   GET  /api/hear/score?key=…&part=vocals|drums|bass|other → that part's sound (audio/mp4)
import fs from "node:fs";
import { cachedScore, startScore, stemPath } from "@/hear/score-server";
import { explain } from "@/studio/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => Response.json(data, { status });

// Same guard as /api/hear: only the app's own window; writes must carry X-Studio.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

export async function POST(req: Request) {
	const denied = forbidden(req);
	if (denied) return denied;
	try {
		const body = (await req.json().catch(() => ({}))) ?? {};
		if (body.key && !body.fileId) return json({ key: body.key, score: cachedScore(String(body.key)) });
		return json(await startScore(body));
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}

export async function GET(req: Request) {
	const denied = forbidden(req);
	if (denied) return denied;
	try {
		const url = new URL(req.url);
		const file = stemPath(String(url.searchParams.get("key") ?? ""), String(url.searchParams.get("part") ?? ""));
		const data = fs.readFileSync(file);
		return new Response(data, { headers: { "Content-Type": "audio/mp4", "Content-Length": String(data.byteLength), "Cache-Control": "no-store" } });
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}
