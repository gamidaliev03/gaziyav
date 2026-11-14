// ArgoLink for the server: the user's key, its video API (POST /v1/videos/generations → request_id, GET /v1/videos/{id}
// until done), uploads of local pictures (POST /v1/media/uploads → PUT), the balance. Read from argolink.io/en/models/<id>
// and /en/docs, 06.11.2026; no live call was made (no key), only the stand-in in test/fake-argo.mjs. Same proxied fetch as
// fal.ai and kie.ai (http.ts `call`), so the VPN and the tests' stand-in apply.
//
// The key: the app keeps it encrypted (GaziyavShell/modules/provider-keys.js) and hands it to this process as a message:
// never written in clear, never logged, never sent to the page, never put in a URL (ArgoLink refuses that).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CancelledError, StudioError, throwIfAborted } from "@/studio/server/errors";
import { call, download, sleep, uploadSeconds } from "@/studio/server/http";
import { vpnShort } from "@/net/proxy";
import { paidMap } from "@/ai/paid-jobs";
import { clearEmpty, noteEmpty } from "@/ai/empty";
import { studioHome } from "@/studio/server/settings";
import { argoModelName, ARGO_RATES } from "./catalog";

const API = "https://argolink.io";
const SERVICE = "ArgoLink";
// (read when used, not when this file loads: the unit tests set it per file — http.ts has the same rule)
const TEST = () => process.env.STUDIO_TEST === "1";

// ───────────────────────── the key ─────────────────────────

type Holder = { __gaziyavArgoKey?: string | null; __gaziyavArgoListening?: boolean };
const g = globalThis as Holder;

export function listenForArgoKey() {
	const port = (process as unknown as { parentPort?: { on: (e: string, f: (m: unknown) => void) => void; postMessage: (m: unknown) => void } }).parentPort;
	if (!port || g.__gaziyavArgoListening) return;
	g.__gaziyavArgoListening = true;
	port.on("message", (m) => {
		const d = ((m as { data?: unknown })?.data ?? m) as { type?: string; provider?: string; key?: unknown };
		if (d?.type === "provider-key" && d.provider === "argo") g.__gaziyavArgoKey = typeof d.key === "string" && d.key.trim() ? d.key.trim() : null;
	});
	port.postMessage({ type: "provider-key-request", provider: "argo" });
}

export function argoKey(): string | null {
	listenForArgoKey();
	return g.__gaziyavArgoKey || null;
}

export const argoHint = (): string | null => {
	const k = argoKey();
	return k ? `…${k.slice(-4)}` : null;
};

const said = (text: string, transient = false) => new StudioError(text, { plain: true, transient });

function auth(): Record<string, string> {
	const k = argoKey();
	if (!k) throw said("Add your ArgoLink key first: Settings → AI.");
	return { Authorization: `Bearer ${k}` };
}

/** ArgoLink's sentence for an HTTP answer (its body says `error`; the words are kept whole). */
function failure(status: number, body: string): StudioError {
	let detail = "";
	try {
		const j = JSON.parse(body) as { error?: { message?: unknown; code?: unknown } | string; message?: unknown };
		const e = j.error;
		detail = typeof e === "string" ? e : String((e as { message?: unknown } | undefined)?.message ?? j.message ?? "");
	} catch {
		detail = body.trim().slice(0, 200);
	}
	if (status === 401 || status === 403) return said("ArgoLink didn't accept the key. Check it in Settings → AI.");
	if (status === 402) {
		noteEmpty("argo");
		return said("ArgoLink: not enough balance. Top it up on argolink.io, then press Retry. Nothing was charged.");
	}
	if (status === 429) return said("ArgoLink: too many requests. Wait a minute, then press Retry.", true);
	return said(`ArgoLink: ${detail || `HTTP ${status}`}.`, status >= 500 || status === 408);
}

async function ask<T>(url: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
	try {
		const res = await call(url, init, { service: SERVICE, signal, timeout: 60, retry: "none" });
		return (await res.json()) as T;
	} catch (error) {
		throwIfAborted(signal);
		const m = /Details: HTTP (\d{3})(?: — ([\s\S]*))?$/.exec((error as Error).message ?? "");
		if (m) throw failure(Number(m[1]), m[2] ?? "");
		throw error;
	}
}

// ───────────────────────── files ─────────────────────────

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
const uploads = new Map<string, { url: string; at: number }>();

/**
 * A local picture on ArgoLink's storage: a ticket (POST /v1/media/uploads {model, type, content_type, size_bytes}), the
 * file PUT to its `upload_url` with the same Content-Type, then `media_url` goes into the video request.
 */
