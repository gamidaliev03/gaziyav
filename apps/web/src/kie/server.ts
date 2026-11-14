// kie.ai for the server: the user's key, its Market task API (createTask → recordInfo), uploads, the credit balance. Every
// request goes through the same proxied fetch as fal.ai (http.ts `call`), so the VPN and the tests' stand-in apply.
//
// The key: the app keeps it encrypted (GaziyavShell/modules/provider-keys.js) and hands it to this process as a message:
// never written in clear, never logged, never sent to the page. Rules from docs.kie.ai: the HTTP status is 200 even for
// a failure, `code` tells; a task has no cancel; a failed task isn't charged; uploaded files go after 24 h.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CancelledError, StudioError, throwIfAborted } from "@/studio/server/errors";
import { call, download, sleep, uploadSeconds } from "@/studio/server/http";
import { vpnShort } from "@/net/proxy";
import { paidMap } from "@/ai/paid-jobs";
import { clearEmpty, noteEmpty } from "@/ai/empty";
import { studioHome } from "@/studio/server/settings";

const API = "https://api.kie.ai";
const UPLOAD = "https://kieai.redpandaai.co";
const SERVICE = "kie.ai";
// (read when used, not when this file loads: the unit tests set it per file — http.ts has the same rule)
const TEST = () => process.env.STUDIO_TEST === "1";
import { CREDIT_USD } from "./catalog";
export { CREDIT_USD };

// ───────────────────────── the key ─────────────────────────

type Holder = { __gaziyavKieKey?: string | null; __gaziyavKieListening?: boolean };
const g = globalThis as Holder;

export function listenForKieKey() {
	const port = (process as unknown as { parentPort?: { on: (e: string, f: (m: unknown) => void) => void; postMessage: (m: unknown) => void } }).parentPort;
	if (!port || g.__gaziyavKieListening) return;
	g.__gaziyavKieListening = true;
	port.on("message", (m) => {
		const d = ((m as { data?: unknown })?.data ?? m) as { type?: string; provider?: string; key?: unknown };
		if (d?.type === "provider-key" && d.provider === "kie") g.__gaziyavKieKey = typeof d.key === "string" && d.key.trim() ? d.key.trim() : null;
	});
	port.postMessage({ type: "provider-key-request", provider: "kie" });
}

export function kieKey(): string | null {
	listenForKieKey();
	return g.__gaziyavKieKey || null;
}

export const kieHint = (): string | null => {
	const k = kieKey();
	return k ? `…${k.slice(-4)}` : null;
};

function auth(): Record<string, string> {
	const k = kieKey();
	if (!k) throw new StudioError("Add your kie.ai key first: Settings → AI.");
	return { Authorization: `Bearer ${k}` };
}

// ───────────────────────── answers ─────────────────────────

type Answer<T> = { code?: number; msg?: string; message?: string; data?: T };

/** kie's own sentences, whole: errors.ts adds no «can't reach the site» to them (its texts say «timed out» too). */
const said = (text: string, transient = false) => new StudioError(text, { plain: true, transient });

function failure(code: number | undefined, text: string): StudioError {
	if (code === 401) return said("kie.ai didn't accept the key. Check it in Settings → AI.");
	if (code === 402) {
		// remembered for 15 min: price_plan says kie.ai is empty, Claude's paid steps on it stop first (ai/empty.ts)
		noteEmpty("kie");
		return said("kie.ai: not enough credits. Top up on kie.ai, then press Retry. Nothing was charged.");
	}
	if (code === 455) return said("kie.ai is under maintenance. Try again later.");
	if (code === 422) return said(`kie.ai didn't accept these settings: ${text || "invalid input"}.`);
	return said(`kie.ai: ${text || `error ${code}`}.`, (code ?? 0) >= 500);
}

/**
 * One request: `code` 429 (its limit is per 10 s) and 5xx wait and go again, a dropped connection too when `again` says a
 * repeat can't create a second job. `submit` (createTask, which bills): only what surely did nothing is repeated — a 429,
 * a 503, a connection that never opened (http.ts «submit», fal's rule); a 502/504 from a gateway after the task may have
 * been created is an error, not a second task.
 */
