// Server side of web image search: a keyed Pixabay / Pexels first the moment its key is pasted, then the free web
// (Wikimedia Commons, Openverse, NASA) as the fallback — the order and the source switch are media-search.ts's (principle 1).
// Results are cached per (source, query, page); downloads are proxied (no CORS issues) and size-checked.
import { routed } from "@/studio/server/http";
import type { WebImage, WebImageSearchResult } from "./types";
import { chosen, serviceKey } from "@/studio/server/providers/services";
import { foundUrl, freePictures, pexelsPictures, pixabayPictures } from "@/studio/server/providers/search";
import { FREE_FOR, planFor, SOURCE_NAME, type SourcePick } from "@/studio/server/providers/media-search";

const PAGE = 12;
const TIMEOUT_MS = 8000;
const UA = "Gaziyav/1.0 (Mac video editor; image search)";
// Wikimedia serves files from upload.* and resized copies from thumb.*.
const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);

export class WebImageError extends Error {}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await fetch(routed(url), { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
			if (res.status === 429) throw new WebImageError("Too many searches — wait a minute and try again.");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return await res.json();
		} catch (error) {
			if (error instanceof WebImageError || attempt === 1) {
				if (error instanceof WebImageError) throw error;
				throw new WebImageError("Image search is not reachable — check the internet connection.");
			}
		}
	}
	throw new WebImageError("Image search is not reachable — check the internet connection.");
}

const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

type CommonsPage = {
	pageid: number;
	title: string;
	imageinfo?: Array<{
		url: string;
		thumburl?: string;
		width: number;
		height: number;
		mime: string;
		descriptionurl: string;
		extmetadata?: Record<string, { value: string } | undefined>;
	}>;
};

