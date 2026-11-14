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

/** Entries made or touched this recently are never trimmed (something may be writing or reading them). */
const BUSY_MS = 15 * 60 * 1000;
/** An unsaved export waits for its «Save» much longer than a render is in use. */
const EXPORT_BUSY_MS = 24 * 3600 * 1000;

/** Bytes under a path and the newest change inside it. */
function measure(full: string): { bytes: number; newest: number } {
	let stat: fs.Stats;
	try {
		stat = fs.statSync(full);
	} catch {
		return { bytes: 0, newest: 0 };
	}
	if (!stat.isDirectory()) return { bytes: stat.size, newest: stat.mtimeMs };
	let bytes = 0;
	let newest = stat.mtimeMs;
	let names: string[] = [];
	try {
		names = fs.readdirSync(full);
	} catch {}
	for (const name of names) {
		const inner = measure(path.join(full, name));
		bytes += inner.bytes;
		newest = Math.max(newest, inner.newest);
	}
	return { bytes, newest };
}

/**
 * Keeps the cache under `limitBytes`: the entries used longest ago go first, until it fits (the owner, 14.11: «автоочистку
 * кэша при достижении стольких-то гигов… старое чистилось, а новое записывалось»). What was made or used in the last
 * minutes stays and is not counted.
 */
export function trimCaches({ limitBytes, now = Date.now() }: { limitBytes: number; now?: number }) {
	const dirs = cacheDirs();
	const entries: Array<{ full: string; bytes: number; newest: number; busy: number }> = [];
	for (const kind of Object.keys(dirs) as CacheKind[]) {
		for (const dir of dirs[kind]) {
			let names: string[];
			try {
				names = fs.readdirSync(dir);
			} catch {
				continue;
			}
			for (const name of names) {
				const full = path.join(dir, name);
				entries.push({ full, ...measure(full), busy: kind === "export" ? EXPORT_BUSY_MS : BUSY_MS });
			}
		}
	}
	// (what is in use is neither deleted nor counted: a long export being written must not push everything else out)
	const idle = entries.filter((entry) => now - entry.newest >= entry.busy).sort((a, b) => a.newest - b.newest);
	let total = idle.reduce((sum, entry) => sum + entry.bytes, 0);
	let removed = 0;
	for (const entry of idle) {
		if (total <= limitBytes) break;
		try {
			fs.rmSync(entry.full, { recursive: true, force: true });
		} catch {
			continue;
		}
		total -= entry.bytes;
		removed++;
	}
	return { ...storageReport(), removed };
}

export function clearCaches({ kinds, olderThanDays }: { kinds?: CacheKind[]; olderThanDays?: number }) {
	const dirs = cacheDirs();
	for (const kind of kinds ?? (Object.keys(dirs) as CacheKind[])) clearDirs(dirs[kind], olderThanDays);
	return storageReport();
}