async function ask<T>(url: string, init: RequestInit, o: { signal?: AbortSignal; again?: boolean; submit?: boolean; timeout?: number }): Promise<T | undefined> {
	for (let attempt = 1; ; attempt++) {
		throwIfAborted(o.signal);
		const wait = (TEST() ? 80 : 1500) * 2 ** Math.min(attempt, 5);
		let j: Answer<T>;
		try {
			const res = await call(url, init, { service: SERVICE, signal: o.signal, timeout: o.timeout ?? 60, retry: o.submit ? "submit" : "none" });
			j = (await res.json()) as Answer<T>;
		} catch (error) {
			throwIfAborted(o.signal);
			const m = /Details: HTTP (\d{3})/.exec((error as Error).message ?? "");
			const status = m ? Number(m[1]) : 0;
			if (status === 401 || status === 402) throw failure(status, "");
			if (!o.submit && attempt < 6 && (status === 429 || status >= 500 || (o.again && !status))) {
				await sleep(wait, o.signal);
				continue;
			}
			throw error;
		}
		if (j.code === 200 || (j.code === undefined && j.data !== undefined)) return j.data;
		if (j.code === 429 && attempt < 8) {
			await sleep(wait, o.signal);
			continue;
		}
		throw failure(j.code, String(j.msg ?? j.message ?? ""));
	}
}

// ───────────────────────── files ─────────────────────────

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const uploads = new Map<string, { url: string; at: number }>();

/** A local file on kie's storage (the models read their inputs from a link; kie deletes it after 24 h). */
export async function uploadToKie(file: string, signal?: AbortSignal): Promise<string> {
	const st = fs.statSync(file);
	const key = crypto.createHash("sha1").update(`${file}:${st.size}:${st.mtimeMs}`).digest("hex");
	const hit = uploads.get(key);
	if (hit && Date.now() - hit.at < 3 * 3600 * 1000) return hit.url;
	const ext = path.extname(file).toLowerCase();
	const form = new FormData();
	form.append("file", new Blob([await fs.promises.readFile(file)], { type: TYPES[ext] ?? "application/octet-stream" }), `gz_${crypto.randomBytes(5).toString("hex")}${ext || ".bin"}`);
	form.append("uploadPath", "gaziyav");
	const d = await ask<{ downloadUrl?: string; fileUrl?: string }>(`${UPLOAD}/api/file-stream-upload`, { method: "POST", headers: auth(), body: form }, { signal, timeout: uploadSeconds(st.size) });
	const url = d?.downloadUrl ?? d?.fileUrl;
	if (!url) throw new StudioError("kie.ai didn't keep the file. Press Retry.");
	uploads.set(key, { url, at: Date.now() });
	return url;
}

// ───────────────────────── tasks ─────────────────────────

export interface KieRun {
	signal?: AbortSignal;
	onStatus?: (text: string) => void;
	onProgress?: (p: number) => void;
	expectSeconds?: number;
	timeoutSeconds?: number;
	/** Names a job whose input holds per-run links, for a Retry. */
	resumeKey?: string;
}

/** The states kie.ai documents for a task; anything else is shown as it is. */
const KNOWN_STATES = ["waiting", "queuing", "generating", "success", "fail"];

interface Record_ {
	state?: string;
	resultJson?: string;
	failCode?: string;
	failMsg?: string;
	creditsConsumed?: number;
}

/** Paid tasks whose file isn't on this Mac yet: Retry comes back to them (fal/server.ts `paidJobs`, the same rule). */
type Paid = { taskId: string; at: number; urls: string[]; following?: boolean; result?: KieResult };
const paid = paidMap<Paid>("kie");

export interface KieResult {
	urls: string[];
	/** Dollars kie really charged, when it says. */
	usd?: number;
}

/** The files of a finished task: `resultUrls` for Market models; Veo says `result_urls` / `origin_urls`. */
export function resultUrls(json: string | undefined): string[] {
	if (!json) return [];
	try {
		const j = JSON.parse(json) as { resultUrls?: string[]; data?: { result_urls?: string[]; origin_urls?: string[] }; result_urls?: string[]; origin_urls?: string[] };
		const data = j.data ?? j;
		return (j.resultUrls?.length ? j.resultUrls : data.result_urls?.length ? data.result_urls : (data.origin_urls ?? [])).filter((u) => typeof u === "string");
	} catch {
		return [];
	}
}

