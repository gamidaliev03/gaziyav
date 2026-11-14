// Late (getlate.dev, now Zernio) for the server: the user's API key, the profile the accounts are connected to, the
// accounts, the platforms' own connect pages, the video upload and the posts. Only what Late's API reference says
// (https://zernio.com/openapi.json): Bearer key; GET/POST /v1/profiles; GET /v1/connect/{platform}; GET /v1/accounts;
// DELETE /v1/accounts/{id}; GET /v1/accounts/{id}/tiktok/creator-info; POST /v1/media/presign + PUT to its uploadUrl;
// POST /v1/posts (publishNow | scheduledFor); GET / DELETE /v1/posts/{id}; POST /v1/posts/{id}/retry.
//
// The key: the app keeps it encrypted with the Mac's Keychain (Electron safeStorage, main.js) and hands it to this
// process as a message, like the fal.ai key — never written in clear, never logged, never sent to the page.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { StudioError } from "@/studio/server/errors";
import { networkError, routed } from "@/studio/server/http";
import type { Platform } from "../caption";
import { accountView, KEY_WRONG, LATE_API, type LateAccount, lateHttpError } from "../late";
import { shareDir } from "./store";

const SERVICE = "Late";
const TEST = process.env.STUDIO_TEST === "1";

// ───────────────────────── the key ─────────────────────────

const SLOT = "__gaziyavLateKey";
type Holder = { [SLOT]?: string | null; __gaziyavLateListening?: boolean };
const g = globalThis as Holder;

/** Listens for the key from the app (main.js sends it at start and whenever it changes in Settings → Share). */
export function listenForLateKey() {
	const port = (
		process as unknown as {
			parentPort?: {
				on: (e: string, f: (m: unknown) => void) => void;
				postMessage: (m: unknown) => void;
			};
		}
	).parentPort;
	if (!port || g.__gaziyavLateListening) return;
	g.__gaziyavLateListening = true;
	port.on("message", (m) => {
		const d = ((m as { data?: unknown })?.data ?? m) as {
			type?: string;
			key?: unknown;
			id?: unknown;
		};
		// Settings → Save: the app asks whether Late takes the pasted key before it keeps it (a wrong key was saved
		// and shown as «Key saved …0000»).
		if (d?.type === "late-key-check") {
			void checkLateKey(String(d.key ?? "")).then((r) => port.postMessage({ type: "late-key-checked", id: d.id, ...r }));
			return;
		}
		if (d?.type !== "late-key") return;
		const next = typeof d.key === "string" && d.key.trim() ? d.key.trim() : null;
		if (next !== g[SLOT]) accountsCache = null;
		g[SLOT] = next;
	});
	port.postMessage({ type: "late-key-request" });
}

export function lateKey(): string | null {
	listenForLateKey();
	const k = g[SLOT];
	if (k) return k;
	if (TEST && process.env.STUDIO_TEST_LATE_KEY) return process.env.STUDIO_TEST_LATE_KEY;
	return null;
}

/** «…ab12» for Settings. */
export function lateKeyHint(): string | null {
	const k = lateKey();
	return k ? `…${k.slice(-4)}` : null;
}

// ───────────────────────── requests ─────────────────────────

/** The person cancelled (Cancel in the sheet): the row says Cancelled, not a failure. */
export class Cancelled extends StudioError {
	constructor() {
		super("Cancelled");
	}
}

/** Late's refusal: plain words for the row, Late's own message as the details. */
export class LateError extends StudioError {
	constructor(
		message: string,
		readonly status: number,
		readonly detail?: string,
		readonly code?: string,
	) {
		super(message);
	}
}

async function api<T = Record<string, unknown>>(
	method: string,
	route: string,
	opts: {
		body?: unknown;
		query?: Record<string, string>;
		timeout?: number;
		idempotencyKey?: string;
		signal?: AbortSignal;
		/** A key to check instead of the saved one (Settings → Save). */
		key?: string;
	} = {},
): Promise<{ status: number; data: T }> {
	const key = opts.key ?? lateKey();
	if (!key) throw new StudioError("Add your Late API key first: Settings → Share.");
	const u = new URL(`${LATE_API}${route}`);
	for (const [k, v] of Object.entries(opts.query ?? {})) u.searchParams.set(k, v);
	const headers: Record<string, string> = {
		Authorization: `Bearer ${key}`,
		Accept: "application/json",
	};
	if (opts.body !== undefined) headers["Content-Type"] = "application/json";
	if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
	const timeout = opts.timeout ?? 30;
	let res: Response;
	try {
		const signals = [AbortSignal.timeout(timeout * 1000), ...(opts.signal ? [opts.signal] : [])];
		res = await fetch(routed(u.toString()), {
			method,
			headers,
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			signal: AbortSignal.any(signals),
		});
	} catch (error) {
		throw networkError(SERVICE, error, timeout);
	}
	const text = await res.text().catch(() => "");
	let data: Record<string, unknown> = {};
	try {
		data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		if (res.ok) throw new LateError("Late sent an answer Gaziyav can't read. Press Retry.", res.status);
	}
	if (!res.ok) {
		const detail = typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : text.replace(/\s+/g, " ").slice(0, 300);
		throw new LateError(lateHttpError(res.status, data), res.status, detail ? `HTTP ${res.status}${data.code ? ` ${String(data.code)}` : ""} — ${String(detail).slice(0, 500)}` : `HTTP ${res.status}`, typeof data.code === "string" ? data.code : undefined);
	}
	return { status: res.status, data: data as T };
}

