// One cloud for every kind of content Gaziyav doesn't carry inside (music, sounds, stickers, graphics): the app has
// the catalogs and small previews; a file comes down the first time it is used (or ahead of time, in the background),
// is checked (size + SHA-256) and kept in the cache (Application Support/Gaziyav/MediaLibrary). The cache has a size
// limit: the files used longest ago go first. Where a file comes from, in order:
//  - the folder the owner prepares for the upload (~/gaziyav-content, STUDIO_CONTENT_STAGING), so a new build can be
//    checked before its files are on Hugging Face;
//  - our Hugging Face dataset and its mirror hf-mirror.com — only files whose licence lets us share them (`hf`);
//  - the place it was published (`url`), e.g. Mixkit's own server for Mixkit items (their licence forbids re-hosting).
// A download the user asked for starts at once; background ones (a tab's top files, the rows in view) run at most two
// at a time and wait while the timeline plays, a video exports or an AI job runs.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { supportDir } from "@/platform/paths";

export interface CloudFile {
	/** The content's folder in the cache, in the dataset and in the upload folder: "Music", "Sound Effects", "stickers/…". */
	part: string;
	/** Path inside the part folder. */
	file: string;
	bytes?: number;
	sha256?: string;
	/** Where the file was published (always allowed: the user downloads it from its author). */
	url?: string;
	/** The licence lets us share the file: it is in our Hugging Face dataset (and in the upload folder before that). */
	hf?: boolean;
	/** 1–20: downloaded in the background when its tab first opens. */
	top?: number;
}

// Gaziyav's own public dataset on the owner's Hugging Face (never another project's).
const DATASET = () => process.env.STUDIO_MEDIA_DATASET || "adsfadfadsfadsf/gaziyav-media";
const HOSTS = () => (process.env.STUDIO_MEDIA_HOSTS ?? "https://huggingface.co,https://hf-mirror.com").split(",").filter(Boolean);
export const stagingRoot = () => process.env.STUDIO_CONTENT_STAGING ?? path.join(os.homedir(), "gaziyav-content");
export const cacheRoot = () => path.join(supportDir(), "MediaLibrary");
/** The cache's size limit: 2 GB (STUDIO_CONTENT_CACHE_MB for tests). */
export const cacheLimit = () => Math.max(1, Number(process.env.STUDIO_CONTENT_CACHE_MB || 2048)) * 1024 * 1024;
/** Background downloads at once (the user's own requests never wait). */
const BACKGROUND_MAX = 2;

