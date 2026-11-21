// Claude's money: every paid step priced from the app's own tables before it runs (the same numbers the buttons show:
// fal.ai, kie.ai, ArgoLink), the providers' balances, and this video's budget. By default (the taste profile's "balance"
// mode, A7) there is no per-video cap: a paid step stops only when its provider can't pay for it — its balance is lower,
// or it refused a job for an empty balance in the last 15 min (ai/empty.ts: «fal.ai: EMPTY (refused 02:09)»). A budget the
// user names for a video (price_plan {budget}), or the "video" mode, caps it. A step that runs says what it charged. The
// app's own buttons and Gaziyav AI keep asking the user in the app (cloud/spend.ts): none of this applies to them.
import { EditorCore } from "@/core";
import { checkArgoKey, checkKieKey, falBalance, keysOf, unitPrice, useFal } from "@/fal/client";
import { type FalModel, type FalTask, apiOf, chosenModel, falModel, modelsFor, price, usd } from "@/fal/models";
import type { AiApi } from "@/fal/video";
import { CREDIT_USD } from "@/kie/catalog";
import { chosenModel as studioLipsyncModel } from "@/studio/client/actions";
import { LIPSYNC_TAIL_SECONDS } from "@/studio/shared/models";
import { claudeCall } from "./context";

const HEADERS = { "X-Studio": "1", "Content-Type": "application/json" };
export const API_LABEL: Record<AiApi, string> = { fal: "fal.ai", kie: "kie.ai", argo: "ArgoLink" };

export interface Budget {
	limit: number;
	budget: number;
	own: boolean;
	spent: number;
	left: number;
	byApi: Record<string, number>;
	steps: Array<{ at: number; what: string; usd: number; api: string; job?: string }>;
	/** "balance": no per-video cap unless the user named this video's budget; "video": the budget caps every video. */
	mode?: "balance" | "video";
	/** Whether `left` stops a paid step. */
	capped?: boolean;
}

/** Whether this video's budget stops a step (older servers: always). */
const isCapped = (b: Budget) => b.capped !== false;

const projectId = () => EditorCore.getInstance().project.getActiveOrNull()?.metadata.id ?? "";

async function budgetCall(init?: RequestInit, query = ""): Promise<Budget> {
	const res = await fetch(`/api/mcp/budget${query}`, { headers: HEADERS, ...init });
	const j = (await res.json().catch(() => ({}))) as Budget & { error?: string };
	if (!res.ok || j.error) throw new Error(j.error || "Gaziyav couldn't read the budget. Try again.");
	return j;
}

export const readBudget = () => budgetCall(undefined, `?project=${encodeURIComponent(projectId())}`);
export const saveBudget = (usd: number) => budgetCall({ method: "POST", body: JSON.stringify({ project: projectId(), budget: usd }) });
const recordSpend = (what: string, usd: number, api: AiApi, job?: string) => budgetCall({ method: "POST", body: JSON.stringify({ project: projectId(), spend: { what, usd, api, ...(job ? { job } : {}) } }) });

/** «$0.40 of $1.00 spent, $0.60 left (fal.ai $0.30, kie.ai $0.10)»; in balance mode «$2.38 spent (…) · no per-video cap». */
export function budgetLine(b: Budget): string {
	const by = Object.entries(b.byApi)
		.filter(([, v]) => v > 0)
		.map(([api, v]) => `${API_LABEL[api as AiApi] ?? api} ${usd(v)}`)
		.join(", ");
	if (!isCapped(b)) return `this video: ${usd(b.spent)} spent${by ? ` (${by})` : ""} · no per-video cap: paid steps run while the provider's balance covers them`;
	return `this video: ${usd(b.spent)} of ${usd(b.budget)} spent, ${usd(b.left)} left${by ? ` (${by})` : ""}${b.own ? "" : " — the default budget; the user can name another"}`;
}

// ───────────────────────── balances ─────────────────────────

export interface Balance {
	key: boolean;
	usd: number | null;
	note?: string;
	/** When it refused a paid job for an empty balance (the last 15 min): its models are blocked until then. */
	empty?: number;
}

