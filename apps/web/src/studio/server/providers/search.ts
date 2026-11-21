// Picture, clip and web search by the service chosen in Settings → Services. Gaziyav's own way (Wikimedia Commons;
// Pexels + Pixabay + Commons for clips; Wikipedia) stays the default and is not here: each caller keeps it and asks this
// module first. The calls are the ported providers' own (openfilm/pexels.mjs, pixabay.mjs; Gaziyav 2's free media for
// Openverse, NASA and the Internet Archive), listing results instead of downloading them all; files come down one at a
// time when picked, only from addresses a search here answered.
import { routed } from "../http";
import { StudioError } from "../errors";
import { chosen, plainLine, runService, serviceKey } from "./services";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const UA = "Gaziyav/1.0 (video editor; media search)";
const TIMEOUT = 12_000;

/** The addresses searches here answered (a picked file may come only from one of them). */
const g = globalThis as { __gaziyavFound?: Set<string> };
const found = () => (g.__gaziyavFound ??= new Set());
const remember = (url: string) => {
	const s = found();
	if (s.size > 5000) s.clear();
	s.add(url);
	return url;
};
export const foundUrl = (url: string) => found().has(url);

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(routed(url), { headers: { "User-Agent": UA, accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
	} catch (error) {
		throw new StudioError(plainLine(error));
	}
	if (!res.ok) throw new StudioError(plainLine(new Error(`answered (${res.status})`)));
	return (await res.json()) as T;
}

// ───────────────────────── pictures ─────────────────────────

export interface FoundPicture {
	id: string;
	title: string;
	author: string;
	license: string;
	sourceUrl: string;
	thumbUrl: string;
	fullUrl: string;
	width: number;
	height: number;
}

const PAGE = 12;

/** Licences that allow reworking (Gaziyav 2's free media rule: never NC or ND). */
const REWORK = (l: string) => {
	const s = l.toLowerCase();
	if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv/.test(s)) return false;
	return /public domain|\bpd\b|pdm|cc0|cc[- ]?by|attribution|nasa|creativecommons\.org\/(licenses\/by(-sa)?\/|publicdomain)/.test(s);
};

async function pexelsPictures(q: string, page: number, key: string): Promise<FoundPicture[]> {
	const j = await getJson<{ photos?: Array<{ id: number; url?: string; alt?: string; photographer?: string; width?: number; height?: number; src?: Record<string, string> }> }>(
		`https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: String(PAGE), page: String(page) })}`,
		{ authorization: key },
	);
	return (j.photos ?? []).flatMap((p) => {
		const full = p.src?.large2x || p.src?.original;
		const thumb = p.src?.medium || p.src?.small || full;
		return full && thumb ? [{ id: `pexels:${p.id}`, title: p.alt || q, author: p.photographer ?? "Pexels", license: "Pexels license (free)", sourceUrl: p.url ?? "https://www.pexels.com", thumbUrl: remember(thumb), fullUrl: remember(full), width: p.width ?? 0, height: p.height ?? 0 }] : [];
	});
}

async function pixabayPictures(q: string, page: number, key: string, type: string): Promise<FoundPicture[]> {
	const j = await getJson<{ hits?: Array<{ id: number; pageURL?: string; tags?: string; user?: string; webformatURL?: string; previewURL?: string; largeImageURL?: string; imageWidth?: number; imageHeight?: number }> }>(
		`https://pixabay.com/api/?${new URLSearchParams({ key, q: q.slice(0, 100), image_type: type, safesearch: "true", per_page: String(PAGE), page: String(page) })}`,
	);
	return (j.hits ?? []).flatMap((h) => {
		const full = h.largeImageURL || h.webformatURL;
		const thumb = h.webformatURL || h.previewURL || full;
		return full && thumb ? [{ id: `pixabay:${h.id}`, title: (h.tags ?? q).split(",")[0].trim(), author: h.user ?? "Pixabay", license: "Pixabay license (free)", sourceUrl: h.pageURL ?? "https://pixabay.com", thumbUrl: remember(thumb), fullUrl: remember(full), width: h.imageWidth ?? 0, height: h.imageHeight ?? 0 }] : [];
	});
}

