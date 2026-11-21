
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { viaVpn, vpnWhy } from "@/net/proxy";
import { brandText, CancelledError, StudioError, throwIfAborted } from "./errors";

export type Json = Record<string, any>;

/**
 * How a failed request is repeated:
 * - "poll":   reads with no side effects (status polls, result downloads, upload tickets): 429/5xx, dropped
 *             connections and timeouts are retried with backoff;
 * - "chat":   a model answer (Gaziyav AI): 429/5xx and dropped connections, not timeouts (they already took minutes);
 * - "submit": a paid generation without an idempotency key: only when the provider surely did nothing
 *             (429, 503, or the connection never opened) — never a request that may have started a billed job;
 * - "none":   one attempt.
 */
export type Retry = "none" | "poll" | "chat" | "submit";

export interface CallOptions {
	signal?: AbortSignal;
	/** Seconds per attempt. */
	timeout?: number;
	/** The provider as written in code ("MiniMax", "sync.so", "Gaziyav AI"…); users see it as brandText makes it. */
	service: string;
	retry?: Retry;
	attempts?: number;
}

const ATTEMPTS: Record<Retry, number> = { none: 1, poll: 5, chat: 3, submit: 3 };
const DELAYS: Record<Retry, number[]> = { none: [], poll: [2, 4, 8, 15], chat: [2, 5], submit: [3, 8] };
/** JSON answers larger than this are refused (the largest real one, 10 min of hex audio, is ~20 MB). */
const MAX_JSON = 64 * 1024 * 1024;
const MAX_ERROR_BODY = 256 * 1024;

// Read when a request is made, not when this file loads: the unit tests set these per file, and a value read by an
// earlier file sent the Late tests to the real internet (the app sets them before it starts, so nothing changes there).
const TEST = () => process.env.STUDIO_TEST === "1";
/** Self-tests only: every request to the internet goes to a local stand-in as /<host>/<path>. */
const fakeNet = () => (TEST() ? (process.env.STUDIO_FAKE_NET ?? "").replace(/\/$/, "") : "");
/** Self-tests only: caps each attempt's timeout (seconds) and shortens the waits between attempts. */
const testTimeout = () => (TEST() ? Number(process.env.STUDIO_FAKE_TIMEOUT || 0) : 0);

/** The URL a request really goes to: itself, or the local stand-in in the app's self-tests. */
export function routed(url: string): string {
	const FAKE_NET = fakeNet();
	if (!FAKE_NET) return url;
	try {
		const u = new URL(url);
		if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return url;
		return `${FAKE_NET}/${u.host}${u.pathname}${u.search}`;
	} catch {
		return url;
	}
}

function withTimeout(signal: AbortSignal | undefined, seconds: number): AbortSignal {
	const t = AbortSignal.timeout(seconds * 1000);
	return signal ? AbortSignal.any([signal, t]) : t;
}

/** Strips HTML and long noise from an error body. */
export function brief(text: string): string {
	return text
		.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 400);
}

function describe(body: string): string {
	try {
		const j = JSON.parse(body);
		// a validation answer ({detail: [{loc, msg}]}) keeps the field it is about: «image_url: … flagged» (fal's safety
		// filter names the picture, the description or the sound there, C13)
		const first = Array.isArray(j?.detail) ? j.detail[0] : undefined;
		const loc = Array.isArray(first?.loc) ? first.loc.filter((p: unknown) => typeof p === "string" && p !== "body").join(".") : "";
		const m =
			j?.error?.message ??
			(first?.msg ? (loc ? `${loc}: ${first.msg}` : first.msg) : undefined) ??
			(typeof j?.detail === "string" ? j.detail : undefined) ??
			j?.message ??
			j?.msg ??
			j?.error ??
			j?.errorCode ??
			j?.base_resp?.status_msg;
		if (m) return typeof m === "string" ? m.slice(0, 400) : JSON.stringify(m).slice(0, 400);
	} catch {}
	return brief(body);
}

/** "Gaziyav AI", "The voice service", "The lipsync service" — the subject of a sentence about this provider. */
export function serviceName(service: string): string {
	const b = brandText(service).trim();
	// (fal.ai, kie.ai: names that are written in lower case, not «The fal.ai»)
	if (/\.ai$/i.test(b)) return b;
	if (/service$/i.test(b) || /^[a-z]/.test(b)) return `The ${b[0].toLowerCase()}${b.slice(1)}`;
	return b;
}

