// The local sound library: our bundled CC0 pack plus, only if the user picked one, their own folder
// (read-only, used in place, never copied). A Kadr-style folder ships library.json indexes, so nothing is
// re-scanned there; any other folder is listed once.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryIndex, LibraryItem, LibraryKind, LibrarySource } from "@/library/types";
import { userKadrLibrary, userLibraryRoot } from "@/platform/library";
import { cachedFile, isCached, type RemoteRow } from "./remote";
import gainsJson from "@/library/gains.json";
import extraJson from "@/library/extra-audio.json";

/** The gain of each catalog file, by "<part>/<id>" (scripts/library-gain.ts). */
const GAINS = gainsJson as Record<string, number>;
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);

/** The old LipSync Studio sounds: a development server or tests only (STUDIO_LSS_PUBLIC). */
function lipsyncPublicDir() {
	return process.env.STUDIO_LSS_PUBLIC || null;
}

function bundledDir() {
	return path.join(process.cwd(), "public", "sfx");
}

interface Entry {
	item: LibraryItem;
	file: string;
	/** A catalog row whose file may not be on this Mac yet (downloaded on first use, see remote.ts). */
	remote?: { part: string; row: RemoteRow };
}

let cache: { entries: Map<string, Entry>; index: LibraryIndex; builtAt: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

const shortHash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

function readJson<T>(file: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return null;
	}
}

interface KadrRow extends RemoteRow {
	id: string | number;
	title: string;
	group: string;
	tag?: string;
	dur?: number;
	artist?: string;
	/** The preview wave: 48 heights 0–255, base64. */
	peaks?: string;
	license?: string;
}

function kadr(kind: LibraryKind, folder: string, prefix: string, out: Entry[]) {
	const lib = userKadrLibrary();
	if (!lib) return;
	const root = path.join(lib, folder);
	const rows = readJson<KadrRow[]>(path.join(root, "library.json"));
	if (!Array.isArray(rows)) return;
	for (const r of rows) {
		if (!r?.file || !r.title) continue;
		const file = path.resolve(root, r.file);
		if (!file.startsWith(root + path.sep)) continue;
		const tags = [r.tag, r.artist].filter((t): t is string => typeof t === "string" && !!t);
		const remote = r.url || r.hf ? { part: folder, row: r } : undefined;
		out.push({
			file,
			remote,
			item: {
				id: `${prefix}${r.id}`,
				kind,
				name: r.title,
				cat: r.group || "Other",
				tags,
				dur: Number(r.dur) || 0,
				src: "kadr",
				...(r.peaks ? { peaks: r.peaks } : {}),
				...(r.top ? { top: r.top } : {}),
				...(r.artist ? { artist: r.artist } : {}),
				...(r.license ? { license: r.license } : {}),
				...(GAINS[`${folder}/${r.id}`] ? { gain: GAINS[`${folder}/${r.id}`] } : {}),
			},
		});
	}
}

/** Duration from a WAV header (exact) — other formats get 0 and are probed by the browser. */
function wavDuration(file: string): number {
	try {
		const fd = fs.openSync(file, "r");
		const head = Buffer.alloc(4096);
		fs.readSync(fd, head, 0, 4096, 0);
		fs.closeSync(fd);
		if (head.toString("ascii", 0, 4) !== "RIFF") return 0;
		let byteRate = 0;
		for (let p = 12; p + 8 < head.length; ) {
			const id = head.toString("ascii", p, p + 4);
			const size = head.readUInt32LE(p + 4);
			if (id === "fmt ") byteRate = head.readUInt32LE(p + 16);
			if (id === "data") {
				const dataSize = Math.min(size, fs.statSync(file).size - p - 8);
				return byteRate ? dataSize / byteRate : 0;
			}
			p += 8 + size + (size % 2);
		}
	} catch {}
	return 0;
}

