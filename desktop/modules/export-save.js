// Nothing half-written, ever (render, 11.11): where an export's bytes live until the file is whole, and what the app
// remembers about an export that was cut short.
//
//  · A file is never written under its final name. With an «Export to» folder the export grows beside its place as
//    «.<name>.<pid>-<rand>.gaziyav-part» (hidden in Finder, on the same volume: no second copy, no double space) and
//    reaches its name by one rename when it is whole and on the disk (fsync). Through the Save dialog it grows in the
//    temp folder and is placed the same way once the user has chosen where.
//  · The journal (<userData>/export-journal.json) holds every export from the press of Export to its end. A kill, a
//    crash or a power cut leaves its entry: the next start removes the part files of apps that no longer run and hands
//    the entries to the page, which says the export was interrupted and offers it again.
//  · Room on the disk is counted per volume: what the export needs where it grows and where it lands.
//
// Pure Node, no Electron: tested by test/shell-fixes.test.mjs (node --test).
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PART_EXT = ".gaziyav-part";
const PART_NAME = /^\..*\.(\d+)-[0-9a-f]{6}\.gaziyav-part$/;

/** «.<name>.<pid>-<rand>.gaziyav-part» beside `target`: hidden, on the target's volume, naming the app that owns it. */
function partPath(target, pid = process.pid) {
	const base = path.basename(target).slice(0, 160);
	return path.join(path.dirname(target), `.${base}.${pid}-${crypto.randomBytes(3).toString("hex")}${PART_EXT}`);
}

/** The pid in a part file's name, or 0 when the name is not one of ours. */
function partOwner(name) {
	return Number(PART_NAME.exec(path.basename(name))?.[1] ?? 0);
}