const clock = (at: number) => new Date(at).toTimeString().slice(0, 5);
/** «fal.ai: EMPTY (refused 02:09) — fal.ai models blocked». */
export const emptyLine = (api: AiApi, at: number) => `${API_LABEL[api]}: EMPTY (refused ${clock(at)}) — ${API_LABEL[api]} models blocked`;

/** Which providers have a key, and what each has left (null: the provider doesn't say). */
export async function balances(): Promise<Record<AiApi, Balance>> {
	const s = await useFal.getState().refresh();
	const out: Record<AiApi, Balance> = { fal: { key: !!s?.key, usd: null }, kie: { key: !!s?.kie.key, usd: null }, argo: { key: !!s?.argo.key, usd: null } };
	for (const [api, at] of Object.entries(s?.empty ?? {}) as Array<[AiApi, number]>) if (out[api] && typeof at === "number") out[api].empty = at;
	await Promise.all([
		out.fal.key
			? falBalance().then((v) => {
					out.fal.usd = v;
				})
			: null,
		out.kie.key
			? checkKieKey()
					.then((r) => {
						if (r.ok && typeof r.credits === "number") Object.assign(out.kie, { usd: r.credits * CREDIT_USD, note: `${Math.round(r.credits)} credits` });
						else out.kie.note = r.error;
					})
					.catch(() => {})
			: null,
		out.argo.key
			? checkArgoKey()
					.then((r) => {
						if (r.ok && typeof r.available === "number") out.argo.usd = r.available;
						else out.argo.note = r.error;
					})
					.catch(() => {})
			: null,
	]);
	// a balance read now says more than a refusal remembered: a positive one (a top-up) lifts the EMPTY mark
	for (const b of Object.values(out)) if (b.empty && b.usd !== null && b.usd > 0) delete b.empty;
	return out;
}

const balanceText = (b: Record<AiApi, Balance>) =>
	(Object.keys(b) as AiApi[])
		.map((api) => (b[api].key && b[api].empty ? emptyLine(api, b[api].empty as number) : b[api].key && b[api].usd !== null && (b[api].usd as number) <= 0 ? `${API_LABEL[api]}: EMPTY (${usd(0)}) — ${API_LABEL[api]} models blocked` : `${API_LABEL[api]} ${!b[api].key ? "no key" : b[api].usd === null ? "balance not reported" : `${usd(b[api].usd as number)}${b[api].note ? ` (${b[api].note})` : ""}`}`))
		.join(" · ");

/** A provider that can't pay for anything now: no key, refused for an empty balance lately, or a balance read at $0. */
const dry = (b: Balance) => !b.key || !!b.empty || (b.usd !== null && b.usd <= 0);
/** Whether a provider can't take a paid step now: dry, or a balance under `cost`. */
const blocked = (b: Balance, cost: number) => dry(b) || (b.usd !== null && b.usd + 1e-9 < cost);

// ───────────────────────── the gate on every paid Claude step ─────────────────────────

/**
 * Throws (nothing spent) when this step would pass the video's budget (when it has a cap) or its provider can't pay for it.
 * `other`: the same step on another provider, named in the refusal («use … instead»).
 */
export async function gate(what: string, cost: number, api: AiApi, other?: string, again = false): Promise<Budget> {
	const b = await readBudget();
	if (isCapped(b) && cost > b.left + 1e-9) {
		throw new Error(
			`Not run: ${what} costs ${usd(cost)} on ${API_LABEL[api]}, more than this video's budget has left (${usd(b.left)} of ${usd(b.budget)}). Nothing was spent. Pick a cheaper option (price_plan with model:"cheapest", shorter, lower quality) or ask the user once whether to raise the budget; if yes, price_plan {budget: <new total>} and call again.`,
		);
	}
	const bal = (await balances())[api];
	const instead = other ? ` Use ${other} instead.` : " Use a model on another provider (price_plan {kind, mode} lists them).";
	if (!bal.key) throw new Error(`Not run: there is no ${API_LABEL[api]} key.${instead} Or tell the user to add it in Gaziyav → Settings → Services.`);
	// (again:true: the user says it was topped up — one more try; a refusal marks it again, a job taken clears it)
	if (bal.empty && !again) throw new Error(`Not run: ${emptyLine(api, bal.empty)} (it refused a paid job for an empty balance; kept 15 min). Nothing was spent.${instead} Or tell the user to top it up; once they have, the same call with again:true tries it.`);
	if (bal.usd !== null && bal.usd + 1e-9 < cost) throw new Error(`Not run: ${API_LABEL[api]} has ${usd(bal.usd)} left, this costs ${usd(cost)}. Nothing was spent.${instead} Or tell the user to top it up.`);
	return b;
}

