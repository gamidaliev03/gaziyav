// Claude's ears (studio/server/hear.ts), on the app's own server:
//   POST /api/hear/source  { fileId, language?, words? }          → JobState (result: { key, duration, words, language })
//   POST /api/hear/map     { key, from, to, place, fps, clip?, captions?, fileId? } → the audio map of a clip's range
//                          (timeline seconds); captions: what the hearing model's tagger hears in each stretch
//   POST /api/hear/near    { key, place, fps, at | after, window? } → the best cut points near a time / after word #n
//   POST /api/hear/plan    { key, place, fps, op, … }              → where remove_pauses / cut_out / split / trim cut
//   POST /api/hear/ask     { key, fileId?, place, from, to, like, find? } → how much it sounds like each of `like` / where
//                          (any English words with the hearing model, CLAP; the measured concepts without it)
//   POST /api/hear/seams   { seams, fps }                         → every cut checked by ear, with fixes
//   POST /api/hear/picture { fileId, from, length, cols, rows }   → waveform + spectrogram bytes for the window to paint
//   POST /api/hear/frames  { items: [{fileId, at}], height? }    → small JPEG frames (a cut's filmstrip)
// Media is sent once with /api/studio/upload; jobs are polled at /api/studio/jobs/:id.
import { explain } from "@/studio/server/errors";
import { hearAsk, hearFrames, hearMapWith, hearMusic, hearNear, hearPicture, hearPlan, hearSeams, startHearing } from "@/studio/server/hear";

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
		if (route === "source") return json(await startHearing(body));
		if (route === "map") return json(await hearMapWith(body, req.signal));
		if (route === "near") return json(hearNear(body));
		if (route === "ask") return json(await hearAsk(body, req.signal));
		if (route === "music") return json(await hearMusic(body, req.signal));
		if (route === "plan") return json(hearPlan(body));
		if (route === "seams") return json(await hearSeams(body, req.signal));
		if (route === "picture") return json(await hearPicture(body, req.signal));
		if (route === "frames") return json(await hearFrames(body, req.signal));
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}