/** Whether Late takes this key (GET /v1/accounts with it), before the app saves it: plain words when it doesn't. */
export async function checkLateKey(key: string): Promise<{ ok: true; accounts: number } | { ok: false; error: string; detail?: string }> {
	const value = key.trim();
	if (!value) return { ok: false, error: KEY_WRONG };
	try {
		const { data } = await api<{ accounts?: Array<Record<string, unknown>> }>("GET", "/accounts", { timeout: 15, key: value });
		return { ok: true, accounts: (data.accounts ?? []).map(accountView).filter(Boolean).length };
	} catch (error) {
		if (error instanceof LateError && (error.status === 401 || error.status === 403)) return { ok: false, error: KEY_WRONG, detail: error.detail };
		return { ok: false, error: (error as Error).message || "Late isn't answering right now. Try again in a few minutes.", detail: error instanceof LateError ? error.detail : undefined };
	}
}

// ───────────────────────── the profile (Late connects accounts to one) ─────────────────────────

const profileFile = () => path.join(shareDir(), "late.json");

function savedProfile(): string | null {
	try {
		const j = JSON.parse(fs.readFileSync(profileFile(), "utf8")) as {
			profileId?: string;
			key?: string;
		};
		return j.key === lateKeyHint() && j.profileId ? j.profileId : null;
	} catch {
		return null;
	}
}

/** The profile new connections go to: the one saved for this key, else Late's default one, else a new «Gaziyav». */
export async function profileId(): Promise<string> {
	const saved = savedProfile();
	if (saved) return saved;
	const { data } = await api<{
		profiles?: Array<{ _id?: string; isDefault?: boolean }>;
	}>("GET", "/profiles");
	const list = (data.profiles ?? []).filter((p) => p._id);
	let id = (list.find((p) => p.isDefault) ?? list[0])?._id;
	if (!id) {
		const made = await api<{ profile?: { _id?: string } }>("POST", "/profiles", { body: { name: "Gaziyav" } });
		id = made.data.profile?._id;
	}
	if (!id) throw new LateError("Late didn't give a profile to connect the accounts to. Try again.", 500);
	fs.mkdirSync(shareDir(), { recursive: true });
	fs.writeFileSync(profileFile(), JSON.stringify({ profileId: id, key: lateKeyHint() }), { mode: 0o600 });
	return id;
}

// ───────────────────────── accounts ─────────────────────────

let accountsCache: {
	at: number;
	accounts: LateAccount[];
	error?: string;
} | null = null;

/** The connected YouTube / Instagram / TikTok accounts (kept a minute; `fresh` asks Late again). */
export async function lateAccounts(fresh = false): Promise<{ accounts: LateAccount[]; error?: string }> {
	if (!lateKey()) return { accounts: [] };
	if (!fresh && accountsCache && Date.now() - accountsCache.at < 60_000) return accountsCache;
	try {
		const { data } = await api<{ accounts?: Array<Record<string, unknown>> }>("GET", "/accounts", { timeout: 15 });
		const accounts = (data.accounts ?? []).map(accountView).filter((a): a is LateAccount => !!a);
		accountsCache = { at: Date.now(), accounts };
	} catch (error) {
		accountsCache = {
			at: Date.now(),
			accounts: accountsCache?.accounts ?? [],
			error: (error as Error).message,
		};
	}
	return accountsCache;
}

export function forgetAccounts() {
	accountsCache = null;
}

