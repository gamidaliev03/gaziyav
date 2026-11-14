// fal.ai for the server: the user's one key, the queue API (submit → status → result, cancel), uploads to fal's
// storage, result downloads and the live prices. Every AI feature (lipsync, voice, clone, pictures, video, face swap,
// the agent) goes through here.
//
// The key: the app keeps it encrypted with the Mac's Keychain (Electron safeStorage, main.js) and hands it to this
// process as a message — it is never written in clear, never logged and never sent to the page.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CancelledError, limitText, StudioError, throwIfAborted } from "@/studio/server/errors";
import { brief, call, download, getJson, httpError, routed as routedUrl, sleep, uploadSeconds } from "@/studio/server/http";
import { loadSettings, saveSettings, studioHome } from "@/studio/server/settings";
import { argoKey, listenForArgoKey } from "@/argo/server";
import { vpnShort } from "@/net/proxy";
import { paidMap } from "@/ai/paid-jobs";
import { clearEmpty, noteEmpty } from "@/ai/empty";
import { kieKey, listenForKieKey } from "@/kie/server";
import { chosenModel, cloneTts, FAL_MODELS, FAL_ONLY, FAL_TASKS, type FalModel, type FalTask, liveUnit } from "./models";
import type { Keys } from "./video";

const QUEUE = "https://queue.fal.run";
const REST = "https://rest.fal.ai";
const API = "https://api.fal.ai";
/** OpenRouter's models through fal, OpenAI-compatible (the agent, scripts, the dub's translation). */
export const FAL_LLM_BASE = "https://fal.run/openrouter/router/openai/v1";
const SERVICE = "fal.ai";
// (read when used, not when this file loads: the unit tests set it per file — http.ts has the same rule)
const TEST = () => process.env.STUDIO_TEST === "1";

// ───────────────────────── the key ─────────────────────────

const SLOT = "__gaziyavFalKey";
type Holder = { [SLOT]?: string | null; __gaziyavFalListening?: boolean };
const g = globalThis as Holder;

/** Listens for the key from the app (main.js sends it at start and whenever it changes in Settings). */
export function listenForKey() {
	listenForKieKey();
	listenForArgoKey();
	const port = (process as unknown as { parentPort?: { on: (e: string, f: (m: unknown) => void) => void; postMessage: (m: unknown) => void } }).parentPort;
	if (!port || g.__gaziyavFalListening) return;
	g.__gaziyavFalListening = true;
	port.on("message", (m) => {
		const d = ((m as { data?: unknown })?.data ?? m) as { type?: string; key?: unknown };
		if (d?.type === "fal-key") g[SLOT] = typeof d.key === "string" && d.key.trim() ? d.key.trim() : null;
	});
	port.postMessage({ type: "fal-key-request" });
}

export function falKey(): string | null {
	listenForKey();
	const k = g[SLOT];
	if (k) return k;
	if (TEST() && process.env.STUDIO_TEST_FAL_KEY) return process.env.STUDIO_TEST_FAL_KEY;
	// Started from a terminal with FAL_KEY and nothing saved in Settings yet.
	if (k === undefined && process.env.FAL_KEY) return process.env.FAL_KEY.trim() || null;
	return null;
}

/** The key's last four characters, for Settings («…ab12»). */
export function keyHint(): string | null {
	const k = falKey();
	return k ? `…${k.slice(-4)}` : null;
}

function requireKey(): string {
	const k = falKey();
	if (!k) throw new StudioError("Add your fal.ai key first: Settings → AI (fal.ai).");
	return k;
}

const auth = () => ({ Authorization: `Key ${requireKey()}` });

// ───────────────────────── the models the user picked ─────────────────────────

/** Which APIs have a key now. */
export const keysNow = (): Keys => ({ fal: !!falKey(), kie: !!kieKey(), argo: !!argoKey() });

/**
 * The model each task runs on: ONE pick per task, whichever API it is on (`falModels` in the settings file). A file from
 * the time of the fal/kie switch is carried over once: with kie on, its pick (else the default) wins, otherwise fal's.
 */