async function searchCommons(query: string, page: number): Promise<{ items: WebImage[]; hasMore: boolean }> {
	const params = new URLSearchParams({
		action: "query",
		format: "json",
		generator: "search",
		gsrnamespace: "6",
		gsrsearch: `${query} filetype:bitmap`,
		gsrlimit: String(PAGE),
		gsroffset: String((page - 1) * PAGE),
		prop: "imageinfo",
		iiprop: "url|size|mime|extmetadata",
		iiextmetadatafilter: "Artist|LicenseShortName",
		iiurlwidth: "360",
	});
	const data = (await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`, { "User-Agent": UA, "Api-User-Agent": UA })) as {
		query?: { pages?: Record<string, CommonsPage & { index?: number }> };
		continue?: unknown;
	};
	const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
	const items: WebImage[] = [];
	for (const p of pages) {
		const info = p.imageinfo?.[0];
		if (!info || !/^image\/(jpeg|png|webp|gif)$/.test(info.mime)) continue;
		const thumb = info.thumburl ?? info.url;
		// Big originals: the CDN's 1920 px copy instead (same URL scheme as the 360 px thumbnail).
		const full = info.width > 1920 && info.thumburl ? info.thumburl.replace(/\/\d+px-([^/]+)$/, "/1920px-$1") : info.url;
		const meta = info.extmetadata ?? {};
		items.push({
			id: `commons:${p.pageid}`,
			provider: "commons",
			title: p.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
			author: strip(meta.Artist?.value ?? ""),
			license: strip(meta.LicenseShortName?.value ?? ""),
			sourceUrl: info.descriptionurl,
			thumbUrl: thumb,
			fullUrl: full,
			width: info.width,
			height: info.height,
		});
	}
	return { items, hasMore: !!data.continue };
}

const cache = new Map<string, Promise<{ items: WebImage[]; hasMore: boolean }>>();

function cached(key: string, run: () => Promise<{ items: WebImage[]; hasMore: boolean }>) {
	let hit = cache.get(key);
	if (!hit) {
		hit = run();
		cache.set(key, hit);
		hit.catch(() => cache.delete(key));
		if (cache.size > 200) cache.delete(cache.keys().next().value as string);
	}
	return hit;
}

const asWeb = (p: { id: string } & Omit<WebImage, "provider">): WebImage => ({ ...p, provider: (p.id.split(":")[0] as WebImage["provider"]) || "commons" });

/** Interleaves lists so each source shows on the first screen. */
function interleave(lists: WebImage[][]): WebImage[] {
	const out: WebImage[] = [];
	for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) out.push(l[i]);
	return out;
}

export async function searchWebImages(query: string, page: number, pick?: SourcePick): Promise<WebImageSearchResult> {
	const q = query.trim().slice(0, 200);
	if (!q) return { items: [], hasMore: false, providers: [] };
	const plan = await planFor("picture", pick);
	if (!plan.keyed.length && !plan.free) return { items: [], hasMore: false, providers: [], searched: [], ...(plan.note ? { note: plan.note } : {}) };
	// Keyed services first (their pictures on top), the free web behind them.
	const row = chosen("image-search");
	const pixabayType = row.provider === "pixabay" && row.model ? row.model : "photo";
	const keyed = plan.keyed.map((id) =>
		cached(`${id}|${q}|${page}`, async () => {
			const items = id === "pixabay" ? await pixabayPictures(q, page, serviceKey("pixabay"), pixabayType) : await pexelsPictures(q, page, serviceKey("pexels"));
			return { items: items.map(asWeb), hasMore: items.length >= PAGE - 2 };
		}),
	);
	const free = plan.free
		? [
				cached(`commons|${q}|${page}`, () => searchCommons(q, page)),
				cached(`free|${q}|${page}`, async () => {
					const items = await freePictures(q, page);
					return { items: items.map(asWeb), hasMore: items.length >= PAGE - 2 };
				}),
			]
		: [];
	const [k, f] = await Promise.all([Promise.allSettled(keyed), Promise.allSettled(free)]);
	const ok = (s: PromiseSettledResult<{ items: WebImage[]; hasMore: boolean }>[]) => s.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []));
	const fails = [...k, ...f].filter((s) => s.status === "rejected") as PromiseRejectedResult[];
	const keyedOk = ok(k);
	const freeOk = ok(f);
	if (!keyedOk.length && !freeOk.length) {
		const first = fails[0]?.reason;
		throw first instanceof WebImageError ? first : new WebImageError(first instanceof Error && first.message ? first.message : "Image search failed — try again.");
	}
	const failedKeyed = plan.keyed.filter((_, i) => k[i]?.status === "rejected").map((id) => SOURCE_NAME[id]);
	const note = [plan.note, failedKeyed.length ? `${failedKeyed.join(" and ")} didn't answer (${((k.find((x) => x.status === "rejected") as PromiseRejectedResult).reason as Error)?.message ?? "error"}); the free web answered.` : ""].filter(Boolean).join(" ") || undefined;
	const items = [...interleave(keyedOk.map((r) => r.items)), ...interleave(freeOk.map((r) => r.items))];
	// The next page in the background (Kadr does the same), Commons only: keyed services count every request.
	if (plan.free) void cached(`commons|${q}|${page + 1}`, () => searchCommons(q, page + 1)).catch(() => {});
	const providers = [...new Set(items.map((i) => i.provider))];
	return {
		items,
		hasMore: [...keyedOk, ...freeOk].some((r) => r.hasMore),
		providers,
		searched: [...plan.keyed, ...(plan.free ? FREE_FOR.picture : [])].map((id) => SOURCE_NAME[id]),
		...(note ? { note } : {}),
	};
}

/** Downloads one image (only from the two providers' CDNs), 1 kB … 60 MB. */
export async function downloadWebImage(url: string): Promise<{ bytes: ArrayBuffer; type: string }> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new WebImageError("Not an image link.");
	}
	if (parsed.protocol !== "https:" || !(ALLOWED_HOSTS.has(parsed.hostname) || foundUrl(parsed.href) || foundUrl(url))) throw new WebImageError("Only pictures a search found can be added.");
	const res = await fetch(routed(parsed.href), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) }).catch(() => null);
	if (!res?.ok) throw new WebImageError("The image could not be downloaded — check the internet connection.");
	const type = res.headers.get("content-type") ?? "image/jpeg";
	if (!/^image\/(jpeg|png|webp|gif)/.test(type)) throw new WebImageError("That file is not a supported image.");
	const bytes = await res.arrayBuffer();
	if (bytes.byteLength < 1024 || bytes.byteLength > 60 * 1024 * 1024) throw new WebImageError("The image is empty or too large (over 60 MB).");
	return { bytes, type };
}
