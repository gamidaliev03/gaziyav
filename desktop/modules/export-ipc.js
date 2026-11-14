// The Mac app's side of an export's file («studio:export-*») and of every file the editor saves through a dialog
// (render, 11.11). The rules are in modules/export-save.js: a file is never written under its final name, a journal
// remembers exports in flight, room on the disk is counted per volume. main.js only registers this.
"use strict";
const { app, dialog, ipcMain, session, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const save = require("./export-save");

/**
 * deps: { test, fromApp(event), ensureWindow(), window(), insideSpace(file), exportDir(), lang(), log(…) }
 * Returns { sweep(), quit() } for the app's start and end.
 */
function register(deps) {
	const { test, fromApp, log } = deps;
	/** id → { dir | null, file, handle, beside, target } : `dir` is a temp folder of this export, null when the file grows beside its place. */
	const files = new Map();
	let count = 0;
	let journal = null;
	const theJournal = () => (journal ??= save.openJournal(path.join(app.getPath("userData"), "export-journal.json")));
	/** Where a file saved through the dialog went last time (an entry id, or a server-held file's path). */
	const lastTarget = new Map();

	// Test mode: <user data>/test-disk-free.txt pretends that many bytes are free on every volume;
	// <user data>/test-save-dialog.txt stands in for the Save dialog's answer («cancel», or a folder).
	const testFile = (name) => {
		if (!test) return null;
		try {
			return fs.readFileSync(path.join(app.getPath("userData"), name), "utf8").trim();
		} catch {
			return null;
		}
	};
	const fakeFree = () => {
		const text = testFile("test-disk-free.txt");
		return text === null ? null : Number(text) || 0;
	};

	const tell = (info) => {
		const win = deps.window();
		if (!win || win.isDestroyed()) return;
		win.webContents.send("studio:download", info);
		// an export kept in the space: Media → Downloads shows it under Exports
		if (info.state === "completed" && deps.insideSpace(info.path)) win.webContents.send("gz:downloads:changed", {});
	};

	/** The file's bytes are on the disk and its handle is closed (before it gets its name). */
	async function closeWhole(entry, { durable = true } = {}) {
		const handle = entry.handle;
		if (!handle) return;
		entry.handle = null;
		try {
			if (durable) {
				await handle.sync().catch((error) => {
					if (error?.code === "ENOSPC" || error?.code === "EIO") throw error;
				});
			}
		} finally {
			await handle.close().catch(() => {});
		}
	}

	async function remove(id) {
		const entry = files.get(id);
		if (!entry) return;
		files.delete(id);
		lastTarget.delete(id);
		await entry.handle?.close().catch(() => {});
		if (entry.dir) await fs.promises.rm(entry.dir, { recursive: true, force: true }).catch(() => {});
		else if (!entry.external) await fs.promises.rm(entry.file, { force: true }).catch(() => {});
	}

	const dialogTitle = (name) => {
		const ru = deps.lang() === "ru";
		if (/\.(png|jpe?g|webp|gif|heic|avif|bmp|tiff?)$/i.test(name)) return ru ? "Сохранить изображение" : "Save Image";
		if (/\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(name)) return ru ? "Сохранить звук" : "Save Audio";
		if (/\.(mp4|mov|webm|mkv|m4v)$/i.test(name)) return ru ? "Сохранить видео" : "Save Video";
		return ru ? "Сохранить файл" : "Save File";
	};

	/** Where the Save dialog starts (tests: where files are saved with no dialog). */
	const landsBy = () => (test && process.env.STUDIO_DOWNLOADS ? process.env.STUDIO_DOWNLOADS : deps.exportDir());

	/** The user's choice of a place for `name`, or null when the dialog was closed. */
	async function chooseTarget(name) {
		if (test && process.env.STUDIO_DOWNLOADS) {
			const answer = testFile("test-save-dialog.txt");
			if (answer === "cancel") return null;
			// Never over an earlier export (the Save dialog asks first; the test folder has no dialog): «name (1).mp4».
			return save.freeTarget(answer || process.env.STUDIO_DOWNLOADS, name);
		}
		const dir = deps.exportDir();
		try {
			fs.mkdirSync(dir, { recursive: true });
		} catch {}
		const result = await dialog.showSaveDialog(deps.ensureWindow(), { title: dialogTitle(name), defaultPath: path.join(dir, name) });
		return result.canceled || !result.filePath ? null : result.filePath;
	}

	/** Why a file could not be placed, in a word the page can say, with the numbers of a full disk. */
	async function whyNot(error, source, target) {
		let reason;
		if (error?.code === "ENOSPC") reason = "space";
		else if (["EACCES", "EPERM", "EROFS", "ENOENT", "ENOTDIR"].includes(error?.code)) reason = "folder";
		else {
			try {
				fs.accessSync(path.dirname(target), fs.constants.W_OK);
			} catch {
				reason = "folder";
			}
		}
		if (reason !== "space") return reason ? { reason } : {};
		const needBytes = await fs.promises.stat(source).then((s) => s.size, () => 0);
		const freeBytes = fakeFree() ?? (await save.freeBytes(path.dirname(target))) ?? 0;
		return { reason, needBytes, freeBytes };
	}

	/**
	 * A finished file reaches the place the user chooses, in one step. `again`: the place chosen last time (the disk was
	 * full then), no dialog. The page hears the end as «studio:download» { name, path, state, reason?, needBytes?, freeBytes? }.
	 * Returns true when the file is in its place.
	 */
	async function saveThroughDialog({ key, source, name, again = false, onPlaced }) {
		const target = (again && lastTarget.get(key)) || (await chooseTarget(name));
		if (!target) {
			tell({ name, path: "", state: "cancelled" });
			return false;
		}
		lastTarget.set(key, target);
		try {
			await save.placeFile(source, target);
		} catch (error) {
			log(`[studio] couldn't save ${name}: ${String(error?.code ?? error?.message ?? error)}`);
			tell({ name, path: target, state: "interrupted", ...(await whyNot(error, source, target)) });
			return false;
		}
		lastTarget.delete(key);
		await onPlaced?.();
		// (a file kept inside the space is not shown in Finder: the volume stays out of Finder's sight and recents)
		if (!test && !deps.insideSpace(target)) shell.showItemInFolder(target);
		tell({ name, path: target, state: "completed" });
		return true;
	}

	// Exports written to disk as they are encoded (web: src/export/disk.ts): written at the positions the muxer asks
	// for. A long 4K export never has to fit in the page's memory. `where` = { folder, filename } when the «Export to»
	// folder is known: the file then grows beside its place; else in a temp folder that carries this app's pid.
	ipcMain.handle("studio:export-file-open", async (event, where) => {
		if (!fromApp(event)) throw new Error("not allowed");
		const id = `x${++count}`;
		const folder = typeof where?.folder === "string" && path.isAbsolute(where.folder) ? where.folder : null;
		if (folder) {
			try {
				if ((await fs.promises.stat(folder)).isDirectory()) {
					// remembered first: a kill right after leaves a part file the next start knows where to look for
					theJournal().rememberFolder(folder);
					const file = save.partPath(path.join(folder, save.cleanName(where.filename)));
					const handle = await fs.promises.open(file, "wx+");
					files.set(id, { dir: null, file, handle, beside: folder });
					return id;
				}
			} catch {
				// a folder that is gone or can't be written: the export is made in the temp folder, and saving says why
			}
		}
		const dir = await fs.promises.mkdtemp(path.join(app.getPath("temp"), `Gaziyav-export-${process.pid}-`));
		const file = path.join(dir, "export");
		const handle = await fs.promises.open(file, "w+");
		files.set(id, { dir, file, handle });
		return id;
	});
	ipcMain.handle("studio:export-file-write", async (event, id, position, data) => {
		const entry = fromApp(event) ? files.get(id) : null;
		if (!entry?.handle || !(data instanceof Uint8Array) || !Number.isSafeInteger(position) || position < 0) throw new Error("bad export write");
		// Test mode: <user data>/test-disk-full.txt makes every write fail as a full disk does, while it is there.
		if (test && testFile("test-disk-full.txt") !== null) throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
		await entry.handle.write(data, 0, data.byteLength, position);
	});
	// The file starts again from nothing (the renderer fell back to its other way of writing the same export).
	ipcMain.handle("studio:export-file-reset", async (event, id) => {
		const entry = fromApp(event) ? files.get(id) : null;
		if (!entry?.handle) throw new Error("bad export reset");
		await entry.handle.truncate(0);
	});
	// Free bytes where an export's file grows (said when the disk fills up in the middle of it).
	ipcMain.handle("studio:export-file-space", async (event, id) => {
		const entry = fromApp(event) ? files.get(id) : null;
		if (!entry) return { freeBytes: null };
		return { freeBytes: fakeFree() ?? (await save.freeBytes(path.dirname(entry.file))) };
	});
	// The finished file for the ffmpeg pass: the server reads it from disk.
	ipcMain.handle("studio:export-file-path", async (event, id) => {
		const entry = fromApp(event) ? files.get(id) : null;
		if (!entry) throw new Error("This export is gone: export it again");
		await closeWhole(entry, { durable: false });
		return entry.file;
	});
	// Export → «Export to» folder: the file gets its name there (never over an existing one) by one rename.
	ipcMain.handle("studio:export-file-move", async (event, id, folder, filename) => {
		const entry = fromApp(event) ? files.get(id) : null;
		if (!entry) throw new Error("This export is gone: export it again");
		await closeWhole(entry);
		// (a folder that went away, an unplugged disk, is said, never made again on this Mac)
		if (!path.isAbsolute(folder)) throw new Error("Choose the export folder again.");
		const stat = await fs.promises.stat(folder).catch(() => null);
		if (!stat) throw new Error(`The folder «${path.basename(folder)}» isn't there any more. Choose another one.`);
		if (!stat.isDirectory()) throw new Error("Choose a folder to export to.");
		const target = save.freeTarget(folder, save.cleanName(filename));
		theJournal().rememberFolder(folder);
		// (another volume: copied beside its place under a part name and renamed when whole)
		await save.placeFile(entry.file, target);
		await remove(id);
		return target;
	});
	// No folder chosen: the Save dialog, then the same one step. A closed dialog keeps the file for «Save again».
	ipcMain.handle("studio:export-file-save", async (event, id, filename, again) => {
		const entry = fromApp(event) ? files.get(id) : null;
		if (!entry) throw new Error("This export is gone: export it again");
		await closeWhole(entry);
		await saveThroughDialog({ key: id, source: entry.file, name: save.cleanName(filename), again: again === true, onPlaced: () => remove(id) });
	});
	// The same for a file the app's server holds (the result of the ffmpeg pass): only its own work folder can be named.
	ipcMain.handle("studio:export-file-save-from", async (event, file, filename, again) => {
		if (!fromApp(event)) throw new Error("not allowed");
		const real = (p) => {
			try {
				return fs.realpathSync(p);
			} catch {
				return null;
			}
		};
		const source = real(String(file || ""));
		const work = real(path.join(os.tmpdir(), "Gaziyav-export-work"));
		if (!source || !work || !source.startsWith(work + path.sep) || !fs.statSync(source).isFile()) throw new Error("This export is gone: export it again");
		await saveThroughDialog({ key: source, source, name: save.cleanName(filename), again: again === true });
	});
	// Before an export starts: is there room for it — where it grows and where it lands? { ok, needBytes, freeBytes,
	// shortBytes, folder } of the volume that is shortest; a check that cannot be made never blocks an export.
	// `extra.masterBytes`: the page's master of an export that has a second (ffmpeg) pass.
	ipcMain.handle("studio:export-room", async (event, bytes, folder, extra) => {
		if (!fromApp(event) || !Number.isFinite(bytes) || bytes <= 0) return { ok: true };
		try {
			const temp = app.getPath("temp");
			const chosen = typeof folder === "string" && path.isAbsolute(folder) && fs.existsSync(folder) ? folder : null;
			const masterBytes = Number(extra?.masterBytes) > 0 ? Number(extra.masterBytes) : 0;
			return await save.roomFor({ bytes, masterBytes, lands: chosen ?? landsBy(), grows: chosen ?? temp, temp, fakeFree: fakeFree() });
		} catch {
			return { ok: true };
		}
	});
	ipcMain.handle("studio:export-file-discard", async (event, id) => {
		if (fromApp(event)) await remove(id);
	});
	// The journal of exports in flight: begin(entry) → id, update(id, patch), end(id), interrupted(session) → entries.
	ipcMain.handle("studio:export-journal", (event, op, a, b) => {
		if (!fromApp(event)) return null;
		const book = theJournal();
		if (op === "begin") return a && typeof a === "object" && JSON.stringify(a).length < 12_000_000 ? book.begin(a) : null;
		if (op === "update") return b && typeof b === "object" ? (book.update(String(a), b) ?? null) : null;
		if (op === "end") return book.end(String(a)) ?? null;
		if (op === "interrupted") return book.interrupted(String(a ?? ""));
		return null;
	});

	// Every file the editor saves through a download (a sound file, captions, a still, a project copy): it lands in a
	// temp folder first, then goes where the Save dialog says by one rename — a kill or a full disk in the middle
	// leaves nothing under the name the user chose.
	session.defaultSession.on("will-download", (_event, download) => {
		const name = save.cleanName(download.getFilename(), "download");
		let dir;
		try {
			dir = fs.mkdtempSync(path.join(app.getPath("temp"), `Gaziyav-export-${process.pid}-`));
		} catch {
			// the temp folder can't be written: Chromium's own dialog and its own way of writing
			download.once("done", (_e, state) => tell({ name, path: download.getSavePath(), state }));
			if (test && process.env.STUDIO_DOWNLOADS) download.setSavePath(save.freeTarget(process.env.STUDIO_DOWNLOADS, name));
			else download.setSaveDialogOptions({ title: dialogTitle(name), defaultPath: path.join(deps.exportDir(), name) });
			return;
		}
		const source = path.join(dir, name);
		download.setSavePath(source);
		download.once("done", async (_e, state) => {
			try {
				if (state === "completed") await saveThroughDialog({ key: source, source, name });
				else if (state === "interrupted") {
					// it never reached the temp folder: a full disk there is the usual reason, and is said with its number
					const freeBytes = fakeFree() ?? (await save.freeBytes(dir)) ?? 0;
					const full = freeBytes < 4 * 1024 * 1024;
					tell({ name, path: "", state, ...(full ? { reason: "space", needBytes: download.getTotalBytes() || 0, freeBytes } : {}) });
				} else tell({ name, path: "", state });
			} catch (error) {
				log(`[studio] couldn't save ${name}: ${String(error?.message ?? error)}`);
				tell({ name, path: "", state: "interrupted" });
			} finally {
				lastTarget.delete(source);
				fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
			}
		});
	});

	return {
		/** At the start: the part files that apps no longer running left beside their places. */
		sweep() {
			try {
				save.sweepParts(theJournal().folders(), { log });
			} catch {}
		},
		/** At a normal quit: whatever is unfinished or unsaved goes. */
		quit() {
			for (const entry of files.values()) {
				try {
					if (entry.dir) fs.rmSync(entry.dir, { recursive: true, force: true });
					else if (!entry.external) fs.rmSync(entry.file, { force: true });
				} catch {}
			}
		},
	};
}

module.exports = { register };
