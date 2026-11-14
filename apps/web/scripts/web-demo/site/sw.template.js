// Gaziyav in the browser: keeps the site's own files so the editor opens with no internet after the first visit.
// Only this site's files, cache first; a new version of the site (another list) replaces them all. Requests to any
// other host are never touched (the pages make none).
const VERSION = "gz-__VERSION__";
const FILES = __FILES__;
const scopeUrl = (f) => new URL(f, self.registration.scope).href;

// Fills the copy: every listed file not in it yet, a few at a time, three rounds for the ones a busy link dropped.
async function fill() {
	const cache = await caches.open(VERSION);
	for (let round = 0; round < 3; round++) {
		const have = new Set((await cache.keys()).map((r) => r.url));
		const missing = FILES.map(scopeUrl).filter((u) => !have.has(u));
		if (!missing.length) return;
		for (let i = 0; i < missing.length; i += 6) await Promise.all(missing.slice(i, i + 6).map((u) => cache.add(u).catch(() => {})));
	}
}

self.addEventListener("install", (event) => {
	event.waitUntil(fill().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k.startsWith("gz-") && k !== VERSION).map((k) => caches.delete(k))))
			.then(() => self.clients.claim())
			// anything the install could not get (offline for a moment) is fetched again in the background
			.then(() => fill()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;
	// video and sound are read in ranges: those go to the network/cache by themselves
	if (request.headers.has("range")) return;
	event.respondWith(
		caches.open(VERSION).then(async (cache) => {
			const url = new URL(request.url);
			url.search = "";
			const key = request.mode === "navigate" && url.pathname.endsWith("/") ? url.href : url.href;
			const hit = (await cache.match(key)) ?? (request.mode === "navigate" ? await cache.match(key.endsWith("/") ? key : `${key}/`) : undefined);
			if (hit) return hit;
			try {
				const response = await fetch(request);
				if (response.ok && response.type === "basic") cache.put(key, response.clone()).catch(() => {});
				return response;
			} catch (error) {
				if (request.mode === "navigate") {
					const home = await cache.match(new URL("editor/", self.registration.scope).href);
					if (home) return home;
				}
				throw error;
			}
		}),
	);
});