/** Openverse and NASA's library, no key (Commons is the default row's own). */
async function freePictures(q: string, page: number): Promise<FoundPicture[]> {
	const openverse = getJson<{ results?: Array<{ id: string; title?: string; url?: string; thumbnail?: string; foreign_landing_url?: string; creator?: string; license?: string; license_version?: string; width?: number; height?: number }> }>(
		`https://api.openverse.org/v1/images/?${new URLSearchParams({ q, license_type: "commercial,modification", page_size: String(PAGE), page: String(page) })}`,
	).then((j) =>
		(j.results ?? []).flatMap((r) => {
			const licence = r.license === "pdm" || r.license === "cc0" ? `public domain (${r.license})` : `CC ${String(r.license ?? "").toUpperCase()} ${r.license_version ?? ""}`.trim();
			if (!r.url || !REWORK(licence)) return [];
			return [{ id: `openverse:${r.id}`, title: r.title || q, author: r.creator || "Openverse", license: licence, sourceUrl: r.foreign_landing_url ?? "https://openverse.org", thumbUrl: remember(r.thumbnail || r.url), fullUrl: remember(r.url), width: r.width ?? 0, height: r.height ?? 0 }];
		}),
	);
	const nasa = getJson<{ collection?: { items?: Array<{ data?: Array<{ nasa_id?: string; title?: string; photographer?: string; center?: string }>; links?: Array<{ href?: string }> }> } }>(
		`https://images-api.nasa.gov/search?${new URLSearchParams({ q, media_type: "image", page_size: String(PAGE), page: String(page) })}`,
	).then((j) =>
		(j.collection?.items ?? []).slice(0, PAGE).flatMap((it) => {
			const d = it.data?.[0] ?? {};
			const thumb = String(it.links?.[0]?.href ?? "");
			if (!thumb) return [];
			return [{ id: `nasa:${d.nasa_id}`, title: d.title || q, author: d.photographer || d.center || "NASA", license: "NASA media (public domain in the US)", sourceUrl: `https://images.nasa.gov/details/${d.nasa_id}`, thumbUrl: remember(thumb), fullUrl: remember(thumb.replace(/~thumb\.(jpg|png)$/i, "~large.$1")), width: 0, height: 0 }];
		}),
	);
	const all = await Promise.allSettled([openverse, nasa]);
	const lists = all.map((r) => (r.status === "fulfilled" ? r.value : []));
	if (all.every((r) => r.status === "rejected")) throw (all[0] as PromiseRejectedResult).reason;
	const out: FoundPicture[] = [];
	for (let i = 0; lists.some((l) => l[i]); i++) for (const l of lists) if (l[i]) out.push(l[i]);
	return out;
}

/** Pictures by the chosen service; null: the row is on Gaziyav's own (Commons), the caller searches as before. */
export async function searchPicturesByChoice(q: string, page: number): Promise<{ items: FoundPicture[]; hasMore: boolean } | null> {
	const o = chosen("image-search");
	if (o.id === "gaziyav") return null;
	const items =
		o.id === "free-media"
			? await freePictures(q, page)
			: o.provider === "pexels"
				? await pexelsPictures(q, page, serviceKey("pexels"))
				: o.provider === "pixabay"
					? await pixabayPictures(q, page, serviceKey("pixabay"), o.model ?? "photo")
					: null;
	if (!items) return null;
	return { items, hasMore: items.length >= PAGE - 2 };
}

// ───────────────────────── clips ─────────────────────────

export interface FoundClip {
	item: string;
	title: string;
	source: string;
	seconds?: number;
	width?: number;
	height?: number;
	mb?: number;
	license?: string;
}

