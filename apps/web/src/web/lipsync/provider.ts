// The provider straight from the page: upload to its storage, submit to its queue, poll, fetch the answer and the file,
// cancel — the same request shapes as the desktop's fal/server.ts. The key comes from ONE getter, goes only in the
// Authorization header and only to KEY_HOSTS (mayCarryKey); no URL ever holds it, nothing here logs.
import { mayCarryKey } from "./hosts";
import { keyForHttp, WebLipError } from "./sentences";

export const QUEUE = "https://queue.fal.run";
export const REST = "https://rest.fal.ai";

export interface QueuedRequest {
	endpoint: string;
	requestId: string;
	statusUrl: string;
	responseUrl: string;
	cancelUrl: string;
}

export type QueueState = { state: "queued"; position?: number } | { state: "working" } | { state: "done" } | { state: "failed"; error: string; refused: boolean } | { state: "stopped"; status: string };

export interface ProviderOptions {
	key: () => string | null;
	fetch?: typeof fetch;
	/** Tests only: where a provider URL really goes (the stand-in on 127.0.0.1). Production: the URL itself. */
	route?: (url: string) => string;
}

/** owner/app of an endpoint (status, answer and cancel live there, not under a sub-path) — fal/server.ts appOf. */
export const appOf = (endpoint: string) => endpoint.split("/").slice(0, 2).join("/");

/** The desktop's upload ticket request (fal/server.ts uploadFile). */
export const uploadTicket = (contentType: string, fileName: string) => ({ url: `${REST}/storage/upload/initiate?storage_type=fal-cdn-v3`, body: { content_type: contentType, file_name: fileName } });

/** The queue's request from its submit answer (fal/server.ts submit). */
export function queued(endpoint: string, j: { request_id?: string; status_url?: string; response_url?: string; cancel_url?: string }): QueuedRequest {
	if (!j.request_id) throw new WebLipError("web.failed", "no request id");
	const base = `${QUEUE}/${appOf(endpoint)}/requests/${j.request_id}`;
	return { endpoint, requestId: j.request_id, statusUrl: j.status_url || `${base}/status`, responseUrl: j.response_url || base, cancelUrl: j.cancel_url || `${base}/cancel` };
}

const REFUSED = /content_policy_violation|model_moderated|content polic|safety (filter|checker|check)|flagged|nsfw|moderat/i;

/** A status answer → one of the states the page follows (fal/server.ts runFal's loop). */
export function readStatus(s: { status?: string; queue_position?: number; error?: string; error_type?: string }): QueueState {
	const state = String(s.status ?? "").toUpperCase();
	if (state === "IN_QUEUE") return { state: "queued", ...(Number(s.queue_position) > 0 ? { position: Number(s.queue_position) } : {}) };
	if (state === "IN_PROGRESS") return { state: "working" };
	if (state === "COMPLETED") return s.error ? { state: "failed", error: String(s.error), refused: REFUSED.test(`${s.error} ${s.error_type ?? ""}`) } : { state: "done" };
	return { state: "stopped", status: state.toLowerCase() || "unknown" };
}

export function createProvider(o: ProviderOptions) {
	const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
	const route = o.route ?? ((u: string) => u);
	const auth = (url: string): Record<string, string> => {
		if (!mayCarryKey(url)) return {};
		const k = o.key();
		if (!k) throw new WebLipError("web.no_key");
		return { Authorization: `Key ${k}` };
	};
	async function call(url: string, init: RequestInit & { headers?: Record<string, string> }, signal?: AbortSignal): Promise<Response> {
		let res: Response;
		try {
			res = await doFetch(route(url), { ...init, headers: { ...auth(url), ...(init.headers ?? {}) }, signal, credentials: "omit", referrerPolicy: "no-referrer" });
		} catch (error) {
			if ((error as Error)?.name === "AbortError") throw error;
			throw new WebLipError("web.network", String((error as Error)?.message ?? error));
		}
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new WebLipError(keyForHttp(res.status, text), `HTTP ${res.status}`);
		}
		return res;
	}
	return {
		/** A file on the provider's storage: the ticket (with the key), then the bytes to the signed link (without it). */
		async upload(blob: Blob, fileName: string, signal?: AbortSignal): Promise<string> {
			const type = blob.type || "application/octet-stream";
			const t = uploadTicket(type, fileName);
			const ticket = (await (await call(t.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t.body) }, signal)).json().catch(() => ({}))) as { upload_url?: string; file_url?: string };
			if (!ticket.upload_url || !ticket.file_url) throw new WebLipError("web.failed", "no upload ticket");
			await call(ticket.upload_url, { method: "PUT", headers: { "Content-Type": type }, body: blob }, signal);
			return ticket.file_url;
		},
		async submit(endpoint: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<QueuedRequest> {
			const res = await call(`${QUEUE}/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }, signal);
			return queued(endpoint, (await res.json().catch(() => ({}))) as Record<string, string>);
		},
		async status(req: QueuedRequest, signal?: AbortSignal): Promise<QueueState> {
			const url = `${req.statusUrl}${req.statusUrl.includes("?") ? "&" : "?"}logs=0`;
			return readStatus((await (await call(url, { method: "GET" }, signal)).json().catch(() => ({}))) as Record<string, never>);
		},
		async answer<T = Record<string, unknown>>(req: QueuedRequest, signal?: AbortSignal): Promise<T> {
			return (await (await call(req.responseUrl, { method: "GET" }, signal)).json()) as T;
		},
		async cancel(req: QueuedRequest): Promise<void> {
			if (!o.key()) return;
			await call(req.cancelUrl, { method: "PUT" }).then((r) => r.body?.cancel()).catch(() => {});
		},
		/** Any other call to the provider's own hosts (the agent's model, the account): the key only where it may go. */
		request: (url: string, init: RequestInit & { headers?: Record<string, string> }, signal?: AbortSignal) => call(url, init, signal),
		/** A finished file (the provider's links are public and short-lived: fetched at once, no key). */
		async download(url: unknown, signal?: AbortSignal): Promise<Blob> {
			if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new WebLipError("web.no_file", "no link", true);
			try {
				return await (await call(url, { method: "GET" }, signal)).blob();
			} catch (error) {
				if ((error as Error)?.name === "AbortError") throw error;
				throw new WebLipError("web.no_file", String((error as WebLipError).details ?? ""), true);
			}
		},
	};
}

export type Provider = ReturnType<typeof createProvider>;
