// Where the Media, Music and Sounds searches look (principle 1, «sources and backups»): one choice per kind — All, one
// keyed service by name, the free web, or the user's own library — kept beside the settings (search-sources.json) and
// read by the panels and by the chat's / connector's search tools alike. «All» asks a keyed service FIRST the moment its
// key is pasted (Settings → Services), the free web behind it as the fallback. Pixabay and Pexels give pictures and
// clips only (their APIs have no music or sounds: pixabay.com/api/docs, 21.11), so music and sounds come from the
// library and the free web (Openverse: Jamendo, ccMixter, Freesound, Wikimedia), never «from Pixabay».
import fs from "node:fs";
import path from "node:path";
import { routed } from "../http";
import { StudioError } from "../errors";
import { studioHome } from "../settings";
import { chosen, keysReady, serviceKey } from "./services";
import { foundUrl, rememberFound } from "./search";

export type SearchKind = "picture" | "video" | "music" | "sound";
export type KeyedSource = "pixabay" | "pexels";
export type SourcePick = "all" | KeyedSource | "web" | "library";

export const SEARCH_KINDS: readonly SearchKind[] = ["picture", "video", "music", "sound"];
const PICKS: readonly SourcePick[] = ["all", "pixabay", "pexels", "web", "library"];
export const isSearchKind = (v: unknown): v is SearchKind => SEARCH_KINDS.includes(v as SearchKind);
export const isSourcePick = (v: unknown): v is SourcePick => PICKS.includes(v as SourcePick);

export const SOURCE_NAME: Record<string, string> = {
	pixabay: "Pixabay",
	pexels: "Pexels",
	commons: "Wikimedia Commons",
	openverse: "Openverse",
	nasa: "NASA",
	archive: "Internet Archive",
	jamendo: "Jamendo",
	ccmixter: "ccMixter",
	freesound: "Freesound",
	wikimedia_audio: "Wikimedia",
	library: "Gaziyav",
};

/** The keyed services that can give this kind (none for music and sounds). */
const KEYED_FOR: Record<SearchKind, readonly KeyedSource[]> = { picture: ["pixabay", "pexels"], video: ["pixabay", "pexels"], music: [], sound: [] };
/** The free sites asked for this kind, in order. */
export const FREE_FOR: Record<SearchKind, readonly string[]> = {
	picture: ["commons", "openverse", "nasa"],
	video: ["commons", "archive"],
	music: ["jamendo", "ccmixter", "wikimedia_audio"],
	sound: ["freesound", "wikimedia_audio"],
};

const hasKey = (id: KeyedSource) => !!serviceKey(id);

// ───────────────────────── the choice ─────────────────────────

const file = () => path.join(studioHome(), "search-sources.json");

export function readPicks(): Record<SearchKind, SourcePick> {
	const out = { picture: "all", video: "all", music: "all", sound: "all" } as Record<SearchKind, SourcePick>;
	try {
		const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as Record<string, unknown>;
		for (const k of SEARCH_KINDS) if (isSourcePick(raw[k]) && (raw[k] === "all" || raw[k] === "web" || raw[k] === "library" || KEYED_FOR[k].includes(raw[k] as KeyedSource))) out[k] = raw[k] as SourcePick;
	} catch {}
	return out;
}

export const readPick = (kind: SearchKind): SourcePick => readPicks()[kind];

