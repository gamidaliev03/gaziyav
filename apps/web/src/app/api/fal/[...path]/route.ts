// fal.ai for the page: whether the key is set (never the key), the models and their prices, the user's choices.
//   GET  /api/fal/status          → { key, hint, choices, models: [{…, live?}], spent }
//   POST /api/fal/check           → { ok } | { ok: false, error } (asks fal whether it takes the key)
//   POST /api/fal/model           { task, id } → the new status
import { checkKey, chooseModel, falBalance, keyHint, keysNow, livePrices, modelChoices, spent } from "@/fal/server";
import { ARGO_MODELS, chosenModel, FAL_MODELS, FAL_TASKS, type FalTask, KIE_MODELS, modelsFor } from "@/fal/models";
import { argoHint, argoSpent, checkArgoKey } from "@/argo/server";
import { checkKieKey, kieHint, kieSpent } from "@/kie/server";
import { explain, StudioError } from "@/studio/server/errors";
import { emptyNow } from "@/ai/empty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) => Response.json(data, { status });

function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

async function status() {
	const live = await livePrices();
	const choices = modelChoices();
	const keys = keysNow();
	const chosen = Object.fromEntries(FAL_TASKS.map((t) => [t.id, chosenModel(t.id, choices, keys).id]));
	return {
		key: !!keyHint(),
		hint: keyHint(),
		choices: chosen,
		models: [...FAL_MODELS.map((m) => ({ ...m, live: live[m.id] ?? (m.i2v ? live[m.i2v] : undefined) })), ...KIE_MODELS, ...ARGO_MODELS],
		spent: spent(),
		kie: { key: !!kieHint(), hint: kieHint(), spent: kieSpent() },
		argo: { key: !!argoHint(), hint: argoHint(), spent: argoSpent() },
		// providers that refused a paid job for an empty balance in the last 15 min → when (ai/empty.ts)
		empty: emptyNow(),
	};
}

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	try {
		if (head === "status") return json(await status());
		if (head === "balance") return json({ balance: await falBalance() });
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: explain(error) }, 400);
	}
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head] = (await ctx.params).path;
	try {
		if (head === "check") return json(await checkKey());
		if (head === "kie-check") return json(await checkKieKey());
		if (head === "argo-check") return json(await checkArgoKey());
		if (head === "model") {
			const b = (await req.json()) as { task?: string; id?: string };
			const task = FAL_TASKS.find((t) => t.id === b.task)?.id as FalTask | undefined;
			const id = String(b.id ?? "").trim();
			if (!task || !id) throw new StudioError("Pick a model.");
			if (task !== "llm" && !modelsFor(task).some((m) => m.id === id)) throw new StudioError("This model isn't offered for that.");
			if (task === "llm" && !/^[\w.-]+\/[\w.:-]+$/.test(id)) throw new StudioError("An OpenRouter model id looks like google/gemini-2.5-flash.");
			chooseModel(task, id);
			return json(await status());
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return json({ error: error instanceof StudioError ? error.message : explain(error) }, 400);
	}
}
