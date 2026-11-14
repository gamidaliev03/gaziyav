// An import from an ordinary place on this Mac (the internal disk, a fixed external drive) is not copied into the
// project any more: the project keeps where the file is, its size and date, and its file number (a rename or a move on
// the same disk keeps it). Copied are only files that will go away: on removable media (an SD card, a camera, a USB
// stick), on a disk image, on a network share, or in a temporary folder (the Mac's temp folders, the Trash, caches).
//
// The window can't open a file by its path. At each open of a project the editor asks for its originals and gets them
// as real, disk-backed File objects — the same kind a file picker gives (nothing is read or copied until a clip plays):
// they are put into a hidden file input of the page through the DevTools protocol (`DOM.setFileInputFiles`).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const real = (p) => {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return p;
	}
};
const inside = (p, root) => {
	const r = real(root);
	return p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
};
// the app's own folders (its profile: results, uploads, caches) count as temporary: what it keeps there may be cleared
let ownRoots = [];
const tempRoots = () => [os.tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders", path.join(os.homedir(), ".Trash"), path.join(os.homedir(), "Library", "Caches"), ...ownRoots];

/** «fixed» or «removable», by the volume's mount point (asked once per volume). */
const volumes = new Map();
function volumeKind(mount) {
	if (process.platform !== "darwin" || mount === "/") return Promise.resolve("fixed");
	const known = volumes.get(mount);
	if (known) return known;
	const asked = new Promise((resolve) => {
		execFile("/usr/sbin/diskutil", ["info", "-plist", mount], { timeout: 5000 }, (error, out) => {
			// a network share, or a volume diskutil can't describe: it may go away — copied
			if (error || !out) return resolve("removable");
			const yes = (key) => new RegExp(`<key>${key}</key>\\s*<true/>`).test(out);
			const text = (key) => (new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(out) || [])[1] || "";
			const removable = yes("RemovableMedia") || yes("Removable") || /disk image|secure digital/i.test(`${text("BusProtocol")} ${text("DeviceTreePath")}`) || text("VirtualOrPhysical") === "Virtual";
			resolve(removable ? "removable" : "fixed");
		});
	});
	volumes.set(mount, asked);
	return asked;
}

/** Where a file the user imported lives: «place» (used where it is), «temporary» or «removable» (copied). */
async function placeOf(file) {
	if (typeof file !== "string" || !path.isAbsolute(file)) return "temporary";
	const p = real(file);
	// tests keep all their media under /private/tmp: this folder of theirs counts as an ordinary place
	const testPlace = process.env.STUDIO_TEST === "1" ? process.env.STUDIO_TEST_PLACE_ROOT : "";
	if (testPlace && inside(p, testPlace)) return "place";
	if (tempRoots().some((r) => inside(p, r))) return "temporary";
	const m = /^\/Volumes\/[^/]+/.exec(p);
	return (await volumeKind(m ? m[0] : "/")) === "fixed" ? "place" : "removable";
}

/** The file's number on its disk (kept through renames and moves on that disk), for finding it again. */
function identity(file) {
	try {
		const st = fs.statSync(file);
		return st.isFile() ? { dev: st.dev, ino: st.ino, size: st.size, lastModified: Math.floor(st.mtimeMs) } : null;
	} catch {
		return null;
	}
}

const sameFile = (st, want) => st.isFile() && st.size === want.size && Math.abs(st.mtimeMs - want.lastModified) <= 2000;

/**
 * Finds an original again: at its path (the same size and date), else by its file number on the same disk (renamed or
 * moved), else nothing. `changed`: a file is at the path but it is not the one imported (another size or date).
 */
function locate(want) {
	if (!want || typeof want.path !== "string" || !path.isAbsolute(want.path)) return { status: "missing" };
	let atPath = null;
	try {
		atPath = fs.statSync(want.path);
		if (sameFile(atPath, want)) return { status: "ok", path: want.path };
	} catch {}
	if (process.platform === "darwin" && Number.isFinite(want.dev) && Number.isFinite(want.ino)) {
		const byNumber = `/.vol/${want.dev}/${want.ino}`;
		try {
			const st = fs.statSync(byNumber);
			if (sameFile(st, want)) {
				const now = real(byNumber);
				return { status: "moved", path: now.startsWith("/.vol/") ? byNumber : now };
			}
		} catch {}
	}
	if (atPath?.isFile()) return { status: "changed", path: want.path, size: atPath.size, lastModified: Math.floor(atPath.mtimeMs) };
	return { status: "missing" };
}

/** Puts `paths` into the page's file input `selector` as disk-backed files (DevTools protocol, then detached). */
async function setInputFiles(wc, selector, paths) {
	const dbg = wc.debugger;
	const mine = !dbg.isAttached();
	if (mine) dbg.attach("1.3");
	try {
		const found = await dbg.sendCommand("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)})`, returnByValue: false });
		const objectId = found?.result?.objectId;
		if (!objectId) throw new Error("the page has no such file input");
		await dbg.sendCommand("DOM.setFileInputFiles", { files: paths, objectId });
		await dbg.sendCommand("Runtime.releaseObject", { objectId }).catch(() => {});
	} finally {
		if (mine) {
			try {
				dbg.detach();
			} catch {}
		}
	}
}

function register({ log, own = [] } = {}) {
	const { ipcMain } = require("electron");
	ownRoots = own.filter(Boolean);
	// what an import should do with each file: use it where it is, or copy it (and the file's number for later)
	ipcMain.handle("studio:originals-place", async (_event, files) => {
		const list = Array.isArray(files) ? files.slice(0, 2000) : [];
		return Promise.all(list.map(async (file) => ({ place: await placeOf(file), ...(identity(file) ?? {}) })));
	});
	// a project opens: its originals as disk-backed files, in the order asked (only the ones found are put in)
	ipcMain.handle("studio:originals-attach", async (event, { selector, files } = {}) => {
		const list = Array.isArray(files) ? files.slice(0, 5000) : [];
		const found = list.map(locate);
		const paths = found.filter((f) => f.path).map((f) => f.path);
		if (paths.length) {
			try {
				await setInputFiles(event.sender, String(selector ?? ""), paths);
			} catch (error) {
				log?.(`[originals] could not hand ${paths.length} file(s) to the window: ${error?.message ?? error}`);
				return list.map(() => ({ status: "unavailable" }));
			}
		}
		return found;
	});
}

module.exports = { register, placeOf, locate, identity };