export async function uploadToArgo(file: string, signal?: AbortSignal, model = "seedance-2.0-mini"): Promise<string> {
	const st = fs.statSync(file);
	const key = crypto.createHash("sha1").update(`${file}:${st.size}:${st.mtimeMs}`).digest("hex");
	const hit = uploads.get(key);
	if (hit && Date.now() - hit.at < 3 * 3600 * 1000) return hit.url;
	const content_type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
	const type = content_type.split("/")[0];
	const ticket = await ask<{ upload_url?: string; media_url?: string }>(`${API}/v1/media/uploads`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify({ model, type, content_type, size_bytes: st.size }) }, signal);
	if (!ticket.upload_url || !ticket.media_url) throw said("ArgoLink didn't accept the file. Press Retry.");
	await call(ticket.upload_url, { method: "PUT", headers: { "Content-Type": content_type }, body: new Blob([await fs.promises.readFile(file)], { type: content_type }) }, { service: SERVICE, signal, timeout: uploadSeconds(st.size, 300), retry: "none" });
	uploads.set(key, { url: ticket.media_url, at: Date.now() });
	return ticket.media_url;
}

// ───────────────────────── tasks ─────────────────────────

export interface ArgoRun {
	signal?: AbortSignal;
	onStatus?: (text: string) => void;
	onProgress?: (p: number) => void;
	expectSeconds?: number;
	timeoutSeconds?: number;
	resumeKey?: string;
}

export interface ArgoResult {
	urls: string[];
	/** Dollars ArgoLink really billed (its `billed_seconds` at the page's rate for the resolution), when it says. */
	usd?: number;
}

interface Job {
	status?: string;
	video?: { url?: string };
	error?: { message?: unknown; code?: unknown } | string;
	usage?: { billed_seconds?: number };
}

/** Finished tasks whose file isn't on this Mac yet: Retry comes back to them instead of paying again. */
type Paid = { requestId: string; at: number; result?: ArgoResult; following?: boolean };
const paid = paidMap<Paid>("argo");

const KNOWN = ["pending", "done", "failed", "expired"];

/** One video, start to finish. The maximum price is held at submit and settled at the end; failed and expired aren't charged. */
export async function runArgo(endpoint: string, input: Record<string, unknown>, o: ArgoRun = {}): Promise<ArgoResult> {
	throwIfAborted(o.signal);
	const model = argoModelName(endpoint);
	let key = o.resumeKey ?? crypto.createHash("sha1").update(`${model}\n${JSON.stringify(input)}`).digest("hex");
	const held = paid.get(key);
	if (held?.following) key = `${key}:${crypto.randomUUID()}`;
	const kept = held && !held.following && Date.now() - held.at < 3 * 3600 * 1000 ? held : undefined;
	if (kept?.result) {
		o.onProgress?.(1);
		return kept.result;
	}
	const headers = { ...auth(), "Content-Type": "application/json" };
	let requestId = kept?.requestId;
	if (!requestId) {
		o.onStatus?.("sending the job to ArgoLink");
		const r = await ask<{ request_id?: string }>(`${API}/v1/videos/generations`, { method: "POST", headers, body: JSON.stringify({ model, ...input }) }, o.signal);
		requestId = r.request_id;
		if (!requestId) throw said("ArgoLink didn't start the job. Press Retry.");
		clearEmpty("argo");
	}
	if (kept) kept.following = true;
	else paid.set(key, { requestId, at: Date.now(), following: true });
	const started = Date.now();
	const limit = (TEST() && Number(process.env.STUDIO_TEST_KIE_LIMIT)) || (o.timeoutSeconds ?? 1800) * 1000;
	const expect = Math.max(5, o.expectSeconds ?? 90) * 1000;
	const step = TEST() ? 150 : 10_000;
	let seen = "";
	// (a paid job is not dropped over a bad minute of the network or the VPN: kie.ai's and fal.ai's rule)
	let misses = 0;
	let lastMiss: unknown = null;
	try {
		for (;;) {
			throwIfAborted(o.signal);
			if (Date.now() - started > limit) {
				// The time ran out while the line was down: the job may have finished (and billed) meanwhile. The row stays
				// and Retry follows the same job; the last word of the network is the error.
				if (misses > 0 && lastMiss) throw lastMiss;
				paid.delete(key);
				throw said(`ArgoLink didn't finish within ${Math.max(1, Math.round(limit / 60000))} min. A job that does not finish is not charged. Press Retry, or pick another model.`);
			}
			let r: Job;
			try {
				r = await ask<Job>(`${API}/v1/videos/${encodeURIComponent(requestId)}`, { headers: auth() }, o.signal);
				misses = 0;
			} catch (error) {
				throwIfAborted(o.signal);
				if (kept && error instanceof StudioError && /no such job|not found|\b404\b/i.test(error.message)) {
					paid.delete(key);
					return await runArgo(endpoint, input, o);
				}
				if (!(error instanceof StudioError && error.transient) || ++misses > 60) throw error;
				lastMiss = error;
				o.onStatus?.(`waiting for ArgoLink (${vpnShort() ?? "the connection dropped"}; the job keeps running there)`);
				await sleep(step, o.signal);
				continue;
			}
			const status = String(r.status ?? "").toLowerCase();
			if (status !== seen) {
				seen = status;
				console.log(`ArgoLink job ${requestId} (${model}): ${status ? `status «${status}»${KNOWN.includes(status) ? "" : " (not one of ours)"}` : `answer without a status, fields: ${Object.keys(r).join(",") || "none"}`}`);
			}
			if (status === "done") {
				const url = r.video?.url;
				if (!url) {
					paid.delete(key);
					throw said("ArgoLink finished without a file. Press Retry.");
				}
				const rate = ARGO_RATES[model]?.[String(input.resolution ?? "720p")];
				const billed = r.usage?.billed_seconds;
				const result: ArgoResult = { urls: [url], ...(typeof billed === "number" && Number.isFinite(billed) && rate ? { usd: Math.round(billed * rate * 1e6) / 1e6 } : {}) };
				Object.assign(paid.get(key) ?? {}, { result });
				paid.save();
				o.onProgress?.(1);
				return result;
			}
			if (status === "failed" || status === "expired") {
				paid.delete(key);
				const e = r.error;
				const why = typeof e === "string" ? e : e && typeof e === "object" && e.message ? String(e.message) : status === "expired" ? "the job expired" : "the job failed";
				throw said(`ArgoLink couldn't make this: ${why.replace(/[.\s]+$/, "")}. Nothing was charged. Press Retry, or pick another model.`);
			}
			const waited = Math.round((Date.now() - started) / 1000);
			const for_ = waited < 60 ? `${waited} s` : `${Math.floor(waited / 60)} min ${waited % 60} s`;
			o.onStatus?.(!status ? `ArgoLink sent no status · waiting ${for_}` : KNOWN.includes(status) ? `working on ArgoLink · ${for_}` : `ArgoLink says «${status}» · waiting ${for_}`);
			o.onProgress?.(Math.min(0.95, 1 - Math.exp((-1.6 * (Date.now() - started)) / expect)));
			await sleep(step, o.signal);
		}
	} catch (error) {
		// Stop only stops following: ArgoLink has no cancel, the job may finish and bill. Its row stays (3 h), so the same
		// Generate comes back to it instead of paying for a second one.
		if (error instanceof CancelledError || o.signal?.aborted) throw new CancelledError();
		throw error;
	} finally {
		const job = paid.get(key);
		if (job) job.following = false;
	}
}