/** The providers that can't take a paid step now (no key, empty lately): models on them are passed over when picking. */
export async function blockedApis(): Promise<Set<AiApi>> {
	const b = await balances();
	return new Set((Object.keys(b) as AiApi[]).filter((api) => dry(b[api])));
}

/** After a paid step ran: what it charged, kept for this video (once per generation: `job`); the line Claude reports. */
export async function charged(what: string, cost: number, api: AiApi, job?: string): Promise<string> {
	const b = await recordSpend(what, cost, api, job);
	return `charged ${usd(cost)} on ${API_LABEL[api]} · ${budgetLine(b)}`;
}

/** A Claude call (not the user's buttons or Gaziyav AI): only then the budget applies. */
export const underBudget = () => claudeCall() !== null;

// ───────────────────────── prices of planned steps ─────────────────────────

export interface PlanItem {
	kind: "image" | "video" | "voice" | "lipsync" | "face_swap";
	model?: string;
	mode?: string;
	duration?: number;
	quality?: string;
	aspect?: string;
	count?: number;
	chars?: number;
	audio?: boolean;
	/** How many reference pictures go with it (cast photos, a style): some models follow fewer, some charge per picture. */
	refs?: number;
}

interface Priced {
	line: string;
	each: number;
	total: number;
	api: AiApi | null;
	model?: string;
	error?: string;
}

interface CloudModel {
	id: string;
	title: string;
	api?: AiApi;
	usd?: number;
	limits?: { supported_durations_seconds?: number[]; supported_qualities?: string[]; supported_aspect_ratios?: string[] };
}