export function modelChoices(): Partial<Record<FalTask, string>> {
	const s = loadSettings();
	if (s.aiApi === "kie" || Object.keys(s.kieModels).length) {
		const picks = { ...s.falModels };
		if (s.aiApi === "kie") for (const t of FAL_TASKS) if (!FAL_ONLY.includes(t.id)) (s.kieModels[t.id] ? (picks[t.id] = s.kieModels[t.id]) : delete picks[t.id]);
		saveSettings({ falModels: picks, aiApi: "fal", kieModels: {} });
		return picks as Partial<Record<FalTask, string>>;
	}
	return s.falModels as Partial<Record<FalTask, string>>;
}

/** The model a task runs on now: the pick, or the default of an API that has a key. Its `api` is where the job goes. */
export const modelFor = (task: FalTask): FalModel => chosenModel(task, modelChoices(), keysNow());

/** fal's speech model, for the voices only fal has (clones). */
export const chosenTts = (): FalModel => cloneTts(modelChoices());

export const chooseModel = (task: FalTask, id: string) => saveSettings({ falModels: { ...modelChoices(), [task]: id } });

// ───────────────────────── what was spent ─────────────────────────

const spendFile = () => path.join(studioHome(), "fal-spend.json");

export function spent(): { total: number; byTask: Record<string, number>; tokens?: number } {
	try {
		const j = JSON.parse(fs.readFileSync(spendFile(), "utf8"));
		return { total: Number(j.total) || 0, byTask: j.byTask && typeof j.byTask === "object" ? j.byTask : {}, ...(Number(j.tokens) > 0 ? { tokens: Number(j.tokens) } : {}) };
	} catch {
		return { total: 0, byTask: {} };
	}
}

/** Adds a finished run's price (fal's list price; the bill on fal.ai is the exact one). LLM steps also count their tokens. */
export function addSpend(task: FalTask, usd: number, tokens = 0) {
	if (!(usd > 0) && !(tokens > 0)) return;
	const s = spent();
	s.total += usd > 0 ? usd : 0;
	if (usd > 0) s.byTask[task] = (s.byTask[task] ?? 0) + usd;
	if (tokens > 0) s.tokens = (s.tokens ?? 0) + tokens;
	fs.mkdirSync(studioHome(), { recursive: true });
	fs.writeFileSync(spendFile(), JSON.stringify(s), { mode: 0o600 });
}

/** The unit price a run is billed by in «Spent»: fal's live price when known and in the catalog's unit (what the button showed), else the catalog's. */
export function liveUnitPrice(m: FalModel): number {
	return liveUnit(m, priceCache?.prices[m.id]);
}

// ───────────────────────── errors ─────────────────────────

/** fal's validation answers ({detail: [{loc, msg}]}) as one sentence. */
function falDetail(body: unknown): string {
	const d = (body as { detail?: unknown; error?: unknown; message?: unknown })?.detail ?? (body as { error?: unknown })?.error ?? (body as { message?: unknown })?.message;
	if (typeof d === "string") return d;
	if (Array.isArray(d)) return d.map((x) => [Array.isArray(x?.loc) ? x.loc.filter((p: unknown) => p !== "body").join(".") : "", x?.msg ?? ""].filter(Boolean).join(": ")).join("; ");
	return d ? JSON.stringify(d).slice(0, 300) : "";
}

const BALANCE_SENTENCE = "fal.ai: the account balance is empty. Top it up on fal.ai (Billing), then press Retry. Nothing was charged.";
const REFUSED_SENTENCE = "fal.ai's safety filter refused this request. Change the description or the picture, or pick another model.";
const REFUSED = /content_policy_violation|model_moderated|content polic|safety (filter|checker|check)|flagged|nsfw|moderat/i;

