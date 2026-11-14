// THE SEAM: one object in the shape of the static edition's BrowserAi (pubdemo's src/demo/ai-adapter.ts) that answers
// the golden path's /api/ routes inside the page, exactly as the desktop server answers them — the app's client
// (studio/client/api.ts, actions.ts, the store, editor-bridge) stays as it is. Everything else stays «in the app».
import type { ReactNode } from "react";
import { FAL_DEFAULTS, FAL_MODELS } from "@/fal/models";
import { createEngine, type Engine } from "./engine";
import { CONNECT_HOSTS } from "./hosts";
import { forgetKey, keyHint, readKey, saveKey } from "./key";
import { browserMedia, type Media } from "./media";
import { indexedDbPark, type Park } from "./park";
import { createProvider } from "./provider";
import { keyOf, type Lang, say, WebLipError } from "./sentences";

/** pubdemo's BrowserAi, structurally (its file is not imported: the two trees meet only here). */
export interface WebAiAdapter {
	handles: (path: string, method: string) => boolean;
	answer: (path: string, init: RequestInit | undefined, url: URL) => Promise<Response>;
	panel?: () => ReactNode;
}

const ROUTES: Array<[string, RegExp]> = [
	["POST", /^\/api\/studio\/upload$/],
	["POST", /^\/api\/studio\/preflight$/],
	["POST", /^\/api\/studio\/jobs\/(voiceover|lipsync)$/],
	["GET", /^\/api\/studio\/jobs\/[\w-]+$/],
	["DELETE", /^\/api\/studio\/jobs\/[\w-]+$/],
	["GET", /^\/api\/studio\/file\/[\w-]+$/],
	["DELETE", /^\/api\/studio\/file\/[\w-]+$/],
	["GET", /^\/api\/fal\/status$/],
];

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export interface WebLipsyncOptions {
	fetch?: typeof fetch;
	/** Tests only: a provider URL → the local stand-in. */
	route?: (url: string) => string;
	park?: Park;
	media?: Media;
	pollMs?: number;
	lang?: () => Lang;
	panel?: () => ReactNode;
}

export function createWebLipsync(o: WebLipsyncOptions = {}): { adapter: WebAiAdapter; engine: Engine; hosts: readonly string[]; key: { read: typeof readKey; save: typeof saveKey; forget: typeof forgetKey; hint: () => string | null } } {
	const lang = o.lang ?? (() => (typeof document !== "undefined" && /^en/i.test(document.documentElement.lang) ? "en" : "ru"));
	const provider = createProvider({ key: () => readKey(), fetch: o.fetch, route: o.route });
	const engine = createEngine({ provider, park: o.park ?? indexedDbPark(), media: o.media ?? browserMedia, hasKey: () => !!readKey(), lang, pollMs: o.pollMs });
	const fail = (error: unknown, status = 400) => {
		const key = keyOf(error);
		return json({ error: say(key, lang()), errorKey: key }, status);
	};
	async function body<T>(init: RequestInit | undefined): Promise<T> {
		const b = init?.body;
		return (typeof b === "string" ? JSON.parse(b) : b instanceof Blob ? JSON.parse(await b.text()) : {}) as T;
	}
	const adapter: WebAiAdapter = {
		handles: (path, method) => ROUTES.some(([m, re]) => m === method.toUpperCase() && re.test(path)),
		async answer(path, init, url) {
			const method = (init?.method ?? "GET").toUpperCase();
			const tail = path.split("?")[0].split("/").slice(3);
			try {
				if (path === "/api/fal/status") {
					const k = readKey();
					const none = { key: false, hint: null, spent: { total: 0, byTask: {} } };
					return json({ key: !!k, hint: keyHint(k), choices: FAL_DEFAULTS, models: FAL_MODELS.filter((m) => !m.api && ["lipsync", "tts", "clone"].includes(m.task)), spent: { total: 0, byTask: {} }, kie: none, argo: none });
				}
				if (tail[0] === "upload") {
					const b = init?.body;
					if (!(b instanceof Blob)) throw new WebLipError("web.prepare", "no file");
					return json(await engine.upload(b, url.searchParams.get("name") ?? (b as File).name ?? "file"));
				}
				if (tail[0] === "preflight") return json(await engine.preflight(await body(init)));
				if (tail[0] === "jobs" && method === "POST") return json(tail[1] === "voiceover" ? await engine.startVoiceover(await body(init)) : await engine.startLipsync(await body(init)));
				if (tail[0] === "jobs" && method === "GET") {
					const s = await engine.job(tail[1]);
					return s ? json(s) : json({ error: say("web.unknown_job", lang()) + " (no longer known)" }, 404);
				}
				if (tail[0] === "jobs" && method === "DELETE") return json({ cancelled: await engine.cancel(tail[1]) });
				if (tail[0] === "file" && method === "GET") {
					const f = await engine.file(tail[1]);
					return f ? new Response(f.blob, { headers: { "Content-Type": f.type || "application/octet-stream" } }) : json({ error: say("web.no_file", lang()) }, 404);
				}
				if (tail[0] === "file" && method === "DELETE") return await engine.deleteFile(tail[1]), json({ ok: true });
				return json({ error: "not here" }, 404);
			} catch (error) {
				return fail(error);
			}
		},
		...(o.panel ? { panel: o.panel } : {}),
	};
	return { adapter, engine, hosts: CONNECT_HOSTS, key: { read: readKey, save: saveKey, forget: forgetKey, hint: () => keyHint(readKey()) } };
}