async function cloud<T>(path: string, body?: unknown): Promise<T> {
	const res = await fetch(`/api/cloud/${path}`, { method: body === undefined ? "GET" : "POST", headers: HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	const j = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
	return j;
}

const canvasAspect = () => {
	const c = EditorCore.getInstance().project.getActiveOrNull()?.settings.canvasSize;
	return c && c.width > c.height ? "16:9" : "9:16";
};

async function cloudModels(kind: "image" | "video", mode?: string): Promise<CloudModel[]> {
	return (await cloud<{ models?: CloudModel[] }>(`models/${kind}${mode ? `?mode=${encodeURIComponent(mode)}` : ""}`)).models ?? [];
}

/** What the server's one resolver (cloud/server.ts resolveVideoModel) says a named id means for a mode. */
export type Resolved = { id: string; note?: string } | { error: string };

/**
 * A kind's (and a video mode's) models, and the model a named id means there — generate and price_plan pick with this,
 * so a plan is generated and charged the same: an id of another mode is its family's model of this mode (said), any
 * other unknown id is refused with the mode's ids before anything is paid (B4/A20/C9).
 */
export async function cloudModelsFor(kind: "image" | "video", mode: string | undefined, named?: string): Promise<{ list: CloudModel[]; resolved?: Resolved }> {
	const m = kind === "video" ? mode || "text" : undefined;
	const q = [m ? `mode=${encodeURIComponent(m)}` : "", named && named !== "cheapest" && kind === "video" ? `model=${encodeURIComponent(named)}` : ""].filter(Boolean).join("&");
	const j = await cloud<{ models?: CloudModel[]; resolved?: Resolved }>(`models/${kind}${q ? `?${q}` : ""}`);
	const list = j.models ?? [];
	if (!named || named === "cheapest") return { list };
	if (kind === "video") return { list, resolved: j.resolved };
	return { list, resolved: list.some((x) => x.id === named) ? { id: named } : { error: `There is no picture model «${named}». Picture models: ${list.slice(0, 24).map((x) => x.id).join(", ")}` } };
}

/** What a priced step is asked for: a model that makes exactly this wins over one that would round it. */
export interface Want {
	duration?: number;
	quality?: string;
	aspect?: string;
}

interface Limited {
	id: string;
	limits?: { supported_durations_seconds?: number[]; supported_qualities?: string[]; supported_aspect_ratios?: string[] };
}

export interface Fit<M, I> {
	model: M;
	cost: number;
	input: I;
	/** How many of the models could do it, and whether the winner makes the length, quality and shape as asked. */
	of: number;
	exact: boolean;
}

/**
 * The cheapest of these models (one kind, one video mode, the APIs with a key) that takes the request: each model's own
 * request (`build`) is priced by the server's estimate, which also refuses what the model can't take (more pictures than
 * it follows, no last frame, a clip that is too long). The price compared is the one that would be charged, and a model
 * that makes the asked length, quality and shape exactly wins over one that would round them. price_plan and generate
 * both pick with this, so a plan priced «cheapest» is generated and charged the same.
 */
export async function cheapestOf<M extends Limited, I extends object>(kind: "image" | "video", list: M[], want: Want, build: (m: M) => I): Promise<Fit<M, I>> {
	const tried = await Promise.all(
		list.slice(0, 80).map(async (m) => {
			try {
				const input = build(m);
				return { m, input, cost: (await cloud<{ cost: number }>("estimate", input)).cost, why: "" };
			} catch (error) {
				return { m, input: {} as I, cost: Number.NaN, why: (error as Error).message };
			}
		}),
	);
	// A model without a known price (0) never wins «cheapest».
	const fits = tried.filter((t) => Number.isFinite(t.cost) && t.cost > 0);
	if (!fits.length) throw new Error(`no ${kind} model takes these inputs${tried.find((t) => t.why)?.why ? ` (${tried.find((t) => t.why)?.why})` : ""}`);
	const asked = (m: M) => {
		const d = m.limits?.supported_durations_seconds ?? [];
		const q = m.limits?.supported_qualities ?? [];
		const a = m.limits?.supported_aspect_ratios ?? [];
		return (kind !== "video" || !want.duration || !d.length || d.includes(want.duration)) && (!want.quality || !q.length || q.includes(want.quality)) && (!want.aspect || !a.length || a.includes(want.aspect));
	};
	const exact = fits.filter((t) => asked(t.m));
	const best = (exact.length ? exact : fits).reduce((a, b) => (b.cost < a.cost ? b : a));
	return { model: best.m, cost: best.cost, input: best.input, of: fits.length, exact: exact.length > 0 };
}

/** A planned step's request for one model, priced before anything is uploaded (the inputs as counts). */
function planInput(kind: "image" | "video", m: CloudModel, it: PlanItem): Record<string, unknown> {
	const durations = m.limits?.supported_durations_seconds ?? [];
	const want = Number(it.duration) || 5;
	const duration = durations.length ? durations.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : want;
	const aspect = it.aspect || canvasAspect();
	const mode = kind === "video" && it.mode && it.mode !== "text" ? it.mode : undefined;
	const refs = Math.max(0, Math.round(Number(it.refs) || 0));
	const input: Record<string, unknown> = { kind, prompt: "price", model: m.id };
	if (kind === "video") {
		input.duration_seconds = duration;
		if (mode) input.mode = mode;
		if (it.audio !== undefined) input.generate_audio = it.audio;
		// What the mode needs, without uploading it: the start (and last) frame, the pictures, the clip's or sound's length.
		if (mode === "image" || mode === "frames") input.reference_count = 1;
		if (mode === "frames") input.end_image_asset_ids = ["planned"];
		if (mode === "reference") input.reference_count = Math.max(1, refs);
		if (mode === "motion" || mode === "avatar") input.image_asset_ids = ["planned"];
		if (mode === "motion" || mode === "edit" || mode === "extend") input.reference_video_duration_seconds = want;
		if (mode === "avatar") input.reference_audio_duration_seconds = want;
	} else if (refs) input.reference_count = refs;
	if (m.limits?.supported_aspect_ratios?.includes(aspect)) input.aspect_ratio = aspect;
	const q = m.limits?.supported_qualities ?? [];
	if (it.quality && q.includes(it.quality)) input.quality = it.quality;
	else if (q.length) input.quality = q[0];
	return input;
}

async function priceCloud(it: PlanItem, n: number): Promise<Priced> {
	const kind = it.kind as "image" | "video";
	const { list, resolved } = await cloudModelsFor(kind, kind === "video" ? it.mode : undefined, it.model);
	if (!list.length) return { line: `${kind}: no model${it.mode && it.mode !== "text" ? ` does "${it.mode}"` : ""} (add a fal.ai, kie.ai or ArgoLink key in Settings → Services)`, each: 0, total: 0, api: null, error: "no model" };
	let picks = list;
	let note = "";
	if (it.model && it.model !== "cheapest") {
		if (!resolved || "error" in resolved) return { line: `${kind}: ${resolved && "error" in resolved ? resolved.error : `no model "${it.model}"`}`, each: 0, total: 0, api: null, error: "unknown model" };
		const m = list.find((x) => x.id === resolved.id);
		if (!m) return { line: `${kind}: no model "${it.model}" (price_plan {kind:"${kind}"${it.mode ? `, mode:"${it.mode}"` : ""}} lists them)`, each: 0, total: 0, api: null, error: "unknown model" };
		picks = [m];
		note = resolved.note ? ` (${resolved.note})` : "";
	} else {
		// Not on a provider that can't pay now (no key, empty lately): the cheapest of the rest; no model named: the default.
		const off = await blockedApis();
		const open = list.filter((x) => !off.has((x.api ?? "fal") as AiApi));
		const pool = open.length ? open : list;
		const d = !it.model ? pool.find((x) => (x as CloudModel & { default?: boolean }).default) : undefined;
		picks = d ? [d] : pool;
	}
	let fit: Fit<CloudModel, Record<string, unknown>>;
	try {
		fit = await cheapestOf(kind, picks, { duration: kind === "video" ? Number(it.duration) || 5 : undefined, quality: it.quality, aspect: it.aspect || canvasAspect() }, (m) => planInput(kind, m, it));
	} catch (error) {
		return { line: `${kind}: can't price (${(error as Error).message})`, each: 0, total: 0, api: null, error: (error as Error).message };
	}
	const api = (fit.model.api ?? "fal") as AiApi;
	const made = fit.input.duration_seconds ?? it.duration ?? 5;
	const what = kind === "video" ? `${made} s${fit.input.quality ? ` ${fit.input.quality}` : ""}${it.mode && it.mode !== "text" ? ` from ${it.mode}` : ""}` : `picture${it.refs ? ` with ${it.refs} reference${it.refs === 1 ? "" : "s"}` : ""}`;
	const which = picks.length > 1 ? ` · the cheapest of ${fit.of} that take it${fit.exact ? "" : " (none makes it exactly as asked: the nearest)"}` : "";
	return { line: `${kind} ×${n} · ${fit.model.title} [${fit.model.id}] (${API_LABEL[api]}) · ${what} · ${usd(fit.cost)} each${which}${note}`, each: fit.cost, total: fit.cost * n, api, model: fit.model.id };
}

function choose(task: FalTask, it: PlanItem, amount: number): FalModel | null {
	const s = useFal.getState().status;
	if (it.model && it.model !== "cheapest") return falModel(it.model) ?? null;
	// (lipsync with no model named: the one the pipeline will really run — this project's pick, else Settings → Services)
	if (!it.model && task === "lipsync") return falModel(studioLipsyncModel(projectId()).id) ?? chosenModel(task, s?.choices, keysOf(s));
	const fits = (m: FalModel) => (m.maxSeconds === undefined || amount <= m.maxSeconds) && (m.minSeconds === undefined || amount >= m.minSeconds);
	if (it.model === "cheapest") {
		const list = modelsFor(task, keysOf(s)).filter(fits);
		return list.sort((a, b) => price(a, amount, unitPrice(a)) - price(b, amount, unitPrice(b)))[0] ?? null;
	}
	return chosenModel(task, s?.choices, keysOf(s));
}

function priceTable(it: PlanItem, n: number): Priced {
	const chars = Math.max(1, Math.round(Number(it.chars) || 300));
	const seconds = Math.max(1, Number(it.duration) || (it.chars ? chars / 15 : 10));
	if (it.kind === "voice") {
		const m = choose("tts", it, chars);
		if (!m) return { line: `voice: no model "${it.model}"`, each: 0, total: 0, api: null, error: "unknown model" };
		const each = price(m, chars, unitPrice(m));
		return { line: `voice ×${n} · ${m.title} (${API_LABEL[apiOf(m)]}) · ${chars} characters · ${usd(each)} each`, each, total: each * n, api: apiOf(m), model: m.id };
	}
	if (it.kind === "face_swap") {
		const m = choose("faceswap", it, seconds);
		if (!m) return { line: "face_swap: no model", each: 0, total: 0, api: null, error: "no model" };
		const each = price(m, seconds, unitPrice(m));
		return { line: `face_swap ×${n} · ${m.title} (${API_LABEL[apiOf(m)]}) · ${seconds} s · ${usd(each)} each`, each, total: each * n, api: apiOf(m), model: m.id };
	}
	const lip = choose("lipsync", it, seconds + LIPSYNC_TAIL_SECONDS);
	if (!lip) return { line: `lipsync: no model "${it.model}"`, each: 0, total: 0, api: null, error: "unknown model" };
	const lipUsd = price(lip, seconds + LIPSYNC_TAIL_SECONDS, unitPrice(lip));
	// New words in the person's own voice: the voice is cloned once and spoken by fal's speech model.
	const s = useFal.getState().status;
	const tts = chosenModel("tts", s?.choices, { fal: true, kie: false, argo: false });
	const voiceUsd = it.chars ? price(tts, chars, unitPrice(tts)) + price(chosenModel("clone", s?.choices)) : 0;
	const each = lipUsd + voiceUsd;
	return { line: `lipsync ×${n} · ${lip.title} (${API_LABEL[apiOf(lip)]}) · ${Math.round(seconds)} s${it.chars ? ` + the voice ${usd(voiceUsd)}` : ""} · ${usd(each)} each`, each, total: each * n, api: apiOf(lip), model: lip.id };
}

/** price_plan: every item priced, the total against the budget, the balances; `budget` saves the user's budget first. */
export async function pricePlan(args: Record<string, unknown>): Promise<string> {
	if (args.budget !== undefined) {
		const v = Number(args.budget);
		if (!Number.isFinite(v) || v < 0) throw new Error("budget: a number of US dollars, e.g. 5.");
		await saveBudget(v);
	}
	const items = (Array.isArray(args.items) ? args.items : []) as PlanItem[];
	const [b, bal] = await Promise.all([readBudget(), balances()]);
	if (!items.length) {
		if (!args.kind) return `Spent: ${budgetLine(b)}.\nBalances: ${balanceText(bal)}.${args.budget !== undefined ? "" : "\nGive items to price a plan, or kind (and mode) to list the models with prices."}`;
		return `${await modelList(String(args.kind), typeof args.mode === "string" ? args.mode : undefined)}\nBudget: ${budgetLine(b)}.\nBalances: ${balanceText(bal)}.`;
	}
	await useFal.getState().refresh();
	const priced: Priced[] = [];
	for (const it of items.slice(0, 40)) {
		const n = Math.max(1, Math.min(50, Math.round(Number(it.count) || 1)));
		try {
			priced.push(it.kind === "image" || it.kind === "video" ? await priceCloud(it, n) : priceTable(it, n));
		} catch (error) {
			priced.push({ line: `${it.kind}: can't price (${(error as Error).message})`, each: 0, total: 0, api: null, error: (error as Error).message });
		}
	}
	const total = priced.reduce((sum, p) => sum + p.total, 0);
	const byApi: Partial<Record<AiApi, number>> = {};
	for (const p of priced) if (p.api && p.total) byApi[p.api] = (byApi[p.api] ?? 0) + p.total;
	const short = (Object.keys(byApi) as AiApi[]).filter((api) => blocked(bal[api], byApi[api] ?? 0));
	const capped = isCapped(b);
	const over = capped && total > b.left + 1e-9;
	const fits = !over && !short.length && !priced.some((p) => p.error);
	const lines = priced.map((p, i) => `${i + 1}. ${p.line}${p.total && p.total !== p.each ? ` = ${usd(p.total)}` : ""}`);
	lines.push(`Total ${usd(total)} · ${budgetLine(b)}.`);
	lines.push(
		fits
			? capped
				? `Fits: ${usd(b.left - total)} would be left. Go ahead; each paid call says what it charged.`
				: "The balances cover it. Go ahead; each paid call says what it charged."
			: over
				? `Over the budget by ${usd(total - b.left)}: use free sources (library, motion layers, web images, the user's media) or cheaper items (model:"cheapest", shorter, lower quality); or ask the user once to raise the budget (price_plan {budget}).`
				: short.length
					? `Can't pay on ${short.map((a) => (bal[a].empty ? emptyLine(a, bal[a].empty as number) : !bal[a].key ? `${API_LABEL[a]} (no key)` : `${API_LABEL[a]} (balance ${usd(bal[a].usd as number)})`)).join("; ")}: pick models on another provider (model:"cheapest" passes over it), or the user tops it up.`
					: "Some items can't be priced: fix them (see above).",
	);
	lines.push(`Balances: ${balanceText(bal)}.`);
	return lines.join("\n");
}

/** The models of a kind (a video mode's) with their prices, cheapest first (what the pickers show). */
async function modelList(kind: string, mode?: string): Promise<string> {
	if (kind === "image" || kind === "video") {
		const m = kind === "video" ? mode || "text" : undefined;
		const list = await cloudModels(kind, m);
		return `${kind}${m ? ` ${m}-mode` : ""} models (cheapest first; price per ${kind === "video" ? "second at the model's start settings" : "picture"}${kind === "video" ? "; other modes: price_plan {kind:\"video\", mode}" : ""}):\n${list
			.slice(0, 30)
			.map((m) => `- ${m.id} · ${m.title} (${API_LABEL[(m.api ?? "fal") as AiApi]}) ${m.usd !== undefined ? usd(m.usd) : "?"}${kind === "video" && m.limits?.supported_durations_seconds?.length ? ` · ${m.limits.supported_durations_seconds.join("/")} s` : ""}${m.limits?.supported_qualities?.length ? ` · ${m.limits.supported_qualities.join("/")}` : ""}${(m as { default?: boolean }).default ? " · default" : ""}`)
			.join("\n")}`;
	}
	const task: FalTask = kind === "voice" ? "tts" : kind === "face_swap" ? "faceswap" : "lipsync";
	const s = useFal.getState().status ?? (await useFal.getState().refresh());
	const pick = chosenModel(task, s?.choices, keysOf(s));
	return `${kind} models (cheapest first):\n${modelsFor(task, keysOf(s))
		.map((m) => `- ${m.id} · ${m.title} (${API_LABEL[apiOf(m)]}) ${usd(unitPrice(m))}/${m.unit}${m.id === pick.id ? " · in use" : ""}`)
		.join("\n")}${kind === "voice" ? "\n(generate kind:voice speaks through the one in use, paid by characters; the ready voices are its speakers.)" : kind === "lipsync" ? "\n(generate kind:lipsync takes model: one of these ids or \"cheapest\"; without it the one in use runs.)" : ""}`;
}
