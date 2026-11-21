// Lets the editor know it runs inside the Mac app, and gives it a few native abilities.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Gaziyav AI's one-shot text jobs (titles, descriptions, captions…): one answer from the person's connected Claude,
// over the same connection as the chat, with no tools (modules/agent-host.js oneShot; gz1-oneshot-api.md).
contextBridge.exposeInMainWorld("gaziyavAI", {
	/** ({ task, prompt, system?, json?, model? }) → { ok: true, text, json? } | { ok: false, error (one plain line), code } */
	text: (args) => ipcRenderer.invoke("gaziyav-ai:text", args && typeof args === "object" ? { task: String(args.task ?? "text"), prompt: String(args.prompt ?? ""), system: String(args.system ?? ""), json: args.json === true, model: String(args.model ?? ""), images: Array.isArray(args.images) ? args.images.slice(0, 6).map((i) => ({ data: String(i?.data ?? ""), mime: String(i?.mime ?? i?.mimeType ?? "") })) : [] } : {}),
	/** → { ready, state: "ready" | "sign-in" | "missing" | "checking", line } — line: how to connect, in the UI's language */
	status: () => ipcRenderer.invoke("gaziyav-ai:status"),
});

contextBridge.exposeInMainWorld("studioApp", {
	/** macOS says memory is short: cb("warning" | "critical" | "normal"); returns an unsubscribe function. */
	onMemoryPressure: (cb) => {
		const handler = (_event, level) => cb(String(level));
		ipcRenderer.on("studio:memory-pressure", handler);
		return () => ipcRenderer.removeListener("studio:memory-pressure", handler);
	},
	/** The Mac's thermal state changed: cb("nominal" | "fair" | "serious" | "critical"); returns an unsubscribe function. */
	onThermal: (cb) => {
		const handler = (_event, level) => cb(String(level));
		ipcRenderer.on("studio:thermal", handler);
		return () => ipcRenderer.removeListener("studio:thermal", handler);
	},
	/** One tap of the Force Touch trackpad ("snap" | "align" | "limit" | "drop"), fire-and-forget (src/haptics). */
	haptic: process.platform === "darwin" ? (kind) => ipcRenderer.send("studio:haptic", String(kind)) : undefined,
	desktop: true,
	platform: process.platform,
	gz: {
		/**
		 * The owner's own edition is the editor alone (GaziyavShell/modules/edition.js WORKSPACE). */
		workspace: false,
		invoke: (channel, ...args) => (String(channel).startsWith("gz:") ? ipcRenderer.invoke(String(channel), ...args) : Promise.reject(new Error("not a gz: channel"))),
		on: (channel, cb) => {
			if (!String(channel).startsWith("gz:")) return () => {};
			const handler = (_event, ...args) => cb(...args);
			ipcRenderer.on(String(channel), handler);
			return () => ipcRenderer.removeListener(String(channel), handler);
		},
	},
	/** The fal.ai key: saved encrypted by the app (Keychain), never readable by the page; set / clear only. */
	falKey: {
		set: (key) => ipcRenderer.invoke("gaziyav:fal-key-set", String(key ?? "")),
		clear: () => ipcRenderer.invoke("gaziyav:fal-key-clear"),
	},
	/** The Late API key (Share → Post): saved encrypted by the app, never readable by the page; set / clear only. */
	lateKey: {
		set: (key) => ipcRenderer.invoke("gaziyav:late-key-set", String(key ?? "")),
		clear: () => ipcRenderer.invoke("gaziyav:late-key-clear"),
	},
	/** Opens Late's connect URL (the platform's own sign-in) in a Gaziyav window; resolves when it's done or closed. */
	lateConnect: (authUrl) => ipcRenderer.invoke("gaziyav:late-connect", String(authUrl ?? "")),
	/** Dock progress bar: 0..1, or null to hide it. */
	setProgress: (value) => ipcRenderer.send("studio:progress", typeof value === "number" ? value : null),
	/** The long jobs on disk (modules/jobs-journal.js): ("put", job) · ("end", id) · ("list") → jobs, each with `earlier`. */
	jobs: (op, a) => ipcRenderer.invoke("studio:jobs", String(op), a ?? null),
	/** Notification + Dock bounce, only shown when the window is not focused. */
	notify: (title, body) => ipcRenderer.send("studio:notify", { title: String(title ?? ""), body: String(body ?? "") }),
	/** "editor" | "projects": enables the editor-only menu items. */
	setContext: (context) => ipcRenderer.send("studio:context", String(context)),
	/** Saved downloads (exports): cb({ name, path, state }); returns an unsubscribe function. */
	onDownload: (cb) => {
		const handler = (_event, info) => cb(info);
		ipcRenderer.on("studio:download", handler);
		return () => ipcRenderer.removeListener("studio:download", handler);
	},
	/** Shows a saved file in Finder. */
	reveal: (file) => ipcRenderer.send("studio:reveal", String(file ?? "")),
	/** The Mac's Share menu (AirDrop, Messages, Mail…) for a saved file; resolves to "shared" or "missing". */
	share: (file) => ipcRenderer.invoke("studio:share", String(file ?? "")),
	/** Share → Post through the sites: the signed-in accounts ({ youtube: { connected, name, avatar }, … }). */
	shareAccounts: () => ipcRenderer.invoke("studio:share-accounts"),
	/** Opens the site's own sign-in in the Share window; resolves when signed in (or the window is closed). */
	shareConnect: (site) => ipcRenderer.invoke("studio:share-connect", String(site ?? "")),
	/** Forgets the site's sign-in. */
	shareDisconnect: (site) => ipcRenderer.invoke("studio:share-disconnect", String(site ?? "")),
	/** Brings a post's Share window to the front. */
	shareShow: (postId) => ipcRenderer.invoke("studio:share-show", String(postId ?? "")),
	/** Settings → General → Appearance: "dark" | "light" | "system" (also View → Appearance). */
	setTheme: (value) => ipcRenderer.send("studio:theme", String(value)),
	// Settings → General → Language (the app menus follow it)
	setLanguage: (value) => ipcRenderer.send("studio:language", String(value)),
	/** A native folder picker; resolves to the folder's path or null. */
	pickFolder: (title) => ipcRenderer.invoke("studio:pick-folder", String(title ?? "")),
	/** A JPEG data URL of part of the window ({ x, y, width, height, maxHeight } in page pixels), or null. */
	capture: (rect) => ipcRenderer.invoke("studio:capture", rect ?? null),
	/** ⌃⌥⌘N, the owner's remark (modules/notes.js): ("begin") → token · ("save", token, note) → true · ("discard", token). */
	note: (op, token, note) => ipcRenderer.invoke("studio:note", String(op), token == null ? null : String(token), note ?? null),
	/** The flight recorder (modules/diagnostics.js): a batch of events from src/notes/diag.ts, at most one a second. */
	diag: (batch) => ipcRenderer.send("studio:diag", Array.isArray(batch) ? batch : []),
	/** Exports written to disk as they are encoded (web: src/export/disk.ts; the app's side: modules/export-ipc.js). */
	exportFile: {
		/** `where` = { folder, filename } when the «Export to» folder is known: the file then grows beside its place. */
		open: (where) => ipcRenderer.invoke("studio:export-file-open", where && typeof where === "object" ? { folder: String(where.folder ?? ""), filename: String(where.filename ?? "") } : null),
		write: (id, position, data) => ipcRenderer.invoke("studio:export-file-write", String(id), Number(position), data),
		/** The Save dialog, then one rename into the chosen place. `again`: the place chosen last time, no dialog. */
		save: (id, filename, again) => ipcRenderer.invoke("studio:export-file-save", String(id), String(filename ?? ""), again === true),
		path: (id) => ipcRenderer.invoke("studio:export-file-path", String(id)),
		moveTo: (id, folder, filename) =>
			ipcRenderer.invoke("studio:export-file-move", String(id), String(folder ?? ""), String(filename ?? "")).catch((error) => {
				throw new Error(String(error?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
			}),
		discard: (id) => ipcRenderer.invoke("studio:export-file-discard", String(id)),
		/** Room on disk for an export of about `bytes` saved to `folder` (null: the Save dialog), counted per volume:
		 * { ok, needBytes, freeBytes, shortBytes, folder }. `extra.masterBytes`: the master of an export with a second pass. */
		room: (bytes, folder, extra) => ipcRenderer.invoke("studio:export-room", Number(bytes), folder ? String(folder) : null, extra && typeof extra === "object" ? { masterBytes: Number(extra.masterBytes) || 0 } : null),
		/** Free bytes where an export's file grows: { freeBytes }. */
		space: (id) => ipcRenderer.invoke("studio:export-file-space", String(id)),
		/** The file starts again from nothing. */
		reset: (id) => ipcRenderer.invoke("studio:export-file-reset", String(id)),
		/** The Save dialog for a file the app's server holds (the ffmpeg pass's result), placed by one rename. */
		saveFrom: (file, filename, again) => ipcRenderer.invoke("studio:export-file-save-from", String(file ?? ""), String(filename ?? ""), again === true),
		/** The journal of exports in flight: ("begin", entry) → id · ("update", id, patch) · ("end", id) · ("interrupted", session) → entries. */
		journal: (op, a, b) => ipcRenderer.invoke("studio:export-journal", String(op), a ?? null, b ?? null),
	},
	/** Drags a saved AI result like a file from Finder (call from a dragstart handler). */
	startDrag: (file) => ipcRenderer.send("studio:start-drag", String(file ?? "")),
	/** Where a picked or dropped file is on this Mac ("" for a file made in the window). */
	pathForFile: (file) => {
		try {
			return webUtils.getPathForFile(file) || "";
		} catch {
			return "";
		}
	},
	/** The user's media used where they are (modules/originals.js): per path { place: "place" | "temporary" | "removable", dev, ino, size, lastModified }. */
	originalsPlace: (paths) => ipcRenderer.invoke("studio:originals-place", Array.isArray(paths) ? paths.map(String) : []),
	/** A project opens: its originals put into the file input `selector` as files; per one asked { status, path? }. */
	attachOriginals: (selector, files) => ipcRenderer.invoke("studio:originals-attach", { selector: String(selector ?? ""), files: Array.isArray(files) ? files : [] }),
	/** The Claude chat column at the right of the editor (modules/agent-host.js): shown or not → whether it is shown now. */
	chat: {
		toggle: (open) => ipcRenderer.invoke("gz-chat:toggle", typeof open === "boolean" ? open : null),
		state: () => ipcRenderer.invoke("gz-chat:state"),
	},
	/** Self-tests only (main.js answers in test mode alone): the menu bar's items, a click on one, the clipboard kept. */
	testMenu: (op, id) => ipcRenderer.invoke("gaziyav:test-menu", String(op ?? ""), String(id ?? "")),
});

// The page makes room for the traffic lights only inside the Mac app.
function mark() {
	const root = document.documentElement;
	if (root) root.setAttribute("data-desktop", process.platform === "darwin" ? "mac" : "desktop");
}
mark();
document.addEventListener("DOMContentLoaded", mark);