/**
 * The app's upload is an XMLHttpRequest (studio/client/api.ts uploadBytes: for its progress bar), which a fetch shim
 * never sees. Same-origin POSTs to /api/studio/upload — and nothing else — are answered by the adapter here, with the
 * events the client listens to (upload.onprogress, onload, onerror).
 */
export function bridgeUploadXhr(adapter: WebAiAdapter, w: Window & typeof globalThis = window): void {
	const X = w.XMLHttpRequest as typeof XMLHttpRequest & { __gzWebLip?: boolean };
	if (!X || X.__gzWebLip) return;
	X.__gzWebLip = true;
	const open = X.prototype.open;
	const send = X.prototype.send;
	X.prototype.open = function (this: XMLHttpRequest & { __gzUrl?: URL }, method: string, url: string | URL, ...rest: unknown[]) {
		const u = new URL(String(url), w.location.href);
		const at = u.pathname.indexOf("/api/studio/upload");
		this.__gzUrl = method.toUpperCase() === "POST" && u.origin === w.location.origin && at >= 0 ? u : undefined;
		return (open as (...a: unknown[]) => void).call(this, method, url, ...(rest.length ? rest : [true]));
	} as typeof X.prototype.open;
	X.prototype.send = function (this: XMLHttpRequest & { __gzUrl?: URL }, payload?: Document | XMLHttpRequestBodyInit | null) {
		const u = this.__gzUrl;
		if (!u || !(payload instanceof Blob)) return send.call(this, payload as XMLHttpRequestBodyInit | null | undefined);
		const xhr = this;
		const done = (status: number, text: string) => {
			Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
			Object.defineProperty(xhr, "status", { value: status, configurable: true });
			Object.defineProperty(xhr, "responseText", { value: text, configurable: true });
			(xhr.upload.onprogress as ((e: ProgressEvent) => void) | null)?.(new ProgressEvent("progress", { lengthComputable: true, loaded: payload.size, total: payload.size }));
			xhr.onload?.call(xhr, new ProgressEvent("load"));
			xhr.dispatchEvent(new Event("loadend"));
		};
		adapter
			.answer(u.pathname.slice(u.pathname.indexOf("/api/")), { method: "POST", body: payload }, u)
			.then(async (r) => done(r.status, await r.text()))
			.catch(() => xhr.onerror?.call(xhr, new ProgressEvent("error")));
	};
}

/**
 * The one line pubdemo's start-up needs: `mountWebLipsync(registerBrowserAi)` (and CONNECT_HOSTS into connect-hosts.json).
 * Returns the parts for the key panel and tests.
 */
export function mountWebLipsync(register: (a: WebAiAdapter) => void, o: WebLipsyncOptions = {}) {
	const made = createWebLipsync(o);
	register(made.adapter);
	if (typeof window !== "undefined") bridgeUploadXhr(made.adapter);
	return made;
}
