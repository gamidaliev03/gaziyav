// Free stock video for B-roll: Pixabay and Pexels FIRST the moment the user pastes their free keys (Settings → Services;
// the app hands them to this process as a message, like the AI keys), then the free web behind them as the fallback —
// Wikimedia Commons (WebM/MP4 under free licences) and the Internet Archive. The order and the source switch (All · a
// keyed service · free web · my library) are media-search.ts's (principle 1). Searched and downloaded through the app's
// own network path; every clip says where it came from.
import { routed } from "@/studio/server/http";
import { archiveClips, archiveFileUrl } from "@/studio/server/providers/search";
import { chosen, serviceKey } from "@/studio/server/providers/services";
import { planFor, SOURCE_NAME, FREE_FOR, type SourcePick } from "@/studio/server/providers/media-search";

const UA = "Gaziyav/1.0 (Mac video editor; stock video search)";
const MAX_BYTES = 400e6;

export type StockSource = "pexels" | "pixabay" | "commons" | "archive";

export interface StockClip {
	/** The item id place takes: stock:pexels:<id>, stock:pixabay:<id>, stock:File:<title>. */
	item: string;
	title: string;
	source: StockSource;
	seconds?: number;
	width?: number;
	height?: number;
	mb?: number;
	license?: string;
	/** A still of the clip for the panel's tile. */
	thumb?: string;
}

// ───────────────────────── the keys ─────────────────────────

type Holder = { __gaziyavStockKeys?: Partial<Record<"pexels" | "pixabay", string | null>>; __gaziyavStockListening?: boolean };
const g = globalThis as Holder;

function listen() {
	const port = (process as unknown as { parentPort?: { on: (e: string, f: (m: unknown) => void) => void; postMessage: (m: unknown) => void } }).parentPort;
	if (!port || g.__gaziyavStockListening) return;
	g.__gaziyavStockListening = true;
	g.__gaziyavStockKeys ??= {};
	port.on("message", (m) => {
		const d = ((m as { data?: unknown })?.data ?? m) as { type?: string; provider?: string; key?: unknown };
		if (d?.type === "provider-key" && (d.provider === "pexels" || d.provider === "pixabay")) (g.__gaziyavStockKeys as Record<string, string | null>)[d.provider] = typeof d.key === "string" && d.key.trim() ? d.key.trim() : null;
	});
	for (const provider of ["pexels", "pixabay"]) port.postMessage({ type: "provider-key-request", provider });
}

export function stockKey(provider: "pexels" | "pixabay"): string | null {
	listen();
	// Settings → Services' own copy first (and the tests' stand-in keys), this module's as before
	return serviceKey(provider) || g.__gaziyavStockKeys?.[provider] || null;
}

/** For Settings: which keys are saved (their last 4 only). */
export function stockKeys() {
	const view = (k: string | null) => ({ key: !!k, hint: k ? `…${k.slice(-4)}` : null });
	return { pexels: view(stockKey("pexels")), pixabay: view(stockKey("pixabay")) };
}

// ───────────────────────── searching ─────────────────────────

class StockError extends Error {}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(routed(url), { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(12_000) });
	} catch {
		throw new StockError("Stock search isn't reachable: check the internet connection.");
	}
	if (res.status === 401 || res.status === 403 || res.status === 400) throw new StockError("key");
	if (res.status === 429) throw new StockError("Too many stock searches: wait a minute.");
	if (!res.ok) throw new StockError(`Stock search answered ${res.status}.`);
	return (await res.json()) as T;
}

interface PexelsVideo {
	id: number;
	url?: string;
	duration?: number;
	width?: number;
	height?: number;
	user?: { name?: string };
	image?: string;
	video_files?: Array<{ link: string; width?: number; height?: number; file_type?: string; quality?: string }>;
}

interface PixabayHit {
	id: number;
	duration?: number;
	tags?: string;
	user?: string;
	picture_id?: string;
	videos?: Record<string, { url: string; width?: number; height?: number; size?: number; thumbnail?: string }>;
}