export const keyOf = (f: CloudFile) => `${f.part}/${f.file}`;
export const cachedPath = (f: CloudFile) => path.join(cacheRoot(), f.part, f.file);
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Every place the file may come from, in order (a path is the upload folder's copy). */
export function sourcesOf(f: CloudFile): string[] {
	const out: string[] = [];
	if (f.hf) {
		const staged = path.join(stagingRoot(), f.part, f.file);
		if (fs.existsSync(staged)) out.push(staged);
		for (const host of HOSTS()) out.push(`${host}/datasets/${DATASET()}/resolve/main/${encodePath(keyOf(f))}`);
	}
	if (f.url) out.push(f.url);
	return out;
}

export function isCached(f: CloudFile): boolean {
	return fs.existsSync(cachedPath(f));
}

// One state for the whole server: Next bundles each API route on its own, and a module imported by two routes may be
// evaluated twice — the queue, the pause and the downloads in flight must be the same for every route.
const shared = globalThis as { __gaziyavCloud?: CloudState };
shared.__gaziyavCloud ??= {
	downloadStats: { count: 0 },
	inflight: new Map(),
	progress: new Map(),
	paused: new Set(),
	background: { n: 0 },
	waiting: [],
	prefetched: new Set(),
	offlineSince: { at: 0 },
};
const state: CloudState = shared.__gaziyavCloud;
interface CloudState {
	downloadStats: { count: number };
	inflight: Map<string, Promise<string>>;
	progress: Map<string, number>;
	paused: Set<string>;
	background: { n: number };
	waiting: Array<{ key: string; go: (held: boolean) => void }>;
	prefetched: Set<string>;
	offlineSince: { at: number };
}
/** Downloads made by this process (tests: a cached file is never fetched twice). */
export const downloadStats = state.downloadStats;
const { inflight, progress, paused, waiting } = state;

function wake() {
	while (waiting.length && !paused.size && state.background.n < BACKGROUND_MAX) {
		state.background.n++;
		waiting.shift()?.go(true);
	}
}
/** A background slot (resolves true), or the user asked for the same file meanwhile (resolves false: no slot held).
 * `first`: the pointer rests on it — first in the queue (still two at a time). */
function slot(key: string, first = false): Promise<boolean> {
	if (!paused.size && state.background.n < BACKGROUND_MAX) {
		state.background.n++;
		return Promise.resolve(true);
	}
	return new Promise((go) => (first ? waiting.unshift({ key, go }) : waiting.push({ key, go })));
}

/** The queue as it is (self-tests): background slots held, files waiting, downloads running. */
export const queueState = () => ({ background: state.background.n, waiting: waiting.length, running: inflight.size, paused: [...paused] });

/** No source could be reached lately (the cloud mark shows only then, like iCloud Photos offline). */
export const isOffline = () => state.offlineSince.at > 0 && Date.now() - state.offlineSince.at < 60_000;
function hurry(key: string) {
	const i = waiting.findIndex((w) => w.key === key);
	if (i >= 0) waiting.splice(i, 1)[0].go(false);
}

/** Background downloads wait while `reason` holds (the timeline plays, a video exports, an AI job runs). */
export function setPaused(reason: string, on: boolean) {
	if (on) paused.add(reason);
	else paused.delete(reason);
	wake();
}

/** How far each file of `keys` is (0…1) while it downloads; files not downloading are left out. */
export function progressOf(keys: string[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const k of keys) {
		const v = progress.get(k);
		if (v !== undefined) out[k] = v;
	}
	return out;
}
export const downloading = (key: string) => inflight.has(key);

/** The cached file, downloaded first if needed (one download per file however many ask). */
export function ensureCached(f: CloudFile, { background: bg = false, first = false }: { background?: boolean; first?: boolean } = {}): Promise<string> {
	const dest = cachedPath(f);
	if (fs.existsSync(dest)) {
		touch(dest);
		return Promise.resolve(dest);
	}
	const key = keyOf(f);
	const running = inflight.get(key);
	if (running) {
		if (!bg) hurry(key);
		else if (first) {
			// Already queued: to the front.
			const i = waiting.findIndex((w) => w.key === key);
			if (i > 0) waiting.unshift(...waiting.splice(i, 1));
		}
		return running;
	}
	if (!bg || !paused.size) progress.set(key, 0);
	const job = (async () => {
		const held = bg ? await slot(key, first) : false;
		progress.set(key, 0);
		try {
			return await download(dest, sourcesOf(f), f, key);
		} finally {
			if (held) {
				state.background.n--;
				wake();
			}
		}
	})().finally(() => {
		inflight.delete(key);
		progress.delete(key);
	});
	inflight.set(key, job);
	return job;
}

async function download(dest: string, sources: string[], f: CloudFile, key: string): Promise<string> {
	if (!sources.length) throw new Error("It has no download address");
	let last = "";
	for (const src of sources) {
		try {
			let buf: Buffer;
			// Self-tests of «offline»: no network source answers (the upload folder still does).
			if (process.env.STUDIO_TEST === "1" && process.env.STUDIO_CONTENT_OFFLINE === "1" && !path.isAbsolute(src)) throw new Error("offline (test)");
			if (path.isAbsolute(src)) buf = fs.readFileSync(src);
			else {
				const r = await fetch(src, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
				if (!r.ok || !r.body) {
					last = `HTTP ${r.status}`;
					continue;
				}
				const total = Number(r.headers.get("content-length")) || f.bytes || 0;
				const chunks: Uint8Array[] = [];
				let got = 0;
				const reader = r.body.getReader();
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					chunks.push(value);
					got += value.length;
					if (total) progress.set(key, Math.min(0.99, got / total));
				}
				buf = Buffer.concat(chunks);
			}
			downloadStats.count++;
			if (f.bytes && buf.length !== f.bytes) {
				last = "size mismatch";
				continue;
			}
			if (f.sha256 && crypto.createHash("sha256").update(buf).digest("hex") !== f.sha256) {
				last = "checksum mismatch";
				continue;
			}
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			const tmp = `${dest}.part-${process.pid}`;
			fs.writeFileSync(tmp, buf);
			fs.renameSync(tmp, dest);
			progress.set(key, 1);
			state.offlineSince.at = 0;
			trim(dest);
			return dest;
		} catch (error) {
			last = (error as Error).message;
			// Unreachable (not a wrong file): the network is down, as far as this file goes.
			if (!sources.some((s) => path.isAbsolute(s) && fs.existsSync(s))) state.offlineSince.at = Date.now();
		}
	}
	throw new Error(`Couldn't download it (${last}). Check the internet connection.`);
}

function touch(file: string) {
	const now = new Date();
	try {
		fs.utimesSync(file, now, now);
	} catch {}
}

function cacheFiles(): Array<{ file: string; size: number; used: number }> {
	const out: Array<{ file: string; size: number; used: number }> = [];
	const walk = (dir: string) => {
		let names: fs.Dirent[];
		try {
			names = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const d of names) {
			const p = path.join(dir, d.name);
			if (d.isDirectory()) walk(p);
			else if (d.isFile() && !d.name.includes(".part-")) {
				const s = fs.statSync(p);
				out.push({ file: p, size: s.size, used: s.mtimeMs });
			}
		}
	};
	walk(cacheRoot());
	return out;
}

/** Over the limit: the files used longest ago go until the cache is at 90% of it (never `keep` or a download). */
function trim(keep: string) {
	const limit = cacheLimit();
	const files = cacheFiles();
	let total = files.reduce((a, f) => a + f.size, 0);
	if (total <= limit) return;
	const busy = new Set([...inflight.keys()].map((k) => path.join(cacheRoot(), k)));
	for (const f of files.sort((a, b) => a.used - b.used)) {
		if (total <= limit * 0.9) break;
		if (f.file === keep || busy.has(f.file)) continue;
		fs.rmSync(f.file, { force: true });
		total -= f.size;
	}
}

/** Settings: how big the cache is. */
export function cacheInfo(): { bytes: number; files: number; limit: number } {
	const files = cacheFiles();
	return { bytes: files.reduce((a, f) => a + f.size, 0), files: files.length, limit: cacheLimit() };
}

/** Settings → Clear: every cached file goes (not the ones downloading now); what was freed. */
export function clearCache(): number {
	const busy = new Set([...inflight.keys()].map((k) => path.join(cacheRoot(), k)));
	let freed = 0;
	for (const f of cacheFiles()) {
		if (busy.has(f.file)) continue;
		fs.rmSync(f.file, { force: true });
		freed += f.size;
	}
	return freed;
}

const prefetched = state.prefetched;
/** A tab's most used files (top 1–20), in the background, once per run (cached ones are skipped). */
export function prefetchTop(files: CloudFile[], tag = "all"): Promise<number> {
	if (prefetched.has(tag)) return Promise.resolve(0);
	prefetched.add(tag);
	const wanted = files.filter((f) => f.top && f.top <= 20 && !isCached(f)).sort((a, b) => (a.top ?? 99) - (b.top ?? 99));
	return Promise.all(wanted.map((f) => ensureCached(f, { background: true }).then(() => 1, () => 0))).then((r) => r.reduce((a: number, b: number) => a + b, 0));
}
/** Tests: forget the once-per-run prefetch. */
export function resetPrefetch() {
	prefetched.clear();
}

/** The rows in view, in the background (at most two at a time, paused while something heavier runs). */
export function prefetchFiles(files: CloudFile[]) {
	for (const f of files) if (!isCached(f)) void ensureCached(f, { background: true }).catch(() => {});
}