/** What fal's filter flagged, by the input's name: «image_url», «prompt», «audio_url»… (its 422 says it in `loc`). */
export type RefusedField = string;
/** The input fields fal names, as the words Claude and the user read. */
const FIELD_WORDS: Array<[RegExp, string]> = [
	[/prompt|text/i, "the description"],
	[/audio/i, "the sound"],
	[/video/i, "the clip"],
	[/image|frame|photo|picture/i, "the picture"],
];
export const refusedWhat = (field: string) => FIELD_WORDS.find(([re]) => re.test(field))?.[1] ?? "the request";

/** fal's flagged field in a refusal: the `loc` of a content_policy_violation detail, or a field named in its text. */
function refusedField(text: string): RefusedField | null {
	try {
		const d = (JSON.parse(text) as { detail?: unknown }).detail;
		if (Array.isArray(d)) {
			for (const x of d as Array<{ loc?: unknown; msg?: unknown; type?: unknown }>) {
				if (!REFUSED.test(`${x?.type ?? ""} ${x?.msg ?? ""}`) || !Array.isArray(x.loc)) continue;
				const loc = x.loc.filter((p: unknown) => p !== "body" && typeof p === "string").join(".");
				if (loc) return loc;
			}
		}
	} catch {}
	return /\b(image_urls?|start_image_url|end_image_url|first_frame_url|last_frame_url|prompt|audio_url|video_url)\b/.exec(text)?.[1] ?? null;
}

/** The safety refusal: the sentence the page shows, and in its details what was flagged (the job remembers it). */
function refusal(text: string): StudioError {
	const field = refusedField(text);
	const error = new StudioError(field ? `${REFUSED_SENTENCE}\n\nDetails: fal.ai flagged ${refusedWhat(field)} (${field})` : REFUSED_SENTENCE);
	return Object.assign(error, { refused: field ?? "request" });
}

/**
 * fal's sentence for an answer, or null when it has none. The words are read first: a locked account is refused like a
 * bad key, and a 422 echoes the request's `input`, so the balance's words count only outside a 422 (a refused
 * description with «credit» in it read as an empty balance).
 */
function falSentence(status: number, text: string): StudioError | null {
	const bare = status === 422 ? "" : text;
	if (status === 402 || /exhausted[_ ]balance|insufficient (balance|credit|funds)|user is locked|account is locked|top up|billing/i.test(bare)) {
		// remembered for 15 min: price_plan says fal is empty, Claude's paid steps on it stop before uploading (ai/empty.ts)
		noteEmpty("fal");
		return new StudioError(BALANCE_SENTENCE);
	}
	if (status === 401 || status === 403) return new StudioError(`fal.ai didn't accept the key. Check it in Settings → AI (fal.ai).${brief(text) ? `\n\nDetails: HTTP ${status} — ${brief(text)}` : ""}`);
	if (status === 422) {
		if (REFUSED.test(text)) return refusal(text);
		let detail = "";
		try {
			detail = falDetail(JSON.parse(text));
		} catch {
			detail = brief(text);
		}
		return new StudioError(`fal.ai didn't accept these settings: ${detail || "invalid input"}.`);
	}
	return null;
}

async function failure(res: Response): Promise<StudioError> {
	const text = await res.text().catch(() => "");
	return falSentence(res.status, text) ?? httpError(SERVICE, res.status, text, res.statusText);
}

// ───────────────────────── the queue ─────────────────────────

export interface FalRequest {
	endpoint: string;
	requestId: string;
	statusUrl: string;
	responseUrl: string;
	cancelUrl: string;
}

/** owner/app of an endpoint (status, result and cancel live there, not under a sub-path). */
const appOf = (endpoint: string) => endpoint.split("/").slice(0, 2).join("/");

const SILENT_MS = () => (TEST() && Number(process.env.STUDIO_TEST_FAL_SILENT_MS)) || 3 * 60_000;