const pexelsFile = (v: PexelsVideo) => {
	const files = (v.video_files ?? []).filter((f) => f.file_type === "video/mp4" && /^https:\/\//.test(f.link));
	// The sharpest file at or under 1920 on its long side (4K is more than a reel needs and slow to bring in).
	return files.filter((f) => Math.max(f.width ?? 0, f.height ?? 0) <= 1920).sort((a, b) => Math.max(b.width ?? 0, b.height ?? 0) - Math.max(a.width ?? 0, a.height ?? 0))[0] ?? files[0];
};
const pixabayThumb = (h: PixabayHit) => h.videos?.small?.thumbnail || h.videos?.tiny?.thumbnail || h.videos?.medium?.thumbnail || h.videos?.large?.thumbnail || (h.picture_id ? `https://i.vimeocdn.com/video/${h.picture_id}_295x166.jpg` : undefined);
const pixabayFile = (h: PixabayHit) => h.videos?.large?.url ? h.videos.large : h.videos?.medium?.url ? h.videos.medium : h.videos?.small;

async function searchPexels(q: string, key: string, vertical: boolean): Promise<StockClip[]> {
	const j = await getJson<{ videos?: PexelsVideo[] }>(`https://api.pexels.com/videos/search?${new URLSearchParams({ query: q, per_page: "8", ...(vertical ? { orientation: "portrait" } : {}) })}`, { Authorization: key });
	return (j.videos ?? []).map((v) => {
		const f = pexelsFile(v);
		return { item: `stock:pexels:${v.id}`, title: `${q} · ${v.user?.name ?? "Pexels"}`, source: "pexels" as const, seconds: v.duration, width: f?.width ?? v.width, height: f?.height ?? v.height, license: "Pexels license (free)", ...(v.image ? { thumb: v.image } : {}) };
	});
}

async function searchPixabay(q: string, key: string, type?: string): Promise<StockClip[]> {
	const j = await getJson<{ hits?: PixabayHit[] }>(`https://pixabay.com/api/videos/?${new URLSearchParams({ key, q, per_page: "8", safesearch: "true", ...(type ? { video_type: type } : {}) })}`);
	return (j.hits ?? []).map((h) => {
		const f = pixabayFile(h);
		return { item: `stock:pixabay:${h.id}`, title: `${(h.tags ?? q).split(",")[0].trim()} · ${h.user ?? "Pixabay"}`, source: "pixabay" as const, seconds: h.duration, width: f?.width, height: f?.height, mb: f?.size ? Math.round(f.size / 1e5) / 10 : undefined, license: "Pixabay license (free)", ...(pixabayThumb(h) ? { thumb: pixabayThumb(h) } : {}) };
	});
}

interface Page {
	title: string;
	imageinfo?: Array<{ url: string; thumburl?: string; size: number; width: number; height: number; mime: string; metadata?: Array<{ name: string; value: unknown }>; extmetadata?: Record<string, { value: string } | undefined> }>;
}

const commons = (params: Record<string, string>) => getJson<{ query?: { pages?: Record<string, Page> } }>(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ format: "json", ...params })}`);
const length = (p: Page) => Number(p.imageinfo?.[0]?.metadata?.find((m) => m.name === "length" || m.name === "playtime_seconds")?.value) || undefined;

async function searchCommons(q: string): Promise<StockClip[]> {
	const j = await commons({ action: "query", generator: "search", gsrnamespace: "6", gsrlimit: "20", gsrsearch: `${q} filemime:video`, prop: "imageinfo", iiprop: "url|size|mime|metadata|extmetadata", iiextmetadatafilter: "LicenseShortName", iiurlwidth: "320" });
	return Object.values(j.query?.pages ?? {})
		.map((p) => ({ p, i: p.imageinfo?.[0] }))
		.filter(({ i }) => i && /video\/(webm|mp4)/.test(i.mime) && i.size <= MAX_BYTES && i.width >= 640)
		.map(({ p, i }) => ({ item: `stock:${p.title}`, title: p.title.replace(/^File:/, ""), source: "commons" as const, seconds: length(p), width: i?.width, height: i?.height, mb: Math.round((i?.size ?? 0) / 1e5) / 10, license: i?.extmetadata?.LicenseShortName?.value, ...(i?.thumburl ? { thumb: i.thumburl } : {}) }))
		.filter((c) => !c.seconds || c.seconds >= 2)
		.slice(0, 8);
}

/**
 * Clips by the source switch (absent: the one kept): «All» asks the keyed services first (the one picked in Settings →
 * Services first of them), then Commons and the Internet Archive; a keyed service that fails or refuses its key is said
 * in one line and the free web answers. A picked service alone, the free web alone, or the library (none from here).
 */
export async function searchStock(query: string, vertical = true, pick?: SourcePick): Promise<{ items: StockClip[]; notes: string[]; searched: string[] }> {
	const q = query.trim().slice(0, 100);
	if (!q) return { items: [], notes: [], searched: [] };
	const plan = await planFor("video", pick);
	const notes: string[] = plan.note ? [plan.note] : [];
	const searched = [...plan.keyed, ...(plan.free ? FREE_FOR.video : [])].map((id) => SOURCE_NAME[id]);
	if (!plan.keyed.length && !plan.free) return { items: [], notes: ["The video search is set to My library: the project's own Media (switch in the Media panel)."], searched };
	const row = chosen("video-search");
	const pixabayType = row.provider === "pixabay" && row.model ? row.model : undefined;
	const tries: Array<[string, Promise<StockClip[]>]> = plan.keyed.map((id) => [SOURCE_NAME[id], id === "pexels" ? searchPexels(q, stockKey("pexels") as string, vertical) : searchPixabay(q, stockKey("pixabay") as string, pixabayType)]);
	if (plan.free) tries.push(["Wikimedia Commons", searchCommons(q)]);
	const keyedItems: StockClip[] = [];
	const freeItems: StockClip[] = [];
	// The Internet Archive (free, no key) beside Commons: always on the free web, so a keyless search has enough.
	const archived = plan.free ? archiveClips(q).catch(() => [] as StockClip[]) : Promise.resolve([] as StockClip[]);
	const settled = await Promise.allSettled(tries.map(([, run]) => run));
	for (const [i, r] of settled.entries()) {
		const name = tries[i][0];
		if (r.status === "fulfilled") (i < plan.keyed.length ? keyedItems : freeItems).push(...r.value);
		else notes.push((r.reason as Error)?.message === "key" ? `${name} didn't accept the saved key (Settings → Services); the free web answered.` : `${name}: ${(r.reason as Error)?.message}`);
	}
	freeItems.push(...((await archived) as StockClip[]));
	if (plan.free && !plan.keyed.length && !stockKey("pexels") && !stockKey("pixabay")) notes.push("With a free Pexels or Pixabay key (Gaziyav → Settings → Services) the search finds much better footage.");
	// keyed first, then the free web interleaved (Commons, Archive) so both show on the first screen
	const commons = freeItems.filter((c) => c.source === "commons");
	const archive = freeItems.filter((c) => c.source === "archive");
	const free: StockClip[] = [];
	for (let i = 0; i < Math.max(commons.length, archive.length); i++) free.push(...[commons[i], archive[i]].filter((c): c is StockClip => !!c));
	return { items: [...keyedItems.slice(0, 10), ...free].slice(0, 16), notes, searched };
}

