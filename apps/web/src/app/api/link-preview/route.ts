// Real-time preview of a web video (the "Add from a link" dialog) through the app's own server.
//
// The player gets the picture and sound streams yt-dlp found, but video sites throttle a player's
// open-ended byte requests to a crawl (a long YouTube video did not start at all, sound never came).
// This proxy answers the player's Range requests by fetching the same bytes from the site in short
// bounded pieces, which are served at full speed, so playback and seeking are real time.
//
// POST { urls: string[] } (app window only, X-Studio header) → { ids }, then GET ?id=… streams one.
// Only https addresses on public hosts are accepted; ids are random and expire.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Entry {
	url: string;
	size: number | null;
	type: string | null;
	created: number;
}

const MAX_ENTRIES = 40;
const TTL_MS = 6 * 60 * 60 * 1000;
/** Bytes per request to the site: small first piece (fast start), then bigger ones. */
const FIRST_PIECE = 512 * 1024;
const PIECE = 4 * 1024 * 1024;
const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const entries: Map<string, Entry> =
	((globalThis as Record<string, unknown>).__studioLinkPreview as Map<string, Entry>) ??
	((globalThis as Record<string, unknown>).__studioLinkPreview = new Map<string, Entry>());

const json = (data: unknown, status = 200) => Response.json(data, { status });

function localOnly(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request rejected" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request rejected" }, 403);
	return null;
}

/** https on a public host name (no local or private network addresses). */
function isPublicHttps(raw: string): boolean {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return false;
	}
	if (u.protocol !== "https:" || u.username || u.password) return false;
	const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
		const [a, b] = host.split(".").map(Number);
		if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) {
			return false;
		}
	}
	if (host.includes(":")) return false; // literal IPv6
	return true;
}

function prune() {
	const now = Date.now();
	for (const [id, entry] of entries) if (now - entry.created > TTL_MS) entries.delete(id);
	while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
}

export async function POST(req: Request) {
	const rejected = localOnly(req);
	if (rejected) return rejected;
	if (req.headers.get("x-studio") !== "1") return json({ error: "Request rejected" }, 403);
	let urls: unknown;
	try {
		urls = (await req.json())?.urls;
	} catch {
		return json({ error: "Invalid request" }, 400);
	}
	if (!Array.isArray(urls) || urls.length === 0 || urls.length > 4) return json({ error: "Invalid request" }, 400);
	prune();
	const ids: Array<string | null> = urls.map((url) => {
		if (typeof url !== "string" || !isPublicHttps(url)) return null;
		const id = crypto.randomUUID();
		entries.set(id, { url, size: null, type: null, created: Date.now() });
		return id;
	});
	return json({ ids });
}

async function fetchPiece(url: string, start: number, end: number, signal: AbortSignal): Promise<Response> {
	return fetch(url, {
		headers: { Range: `bytes=${start}-${end}`, "User-Agent": UA, Accept: "*/*" },
		signal,
		redirect: "follow",
	});
}

/** Total size and type of the stream (one tiny request, remembered). */
async function describe(entry: Entry, signal: AbortSignal): Promise<boolean> {
	if (entry.size !== null) return true;
	const res = await fetchPiece(entry.url, 0, 0, signal);
	const total = Number(res.headers.get("content-range")?.split("/")[1]);
	await res.body?.cancel().catch(() => {});
	if (!res.ok || !Number.isFinite(total) || total <= 0) return false;
	entry.size = total;
	entry.type = res.headers.get("content-type");
	return true;
}

export async function GET(req: Request) {
	const rejected = localOnly(req);
	if (rejected) return rejected;
	const id = new URL(req.url).searchParams.get("id") ?? "";
	const entry = entries.get(id);
	if (!entry) return new Response("Preview expired — open the link again.", { status: 404 });
	try {
		if (!(await describe(entry, req.signal))) return new Response("The site refused the preview.", { status: 502 });
	} catch {
		return new Response("The site did not answer.", { status: 502 });
	}
	const size = entry.size as number;
	const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
	let start = m?.[1] ? Number(m[1]) : 0;
	let end = m?.[2] ? Number(m[2]) : size - 1;
	if (m && !m[1] && m[2]) {
		// suffix range: the last N bytes
		start = Math.max(0, size - Number(m[2]));
		end = size - 1;
	}
	end = Math.min(end, size - 1);
	if (start > end || start >= size) {
		return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
	}

	const upstream = new AbortController();
	req.signal.addEventListener("abort", () => upstream.abort(), { once: true });
	let position = start;
	let first = true;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (position > end) {
				controller.close();
				return;
			}
			const pieceEnd = Math.min(end, position + (first ? FIRST_PIECE : PIECE) - 1);
			first = false;
			try {
				const res = await fetchPiece(entry.url, position, pieceEnd, upstream.signal);
				if (res.status !== 206 || !res.body) throw new Error(`HTTP ${res.status}`);
				const reader = res.body.getReader();
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					controller.enqueue(value);
					position += value.byteLength;
				}
				if (position <= pieceEnd) throw new Error("short read");
			} catch (error) {
				upstream.abort();
				try {
					controller.error(error);
				} catch {}
			}
		},
		cancel() {
			upstream.abort();
		},
	});
	return new Response(body, {
		status: 206,
		headers: {
			"Content-Type": entry.type ?? "application/octet-stream",
			"Content-Length": String(end - start + 1),
			"Content-Range": `bytes ${start}-${end}/${size}`,
			"Accept-Ranges": "bytes",
			"Cache-Control": "no-store",
		},
	});
}