/** Internet Archive clips that may be reworked, each with an MP4 under 40 MB (Gaziyav 2's free media). */
async function archiveClips(q: string): Promise<FoundClip[]> {
	const base = "https://archive.org";
	const j = await getJson<{ response?: { docs?: Array<{ identifier: string; title?: string; creator?: string | string[]; licenseurl?: string }> } }>(
		`${base}/advancedsearch.php?${new URLSearchParams({ q: `(${q}) AND mediatype:movies AND licenseurl:[* TO *]`, "fl[]": "identifier", rows: "30", output: "json" })}&fl[]=title&fl[]=creator&fl[]=licenseurl`,
	);
	const docs = (j.response?.docs ?? []).filter((d) => REWORK(String(d.licenseurl ?? ""))).slice(0, 12);
	const metas = await Promise.all(docs.map((d) => getJson<{ files?: Array<{ name: string; size?: string; length?: string; width?: string; height?: string }> }>(`${base}/metadata/${encodeURIComponent(d.identifier)}`).catch(() => null)));
	const out: FoundClip[] = [];
	for (const [k, d] of docs.entries()) {
		const file = (metas[k]?.files ?? []).filter((f) => /\.mp4$/i.test(f.name) && Number(f.size ?? 0) > 0 && Number(f.size) < 40e6).sort((a, b) => Number(a.size) - Number(b.size))[0];
		if (!file) continue;
		out.push({ item: `stock:archive:${d.identifier}/${file.name}`, title: d.title || d.identifier, source: "archive", seconds: Number(file.length) || undefined, width: Number(file.width) || undefined, height: Number(file.height) || undefined, mb: Math.round(Number(file.size) / 1e5) / 10, license: String(d.licenseurl ?? "") });
		if (out.length >= 8) break;
	}
	return out;
}

/** Clips by the chosen service; null: Gaziyav's own way (Pexels + Pixabay + Commons, as before). */
export async function searchClipsByChoice(q: string, vertical: boolean, own: { pexels: (q: string, key: string, vertical: boolean) => Promise<FoundClip[]>; pixabay: (q: string, key: string, type?: string) => Promise<FoundClip[]> }): Promise<FoundClip[] | null> {
	const o = chosen("video-search");
	if (o.id === "gaziyav") return null;
	if (o.id === "archive") return archiveClips(q);
	if (o.provider === "pexels") return own.pexels(q, serviceKey("pexels"), vertical);
	if (o.provider === "pixabay") return own.pixabay(q, serviceKey("pixabay"), o.model ?? "film");
	return null;
}

/** An Internet Archive clip's file (its address made here from the item, only on archive.org). */
export function archiveFileUrl(item: string): string | null {
	const m = /^archive:([\w.-]{1,120})\/([^\\]{1,240}\.mp4)$/i.exec(item);
	return m ? `https://archive.org/download/${encodeURIComponent(m[1])}/${m[2].split("/").map(encodeURIComponent).join("/")}` : null;
}

// ───────────────────────── the web ─────────────────────────

/** Web facts by the chosen service (Brave, Tavily, Keenable); null: Wikipedia, as before. */
export async function webSearchByChoice(q: string, signal?: AbortSignal): Promise<Array<{ title: string; summary: string; url: string }> | null> {
	const o = chosen("web-search");
	if (o.id === "gaziyav" || !o.provider) return null;
	const into = fs.mkdtempSync(path.join(os.tmpdir(), "gz-web-"));
	try {
		const r = await runService(o.provider, "web-search", { query: [q] }, { model: o.model, into, signal });
		const hits = (r.receipt.hits ?? (r.receipt.searches as Array<{ hits?: unknown[] }> | undefined)?.[0]?.hits ?? []) as Array<{ title?: string; url?: string; excerpt?: string }>;
		return hits.slice(0, 6).map((h) => ({ title: String(h.title ?? ""), summary: String(h.excerpt ?? ""), url: String(h.url ?? "") }));
	} finally {
		fs.rmSync(into, { recursive: true, force: true });
	}
}
