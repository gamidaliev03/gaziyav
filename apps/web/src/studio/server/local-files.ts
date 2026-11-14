// The user's own media files on this Mac, for Gaziyav AI ("use my video from Downloads"): found by name in the usual
// folders (Movies, Downloads, Desktop, Pictures, Music, Documents) and read only when the agent imports one. Media
// files only, nothing outside those folders, read-only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StudioError } from "./errors";

const FOLDERS = ["Movies", "Videos", "Downloads", "Desktop", "Pictures", "Music", "Documents"];
const KINDS: Record<string, "video" | "image" | "audio"> = {
	mp4: "video", mov: "video", m4v: "video", webm: "video", mkv: "video",
	png: "image", jpg: "image", jpeg: "image", heic: "image", webp: "image", gif: "image", svg: "image",
	mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", flac: "audio", ogg: "audio",
};
const MAX_BYTES = 4e9;

function roots(): string[] {
	const home = os.homedir();
	const space = process.env.STUDIO_DOWNLOADS_DIR ? [process.env.STUDIO_DOWNLOADS_DIR] : [];
	return [...space, ...FOLDERS.map((f) => path.join(home, f))].filter((d) => fs.existsSync(d));
}

const kindOf = (file: string) => KINDS[path.extname(file).slice(1).toLowerCase()];

// The space's own exports (Media → Downloads → Exports): the Export folder next to its Downloads, and the files the app
// noteExport). Those are allowed by identity — the exact path the app wrote — not by folder.
const spaceRoot = () => (process.env.STUDIO_DOWNLOADS_DIR ? path.dirname(process.env.STUDIO_DOWNLOADS_DIR) : null);
function exportedByApp(real: string): boolean {
	const root = spaceRoot();
	if (!root) return false;
	const dir = path.join(root, "Export");
	try {
		if (fs.existsSync(dir) && real.startsWith(`${fs.realpathSync(dir)}${path.sep}`)) return true;
	} catch {}
	try {
		const list = JSON.parse(fs.readFileSync(path.join(root, "exports.json"), "utf8")) as unknown;
		if (!Array.isArray(list)) return false;
		return list.some((e) => {
			const p = (e as { path?: unknown })?.path;
			if (typeof p !== "string" || !path.isAbsolute(p)) return false;
			try {
				return fs.realpathSync(p) === real;
			} catch {
				return false;
			}
		});
	} catch {
		return false;
	}
}

/** Only a media file inside one of the folders (no links out, no hidden files), or one the app exported itself. */
export function allowedFile(file: string): string {
	const real = fs.realpathSync(path.resolve(file));
	if (!roots().some((r) => real.startsWith(`${fs.realpathSync(r)}${path.sep}`)) && !exportedByApp(real)) throw new StudioError("Gaziyav AI may only open media from Movies, Videos, Downloads, Desktop, Pictures, Music or Documents.");
	if (!kindOf(real) || path.basename(real).startsWith(".")) throw new StudioError("Only video, picture and audio files can be imported.");
	const st = fs.statSync(real);
	if (!st.isFile() || st.size > MAX_BYTES) throw new StudioError("That file can't be imported (not a file, or over 4 GB).");
	return real;
}

export interface LocalFile {
	path: string;
	name: string;
	folder: string;
	kind: "video" | "image" | "audio";
	mb: number;
	modified: string;
}

/** Media files whose name contains every word of the query (newest first; empty query = the newest ones). */
export function searchLocalFiles(query: string, kind?: string, limit = 20): LocalFile[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	const found: (LocalFile & { t: number })[] = [];
	const walk = (dir: string, depth: number) => {
		if (depth > 3 || found.length > 2000) return;
		let entries: fs.Dirent[] = [];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".") || e.name.endsWith(".app") || e.name.endsWith(".photoslibrary") || e.name.endsWith(".fcpbundle")) continue;
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p, depth + 1);
			else if (e.isFile()) {
				const k = kindOf(e.name);
				if (!k || (kind && k !== kind)) continue;
				const lower = e.name.toLowerCase();
				if (!words.every((w) => lower.includes(w))) continue;
				try {
					const st = fs.statSync(p);
					found.push({ path: p, name: e.name, folder: path.relative(os.homedir(), dir) || "~", kind: k, mb: Math.round(st.size / 1e5) / 10, modified: st.mtime.toISOString().slice(0, 16).replace("T", " "), t: st.mtimeMs });
				} catch {}
			}
		}
	};
	for (const r of roots()) walk(r, 0);
	return found
		.sort((a, b) => b.t - a.t)
		.slice(0, limit)
		.map(({ t: _t, ...f }) => f);
}