/** One task, start to finish. A task can't be cancelled on kie: Stop only stops following it (see the model's note). */
export async function runKie(model: string, input: Record<string, unknown>, o: KieRun = {}): Promise<KieResult> {
	throwIfAborted(o.signal);
	let key = o.resumeKey ?? crypto.createHash("sha1").update(`${model}\n${JSON.stringify(input)}`).digest("hex");
	const held = paid.get(key);
	if (held?.following) key = `${key}:${crypto.randomUUID()}`;
	const kept = held && !held.following && Date.now() - held.at < 3 * 3600 * 1000 ? held : undefined;
	if (kept?.result) {
		o.onProgress?.(1);
		return kept.result;
	}
	const headers = { ...auth(), "Content-Type": "application/json" };
	let taskId = kept?.taskId;
	if (!taskId) {
		o.onStatus?.("sending the job to kie.ai");
		const d = await ask<{ taskId?: string }>(`${API}/api/v1/jobs/createTask`, { method: "POST", headers, body: JSON.stringify({ model, input }) }, { signal: o.signal, submit: true });
		taskId = d?.taskId;
		if (!taskId) throw new StudioError("kie.ai didn't start the job. Press Retry.");
		clearEmpty("kie");
	}
	if (kept) kept.following = true;
	else paid.set(key, { taskId, at: Date.now(), urls: [], following: true });
	const started = Date.now();
	const limit = (TEST() && Number(process.env.STUDIO_TEST_KIE_LIMIT)) || (o.timeoutSeconds ?? 1800) * 1000;
	const expect = Math.max(5, o.expectSeconds ?? 60) * 1000;
	const step = TEST() ? 150 : 3000;
	// What kie said last, and whether the task ever ran: a task that never left the queue was never charged.
	let seen = "";
	let ran = false;
	// Polls that failed in a row, and the last such failure: a paid task is not dropped over a bad minute of the network or
	// the VPN (the same rule as fal.ai's): it is followed until its time is up.
	let misses = 0;
	let lastMiss: unknown = null;
	try {
		for (;;) {
			throwIfAborted(o.signal);
			if (Date.now() - started > limit) {
				// The time ran out while the line was down, or on a task that was running: kie can't stop it, it may finish
				// and bill. The row stays and Retry follows the same task (the last word of the network is the error, not
				// «kie.ai didn't finish», when it was the line that was down). Only a task that never left the queue is let go.
				if (misses > 0 && lastMiss) throw lastMiss;
				const min = Math.max(1, Math.round(limit / 60000));
				if (ran) throw said(`kie.ai didn't finish within ${min} min. It can't be stopped from here: if it finishes later and bills, kie.ai's log shows it. Press Retry to keep waiting for this task, or pick another model.`);
				paid.delete(key);
				throw said(`kie.ai never started this task: it stayed ${seen && seen !== "waiting" ? `«${seen}»` : "waiting"} in its queue for ${min} min. Nothing was charged. Press Retry, or pick another model. (kie.ai can't cancel it: if it starts later, its log shows it.)`);
			}
			let r: Record_ | undefined;
			try {
				r = await ask<Record_>(`${API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers }, { signal: o.signal, again: true });
				misses = 0;
			} catch (error) {
				throwIfAborted(o.signal);
				// A task kie no longer knows (an old row from before a restart): a new one.
				if (kept && error instanceof StudioError && /no such task|not found|\b404\b/i.test(error.message)) {
					paid.delete(key);
					return await runKie(model, input, o);
				}
				if (!(error instanceof StudioError && error.transient) || ++misses > 60) throw error;
				lastMiss = error;
				o.onStatus?.(`waiting for kie.ai (${vpnShort() ?? "the connection dropped"}; the task keeps running there)`);
				await sleep(step * 2, o.signal);
				continue;
			}
			const state = String(r?.state ?? "").toLowerCase();
			if (state !== seen) {
				// A state we don't know (or none) stays visible: in the log (never the key) and in the job's text.
				seen = state;
				const known = KNOWN_STATES.includes(state);
				console.log(`kie.ai task ${taskId} (${model}): ${state ? `state «${state}»${known ? "" : " (not one of ours)"}` : `answer without a state, fields: ${Object.keys(r ?? {}).join(",") || "none"}`}`);
			}
			if (state === "success") {
				const urls = resultUrls(r?.resultJson);
				if (!urls.length) {
					paid.delete(key);
					throw said("kie.ai finished without a file. Press Retry.");
				}
				const result: KieResult = { urls, ...(Number.isFinite(r?.creditsConsumed) ? { usd: (r?.creditsConsumed as number) * CREDIT_USD } : {}) };
				Object.assign(paid.get(key) ?? {}, { result, urls });
				paid.save();
				o.onProgress?.(1);
				return result;
			}
			if (state === "fail") {
				paid.delete(key);
				// kie charges nothing for a failed task: its own reason, whole.
				throw said(`kie.ai couldn't make this: ${String(r?.failMsg || r?.failCode || "the job failed").replace(/[.\s]+$/, "")}. Nothing was charged. Press Retry, or pick another model.`);
			}
			const waited = Math.round((Date.now() - started) / 1000);
			const for_ = waited < 60 ? `${waited} s` : `${Math.floor(waited / 60)} min ${waited % 60} s`;
			if (state === "generating") {
				ran = true;
				o.onStatus?.(`working on kie.ai · ${for_}`);
				o.onProgress?.(Math.min(0.95, 1 - Math.exp((-1.6 * (Date.now() - started)) / expect)));
			} else {
				o.onStatus?.(!state ? `kie.ai sent no state · waiting ${for_}` : KNOWN_STATES.includes(state) ? `waiting in the kie.ai queue · ${for_}` : `kie.ai says «${state}» · waiting ${for_}`);
			}
			await sleep(step, o.signal);
		}
	} catch (error) {
		// Stop only stops following: kie can't cancel the task, which may finish and bill. Its row stays (3 h), so the
		// same Generate comes back to it instead of paying for a second one.
		if (error instanceof CancelledError || o.signal?.aborted) throw new CancelledError();
		throw error;
	} finally {
		const job = paid.get(key);
		if (job) job.following = false;
	}
}

/** A finished file saved at once (kie's links don't last for ever). */
export async function fetchKieResult(url: unknown, dest: string, signal?: AbortSignal): Promise<string> {
	if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw new StudioError("kie.ai finished without a file. Press Retry.");
	await download(url, dest, { signal, service: SERVICE });
	for (const [key, job] of paid) if (job.urls.includes(url)) paid.delete(key);
	return dest;
}

// ───────────────────────── the balance, what was spent ─────────────────────────

/** kie's balance in credits. */
export async function kieCredits(): Promise<number> {
	const d = await ask<number>(`${API}/api/v1/chat/credit`, { headers: auth() }, { again: true });
	return Number(d) || 0;
}

export async function checkKieKey(): Promise<{ ok: true; credits: number } | { ok: false; error: string }> {
	if (!kieKey()) return { ok: false, error: "No key yet. Paste your kie.ai key." };
	try {
		return { ok: true, credits: await kieCredits() };
	} catch (error) {
		return { ok: false, error: (error as Error).message };
	}
}

const spendFile = () => path.join(studioHome(), "kie-spend.json");

export function kieSpent(): { total: number; byTask: Record<string, number> } {
	try {
		const j = JSON.parse(fs.readFileSync(spendFile(), "utf8"));
		return { total: Number(j.total) || 0, byTask: j.byTask && typeof j.byTask === "object" ? j.byTask : {} };
	} catch {
		return { total: 0, byTask: {} };
	}
}

export function addKieSpend(task: string, usd: number) {
	if (!(usd > 0)) return;
	const s = kieSpent();
	s.total += usd;
	s.byTask[task] = (s.byTask[task] ?? 0) + usd;
	fs.mkdirSync(studioHome(), { recursive: true });
	fs.writeFileSync(spendFile(), JSON.stringify(s), { mode: 0o600 });
}
