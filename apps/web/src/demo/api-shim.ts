// The browser demo's «server», inside the page (the method of the earlier static export of the editor). The app's page
// asks its own local server (/api/…) for a few facts, caches and the AI; a static site has no server, so window.fetch is
// wrapped once, before the first request: the few facts are answered here, everything else under /api/ gets a quiet
// «not in the browser» at once (AI requests go to one adapter: ai-adapter.ts) — no request ever leaves the tab. Requests to any other host are refused too: the demo
// sends nothing anywhere (the page's Content-Security-Policy says the same to the browser).

import { browserAi, isAiPath } from "./ai-adapter";
import hosts from "./connect-hosts.json";

export const NOT_IN_DEMO = "This works in the Gaziyav app for Mac.";

export interface ShimCall {
	method: string;
	path: string;
	status: number;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/** The answer to one /api/ request of the app (path without the site's prefix, e.g. "/api/version"). */
export function answer(path: string, method = "GET", search = ""): Response {
	const [, , area = "", head = ""] = path.split("/");
	const params = new URLSearchParams(search);
	if (area === "version") return json({ version: process.env.NEXT_PUBLIC_APP_VERSION ?? "demo", demo: true });
	if (area === "hardware") return json({ tier: "standard" });
	if (area === "transcribe" && head === "status") return json({ available: false, reason: NOT_IN_DEMO });
	if (area === "text" && head === "graphics") return json({ available: false, items: [] });
	if (area === "library") {
		if (head === "index") return json({ items: [], sources: [] });
		if (head === "state") return json({ favourites: [], recent: [] });
		if (head === "progress") return json({ downloading: {}, cached: [], offline: true });
		if (head === "ensure") return json({ ok: false, failed: (params.get("ids") ?? "").split(",").filter(Boolean) });
		// favourites and «recent» of the sound panel: accepted, nothing kept
		if (method !== "GET") return json({ ok: true, favourites: [], recent: [] });
	}
	if (area === "settings" && head === "storage") return json({ ok: true, demo: true });
	// the voice-over action first makes sure the word-timing model is on this computer (the desktop's on-device AI); the
	// browser edition has none and needs none — its voice job skips word timings — so the step is answered as done
	if (area === "ondevice" && head === "status") return json({ models: [{ id: "whisper", title: "Whisper", purpose: "", downloadBytes: 0, diskBytes: 0, installBytes: 0, installed: true, verified: true }], library: { folder: "" } });
	// the export cache of the app (export/build/cache-client.ts): «none here», so every export renders from scratch
	if (area === "export" && head === "cache") return json({ error: NOT_IN_DEMO }, 404);
	// journals and quiet notes of the app's background work: accepted, nothing kept
	if (head === "journal" || head === "quiet") return json({ ok: true });
	return json({ error: NOT_IN_DEMO, demo: true }, method === "GET" ? 404 : 501);
}

/** The path of an /api/ request of this page («/api/…», wherever the site's prefix puts it), or null. */
export function apiPath(url: URL, origin: string): string | null {
	if (url.origin !== origin) return null;
	const at = url.pathname.indexOf("/api/");
	return at < 0 ? null : url.pathname.slice(at);
}

// A host the browser AI module was allowed to reach (connect-hosts.json); nothing else leaves the tab.
export const allowedHost = (origin: string, list: readonly string[] = hosts.connect): boolean => {
	let host: string;
	try {
		const u = new URL(origin);
		if (u.protocol !== "https:") return false;
		host = u.hostname;
	} catch {
		return false;
	}
	return list.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));
};

/** The site's own sound pack (public/sfx, CC0) as the app's sound library lists it (library/server/index-store.ts). */
async function bundledSounds(realFetch: typeof fetch): Promise<Response> {
	try {
		const rows = (await (await realFetch(new URL("sfx/index.json", document.baseURI))).json()) as Array<{ file: string; name: string; en?: string; cat: string; tags?: string[]; dur: number }>;
		const items = rows.map((r) => ({ id: `b-${r.file.replace(/\.[^.]+$/, "")}`, kind: "sfx", name: r.en || r.name, cat: "Basic", tags: [r.name, r.cat, ...(r.tags ?? [])], dur: r.dur, src: "bundled" }));
		return json({ items, sources: [{ src: "bundled", kind: "sfx", count: items.length }] });
	} catch {
		return json({ items: [], sources: [] });
	}
}

let installed = false;
const calls: ShimCall[] = [];

/** What the app asked its absent server in this tab (tests read it: window.__demoApi). */
export const shimCalls = (): readonly ShimCall[] => calls;

/** Wraps window.fetch once; call before the editor starts. */
export function installDemoApi(): void {
	if (installed || typeof window === "undefined") return;
	installed = true;
	const realFetch = window.fetch.bind(window);
	const wrapped = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		let url: URL;
		try {
			url = new URL(raw, location.href);
		} catch {
			return realFetch(input, init);
		}
		if (url.protocol === "blob:" || url.protocol === "data:") return realFetch(input, init);
		if (url.origin !== location.origin && !allowedHost(url.origin)) {
			calls.push({ method: "GET", path: url.origin, status: 0 });
			return Promise.reject(new TypeError("The demo sends nothing outside this page"));
		}
		const path = apiPath(url, location.origin);
		if (!path) return realFetch(input, init);
		const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
		// AI: the one adapter (src/demo/ai-adapter.ts); without one, the generic «in the desktop app»
		const ai = isAiPath(path) ? browserAi() : null;
		if (ai?.handles(path, method)) {
			calls.push({ method, path, status: -1 });
			return ai.answer(path, init, url);
		}
		if (path === "/api/library/index" && method === "GET") {
			calls.push({ method, path, status: 200 });
			return bundledSounds(realFetch);
		}
		const response = answer(path, method, url.search);
		calls.push({ method, path, status: response.status });
		return Promise.resolve(response);
	};
	window.fetch = wrapped as typeof fetch;
	// nothing is ever reported anywhere
	if (navigator.sendBeacon) navigator.sendBeacon = () => true;
	(window as unknown as { __demoApi: () => readonly ShimCall[] }).__demoApi = shimCalls;
}