export function setPick(kind: SearchKind, pick: SourcePick) {
	if (!isSearchKind(kind) || !isSourcePick(pick)) throw new StudioError("This source isn't offered for that.");
	if (pick !== "all" && pick !== "web" && pick !== "library" && !KEYED_FOR[kind].includes(pick)) throw new StudioError("This source isn't offered for that.");
	const next = { ...readPicks(), [kind]: pick };
	fs.mkdirSync(studioHome(), { recursive: true });
	const tmp = `${file()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
	fs.renameSync(tmp, file());
}

/** The keyed services with a key, in the order they are asked: the one picked in Settings → Services first. */
function keyedOrder(kind: SearchKind): KeyedSource[] {
	const list = KEYED_FOR[kind].filter(hasKey);
	if (kind !== "picture" && kind !== "video") return list;
	const row = chosen(kind === "picture" ? "image-search" : "video-search").provider;
	return [...list].sort((a, b) => (b === row ? 1 : 0) - (a === row ? 1 : 0));
}

export interface SearchPlan {
	/** Keyed services to ask, first, in order. */
	keyed: KeyedSource[];
	/** The free web after them. */
	free: boolean;
	/** The user's own library (music and sounds: the catalog; pictures and video: the project's Media). */
	library: boolean;
	/** One line when the pick couldn't be followed as it is (a picked service without its key). */
	note?: string;
}

/** What a search of `kind` asks, for the pick given (absent: the one kept). */
export async function planFor(kind: SearchKind, pick?: SourcePick): Promise<SearchPlan> {
	await keysReady();
	const p = pick && isSourcePick(pick) ? pick : readPick(kind);
	if (p === "library") return { keyed: [], free: false, library: true };
	if (p === "web") return { keyed: [], free: true, library: false };
	if (p === "pixabay" || p === "pexels") {
		if (KEYED_FOR[kind].includes(p) && hasKey(p)) return { keyed: [p], free: false, library: false };
		return { keyed: keyedOrder(kind), free: true, library: true, note: `${SOURCE_NAME[p]} has no key yet (Settings → Services): the free web was searched.` };
	}
	return { keyed: keyedOrder(kind), free: true, library: true };
}

/** For the panels: the switch's choices and the line naming what is really searched. */
export async function sourcesView(kind: SearchKind) {
	await keysReady();
	const pick = readPick(kind);
	const plan = await planFor(kind, pick);
	const keyed = KEYED_FOR[kind].filter(hasKey).map((id) => ({ id, name: SOURCE_NAME[id] }));
	const searched = [...plan.keyed, ...(plan.free ? FREE_FOR[kind] : [])].map((id) => SOURCE_NAME[id]);
	// Keys for services that have no audio: said once, so music and sounds don't look «from Pixabay».
	const noAudio = kind === "music" || kind === "sound" ? (["pixabay", "pexels"] as const).filter(hasKey).map((id) => SOURCE_NAME[id]) : [];
	return { kind, pick, keyed, searched, library: plan.library, noAudio };
}

// ───────────────────────── music and sounds on the free web ─────────────────────────

export interface WebAudio {
	id: string;
	/** The site it comes from: jamendo, ccmixter, freesound, wikimedia_audio. */
	source: string;
	title: string;
	author: string;
	license: string;
	sourceUrl: string;
	url: string;
	seconds: number;
}

const UA = "Gaziyav/1.0 (video editor; media search)";
const PAGE = 20;

const licenceLine = (l: string, v?: string) => (l === "cc0" || l === "pdm" ? `public domain (${l})` : `CC ${l.toUpperCase()} ${v ?? ""}`.trim());

async function openverseAudio(q: string, kind: "music" | "sound", page: number): Promise<WebAudio[]> {
	const params = new URLSearchParams({ q, license_type: "commercial,modification", page_size: String(PAGE), page: String(page), ...(kind === "music" ? { category: "music" } : { source: "freesound,wikimedia_audio" }) });
	let res: Response;
	try {
		res = await fetch(routed(`https://api.openverse.org/v1/audio/?${params}`), { headers: { "User-Agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
	} catch {
		throw new StudioError("The free music search can't be reached: check the internet connection.");
	}
	if (res.status === 429) throw new StudioError("The free music search is busy: wait a minute.");
	if (!res.ok) throw new StudioError("The free music search didn't answer.");
	const j = (await res.json()) as { results?: Array<{ id: string; title?: string; url?: string; creator?: string; license?: string; license_version?: string; foreign_landing_url?: string; source?: string; duration?: number | null; filetype?: string }> };
	return (j.results ?? []).flatMap((r) => {
		if (!r.url || !/^https:\/\//.test(r.url) || !r.license || /nc|nd/.test(r.license)) return [];
		const seconds = Math.round((r.duration ?? 0) / 100) / 10;
		// a «sound» over 2 min is a recording, not an effect
		if (kind === "sound" && seconds > 120) return [];
		return [{ id: `openverse:${r.id}`, source: r.source ?? "openverse", title: (r.title || q).slice(0, 80), author: r.creator || SOURCE_NAME[r.source ?? ""] || "Openverse", license: licenceLine(r.license, r.license_version), sourceUrl: r.foreign_landing_url ?? "https://openverse.org", url: rememberFound(r.url), seconds }];
	});
}

const cache = new Map<string, { at: number; run: Promise<WebAudio[]> }>();
/** A search kept for a day (the sites ask for it; the panel asks again while typing). */
function cached(key: string, run: () => Promise<WebAudio[]>) {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.run;
	const p = run();
	cache.set(key, { at: Date.now(), run: p });
	p.catch(() => cache.delete(key));
	if (cache.size > 300) cache.delete(cache.keys().next().value as string);
	return p;
}

/** Music or sounds from the free web, by the pick (library alone: none from here). */
export async function searchWebAudio(query: string, kind: "music" | "sound", page = 1, pick?: SourcePick): Promise<{ items: WebAudio[]; searched: string[]; note?: string }> {
	const q = query.trim().slice(0, 100);
	const plan = await planFor(kind, pick);
	if (!q || !plan.free) return { items: [], searched: [], ...(plan.note ? { note: plan.note } : {}) };
	const items = await cached(`${kind}|${q}|${page}`, () => openverseAudio(q, kind, page));
	return { items, searched: FREE_FOR[kind].map((s) => SOURCE_NAME[s]), ...(plan.note ? { note: plan.note } : {}) };
}

/** One found music or sound file (only from an address a search here answered), 1 kB … 60 MB. */
export async function downloadWebAudio(url: string): Promise<{ bytes: ArrayBuffer; type: string }> {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		throw new StudioError("Not a sound link.");
	}
	if (u.protocol !== "https:" || !foundUrl(url)) throw new StudioError("Only sounds a search found can be added.");
	const res = await fetch(routed(url), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) }).catch(() => null);
	if (!res?.ok) throw new StudioError("The sound didn't download: check the internet connection.");
	const type = (res.headers.get("content-type") ?? "audio/mpeg").split(";")[0];
	if (!/^audio\/|^application\/ogg/.test(type)) throw new StudioError("That file is not a sound.");
	const bytes = await res.arrayBuffer();
	if (bytes.byteLength < 1024 || bytes.byteLength > 60 * 1024 * 1024) throw new StudioError("The sound is empty or too large (over 60 MB).");
	return { bytes, type: type === "audio/mp3" ? "audio/mpeg" : type };
}
