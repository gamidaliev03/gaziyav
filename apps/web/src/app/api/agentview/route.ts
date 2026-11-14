// «Claude at work»: the editor window's Pause, Continue and Stop for Claude's calls (127.0.0.1, the app's own window
// only). GET says whether editing is paused and what Claude is waiting to do; POST {pause} turns the pause on or off;
// POST {stop:true} cancels every call of Claude's that has no answer yet — through the hub's own cancel, which makes
// the window abort the work and the paid polling — and pauses, so the next call does not start under the person's hand.
import { cancel, heard, openCalls } from "@/mcp/server/hub";
import { agentView, PAUSED_REASON, setPaused, STOPPED_REASON } from "@/agentview/server/state";
import { isRead } from "@/agentview/words";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** The app's own window: same origin, and the X-Studio header a web page can't send without a CORS preflight. */
function fromWindow(req: Request): boolean {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false;
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${req.headers.get("host")}`) return false;
	return req.headers.get("x-studio") === "1";
}

/**
 * Calls that never started: their «Not run» answer goes to a Claude that is waiting for it, and counts as heard, so
 * the same call sent again after «Continue» is a new one and runs (it would otherwise join this answer for 30 minutes).
 */
const never = (ids: string[]) => heard(ids);

export async function GET(req: Request) {
	if (!fromWindow(req)) return json({ error: "Request refused" }, 403);
	return json(agentView());
}

export async function POST(req: Request) {
	if (!fromWindow(req)) return json({ error: "Request refused" }, 403);
	const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
	if (body.stop === true) {
		// everything of Claude's that has no answer yet: a queued call never runs, a running one is aborted by the window
		const stopped = openCalls().filter((c) => cancel(c.id, STOPPED_REASON));
		never(stopped.filter((c) => !c.taken).map((c) => c.id));
		return json({ ...setPaused(true, "stop"), stopped: stopped.map((c) => ({ id: c.id, tool: c.tool, running: c.taken })) });
	}
	if (body.pause === true) {
		const view = setPaused(true, "pause");
		// what waits in the queue and would change the project is answered now (what already runs goes on to its end)
		never(openCalls().filter((c) => !c.taken && !isRead(c.tool, c.args) && cancel(c.id, PAUSED_REASON)).map((c) => c.id));
		return json(view);
	}
	if (body.pause === false) return json(setPaused(false));
	return json({ error: "Unknown request" }, 400);
}