export async function submit(endpoint: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<FalRequest> {
	const res = await fetchFal(`${QUEUE}/${endpoint}`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(input) }, { signal, retry: "submit", timeout: 60 });
	const j = (await res.json().catch(() => ({}))) as { request_id?: string; status_url?: string; response_url?: string; cancel_url?: string };
	if (!j.request_id) throw new StudioError("fal.ai didn't start the job. Press Retry.");
	// a paid job accepted: the balance isn't empty (any more)
	clearEmpty("fal");
	const base = `${QUEUE}/${appOf(endpoint)}/requests/${j.request_id}`;
	return { endpoint, requestId: j.request_id, statusUrl: j.status_url || `${base}/status`, responseUrl: j.response_url || base, cancelUrl: j.cancel_url || `${base}/cancel` };
}

/** fetch with the shared retries (http.ts), but fal's own error sentences. */
async function fetchFal(url: string, init: RequestInit, opts: { signal?: AbortSignal; retry: "poll" | "submit" | "none"; timeout: number }): Promise<Response> {
	try {
		return await call(url, init, { service: SERVICE, ...opts });
	} catch (error) {
		// call() throws httpError for non-2xx: its «Details: HTTP 403 — …» line is read for fal's own sentences.
		const m = /Details: HTTP (\d{3})(?: — ([\s\S]*))?$/.exec((error as Error).message ?? "");
		if (m) {
			const sentence = falSentence(Number(m[1]), m[2] ?? "");
			if (sentence) throw sentence;
		}
		throw error;
	}
}

export async function cancel(req: FalRequest): Promise<void> {
	// (the key removed in Settings while a job runs: nothing to cancel it with, and no unhandled rejection either)
	const key = falKey();
	if (!key) return;
	await fetch(routedUrl(req.cancelUrl), { method: "PUT", headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(10_000) })
		.then((r) => r.body?.cancel())
		.catch(() => {});
}


export interface RunOptions {
	signal?: AbortSignal;
	/** «waiting in the queue · 3 ahead», «working on fal.ai» */
	onStatus?: (text: string) => void;
	/** 0…1, estimated from the time the model usually takes (fal sends no percent to callers). */
	onProgress?: (p: number) => void;
	/** Seconds this run usually takes (the progress bar's pace). */
	expectSeconds?: number;
	/** Gives up after this many seconds in all (queue + work). */
	timeoutSeconds?: number;
	/** The queued request, as soon as fal accepted it (to cancel it from elsewhere). */
	onSubmitted?: (req: FalRequest) => void;
	/** What this job makes, when its input holds links made per run (uploads): names the paid job for a retry. */
	resumeKey?: string;
}

/**
 * Paid jobs whose file isn't on this Mac yet: fal bills a finished job, and Retry after a dropped connection or a failed
 * download would pay for it again. It comes back to the same request instead. Gone once the file is saved
 * (fetchResult), when fal says the job failed, or when it was cancelled: «Generate» again is always a new take.
 */
type PaidJob = { req: FalRequest; at: number; answer?: unknown; urls: string[]; following?: boolean };
const PAID_HOLD_MS = 3 * 3600 * 1000;
// (kept on disk too, ai/paid-jobs.ts: a restart in the middle of a job must not make the next Generate pay again)
const paidJobs = paidMap<PaidJob & { at: number }>("fal");

