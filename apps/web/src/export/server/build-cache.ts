// The kept stretches of exports on disk (render, 11.11; the page's side: export/build/*). They live in the app's own
// work folder (<data>/export-cache), under the app build that made them: a new build draws and encodes anew, so what
// an older build kept goes at its first export. The folder is bounded — the stretches used longest ago make room — and
// never takes the disk's last free space. An entry is written whole (temp file, rename) with a SHA-256 of itself at
// its end; one that does not check out when read is removed and counts as not there. Nothing here can make an export
// wrong: a missing, damaged or refused entry only means that stretch is rendered again.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/studio/server/files";
import { ENTRY_MAGIC, type EntryHead } from "../build/entry";

/** Bumped with the entry format: older entries are dropped. */
const FORMAT = 1;
const HASH_BYTES = 32;
// (decimal, as the Settings window writes sizes: «20.00GB»)
const GB = 1e9;
/** The most the kept stretches may take. */
const DEFAULT_LIMIT = 20 * GB;
/** The disk keeps at least this much free whatever the limit says. */
const KEEP_FREE = 10 * GB;

const root = () => path.join(dataDir(), "export-cache");

let saltValue: string | null = null;
/** What this app build is, as a short name: part of every key and the folder its stretches live in. */
export function cacheSalt(): string {
	if (saltValue) return saltValue;
	let build = "dev";
	try {
		build = fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || "dev";
	} catch {}
	saltValue = createHash("sha256").update(`${FORMAT}:${build}`).digest("hex").slice(0, 16);
	return saltValue;
}

const KEY = /^[0-9a-f]{64}$/;
const folder = () => path.join(root(), cacheSalt());
const fileOf = (key: string) => path.join(folder(), key.slice(0, 2), `${key}.gzx`);

/** A test's own limit (bytes): STUDIO_EXPORT_CACHE_LIMIT; else 20 GB. */
function configuredLimit(): number {
	const own = Number(process.env.STUDIO_EXPORT_CACHE_LIMIT);
	return Number.isFinite(own) && own > 0 ? own : DEFAULT_LIMIT;
}

/** What the cache may hold now: its limit, less when the disk is short of free space. */
function limitNow(bytes: number): number {
	const limit = configuredLimit();
	if (process.env.STUDIO_EXPORT_CACHE_LIMIT) return limit;
	try {
		const st = fs.statfsSync(root());
		return Math.max(0, Math.min(limit, bytes + st.bavail * st.bsize - KEEP_FREE));
	} catch {
		return limit;
	}
}

interface Listed {
	file: string;
	bytes: number;
	used: number;
}
function listAll(): Listed[] {
	const out: Listed[] = [];
	let groups: string[] = [];
	try {
		groups = fs.readdirSync(folder());
	} catch {
		return out;
	}
	for (const group of groups) {
		let names: string[] = [];
		try {
			names = fs.readdirSync(path.join(folder(), group));
		} catch {
			continue;
		}
		for (const name of names) {
			const file = path.join(folder(), group, name);
			try {
				const st = fs.statSync(file);
				// a temp file a killed run left: gone after an hour
				if (!name.endsWith(".gzx")) {
					if (Date.now() - st.mtimeMs > 3600_000) fs.rmSync(file, { force: true });
					continue;
				}
				out.push({ file, bytes: st.size, used: st.mtimeMs });
			} catch {}
		}
	}
	return out;
}

let total: number | null = null;
let swept = false;
/** Once per run of the server: the stretches of other builds go, the total is counted. */
function ready(): number {
	if (!swept) {
		swept = true;
		try {
			fs.mkdirSync(folder(), { recursive: true });
			for (const name of fs.readdirSync(root())) if (name !== cacheSalt()) fs.rmSync(path.join(root(), name), { recursive: true, force: true });
		} catch {}
	}
	if (total === null) total = listAll().reduce((sum, entry) => sum + entry.bytes, 0);
	return total;
}

/** Makes room for `incoming` bytes: the entries used longest ago go until the cache fits its limit. */
function makeRoom(incoming: number): boolean {
	const bytes = ready();
	const limit = limitNow(bytes);
	if (incoming > limit) return false;
	if (bytes + incoming <= limit) return true;
	const entries = listAll().sort((a, b) => a.used - b.used);
	let now = entries.reduce((sum, entry) => sum + entry.bytes, 0);
	// (down to nine tenths: not one eviction per stretch from here on)
	const goal = Math.max(0, Math.min(limit - incoming, limit * 0.9));
	for (const entry of entries) {
		if (now <= goal) break;
		try {
			fs.rmSync(entry.file, { force: true });
			now -= entry.bytes;
		} catch {}
	}
	total = now;
	return now + incoming <= limit;
}

