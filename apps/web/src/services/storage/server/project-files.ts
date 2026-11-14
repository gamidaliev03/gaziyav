// Every project also lives as a file on the Mac's disk, outside the browser storage. Projects are kept in Chromium's
// IndexedDB, and Chromium throws a whole IndexedDB away when it takes it for damaged: after the disk ran full in the
// middle of editing, the next start had no projects at all — every project, its versions and its media list
// (pro-reliable, 09.11). Each save is copied here (fsync'ed, renamed into place: a cut write never replaces a good
// copy), and a project the browser storage no longer has comes back from it (services/storage/disk-copies.ts).
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/studio/server/files";

const MAX_BYTES = 300 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

function folder(): string {
	const dir = path.join(dataDir(), "projects");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function fileOf(id: string): string {
	if (!ID.test(id)) throw new Error("Invalid project id");
	return path.join(folder(), `${id}.json`);
}

export function writeProjectFile(id: string, raw: string): void {
	if (raw.length > MAX_BYTES) throw new Error("The project copy is too large");
	const file = fileOf(id);
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	let fd: number | null = null;
	try {
		fd = fs.openSync(tmp, "w");
		fs.writeSync(fd, raw);
		fs.fsyncSync(fd);
		fs.closeSync(fd);
		fd = null;
		// the copy before stays as <id>.json.prev (a save that wrote nonsense never takes the last good one with it)
		try {
			if (fs.existsSync(file)) fs.renameSync(file, `${file}.prev`);
		} catch {}
		fs.renameSync(tmp, file);
		syncDir(path.dirname(file));
		keepVersion(id, file, raw.length);
	} catch (error) {
		if (fd !== null) {
			try {
				fs.closeSync(fd);
			} catch {}
		}
		// a full disk leaves no half file behind; the copy before stays
		fs.rmSync(tmp, { force: true });
		throw error;
	}
}

/** The projects with a copy here, and when it was written. Leftovers of cut writes (older than an hour) go. */
export function listProjectFiles(): Array<{ id: string; savedAt: number }> {
	const dir = folder();
	const out: Array<{ id: string; savedAt: number }> = [];
	for (const name of fs.readdirSync(dir)) {
		const full = path.join(dir, name);
		try {
			if (name.endsWith(".tmp")) {
				if (Date.now() - fs.statSync(full).mtimeMs > 3600_000) fs.rmSync(full, { force: true });
				continue;
			}
			if (!name.endsWith(".json")) continue;
			const id = name.slice(0, -5);
			if (ID.test(id)) out.push({ id, savedAt: fs.statSync(full).mtimeMs });
		} catch {}
	}
	return out;
}

/** The project's copy; a damaged one is passed over for the previous copy, then the newest version that reads. */
export function readProjectFile(id: string): string | null {
	const file = fileOf(id);
	const candidates = [file, `${file}.prev`, ...versionsOf(id)];
	for (const c of candidates) {
		try {
			if (!fs.existsSync(c)) continue;
			const raw = fs.readFileSync(c, "utf8");
			JSON.parse(raw);
			return raw;
		} catch {}
	}
	return null;
}

export function removeProjectFile(id: string): void {
	const file = fileOf(id);
	fs.rmSync(file, { force: true });
	fs.rmSync(`${file}.prev`, { force: true });
	fs.rmSync(path.join(folder(), "versions", id), { recursive: true, force: true });
}

// ── versions outside the copy they protect (IDEAL reliable §4; FCP's backups, Resolve's project backups) ──
// While a project changes, its copy is kept every VERSION_GAP_MS in projects/versions/<id>/, the newest MAX_VERSIONS
// (fewer for a big project), apart from IndexedDB, whose own versions go with it when Chromium throws it away.
const VERSION_GAP_MS = 10 * 60_000;
const MAX_VERSIONS = 24;
const BIG_VERSION_BYTES = 5 * 1024 * 1024;

function versionDir(id: string): string {
	if (!ID.test(id)) throw new Error("Invalid project id");
	return path.join(folder(), "versions", id);
}
/** Newest first. */
function versionsOf(id: string): string[] {
	const dir = versionDir(id);
	try {
		return fs
			.readdirSync(dir)
			.filter((n) => n.endsWith(".json"))
			.sort()
			.reverse()
			.map((n) => path.join(dir, n));
	} catch {
		return [];
	}
}
/** One kept version's text (its name from listProjectVersions), or null. */
export function readProjectVersion(id: string, file: string): string | null {
	if (!ID.test(id) || !/^[0-9TZ-]+\.json$/.test(file)) return null;
	const full = path.join(versionDir(id), file);
	return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}
export function listProjectVersions(id: string): Array<{ file: string; savedAt: number; bytes: number }> {
	return versionsOf(id).map((f) => {
		const st = fs.statSync(f);
		return { file: path.basename(f), savedAt: st.mtimeMs, bytes: st.size };
	});
}
function keepVersion(id: string, file: string, bytes: number) {
	try {
		const list = versionsOf(id);
		const newest = list[0];
		if (newest && Date.now() - fs.statSync(newest).mtimeMs < VERSION_GAP_MS) return;
		const dir = versionDir(id);
		fs.mkdirSync(dir, { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		// a clone where the disk can (APFS: no space used until the copy and the project differ), else a copy
		fs.copyFileSync(file, path.join(dir, `${stamp}.json`), fs.constants.COPYFILE_FICLONE);
		const keep = bytes > BIG_VERSION_BYTES ? 6 : MAX_VERSIONS;
		for (const old of versionsOf(id).slice(keep)) fs.rmSync(old, { force: true });
	} catch {}
}
function syncDir(dir: string) {
	let fd: number | null = null;
	try {
		fd = fs.openSync(dir, "r");
		fs.fsyncSync(fd);
	} catch {
	} finally {
		if (fd !== null) {
			try {
				fs.closeSync(fd);
			} catch {}
		}
	}
}