const lower = (name: string) => (name.startsWith("The ") ? `the ${name.slice(4)}` : name);

function statusLine(service: string, status: number, detail: string): string {
	const who = serviceName(service);
	if (status === 401) return `${who} couldn't connect: access was refused. Update the app.`;
	if (status === 402) return `${who} couldn't start: the account balance is empty. Top it up on its site. Nothing was charged.`;
	if (status === 403) return `${who} refused the request: no access to this model or region.`;
	if (status === 404) return `${who} no longer knows this request: it may have expired.`;
	if (status === 408 || status === 504) return `${who} didn't answer in time.`;
	if (status === 413) return `The file is too large for ${lower(who)}. Use a shorter piece.`;
	if (status === 429) return `${who} is busy right now (too many requests): wait a minute.`;
	if (status >= 500) return `${who} failed on its side.`;
	return `${who} rejected the request${detail ? `: ${detail.replace(/[.\s]+$/, "")}.` : ` (HTTP ${status}).`}`;
}

/** The error for a provider's non-2xx answer. */
export function httpError(service: string, status: number, body: string, statusText = ""): StudioError {
	const detail = describe(body) || statusText;
	return new StudioError(`${statusLine(service, status, detail)}\n\nDetails: HTTP ${status}${detail ? ` — ${detail}` : ""}`, { transient: status === 408 || status === 425 || status === 429 || status >= 500 });
}

function networkCode(error: unknown): string | undefined {
	const e = error as { code?: string; cause?: { code?: string; cause?: { code?: string } } };
	return e?.cause?.code ?? e?.cause?.cause?.code ?? e?.code;
}

/** The error for a request that got no answer at all (offline, dropped, timed out). */
export function networkError(service: string, error: unknown, timeout?: number): StudioError {
	const who = serviceName(service);
	const vpn = vpnWhy();
	if ((error as Error)?.name === "TimeoutError") {
		return new StudioError(`${who} didn't answer within ${timeout ?? "the allowed"} s.`, { transient: true });
	}
	const code = networkCode(error);
	// The VPN is the cause when it is off or down: the connection is cut at once, and «check the network» would send the
	// user to the Wi-Fi.
	if (vpn) return new StudioError(`${who} couldn't connect: ${vpn}\n\nDetails: ${code ?? (error as Error)?.message ?? "no answer"}`, { transient: true });
	const why =
		code === "ENOTFOUND" || code === "EAI_AGAIN"
			? "there is no internet connection (or a VPN/firewall blocks it). Check the network."
			: code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT"
				? "the server didn't answer. Check the network."
					: "the connection dropped. Check the network.";
	return new StudioError(`${who} couldn't connect: ${why}\n\nDetails: ${code ?? (error as Error)?.message ?? "no answer"}`, { transient: true });
}

/** A failure the provider surely never acted on: the connection was never opened. */
function neverSent(error: unknown) {
	return ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"].includes(networkCode(error) ?? "");
}

function retryable(retry: Retry, status: number | undefined, error: unknown): boolean {
	if (retry === "none") return false;
	if (status !== undefined) {
		if (retry === "submit") return status === 429 || status === 503;
		if (retry === "chat") return status === 429 || status >= 500;
		return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
	}
	const timedOut = (error as Error)?.name === "TimeoutError";
	if (retry === "submit") return !timedOut && neverSent(error);
	if (retry === "chat") return !timedOut;
	return true;
}

function waitSeconds(retry: Retry, attempt: number, res?: Response): number {
	const after = Number(res?.headers.get("retry-after"));
	const planned = DELAYS[retry][Math.min(attempt - 1, DELAYS[retry].length - 1)] ?? 2;
	const s = Number.isFinite(after) && after > 0 ? Math.min(30, after) : planned;
	return testTimeout() ? Math.min(s, 0.3) : s;
}

export async function call(url: string, init: RequestInit, opts: CallOptions): Promise<Response> {
	const { signal, service, retry = "none" } = opts;
	const TEST_TIMEOUT = testTimeout();
	const timeout = TEST_TIMEOUT ? Math.min(TEST_TIMEOUT, opts.timeout ?? 120) : (opts.timeout ?? 120);
	const tries = Math.max(1, opts.attempts ?? ATTEMPTS[retry]);
	for (let attempt = 1; ; attempt++) {
		throwIfAborted(signal);
		let res: Response | undefined;
		let failure: unknown;
		try {
			res = await fetch(routed(url), { ...init, signal: withTimeout(signal, timeout) });
		} catch (error) {
			throwIfAborted(signal);
			failure = error;
		}
		if (res?.ok) return res;
		if (attempt < tries && retryable(retry, res?.status, failure)) {
			void res?.body?.cancel().catch(() => {});
			await sleep(waitSeconds(retry, attempt, res) * 1000, signal);
			continue;
		}
		if (res) throw httpError(service, res.status, await readText(res, MAX_ERROR_BODY, service, true).catch(() => ""), res.statusText);
		throw networkError(service, failure, timeout);
	}
}