/** Every link in a fal answer (where its files are). */
function linksIn(value: unknown, out: string[] = []): string[] {
	if (typeof value === "string") {
		if (/^https?:\/\//.test(value)) out.push(value);
	} else if (value && typeof value === "object") for (const v of Object.values(value)) linksIn(v, out);
	return out;
}

/** One fal job, start to finish: submit, follow it, return its answer. Cancelling the signal cancels it on fal. */
export async function runFal<T = Record<string, unknown>>(endpoint: string, input: Record<string, unknown>, o: RunOptions = {}): Promise<T> {
	throwIfAborted(o.signal);
	let key = o.resumeKey ?? crypto.createHash("sha1").update(`${endpoint}\n${JSON.stringify(input)}`).digest("hex");
	const held = paidJobs.get(key);
	// Only a run that has ended is come back to: the same request twice at once is two takes, two jobs.
	if (held?.following) key = `${key}:${crypto.randomUUID()}`;
	const kept = held && !held.following && Date.now() - held.at < PAID_HOLD_MS ? held : undefined;
	if (kept?.answer) {
		o.onProgress?.(1);
		return kept.answer as T;
	}
	const req = kept?.req ?? (await submit(endpoint, input, o.signal));
	if (kept) kept.following = true;
	else paidJobs.set(key, { req, at: Date.now(), urls: [], following: true });
	o.onSubmitted?.(req);
	const started = Date.now();
	const limit = (TEST() && Number(process.env.STUDIO_TEST_FAL_LIMIT)) || (o.timeoutSeconds ?? 1800) * 1000;
	const expect = Math.max(5, o.expectSeconds ?? 60) * 1000;
	let working = 0;
	let misses = 0;
	let lastMiss: unknown = null;
	// fal answering nothing at all for SILENT_MS (every poll timed out or dropped): the job ends with words instead of
	// polling for its whole half hour; the paid job is kept, so Retry follows it (never charged twice). IDEAL reliable §3.
	let silentSince = 0;
	let pollAt = 0;
	const step = TEST() ? 150 : 1500;
	try {
		for (;;) {
			throwIfAborted(o.signal);
			if (Date.now() - started > limit) {
				// The time ran out while the line was down: the job is still running (and billed) on fal, and a cancel would not
				// get there either. The row stays, the last word of the network is the error: Retry follows the same job.
				if (misses > 0 && lastMiss) throw lastMiss;
				void cancel(req);
				paidJobs.delete(key);
				throw new StudioError(`fal.ai didn't finish within ${limitText(limit)}. The job was cancelled; press Retry.`, { key: "fal.timeout", vars: { limit: limitText(limit), seconds: Math.round(limit / 1000) } });
			}
			// A paid job is never dropped over a bad minute of the network: polls keep trying until the time limit
			// (each poll already retries a few times inside getJson).
			let s: { status?: string; queue_position?: number; error?: string; error_type?: string };
			try {
				pollAt = Date.now();
				// two tries per poll (not five): the loop itself keeps polling, and a silent fal is seen within a minute
				s = (await getJson(`${req.statusUrl}${req.statusUrl.includes("?") ? "&" : "?"}logs=0`, auth(), { service: SERVICE, signal: o.signal, retry: "poll", timeout: 30, attempts: 2 })) as typeof s;
				misses = 0;
				silentSince = 0;
			} catch (error) {
				throwIfAborted(o.signal);
				silentSince ||= pollAt;
				if (Date.now() - silentSince > SILENT_MS()) {
					throw new StudioError(`fal.ai stopped answering ${limitText(SILENT_MS())} ago (${vpnShort() ?? "no answer from its servers"}). The job may still finish there: press Retry in a minute to pick it up, it isn't charged twice.`, { key: "fal.silent", vars: { limit: limitText(SILENT_MS()), seconds: Math.round(SILENT_MS() / 1000) } });
				}
				if (kept && /HTTP 404\b|doesn't know this request/.test((error as Error).message)) {
					// The request fal no longer keeps: a new one.
					paidJobs.delete(key);
					return await runFal<T>(endpoint, input, o);
				}
				if (/key|balance|HTTP 4(0[0-3]|04|22)\b/.test((error as Error).message) || ++misses > 40) throw error;
				lastMiss = error;
				o.onStatus?.(`waiting for fal.ai (${vpnShort() ?? "the connection dropped"}; the job keeps running there)`);
				await sleep(TEST() ? 300 : 5000, o.signal);
				continue;
			}
			const state = String(s.status ?? "").toUpperCase();
			if (state === "IN_QUEUE") {
				const n = Number(s.queue_position);
				o.onStatus?.(Number.isFinite(n) && n > 0 ? `waiting in the fal.ai queue · ${n} ahead` : "waiting in the fal.ai queue");
			} else if (state === "IN_PROGRESS") {
				working ||= Date.now();
				o.onStatus?.("working on fal.ai");
				// An ease-out towards 95 %: never stuck, never full before the answer.
				const t = (Date.now() - working) / expect;
				o.onProgress?.(Math.min(0.95, 1 - Math.exp(-1.6 * t)));
			} else if (state === "COMPLETED") {
				if (s.error) {
					paidJobs.delete(key);
					if (REFUSED.test(`${s.error} ${s.error_type ?? ""}`)) throw refusal(`${s.error} ${s.error_type ?? ""}`);
					throw new StudioError(`fal.ai: ${s.error}${s.error_type ? `\n\nDetails: ${s.error_type}` : ""}`, { key: "fal.failed" });
				}
				break;
			} else if (state && state !== "IN_QUEUE") {
				paidJobs.delete(key);
				throw new StudioError(`fal.ai stopped the job (${state.toLowerCase()}). Press Retry.`, { key: "fal.stopped", vars: { state: state.toLowerCase() } });
			}
			await sleep(step, o.signal);
		}
		// The answer of a finished (paid) job: fetched with retries, a dropped connection never loses it.
		let answer: T | null = null;
		for (let attempt = 1; !answer; attempt++) {
			// (a small JSON: 30 s per attempt, not 120. A connection that died without a word — a VPN that reconnected, a Mac
			// that slept — held each of the six attempts for two minutes, a quarter of an hour for a job already paid for.)
			const answerTimeout = TEST() ? 15_000 : 30_000;
			const res = await fetch(routedUrl(req.responseUrl), { headers: auth(), signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(answerTimeout)]) : AbortSignal.timeout(answerTimeout) }).catch((error) => {
				throwIfAborted(o.signal);
				if (attempt >= 6) throw new StudioError(`fal.ai finished, but its answer didn't arrive. Press Retry.\n\nDetails: ${(error as Error).message}`);
				return null;
			});
			if (res && res.ok) answer = (await res.json().catch(() => null)) as T | null;
			else if (res && (res.status < 500 || attempt >= 6) && res.status !== 429) {
				// fal's own refusal of the finished job (a 4xx): nothing to come back to. A 5xx may still answer later.
				if (res.status < 500) paidJobs.delete(key);
				throw await failure(res);
			}
			if (!answer) {
				if (attempt >= 6) throw new StudioError("fal.ai finished, but its answer didn't arrive. Press Retry.");
				await sleep((TEST() ? 100 : 2000) * attempt, o.signal);
			}
		}
		const paid = paidJobs.get(key);
		if (paid) {
			Object.assign(paid, { answer, urls: linksIn(answer) });
			paidJobs.save();
		}
		o.onProgress?.(1);
		return answer;
	} catch (error) {
		if (error instanceof CancelledError || o.signal?.aborted) {
			void cancel(req);
			paidJobs.delete(key);
			throw new CancelledError();
		}
		throw error;
	} finally {
		const job = paidJobs.get(key);
		if (job) job.following = false;
	}
}