function alive(pid) {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

/** fsync of a file (macOS: F_FULLFSYNC through libuv), never a reason to fail the export on a volume that can't. */
async function syncFile(file, io = fs.promises) {
	let handle;
	try {
		handle = await io.open(file, "r+");
		await handle.sync();
	} catch (error) {
		if (error?.code === "ENOSPC" || error?.code === "EIO") throw error;
	} finally {
		await handle?.close().catch(() => {});
	}
}

/** The folder's own entry on the disk (the rename is durable once this returns). */
async function syncDir(dir, io = fs.promises) {
	let handle;
	try {
		handle = await io.open(dir, "r");
		await handle.sync();
	} catch {
	} finally {
		await handle?.close().catch(() => {});
	}
}

/**
 * Puts a finished file at `target` in one step — nobody (Finder, an upload, a crash) ever sees half of it under that
 * name. The same volume: a rename. Another volume: a copy beside the target under a part name, on the disk, then the
 * rename; a disk that fills up or a cable pulled halfway leaves no file under the export's name and the source whole.
 * `io`: fs.promises, or a stand-in in the tests.
 */
async function placeFile(from, target, io = fs.promises) {
	try {
		await io.rename(from, target);
		await syncDir(path.dirname(target), io);
		return;
	} catch (error) {
		if (error?.code !== "EXDEV") throw error;
	}
	const part = partPath(target);
	try {
		await io.copyFile(from, part);
		await syncFile(part, io);
		await io.rename(part, target);
		await syncDir(path.dirname(target), io);
	} catch (error) {
		await io.rm(part, { force: true }).catch(() => {});
		throw error;
	}
	await io.rm(from, { force: true }).catch(() => {});
}

/** «Video.mp4», then «Video (1).mp4» …: an export never lands over a file that is there. */
function freeTarget(folder, name) {
	const { name: base, ext } = path.parse(name);
	let target = path.join(folder, name);
	for (let n = 1; fs.existsSync(target); n++) target = path.join(folder, `${base} (${n})${ext}`);
	return target;
}

/** What macOS and Windows take as a file name: no folders, no ":" "/" "\". */
function cleanName(filename, fallback = "Export.mp4") {
	return path.basename(String(filename || fallback)).replace(/[/:\\]/g, ".") || fallback;
}

/** Free bytes for the user on the volume of `dir` (the nearest folder that exists), or null when it can't be asked. */
async function freeBytes(dir) {
	let at = dir;
	for (let i = 0; i < 64 && at && !fs.existsSync(at); i++) at = path.dirname(at);
	try {
		const st = await fs.promises.statfs(at);
		return st.bavail * st.bsize;
	} catch {
		return null;
	}
}

function volumeOf(dir) {
	let at = dir;
	for (let i = 0; i < 64 && at && !fs.existsSync(at); i++) at = path.dirname(at);
	try {
		return fs.statSync(at).dev;
	} catch {
		return null;
	}
}

/** What an export of `bytes` needs on a volume: a fifth more and 200 MB (the estimate is rough, the system needs air). */
const withAir = (bytes) => Math.round(bytes * 1.2 + 200 * 1024 * 1024);

/**
 * Is there room for an export? Counted per volume: where it grows (`grows`: beside its place, or the temp folder), the
 * master of a second pass and that pass's own file in the temp folder, and where it lands. Answers the volume that is
 * shortest: { ok, needBytes, freeBytes, shortBytes, folder }. A check that cannot be made never blocks an export.
 * `fakeFree`: a test's stand-in for the free bytes of every volume.
 */
async function roomFor({ bytes, masterBytes = 0, lands, grows, temp, fakeFree = null }) {
	if (!Number.isFinite(bytes) || bytes <= 0) return { ok: true };
	const needs = new Map();
	const add = (dir, amount) => {
		if (!dir || !(amount > 0)) return;
		const volume = volumeOf(dir);
		if (volume === null) return;
		const entry = needs.get(volume) ?? { dir, bytes: 0 };
		entry.bytes += amount;
		needs.set(volume, entry);
	};
	if (masterBytes > 0) {
		// the page's master and the encoder's file both grow in the temp folder; the file then moves to its place
		add(temp, masterBytes + bytes);
		if (volumeOf(lands) !== volumeOf(temp)) add(lands, bytes);
	} else {
		add(grows, bytes);
		if (volumeOf(lands) !== volumeOf(grows)) add(lands, bytes);
	}
	let worst = null;
	for (const { dir, bytes: amount } of needs.values()) {
		const needBytes = withAir(amount);
		const free = fakeFree ?? (await freeBytes(dir));
		if (free === null) continue;
		const shortBytes = Math.max(0, needBytes - free);
		if (!worst || shortBytes > worst.shortBytes) worst = { ok: shortBytes === 0, needBytes, freeBytes: free, shortBytes, folder: dir };
	}
	return worst ?? { ok: true };
}

/**
 * The journal of exports in flight. One small JSON file, replaced whole (temp file, fsync, rename): after any kill it
 * is the list as it was before or after the last change, never half of it.
 */
function openJournal(file, { pid = process.pid, now = () => Date.now() } = {}) {
	const read = () => {
		try {
			const data = JSON.parse(fs.readFileSync(file, "utf8"));
			return { entries: Array.isArray(data?.entries) ? data.entries : [], folders: Array.isArray(data?.folders) ? data.folders : [] };
		} catch {
			return { entries: [], folders: [] };
		}
	};
	const write = (data) => {
		const tmp = `${file}.${pid}.tmp`;
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			const fd = fs.openSync(tmp, "w");
			try {
				fs.writeSync(fd, JSON.stringify({ version: 1, ...data }));
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
			fs.renameSync(tmp, file);
		} catch {
			// a full disk: the journal is a courtesy, the export itself goes on
			try {
				fs.rmSync(tmp, { force: true });
			} catch {}
		}
	};
	const KEEP_MS = 7 * 24 * 3600 * 1000;
	return {
		/** A new export: `entry` is the page's own description of it (what to run again). Returns its id. */
		begin(entry) {
			const data = read();
			const id = `e${now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
			data.entries = [...data.entries.filter((e) => now() - (e.at ?? 0) < KEEP_MS), { ...entry, id, pid, at: now() }].slice(-40);
			write(data);
			return id;
		},
		update(id, patch) {
			const data = read();
			if (!data.entries.some((e) => e.id === id)) return;
			data.entries = data.entries.map((e) => (e.id === id ? { ...e, ...patch, id, pid: e.pid, at: e.at } : e));
			write(data);
		},
		end(id) {
			const data = read();
			if (!data.entries.some((e) => e.id === id)) return;
			data.entries = data.entries.filter((e) => e.id !== id);
			write(data);
		},
		/** Exports that never reached their end: of an app that no longer runs, or of an earlier load of this page. */
		interrupted(session) {
			return read().entries.filter((e) => now() - (e.at ?? 0) < KEEP_MS && (e.pid !== pid || e.session !== session));
		},
		/** A folder part files are written into: remembered, so a later start can clear what a kill left there. */
		rememberFolder(folder) {
			const data = read();
			if (data.folders[data.folders.length - 1] === folder) return;
			data.folders = [...data.folders.filter((f) => f !== folder), folder].slice(-24);
			write(data);
		},
		folders: () => read().folders,
	};
}

/**
 * Removes the part files that apps no longer running left in `folders` (a kill or a power cut in the middle of an
 * export). A part of a running copy — this app's own export, or another copy of Gaziyav — is never touched.
 * Returns the paths removed.
 */
function sweepParts(folders, { isAlive = alive, log = () => {} } = {}) {
	const removed = [];
	for (const folder of folders) {
		let names = [];
		try {
			names = fs.readdirSync(folder);
		} catch {
			continue;
		}
		for (const name of names) {
			const owner = partOwner(name);
			if (!owner || isAlive(owner)) continue;
			const full = path.join(folder, name);
			try {
				fs.rmSync(full, { force: true });
				removed.push(full);
				log(`[studio] removed the unfinished part of an export cut short: ${name}`);
			} catch {}
		}
	}
	return removed;
}

module.exports = { PART_EXT, alive, cleanName, freeBytes, freeTarget, openJournal, partOwner, partPath, placeFile, roomFor, sweepParts, syncDir, syncFile, volumeOf, withAir };
