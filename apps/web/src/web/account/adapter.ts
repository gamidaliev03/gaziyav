// fal.ai for the page in the browser edition — what the Mac app's server answers at /api/fal (app/api/fal/[...path]):
//   GET  /api/fal/status   → { key, hint, choices, models, spent, kie, argo }   (never the key: its last four only)
//   POST /api/fal/model    { task, id } → the new status (the visitor's pick, kept in this browser)
//   POST /api/fal/check    → { ok } | { ok: false, error }   (asks fal whether it takes the key)
//   GET  /api/fal/balance  → { balance }   (fal tells it to an admin key only: otherwise null, never a guess)
// Prices are the catalog's (fal/models.ts): the numbers on the buttons are the ones every browser job bills by.
import { apiOf, chosenModel, FAL_MODELS, FAL_TASKS, type FalTask, modelsFor } from "@/fal/models";
import { failure, json, jsonBody, matches, pageLang, type Route } from "../answer";
import { keyHint, readKey } from "../lipsync/key";
import type { WebAiAdapter } from "../lipsync/adapter";
import { QUEUE, type Provider } from "../lipsync/provider";
import { type Lang, say, WebLipError } from "../lipsync/sentences";

export const CHOICES_SLOT = "gz-web-fal-models";
const KEYS = { fal: true, kie: false, argo: false } as const;
const ACCOUNT = "https://api.fal.ai";

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): KV | null => {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
};

/** The visitor's model picks (one per task), as the Mac keeps falModels in its settings. */
export function readChoices(kv: KV | null = store()): Partial<Record<FalTask, string>> {
	try {
		const j = JSON.parse(kv?.getItem(CHOICES_SLOT) ?? "{}");
		return j && typeof j === "object" && !Array.isArray(j) ? (j as Partial<Record<FalTask, string>>) : {};
	} catch {
		return {};
	}
}

const ROUTES: Route[] = [
	["GET", /^\/api\/fal\/status$/],
	["GET", /^\/api\/fal\/balance$/],
	["POST", /^\/api\/fal\/model$/],
	["POST", /^\/api\/fal\/check$/],
];

export function createAccount(d: { provider: Provider; key?: () => string | null; kv?: KV | null; lang?: () => Lang }) {
	const key = d.key ?? (() => readKey());
	const kv = d.kv === undefined ? store() : d.kv;
	const lang = d.lang ?? pageLang;
	const choices = () => readChoices(kv);
	const none = { key: false, hint: null, spent: { total: 0, byTask: {} } };

	function status() {
		const k = key();
		const picks = choices();
		return {
			key: !!k,
			hint: keyHint(k),
			choices: Object.fromEntries(FAL_TASKS.map((t) => [t.id, chosenModel(t.id, picks, KEYS).id])),
			models: FAL_MODELS,
			spent: { total: 0, byTask: {} },
			kie: none,
			argo: none,
		};
	}

	function choose(b: { task?: string; id?: string }) {
		const task = FAL_TASKS.find((t) => t.id === b.task)?.id;
		const id = String(b.id ?? "").trim();
		if (!task || !id) throw new WebLipError("web.bad_model");
		if (task === "llm") {
			if (!/^[\w.-]+\/[\w.:-]+$/.test(id)) throw new WebLipError("web.bad_model");
		} else {
			const m = modelsFor(task).find((x) => x.id === id);
			if (!m) throw new WebLipError("web.bad_model");
			// kie.ai's and ArgoLink's models run in the app only: the page holds one key, fal's
			if (apiOf(m) !== "fal") throw new WebLipError("web.model_app_only");
		}
		try {
			kv?.setItem(CHOICES_SLOT, JSON.stringify({ ...choices(), [task]: id }));
		} catch {}
		return status();
	}

	/** Whether fal takes the key: the status of a request that doesn't exist (free; a refused key answers 401/403). */
	async function check(): Promise<{ ok: true } | { ok: false; error: string }> {
		if (!key()) return { ok: false, error: say("web.no_key", lang()) };
		try {
			await d.provider.request(`${QUEUE}/fal-ai/flux/requests/00000000-0000-4000-8000-000000000000/status`, { method: "GET" });
			return { ok: true };
		} catch (error) {
			const k = error instanceof WebLipError ? error.key : "web.network";
			if (k === "web.key_refused" || k === "web.network" || k === "web.no_key") return { ok: false, error: say(k, lang()) };
			// «no such request» (or an empty balance): the key itself was accepted
			return { ok: true };
		}
	}

	async function balance(): Promise<number | null> {
		if (!key()) return null;
		try {
			const res = await d.provider.request(`${ACCOUNT}/v1/account/billing?expand=credits`, { method: "GET" }, AbortSignal.timeout(15_000));
			const v = ((await res.json()) as { credits?: { current_balance?: unknown } }).credits?.current_balance;
			return typeof v === "number" && Number.isFinite(v) ? v : null;
		} catch {
			return null;
		}
	}

	const adapter: WebAiAdapter = {
		handles: (path, method) => matches(ROUTES, path, method),
		async answer(path, init) {
			const head = path.split("?")[0].split("/")[3];
			try {
				if (head === "status") return json(status());
				if (head === "balance") return json({ balance: await balance() });
				if (head === "model") return json(choose(await jsonBody(init)));
				if (head === "check") return json(await check());
				return json({ error: "Unknown request" }, 404);
			} catch (error) {
				return failure(error, lang());
			}
		},
	};
	return { adapter, choices, status };
}

export type Account = ReturnType<typeof createAccount>;