// ───────────────────────── files ─────────────────────────

const uploads = new Map<string, { url: string; at: number }>();

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac", ".ogg": "audio/ogg", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** A local file on fal's storage (the models read their inputs from a link); the same file is sent once per few hours. */
export async function uploadFile(file: string, signal?: AbortSignal): Promise<string> {
	const st = fs.statSync(file);
	if (st.size > 1024 * 1024 * 1024) throw new StudioError("This file is too large to send to fal.ai (1 GB at most). Use a shorter piece.");
	const key = crypto.createHash("sha1").update(`${file}:${st.size}:${st.mtimeMs}`).digest("hex");
	const hit = uploads.get(key);
	if (hit && Date.now() - hit.at < 3 * 3600 * 1000) return hit.url;
	const ext = path.extname(file).toLowerCase();
	const type = TYPES[ext] ?? "application/octet-stream";
	const name = `gz_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}${ext || ".bin"}`;
	const init = await fetchFal(`${REST}/storage/upload/initiate?storage_type=fal-cdn-v3`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ content_type: type, file_name: name }) }, { signal, retry: "poll", timeout: 30 });
	const ticket = (await init.json().catch(() => ({}))) as { upload_url?: string; file_url?: string };
	if (!ticket.upload_url || !ticket.file_url) throw new StudioError("fal.ai didn't give a place to upload the file. Press Retry.");
	const body = await fs.promises.readFile(file);
	await fetchFal(ticket.upload_url, { method: "PUT", headers: { "Content-Type": type }, body }, { signal, retry: "poll", timeout: uploadSeconds(st.size, 600) });
	uploads.set(key, { url: ticket.file_url, at: Date.now() });
	return ticket.file_url;
}