// ───────────────────────── one clip's file ─────────────────────────

async function stream(url: string, contentType: string, license: string): Promise<Response> {
	const res = await fetch(routed(url), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(300_000) });
	if (!res.ok || !res.body) throw new StockError("The stock clip didn't download. Try another one.");
	const size = Number(res.headers.get("content-length")) || 0;
	if (size > MAX_BYTES) throw new StockError("That stock clip is too big. Pick a shorter one.");
	return new Response(res.body, { headers: { "Content-Type": res.headers.get("content-type") || contentType, ...(size ? { "Content-Length": String(size) } : {}), "x-license": license } });
}

/** The file of a stock item (its link comes from the provider's own answer, never from the caller). */
export async function stockFile(item: string): Promise<Response> {
	const id = item.replace(/^stock:/, "");
	const pex = /^pexels:(\d{1,12})$/.exec(id);
	if (pex) {
		const key = stockKey("pexels") ?? (() => { throw new StockError("No Pexels key: the user saves one in Settings → Services."); })();
		const v = await getJson<PexelsVideo>(`https://api.pexels.com/videos/videos/${pex[1]}`, { Authorization: key });
		const f = pexelsFile(v);
		if (!f) throw new StockError("That Pexels clip has no file to download.");
		return stream(f.link, "video/mp4", `Pexels license · ${v.user?.name ?? "Pexels"} · ${v.url ?? "pexels.com"}`);
	}
	const pix = /^pixabay:(\d{1,12})$/.exec(id);
	if (pix) {
		const key = stockKey("pixabay") ?? (() => { throw new StockError("No Pixabay key: the user saves one in Settings → Services."); })();
		const j = await getJson<{ hits?: PixabayHit[] }>(`https://pixabay.com/api/videos/?${new URLSearchParams({ key, id: pix[1] })}`);
		const h = j.hits?.[0];
		const f = h ? pixabayFile(h) : undefined;
		if (!h || !f?.url) throw new StockError("That Pixabay clip isn't available.");
		return stream(f.url, "video/mp4", `Pixabay license · ${h.user ?? "Pixabay"}`);
	}
	const archive = archiveFileUrl(id);
	if (archive) return stream(archive, "video/mp4", "Internet Archive (free licence)");
	if (!/^File:[^/\\]{1,240}\.(webm|mp4)$/i.test(id)) throw new StockError("Not a stock clip: use an item from find_content stock.");
	const j = await commons({ action: "query", titles: id, prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiextmetadatafilter: "LicenseShortName" });
	const info = Object.values(j.query?.pages ?? {})[0]?.imageinfo?.[0];
	if (!info || new URL(info.url).hostname !== "upload.wikimedia.org" || info.size > MAX_BYTES) throw new StockError("That stock clip isn't available.");
	return stream(info.url, info.mime, info.extmetadata?.LicenseShortName?.value ?? "free licence");
}