export function cacheInfo(): { salt: string; bytes: number; count: number; limit: number } {
	ready();
	const entries = listAll();
	total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
	return { salt: cacheSalt(), bytes: total, count: entries.length, limit: configuredLimit() };
}

/** The head of an entry's file (its first bytes), or null. */
function headOf(file: string): { head: EntryHead; bytes: number } | null {
	let fd: number | null = null;
	try {
		fd = fs.openSync(file, "r");
		const size = fs.fstatSync(fd).size;
		const start = Buffer.alloc(Math.min(size, 16 * 1024));
		fs.readSync(fd, start, 0, start.length, 0);
		if (start.length < ENTRY_MAGIC.length + 4 || start.toString("latin1", 0, ENTRY_MAGIC.length) !== ENTRY_MAGIC) return null;
		const length = start.readUInt32LE(ENTRY_MAGIC.length);
		const from = ENTRY_MAGIC.length + 4;
		let json: Buffer;
		if (from + length <= start.length) json = start.subarray(from, from + length);
		else {
			if (length > 1_000_000 || from + length > size) return null;
			json = Buffer.alloc(length);
			fs.readSync(fd, json, 0, length, from);
		}
		return { head: JSON.parse(json.toString("utf8")) as EntryHead, bytes: size - HASH_BYTES };
	} catch {
		return null;
	} finally {
		if (fd !== null) fs.closeSync(fd);
	}
}

/** Which of `keys` are kept, each with its head (what a planner needs before it reads the packets). */
export function cacheHave(keys: readonly string[]): Record<string, { head: EntryHead; bytes: number }> {
	ready();
	const out: Record<string, { head: EntryHead; bytes: number }> = {};
	for (const key of keys) {
		if (!KEY.test(key)) continue;
		const found = headOf(fileOf(key));
		if (found && found.head.key === key) out[key] = found;
	}
	return out;
}

/** An entry's bytes (without the check at its end), or null: not there, or not whole (it is then removed). */
export function cacheGet(key: string): Buffer | null {
	if (!KEY.test(key)) return null;
	ready();
	const file = fileOf(key);
	let data: Buffer;
	try {
		data = fs.readFileSync(file);
	} catch {
		return null;
	}
	const body = data.subarray(0, Math.max(0, data.length - HASH_BYTES));
	const check = data.subarray(body.length);
	if (data.length <= HASH_BYTES || !createHash("sha256").update(body).digest().equals(check)) {
		try {
			fs.rmSync(file, { force: true });
			total = null;
		} catch {}
		return null;
	}
	// used now: the last to make room
	try {
		const now = new Date();
		fs.utimesSync(file, now, now);
	} catch {}
	return body;
}

/** Keeps an entry. False when it could not be kept (no room, a full disk): the export goes on without it. */
export function cachePut(key: string, body: Uint8Array): boolean {
	if (!KEY.test(key) || body.byteLength < ENTRY_MAGIC.length + 8) return false;
	if (Buffer.from(body.buffer, body.byteOffset, ENTRY_MAGIC.length).toString("latin1") !== ENTRY_MAGIC) return false;
	const file = fileOf(key);
	const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
	try {
		const before = fs.existsSync(file) ? fs.statSync(file).size : 0;
		if (!makeRoom(body.byteLength + HASH_BYTES - before)) return false;
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const fd = fs.openSync(temp, "w");
		try {
			fs.writeSync(fd, body);
			fs.writeSync(fd, createHash("sha256").update(body).digest());
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(temp, file);
		total = (total ?? 0) + body.byteLength + HASH_BYTES - before;
		return true;
	} catch {
		try {
			fs.rmSync(temp, { force: true });
		} catch {}
		return false;
	}
}

/** Settings → «Clear»: every kept stretch goes. Returns the info after. */
export function cacheClear() {
	try {
		fs.rmSync(root(), { recursive: true, force: true });
	} catch {}
	total = null;
	swept = false;
	return cacheInfo();
}

/** Entries not used for `days` go (Settings → Draft → «Auto delete cache»). */
export function cachePrune(days: number) {
	const cutoff = Date.now() - days * 24 * 3600 * 1000;
	for (const entry of listAll()) {
		if (entry.used < cutoff) {
			try {
				fs.rmSync(entry.file, { force: true });
			} catch {}
		}
	}
	total = null;
	return cacheInfo();
}