/** A finished file from fal into `dest` (fal's links are public and short-lived: saved at once). */
export async function fetchResult(url: unknown, dest: string, signal?: AbortSignal): Promise<string> {
	if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new StudioError("fal.ai finished without a file. Press Retry.");
	await download(url, dest, { signal, service: SERVICE });
	for (const [key, job] of paidJobs) if (job.urls.includes(url)) paidJobs.delete(key);
	return dest;
}

// ───────────────────────── prices ─────────────────────────

let priceCache: { at: number; prices: Record<string, { usd: number; unit: string }> } | null = null;

/** fal's live list prices of the catalog's endpoints (an hour's cache); {} without a key or a connection. */
export async function livePrices(): Promise<Record<string, { usd: number; unit: string }>> {
	if (!falKey()) return {};
	if (priceCache && Date.now() - priceCache.at < 3600 * 1000) return priceCache.prices;
	const ids = [...new Set(FAL_MODELS.filter((m) => m.task !== "llm").flatMap((m) => [m.id, m.i2v].filter(Boolean) as string[]))];
	const prices: Record<string, { usd: number; unit: string }> = {};
	try {
		const q = ids.map((id) => `endpoint_id=${encodeURIComponent(id)}`).join("&");
		const j = (await getJson(`${API}/v1/models/pricing?${q}`, auth(), { service: SERVICE, retry: "poll", timeout: 20, attempts: 2 })) as { prices?: Array<{ endpoint_id?: string; unit_price?: number; unit?: string }> };
		for (const p of j.prices ?? []) if (p.endpoint_id && Number.isFinite(p.unit_price)) prices[p.endpoint_id] = { usd: Number(p.unit_price), unit: String(p.unit ?? "") };
		priceCache = { at: Date.now(), prices };
	} catch {
		// One unknown id makes fal refuse the whole list: the catalog's own prices stay in use.
	}
	return prices;
}

/**
 * The account balance in dollars, as fal reports it (GET /v1/account/billing; fal answers it to an admin-scoped key
 * only: any other answer is no number at all, never a guess).
 */
export async function falBalance(): Promise<number | null> {
	if (!falKey()) return null;
	try {
		const res = await fetch(routedUrl(`${API}/v1/account/billing?expand=credits`), { headers: auth(), signal: AbortSignal.timeout(15_000) });
		if (!res.ok) return null;
		const v = ((await res.json()) as { credits?: { current_balance?: unknown } }).credits?.current_balance;
		return typeof v === "number" && Number.isFinite(v) ? v : null;
	} catch {
		return null;
	}
}

/** Whether fal accepts the key now (Settings → Check). */
export async function checkKey(): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!falKey()) return { ok: false, error: "No key yet. Paste your fal.ai key." };
	try {
		const res = await fetch(routedUrl(`${API}/v1/models/pricing?endpoint_id=fal-ai/flux/schnell`), { headers: auth(), signal: AbortSignal.timeout(20_000) });
		if (res.status === 401 || res.status === 403) return { ok: false, error: "fal.ai didn't accept this key. Copy it again from fal.ai → API Keys." };
		if (!res.ok && res.status !== 404) return { ok: false, error: `fal.ai answered HTTP ${res.status}. Try again in a minute.` };
		priceCache = null;
		return { ok: true };
	} catch (error) {
		return { ok: false, error: `fal.ai couldn't be reached: ${(error as Error).message}. Check the internet connection.` };
	}
}
