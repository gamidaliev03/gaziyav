// Settings → Projects / Performance: where Gaziyav keeps things on this Mac and the caches it can make again.
// Cache = renders of AI layers and AI effects, speech transcripts, unsaved export files. Paid results (lipsync
// cache) and the projects themselves are never touched here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "@/studio/server/files";

export type CacheKind = "render" | "transcripts" | "export";

function cacheDirs(): Record<CacheKind, string[]> {
	const data = dataDir();
	return {
		render: [path.join(data, "montage-cache"), path.join(data, "ai-effects")],
		transcripts: [path.join(data, "transcripts")],
		export: [path.join(os.tmpdir(), "Gaziyav-export-work")],
	};
}

/** Bytes under a folder (0 when it isn't there). */
function folderBytes(dir: string): number {
	let total = 0;
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		try {
			total += entry.isDirectory() ? folderBytes(full) : fs.statSync(full).size;
		} catch {}
	}
	return total;
}

/** Removes the entries of the cache folders (older than `olderThanDays` when given); the folders stay. */
function clearDirs(dirs: string[], olderThanDays?: number) {
	const cutoff = olderThanDays ? Date.now() - olderThanDays * 24 * 3600 * 1000 : Number.POSITIVE_INFINITY;
	for (const dir of dirs) {
		let names: string[];
		try {
			names = fs.readdirSync(dir);
		} catch {
			continue;
		}
		for (const name of names) {
			const full = path.join(dir, name);
			try {
				if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true });
			} catch {}
		}
	}
}

export function storageReport() {
	const dirs = cacheDirs();
	const sizes = Object.fromEntries(
		(Object.keys(dirs) as CacheKind[]).map((kind) => [kind, dirs[kind].reduce((sum, dir) => sum + folderBytes(dir), 0)]),
	) as Record<CacheKind, number>;
	const support = process.env.STUDIO_SUPPORT_DIR || path.dirname(dataDir());
	return { support, data: dataDir(), sizes, total: sizes.render + sizes.transcripts + sizes.export };
}

export function clearCaches({ kinds, olderThanDays }: { kinds?: CacheKind[]; olderThanDays?: number }) {
	const dirs = cacheDirs();
	for (const kind of kinds ?? (Object.keys(dirs) as CacheKind[])) clearDirs(dirs[kind], olderThanDays);
	return storageReport();
}
