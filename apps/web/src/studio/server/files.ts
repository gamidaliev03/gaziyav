// Working files of the pipeline: clips sent from the editor, downloaded fragments, voices, lipsync results.
// The editor keeps its own copy of everything it imports, so these are temporary: cleaned up after two days, and
// the oldest go once they pass 4 GB.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { supportDir } from "@/platform/paths";
import { StudioError } from "./errors";

const KEEP_MS = 2 * 24 * 3600 * 1000;
let cleaned = false;

export function dataDir(): string {
	const dir = process.env.STUDIO_DATA_DIR || path.join(supportDir(), "Studio");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function filesDir(): string {
	const dir = path.join(dataDir(), "files");
	fs.mkdirSync(dir, { recursive: true });
	if (!cleaned) {
		cleaned = true;
		cleanup(dir);
	}
	return dir;
}

/** Older than two days, or the oldest beyond 4 GB (never anything from the last hour: a job may be using it). */
const MAX_BYTES = 4e9;

function folderBytes(p: string): number {
	const st = fs.statSync(p);
	if (!st.isDirectory()) return st.size;
	return fs.readdirSync(p).reduce((sum, n) => sum + folderBytes(path.join(p, n)), 0);
}

function cleanup(dir: string) {
	const now = Date.now();
	const kept: { p: string; t: number; bytes: number }[] = [];
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name);
		try {
			const t = fs.statSync(p).mtimeMs;
			if (now - t > KEEP_MS) fs.rmSync(p, { recursive: true, force: true });
			else kept.push({ p, t, bytes: folderBytes(p) });
		} catch {}
	}
	let total = kept.reduce((s, k) => s + k.bytes, 0);
	for (const k of kept.sort((a, b) => a.t - b.t)) {
		if (total <= MAX_BYTES) break;
		if (now - k.t < 3600 * 1000) continue;
		fs.rmSync(k.p, { recursive: true, force: true });
		total -= k.bytes;
	}
}

export interface StoredFile {
	id: string;
	name: string;
	path: string;
}

function safeName(name: string): string {
	const base = path.basename(name || "file").replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(-120);
	return base || "file";
}

/** A new empty slot; the caller writes the file at `path`. */
export function newFile(name: string): StoredFile {
	const id = crypto.randomBytes(8).toString("hex");
	const dir = path.join(filesDir(), id);
	fs.mkdirSync(dir, { recursive: true });
	const n = safeName(name);
	return { id, name: n, path: path.join(dir, n) };
}

export function getFile(id: string): StoredFile {
	if (!/^[0-9a-f]{16}$/.test(id)) throw new StudioError("Invalid file id");
	const dir = path.join(filesDir(), id);
	const name = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => !n.startsWith(".")) : undefined;
	if (!name) throw new StudioError("The file is no longer available (temporary files are kept for 2 days). Run the step again.");
	return { id, name, path: path.join(dir, name) };
}

export function removeFile(id: string) {
	if (!/^[0-9a-f]{16}$/.test(id)) return;
	fs.rmSync(path.join(filesDir(), id), { recursive: true, force: true });
}

/** A scratch folder for one job, removed when the job ends. */
export function workDir(): { dir: string; dispose: () => void } {
	const dir = fs.mkdtempSync(path.join(dataDir(), "work-"));
	return { dir, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export function mimeFor(file: string): string {
	const ext = path.extname(file).toLowerCase();
	return (
		{
			".mp4": "video/mp4",
			".mov": "video/quicktime",
			".m4v": "video/mp4",
			".webm": "video/webm",
			".mkv": "video/x-matroska",
			".mp3": "audio/mpeg",
			".m4a": "audio/mp4",
			".wav": "audio/wav",
			".aac": "audio/aac",
			".ogg": "audio/ogg",
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
		}[ext] ?? "application/octet-stream"
	);
}

/** Gives a stored file a real extension when it has none (by its container), so AVFoundation-based helpers can open it. */
export function withExtension(file: StoredFile, info: { format?: string; hasVideo?: boolean; hasAudio?: boolean }): StoredFile {
	if (/\.[a-z0-9]{2,5}$/i.test(file.name)) return file;
	const f = info.format ?? "";
	const ext = /mov|mp4/.test(f)
		? info.hasVideo
			? ".mp4"
			: ".m4a"
		: /webm/.test(f)
			? ".webm"
			: /matroska/.test(f)
				? ".mkv"
				: /^mp3/.test(f)
					? ".mp3"
					: /wav/.test(f)
						? ".wav"
						: /png/.test(f)
							? ".png"
							: /jpeg|mjpeg/.test(f)
								? ".jpg"
								: info.hasVideo
									? ".mp4"
									: info.hasAudio
										? ".m4a"
										: "";
	if (!ext) return file;
	const next = path.join(path.dirname(file.path), file.name + ext);
	fs.renameSync(file.path, next);
	return { ...file, name: file.name + ext, path: next };
}