/** OGG duration: last page's granule position / sample rate from the identification header. */
function oggDuration(file: string): number {
	try {
		const size = fs.statSync(file).size;
		const fd = fs.openSync(file, "r");
		const head = Buffer.alloc(64);
		fs.readSync(fd, head, 0, 64, 0);
		const tailLen = Math.min(size, 65536);
		const tail = Buffer.alloc(tailLen);
		fs.readSync(fd, tail, 0, tailLen, size - tailLen);
		fs.closeSync(fd);
		const vorbis = head.indexOf("vorbis");
		const opus = head.indexOf("OpusHead");
		const rate = opus >= 0 ? 48000 : vorbis >= 0 ? head.readUInt32LE(vorbis + 11) : 0;
		const last = tail.lastIndexOf("OggS");
		if (!rate || last < 0) return 0;
		const granule = Number(tail.readBigUInt64LE(last + 6));
		return granule > 0 ? granule / rate : 0;
	} catch {
		return 0;
	}
}

function probeDuration(file: string): number {
	const ext = path.extname(file).toLowerCase();
	if (ext === ".wav") return wavDuration(file);
	if (ext === ".ogg") return oggDuration(file);
	return 0;
}

function walk(dir: string, depth = 0): string[] {
	if (depth > 3) return [];
	let names: fs.Dirent[];
	try {
		names = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const d of names) {
		if (d.name.startsWith(".")) continue;
		const p = path.join(dir, d.name);
		if (d.isDirectory()) out.push(...walk(p, depth + 1));
		else if (AUDIO_EXT.has(path.extname(d.name).toLowerCase())) out.push(p);
	}
	return out;
}

const prettyName = (file: string) =>
	path
		.basename(file, path.extname(file))
		.replace(/[_-]+/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/\s+0*(\d+)$/, " $1")
		.trim();

/** A user folder that isn't Kadr-style: every audio file, grouped by its sub-folder. */
function userFolder(out: Entry[]) {
	const root = userLibraryRoot();
	if (!root || userKadrLibrary()) return;
	for (const file of walk(root)) {
		const rel = path.relative(root, file);
		const parts = rel.split(path.sep);
		const dur = probeDuration(file);
		out.push({
			file,
			item: {
				id: `u-${shortHash(rel)}`,
				kind: dur > 45 || /music|song|track/i.test(rel) ? "music" : "sfx",
				name: prettyName(file),
				cat: parts.length > 1 ? parts[0].replace(/[_-]+/g, " ") : "My library",
				tags: parts.slice(0, -1),
				dur,
				src: "lipsync",
			},
		});
	}
}

function lipsync(out: Entry[]) {
	const root = lipsyncPublicDir();
	if (!root) return;
	for (const [sub, kind] of [
		["sfx", "sfx"],
		["music", "music"],
	] as const) {
		const base = path.join(root, sub);
		for (const file of walk(base)) {
			const rel = path.relative(base, file);
			const parts = rel.split(path.sep);
			let cat = "My library";
			const tags: string[] = [];
			if (parts[0] === "kenney" && parts.length > 2) {
				cat = `Kenney: ${parts[1].replace(/-/g, " ")}`;
				tags.push("kenney", parts[1]);
			} else if (parts[0] === "lib") {
				cat = "Memes";
				tags.push("meme");
			}
			out.push({
				file,
				item: {
					id: `l${kind === "music" ? "m" : "s"}-${shortHash(rel)}`,
					kind,
					name: prettyName(file),
					cat,
					tags,
					dur: probeDuration(file),
					src: "lipsync",
				},
			});
		}
	}
}

interface BundledRow {
	file: string;
	name: string;
	en: string;
	cat: string;
	tags: string[];
	dur: number;
}

function bundled(out: Entry[]) {
	const root = bundledDir();
	const rows = readJson<BundledRow[]>(path.join(root, "index.json"));
	if (!Array.isArray(rows)) return;
	for (const r of rows) {
		const file = path.resolve(root, r.file);
		if (!file.startsWith(root + path.sep)) continue;
		out.push({
			file,
			item: {
				id: `b-${path.basename(r.file, path.extname(r.file))}`,
				kind: "sfx",
				name: r.en || r.name,
				cat: "Basic",
				// The Russian name stays searchable.
				tags: [r.name, r.cat, ...(r.tags ?? [])],
				dur: r.dur,
				src: "bundled",
			},
		});
	}
}

/** One more library's rows (CC0 music and sounds, 21.11): id, kind, Gaziyav's own category, name, seconds, tags, a file
 * that ships in public/ (else it downloads on first use from its publisher, like the cloud's other files). */
