// Gaziyav AI's AI (the chooser at the prompt and Settings → AI → API keys): which provider, its key (checked with a
// test call that also lists its models, kept in the Keychain, shown only as a mask) and the model. The app's own
// window only.
import { agentSetup, modelsFor, removeKey, setKey, setModel, setProvider } from "@/studio/server/agent-keys";
import { type AgentProvider, isProvider } from "@/studio/server/agent-providers";
import { explain, StudioError } from "@/studio/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

const provider = (v: unknown): AgentProvider => {
	if (!isProvider(v)) throw new StudioError("Unknown provider.");
	return v;
};

const fail = (error: unknown) => json({ error: error instanceof StudioError ? error.message : explain(error) }, 400);

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	try {
		if (head === "setup") return json(agentSetup());
		if (head === "models") return json({ models: await modelsFor(provider(new URL(req.url).searchParams.get("provider")), req.signal) });
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	try {
		const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
		if (head === "key") return json(await setKey(provider(body.provider), String(body.key ?? ""), { baseUrl: String(body.baseUrl ?? ""), signal: req.signal }));
		if (head === "remove") return json(removeKey(provider(body.provider)));
		if (head === "provider") return json(setProvider(provider(body.provider)));
		if (head === "model") return json(setModel(provider(body.provider), String(body.model ?? "")));
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}