/** A finished file saved at once (its link lasts 24 h). */
export async function fetchArgoResult(url: unknown, dest: string, signal?: AbortSignal): Promise<string> {
	if (typeof url !== "string" || !/^https?:\/\//.test(url)) throw said("ArgoLink finished without a file. Press Retry.");
	await download(url, dest, { signal, service: SERVICE });
	for (const [key, job] of paid) if (job.result?.urls.includes(url)) paid.delete(key);
	return dest;
}

// ───────────────────────── the balance, what was spent ─────────────────────────

/** `available` (what new jobs can spend) and `held` (reserved for running jobs), in dollars. */
export async function argoBalance(): Promise<{ available: number; held: number }> {
	const j = await ask<{ available?: number; held?: number }>(`${API}/v1/account/balance`, { headers: auth() });
	return { available: Number(j.available) || 0, held: Number(j.held) || 0 };
}

export async function checkArgoKey(): Promise<{ ok: true; available: number; held: number } | { ok: false; error: string }> {
	if (!argoKey()) return { ok: false, error: "No key yet. Paste your ArgoLink key." };
	try {
		return { ok: true, ...(await argoBalance()) };
	} catch (error) {
		return { ok: false, error: (error as Error).message };
	}
}

const spendFile = () => path.join(studioHome(), "argo-spend.json");

export function argoSpent(): { total: number; byTask: Record<string, number> } {
	try {
		const j = JSON.parse(fs.readFileSync(spendFile(), "utf8"));
		return { total: Number(j.total) || 0, byTask: j.byTask && typeof j.byTask === "object" ? j.byTask : {} };
	} catch {
		return { total: 0, byTask: {} };
	}
}

export function addArgoSpend(task: string, usd: number) {
	if (!(usd > 0)) return;
	const s = argoSpent();
	s.total += usd;
	s.byTask[task] = (s.byTask[task] ?? 0) + usd;
	fs.mkdirSync(studioHome(), { recursive: true });
	fs.writeFileSync(spendFile(), JSON.stringify(s), { mode: 0o600 });
}
