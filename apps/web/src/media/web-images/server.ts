// Server side of web image search: Wikimedia Commons (free, no key). Results are cached per (query, page); downloads
// are proxied (no CORS issues) and size-checked.
import { routed } from "@/studio/server/http";
import type { WebImage, WebImageSearchResult } from "./types";
import { foundUrl, searchPicturesByChoice } from "@/studio/server/providers/search";

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

export async function searchWebImages(query: string, page: number): Promise<WebImageSearchResult> {
	const q = query.trim().slice(0, 200);
	if (!q) return { items: [], hasMore: false, providers: [] };
	// Settings → Services → Image search: another service when one is chosen (Commons below stays the default).
	const by = await searchPicturesByChoice(q, page).catch((error: Error) => {
		throw new WebImageError(error.message);
	});
	if (by) return { items: by.items.map((i) => ({ ...i, provider: "commons" as const })), hasMore: by.hasMore, providers: ["commons"] };
	const jobs = [cached(`commons|${q}|${page}`, () => searchCommons(q, page))];
	const settled = await Promise.allSettled(jobs);
	const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
	const firstError = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
	if (!ok.length) throw firstError?.reason instanceof WebImageError ? firstError.reason : new WebImageError("Image search failed — try again.");
	// Interleave providers so both show up on the first screen.
	const items: WebImage[] = [];
	const lists = ok.map((r) => r.items);
	for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) items.push(l[i]);
	// Prefetch the next page in the background (Kadr does the same).
	void cached(`commons|${q}|${page + 1}`, () => searchCommons(q, page + 1)).catch(() => {});
	return {
		items,
		hasMore: ok.some((r) => r.hasMore),
		providers: ["commons"],
		...(firstError ? { error: firstError.reason instanceof Error ? firstError.reason.message : undefined } : {}),
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
	if (parsed.protocol !== "https:" || !(ALLOWED_HOSTS.has(parsed.hostname) || foundUrl(parsed.href) || foundUrl(url))) throw new WebImageError("Only Wikimedia Commons images can be added.");
	const res = await fetch(routed(parsed.href), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) }).catch(() => null);
	if (!res?.ok) throw new WebImageError("The image could not be downloaded — check the internet connection.");
	const type = res.headers.get("content-type") ?? "image/jpeg";
	if (!/^image\/(jpeg|png|webp|gif)/.test(type)) throw new WebImageError("That file is not a supported image.");
	const bytes = await res.arrayBuffer();
	if (bytes.byteLength < 1024 || bytes.byteLength > 60 * 1024 * 1024) throw new WebImageError("The image is empty or too large (over 60 MB).");
	return { bytes, type };
}
