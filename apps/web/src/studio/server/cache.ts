// Paid results are never paid twice: a lipsync result is kept under the hash of what was sent
// (source file + piece + speech + model) and reused for free. Entries older than 60 days are removed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, newFile, type StoredFile } from "./files";

const KEEP_MS = 60 * 24 * 3600 * 1000;
const hashes = new Map<string, string>();
let cleaned = false;

function cacheDir(): string {
	const dir = path.join(dataDir(), "cache");
	fs.mkdirSync(dir, { recursive: true });
	if (!cleaned) {
		cleaned = true;
		const now = Date.now();
		for (const name of fs.readdirSync(dir)) {
			try {
				const p = path.join(dir, name);
				if (now - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { force: true });
			} catch {}
		}
	}
	return dir;
}

/** sha256 of a file, remembered per path + size + mtime so repeated checks stay instant. */
export async function fileHash(file: string): Promise<string> {
	const st = fs.statSync(file);
	const memo = `${file}|${st.size}|${st.mtimeMs}`;
	const known = hashes.get(memo);
	if (known) return known;
	const hash = crypto.createHash("sha256");
	await new Promise<void>((resolve, reject) => {
		fs.createReadStream(file)
			.on("data", (d) => hash.update(d))
			.on("end", () => resolve())
			.on("error", reject);
	});
	const value = hash.digest("hex");
	hashes.set(memo, value);
	return value;
}

export async function lipsyncKey(source: string, start: number, length: number, audio: string, model: string): Promise<string> {
	const parts = [await fileHash(source), start.toFixed(3), length.toFixed(3), await fileHash(audio), model];
	return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

function entry(key: string) {
	return path.join(cacheDir(), `${key}.mp4`);
}

export function hasCached(key: string): boolean {
	return fs.existsSync(entry(key));
}

/** A fresh working copy of the cached result, or null. */
export function takeCached(key: string, name: string): StoredFile | null {
	const src = entry(key);
	if (!fs.existsSync(src)) return null;
	const slot = newFile(name);
	fs.copyFileSync(src, slot.path);
	fs.utimesSync(src, new Date(), new Date());
	return slot;
}

export function putCached(key: string, file: string) {
	try {
		fs.copyFileSync(file, entry(key));
	} catch {
		// A cache miss later only costs money again, never breaks the result.
	}
}

/** A cached result's own file (read only: copy it before changing it), or null. */
export function cachedPath(key: string): string | null {
	const p = entry(key);
	return fs.existsSync(p) ? p : null;
}

/** Small JSON beside the results (a piece's face marks, the samples made of a clip). */
export function putCachedJson(key: string, value: unknown) {
	try {
		fs.writeFileSync(path.join(cacheDir(), `${key}.json`), JSON.stringify(value));
	} catch {}
}

export function cachedJson<T>(key: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(path.join(cacheDir(), `${key}.json`), "utf8")) as T;
	} catch {
		return null;
	}
}