/** The body as text, refusing answers larger than `cap` bytes (a broken or hostile server can't exhaust memory). */
async function readText(res: Response, cap: number, service: string, truncate = false): Promise<string> {
	const declared = Number(res.headers.get("content-length") ?? 0);
	if (!truncate && declared > cap) {
		void res.body?.cancel().catch(() => {});
		throw tooLarge(service);
	}
	if (!res.body) return "";
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > cap) {
			void reader.cancel().catch(() => {});
			if (truncate) break;
			throw tooLarge(service);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function tooLarge(service: string) {
	return new StudioError(`${serviceName(service)} sent an answer far larger than expected.`);
}

async function readJson(res: Response, service: string): Promise<Json> {
	let text: string;
	try {
		text = await readText(res, MAX_JSON, service);
	} catch (error) {
		if (error instanceof StudioError) throw error;
		throw networkError(service, error); // the connection dropped mid-answer
	}
	return parse(text, service);
}

export async function getJson(url: string, headers: Record<string, string>, opts: CallOptions): Promise<Json> {
	// A garbled answer to a poll (a proxy's error page, a cut-off body) is retried like a failed request.
	for (let attempt = 1; ; attempt++) {
		const res = await call(url, { headers }, opts);
		try {
			return await readJson(res, opts.service);
		} catch (error) {
			throwIfAborted(opts.signal);
			if (opts.retry !== "poll" || attempt >= 3) throw error;
			await sleep(waitSeconds("poll", attempt) * 1000, opts.signal);
		}
	}
}

export async function postJson(url: string, headers: Record<string, string>, body: unknown, opts: CallOptions): Promise<Json> {
	const res = await call(
		url,
		{ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) },
		opts,
	);
	return readJson(res, opts.service);
}

function parse(text: string, service: string): Json {
	if (!text.trim()) throw new StudioError(`${serviceName(service)} sent an empty answer.`);
	try {
		const value = JSON.parse(text);
		if (value && typeof value === "object") return value;
	} catch {}
	throw new StudioError(`${serviceName(service)} sent an answer Gaziyav can't read.\n\nDetails: ${brief(text) || "not JSON"}`);
}

/**
 * Downloads to `dest` (written as dest.part, renamed when complete). A dropped connection mid-file starts the
 * file again (up to 4 times); on failure nothing is left behind.
 */
export async function download(url: string, dest: string, opts: { signal?: AbortSignal; service: string; headers?: Record<string, string> }) {
	const part = `${dest}.part`;
	try {
		for (let attempt = 1; ; attempt++) {
			const res = await call(url, { headers: opts.headers }, { timeout: 900, retry: "poll", ...opts });
			if (!res.body) throw new StudioError(`${serviceName(opts.service)} sent an empty file.`);
			try {
				await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(part));
				if (fs.statSync(part).size === 0) throw new StudioError(`${serviceName(opts.service)} sent an empty file.`);
				fs.renameSync(part, dest);
				return;
			} catch (error) {
				throwIfAborted(opts.signal);
				if (error instanceof StudioError || attempt >= 4) {
					throw error instanceof StudioError ? error : networkError(opts.service, error);
				}
				await sleep(waitSeconds("poll", attempt) * 1000, opts.signal);
			}
		}
	} finally {
		fs.rmSync(part, { force: true });
	}
}

/**
 * (a fixed minute for a 60 MB piece read as «kie.ai didn't answer» while the file was still going up). 150 KB/s is the
 * slowest line this waits for; an hour is the most.
 */
export const uploadSeconds = (bytes: number, floor = 60): number => Math.min(3600, Math.max(floor, Math.ceil(bytes / 150_000)));

/** ASCII file name for providers that choke on Cyrillic or spaces. */
export function uploadName(file: string): string {
	const ext = path.extname(file).toLowerCase() || ".bin";
	return `ls_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${ext}`;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal?.aborted) return reject(new CancelledError());
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(t);
				reject(new CancelledError());
			},
			{ once: true },
		);
	});
