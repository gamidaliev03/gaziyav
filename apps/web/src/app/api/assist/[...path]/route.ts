// Assist tools (Kadr's on-device helpers) on the app's own server:
//   POST /api/assist/scenes     { fileId, start, length, sensitivity } → JobState (result: { cuts, scores })
//   POST /api/assist/translate  { text, language, from, seconds } → { text, language }   (Gaziyav AI)
// Media is sent once with /api/studio/upload (shared with lipsync); jobs are polled at /api/studio/jobs/:id.
import { startScenes } from "@/assist/server/scenes";
import { translateSpeech } from "@/assist/server/translate";
import { explain } from "@/studio/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

// Same guard as /api/studio: only the app's own window; writes must carry X-Studio.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const route = (await ctx.params).path.join("/");
	try {
		const body = (await req.json().catch(() => ({}))) ?? {};
		if (route === "scenes") return json(startScenes(body));
		if (route === "translate") return json(await translateSpeech(body, req.signal));
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}