type ExtraRow = { id: string; k: LibraryKind; c: string; n: string; d: number; t: string[]; f?: string };
const EXTRA_HOST = () => (process.env.STUDIO_EXTRA_AUDIO_URL || "https://assets.openfilm.dev/library").replace(/\/+$/, "");
const plain = (kind: string, name: string) => `${kind}|${name.toLowerCase().replace(/[^a-z0-9а-яё]+/g, "")}`;

/** The extra rows into the existing categories, after Gaziyav's own; one with the name of an item already there is left out. */
function extra(out: Entry[]) {
	const have = new Set(out.map((e) => plain(e.item.kind, e.item.name)));
	const pub = path.join(process.cwd(), "public");
	for (const r of extraJson as ExtraRow[]) {
		const key = plain(r.k, r.n);
		if (have.has(key)) continue;
		have.add(key);
		const id = `xa-${shortHash(r.id)}`;
		const part = r.k === "music" ? "Music" : "Sound Effects";
		const local = r.f ? path.resolve(pub, r.f) : null;
		const file = `extra/${path.basename(r.id)}`;
		const row: RemoteRow = { file, url: `${EXTRA_HOST()}/${r.id.split("/").map(encodeURIComponent).join("/")}` };
		out.push({
			file: local && local.startsWith(pub + path.sep) ? local : cachedFile(part, row),
			...(local ? {} : { remote: { part, row } }),
			item: { id, kind: r.k, name: r.n, cat: r.c, tags: r.t ?? [], dur: r.d || 0, src: "kadr", license: "CC0 1.0" },
		});
	}
}

function build() {
	const entries: Entry[] = [];
	bundled(entries);
	kadr("sfx", "Sound Effects", "ks-", entries);
	kadr("music", "Music", "km-", entries);
	extra(entries);
	lipsync(entries);
	userFolder(entries);
	const map = new Map<string, Entry>();
	for (const e of entries) if (!map.has(e.item.id)) map.set(e.item.id, e);
	const counts = new Map<string, { src: LibrarySource; kind: LibraryKind; count: number }>();
	for (const { item } of map.values()) {
		const key = `${item.src}:${item.kind}`;
		const c = counts.get(key) ?? { src: item.src, kind: item.kind, count: 0 };
		c.count++;
		counts.set(key, c);
	}
	cache = {
		entries: map,
		index: { items: [...map.values()].map((e) => e.item), sources: [...counts.values()] },
		builtAt: Date.now(),
	};
	return cache;
}

function current() {
	return cache && Date.now() - cache.builtAt < TTL_MS ? cache : build();
}

/** The index; a catalog item says whether its file is on this Mac yet (`remote`: it downloads on first use). */
export function getLibraryIndex(): LibraryIndex {
	const { index, entries } = current();
	return {
		...index,
		items: index.items.map((item) => {
			const e = entries.get(item.id);
			return e?.remote && !fs.existsSync(e.file) && !isCached(e.remote.part, e.remote.row) ? { ...item, remote: true } : item;
		}),
	};
}

/** The file behind an id — only ids from the index resolve, never client paths. Local first, then the download cache. */
export function resolveLibraryFile(id: string): string | null {
	const hit = current().entries.get(id) ?? build().entries.get(id);
	if (!hit) return null;
	if (fs.existsSync(hit.file)) return hit.file;
	return hit.remote && isCached(hit.remote.part, hit.remote.row) ? cachedFile(hit.remote.part, hit.remote.row) : null;
}

/** The download facts of a catalog item whose file isn't on this Mac (null: local or unknown). */
export function libraryRemote(id: string): { part: string; row: RemoteRow } | null {
	const hit = current().entries.get(id) ?? build().entries.get(id);
	return hit?.remote && !fs.existsSync(hit.file) ? hit.remote : null;
}

/** Every catalog item that downloads on demand (for the top-20 prefetch). */
export function remoteRows(): Array<{ part: string; row: RemoteRow }> {
	return [...current().entries.values()].flatMap((e) => (e.remote && !fs.existsSync(e.file) ? [e.remote] : []));
}
