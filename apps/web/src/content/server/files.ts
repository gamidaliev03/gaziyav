// The cloud's files that live outside the library catalogs (stickers…): each set keeps `public/<part>/cloud.json`
// ([{file, bytes, sha256}], made by tools/make-cloud-content.py) and the route /api/content/file/<part>/<file> serves
// the file from the cache, downloading it first. Only these sets, only their own files.
import fs from "node:fs";
import path from "node:path";
import type { CloudFile } from "./cloud";

export const CLOUD_PARTS = ["stickers/emoji3d", "stickers/noto-animated"] as const;

const catalogs = new Map<string, Map<string, { bytes: number; sha256: string }>>();
function catalog(part: string) {
	let c = catalogs.get(part);
	if (!c) {
		c = new Map();
		try {
			const rows = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", part, "cloud.json"), "utf8")) as Array<{ file: string; bytes: number; sha256: string }>;
			for (const r of rows) c.set(r.file, { bytes: r.bytes, sha256: r.sha256 });
		} catch {}
		catalogs.set(part, c);
	}
	return c;
}

/** The cloud file of `part`/`file`, or null (not a cloud set, or not one of its files). */
export function cloudFileOf(part: string, file: string): CloudFile | null {
	if (!(CLOUD_PARTS as readonly string[]).includes(part) || file.includes("/") || file.startsWith(".")) return null;
	const row = catalog(part).get(file);
	return row ? { part, file, ...row, hf: true } : null;
}

export const CONTENT_TYPES: Record<string, string> = { ".png": "image/png", ".json": "application/json", ".webp": "image/webp" };

/** A cloud file the app carries inside (the full build, EMBED_LIBRARY=1: public/<part>/…), so it never waits for the
 * network. The full build may keep it smaller (build.sh SLIM=1): a PNG as lossless WebP of the same name (same pixels),
 * a JSON gzipped (served as is, with Content-Encoding: gzip). Null: not inside (the light build) — the cloud cache. */
export function bundledFileOf(f: CloudFile, root = path.join(process.cwd(), "public")): { path: string; type: string; encoding?: "gzip" } | null {
	const base = path.join(root, f.part, f.file);
	const ext = path.extname(f.file).toLowerCase();
	const type = CONTENT_TYPES[ext] ?? "application/octet-stream";
	if (fs.existsSync(base)) return { path: base, type };
	if (ext === ".png" && fs.existsSync(`${base.slice(0, -4)}.webp`)) return { path: `${base.slice(0, -4)}.webp`, type: "image/webp" };
	if (fs.existsSync(`${base}.gz`)) return { path: `${base}.gz`, type, encoding: "gzip" };
	return null;
}