/** The platform's own sign-in page (Late's connect URL). Late sends the browser back to `redirect` when it's done. */
export async function connectUrl(platform: Platform, redirect: string, reconnect?: string): Promise<string> {
	const query: Record<string, string> = {
		profileId: await profileId(),
		redirect_url: redirect,
	};
	if (reconnect) query.reconnectAccountId = reconnect;
	const { data } = await api<{ authUrl?: string }>("GET", `/connect/${platform}`, { query });
	if (!data.authUrl || !/^https?:\/\//.test(data.authUrl)) throw new LateError("Late didn't give a sign-in page. Try again.", 500);
	forgetAccounts();
	return data.authUrl;
}

export async function disconnect(accountId: string) {
	await api("DELETE", `/accounts/${encodeURIComponent(accountId)}`);
	forgetAccounts();
}

/** TikTok's options for this account (its creator info): who can watch, which interactions the creator allows. */
export async function tiktokInfo(accountId: string) {
	const { data } = await api<{
		creator?: { nickname?: string; canPostMore?: boolean };
		privacyLevels?: Array<{ value?: string; label?: string }>;
		postingLimits?: {
			maxVideoDurationSec?: number;
			interactionSettings?: Record<string, { enabled?: boolean } | null>;
		};
	}>("GET", `/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info`, {
		query: { mediaType: "video" },
	});
	const on = (k: string) => data.postingLimits?.interactionSettings?.[k]?.enabled !== false;
	return {
		privacyLevels: (data.privacyLevels ?? [])
			.filter((p) => p.value)
			.map((p) => ({
				value: String(p.value),
				label: String(p.label ?? p.value),
			})),
		allow: {
			comment: on("allow_comment"),
			duet: on("allow_duet"),
			stitch: on("allow_stitch"),
		},
		maxSeconds: data.postingLimits?.maxVideoDurationSec ?? null,
		canPostMore: data.creator?.canPostMore !== false,
	};
}

// ───────────────────────── the video ─────────────────────────

/** Uploads the exported MP4 to Late's storage (presign, then PUT); `onProgress` 0..1. Returns its public URL. */
export async function uploadVideo(file: string, onProgress: (p: number) => void, signal?: AbortSignal): Promise<string> {
	const size = fs.statSync(file).size;
	const { data } = await api<{ uploadUrl?: string; publicUrl?: string }>("POST", "/media/presign", { body: { filename: "gaziyav.mp4", contentType: "video/mp4", size }, signal });
	if (signal?.aborted) throw new Cancelled();
	if (!data.uploadUrl || !data.publicUrl) throw new LateError("Late didn't give a place to upload the video. Press Retry.", 500);
	const target = new URL(routed(data.uploadUrl));
	await new Promise<void>((resolve, reject) => {
		const lib = target.protocol === "http:" ? http : https;
		// Storage, not the API: no Authorization; the same Content-Type as asked for in the presign.
		const req = lib.request(
			target,
			{
				method: "PUT",
				headers: { "Content-Type": "video/mp4", "Content-Length": size },
				timeout: 120_000,
			},
			(res) => {
				res.resume();
				res.on("end", () => ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300 ? resolve() : reject(new LateError("Late's storage refused the video. Press Retry.", res.statusCode ?? 500, `HTTP ${res.statusCode}`))));
			},
		);
		req.on("timeout", () => req.destroy(Object.assign(new Error("upload stalled"), { code: "ETIMEDOUT" })));
		req.on("error", (error) => reject(error instanceof StudioError ? error : networkError(SERVICE, error, 120)));
		// Cancel in the sheet: the upload stops here, before any post is made.
		const stop = () => req.destroy(new Cancelled());
		if (signal?.aborted) stop();
		signal?.addEventListener("abort", stop, { once: true });
		req.on("close", () => signal?.removeEventListener("abort", stop));
		let sent = 0;
		const stream = fs.createReadStream(file);
		stream.on("data", (chunk) => {
			sent += chunk.length;
			onProgress(size ? sent / size : 1);
		});
		stream.on("error", (error) => req.destroy(error));
		stream.pipe(req);
	});
	return data.publicUrl;
}

// ───────────────────────── posts ─────────────────────────

type LatePost = Record<string, unknown>;

/** Creates the post (publishNow: Late publishes in this request, so it may take minutes). Safe to repeat with the same key. */
export async function createPost(body: Record<string, unknown>, idempotencyKey: string): Promise<{ status: number; post: LatePost | undefined; error?: string }> {
	const { status, data } = await api<{ post?: LatePost; error?: string }>("POST", "/posts", { body, idempotencyKey, timeout: 900 });
	return {
		status,
		post: data.post,
		error: typeof data.error === "string" ? data.error : undefined,
	};
}

export async function getPost(id: string): Promise<LatePost | undefined> {
	return (
		await api<{ post?: LatePost }>("GET", `/posts/${encodeURIComponent(id)}`, {
			timeout: 20,
		})
	).data.post;
}

export async function retryPost(id: string): Promise<LatePost | undefined> {
	return (await api<{ post?: LatePost }>("POST", `/posts/${encodeURIComponent(id)}/retry`, { timeout: 900 })).data.post;
}

export async function deletePost(id: string) {
	await api("DELETE", `/posts/${encodeURIComponent(id)}`);
}
