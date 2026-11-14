// Gaziyav: the video editor as a Mac app.
// The Next.js server runs in a utility process on a fixed local port (projects live in the
// browser storage of that origin, so the port must never change), and the window shows the editor.
const {
	app,
	BrowserWindow,
	Menu,
	Notification,
	dialog,
	ipcMain,
	nativeImage,
	nativeTheme,
	powerSaveBlocker,
	safeStorage,
	screen,
	session,
	ShareMenu,
	shell,
	utilityProcess,
} = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const url = require("node:url");
const { spawnSync } = require("node:child_process");

// Self-tests run a hidden copy with its own port and data folder, so they never touch real projects.
const TEST = process.env.STUDIO_TEST === "1";
// Share recipes wait up to 15 min for a site's upload; the tests use stand-in sites, so there a step waits 30 s at most.
const stepLimit = (ms) => (TEST ? Math.min(ms, 30000) : ms);
// Developer extras (reload, devtools) only when explicitly asked for.
const DEV = process.env.STUDIO_DEV === "1" || TEST;
const IS_MAC = process.platform === "darwin";
const { EDITION, FAMILY, WORKSPACE, EDITOR_PORT, DATA_NAME } = require("./modules/edition");
const PORT = TEST ? Number(process.env.STUDIO_PORT || 3590) : EDITOR_PORT;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const START_TIMEOUT_MS = 30_000;

// ---------- Name, data folder, one-time migration (distribution) ----------
const workspace = require("./modules/no-space");
const vpn = workspace.network;
const reaper = require("./modules/reaper");
const exportIpc = require("./modules/export-ipc");
const jobsJournal = require("./modules/jobs-journal");

// Everything the app keeps lives in ~/Library/Application Support/Gaziyav: the browser profile (projects in
// IndexedDB/OPFS of http://127.0.0.1:47831 — the port never changes), settings, working files and models.
const APP_NAME = "Gaziyav";
app.setName(APP_NAME);
// The UI is English: Chromium's own strings (dialogs, context menus, form validation) follow it
// instead of the Mac's system language.
app.commandLine.appendSwitch("lang", "en-US");
// The GPU process lost a third time: Chromium would end the whole app on purpose (its crash limit). The app stays;
// the page reloads and says what happened (the handler below). IDEAL reliable, audit #20.
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
// Self-tests of the first-run import point appData at a stand-in (Electron's appData ignores HOME); a test copy never
// imports into (or out of) the user's real folders.
if (TEST && process.env.STUDIO_APPDATA) app.setPath("appData", process.env.STUDIO_APPDATA);
// folder itself, as before.
const SUPPORT_DIR = TEST && process.env.STUDIO_USER_DATA ? process.env.STUDIO_USER_DATA : path.join(app.getPath("appData"), DATA_NAME);
const space = workspace.boot({ support: SUPPORT_DIR, test: TEST });
app.setPath("userData", space.userData);
// A configured VPN holds from the first moment: Chromium's default proxy is a black hole until each session is pointed
if (space.mode !== "locked") vpn.boot();
// No DNS prefetching in any page: Electron resolves a site's <link rel="dns-prefetch"> (and http pages' links) with
app.commandLine.appendSwitch("blink-settings", "dnsPrefetchingEnabled=false");
// A test copy only ever sees Chromium's fake camera and microphone (voice-over, the family's calls): never the real ones.
if (TEST) for (const s of ["use-fake-device-for-media-stream", "use-fake-ui-for-media-stream"]) app.commandLine.appendSwitch(s);
// Local crash dumps only (nothing is uploaded): lets us diagnose renderer/GPU crashes. A dump is a copy of the crashed
// process's memory (open projects, pages, keys): it is written inside the space only — the locked shell (whose memory
// holds the password being typed, the volume key while it opens) writes none.
if (space.mode !== "locked") {
	app.setPath("crashDumps", path.join(app.getPath("userData"), "Crashpad"));
	require("electron").crashReporter.start({ productName: APP_NAME, uploadToServer: false });
	require("./modules/diagnostics").register({ fromApp }); // the flight recorder: <userData>/Diagnostics, local only
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

let server = null;
let mainWindow = null;
let quitting = false;
let serverReady = false;

// What the self-tests can look at (only in test mode).
const testState = { notifications: [], progress: [], contextMenus: [], menuResults: [], shared: [] };
if (TEST) {
	globalThis.__studioTest = {
		state: testState,
		get window() {
			return mainWindow;
		},
		Menu,
		clickMenu: (id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.click(),
	};
}

// The menu bar for the self-tests (des2 D3: every item acts or is disabled): the bundle refuses --inspect, so the
// page asks here — in test mode only.
if (TEST) {
	let kept = null;
	ipcMain.handle("gaziyav:test-menu", (_event, op, id) => {
		const menu = Menu.getApplicationMenu();
		if (op === "list") {
			const out = [];
			const walk = (m, pre) => {
				for (const i of m.items) {
					if (i.type === "separator") continue;
					if (i.submenu) walk(i.submenu, `${pre}${i.label} › `);
					else out.push({ path: pre + i.label, id: i.id || "", role: i.role || "", enabled: i.enabled, visible: i.visible, accel: i.accelerator || (i.role === "close" ? "CmdOrCtrl+W" : i.role === "quit" ? "CmdOrCtrl+Q" : i.role === "hide" ? "CmdOrCtrl+H" : i.role === "minimize" ? "CmdOrCtrl+M" : "") });
				}
			};
			if (menu) walk(menu, "");
			return out;
		}
		if (op === "click") return (menu?.getMenuItemById(id)?.click(), true);
		// perfb: the memory signal through its real channel (main → studio:memory-pressure → the page), never the system's
		if (op === "memory-pressure") return (memoryPressure(id), true);
		// (Electron's main-process clipboard here has fewer readers than documented: each one is asked for only if it is
		// there; what cannot be put back makes the test leave the clipboard alone — «safe» says which)
		const { clipboard } = require("electron");
		const has = (name) => typeof clipboard?.[name] === "function";
		if (op === "clipboard-save") {
			const formats = has("availableFormats") ? clipboard.availableFormats() : null;
			const text = has("readText") ? clipboard.readText() : null;
			const onlyText = Array.isArray(formats) && formats.every((f) => /^text\/plain/.test(f));
			kept = { text, safe: text !== null && has("writeText") && (onlyText || (Array.isArray(formats) && formats.length === 0)) };
			return kept.safe;
		}
		if (op === "clipboard-text") return has("readText") ? clipboard.readText() : null;
		// (only between a clipboard-save that said «safe» and its restore: the Mac's clipboard is put back after the step)
		if (op === "clipboard-set" && kept?.safe) return (clipboard.writeText(id), true);
		if (op === "clipboard-restore" && kept) {
			if (kept.safe) clipboard.writeText(kept.text ?? "");
			kept = null;
			return true;
		}
		return false;
	});
}

// ---------- Crash log ----------
// (server errors and exits, renderer/GPU process deaths, hangs, page errors and panel crashes), so a
// crash the user saw can be diagnosed afterwards. Two files of at most 2 MB each, nothing leaves the Mac.
let logFile = null;
// The pipes the app was started with (a test's node, a terminal) can close under it. A write into a closed pipe raised
// EPIPE as an uncaught exception, whose own log line wrote into the same pipe again: an orphaned test app spun a core
// for hours and filled its log (polish, 11.11). A broken pipe is written to no more; a test app whose parent is gone quits.
let stdioGone = false;
function onStdioError(error) {
	if (error?.code !== "EPIPE" && error?.code !== "ERR_STREAM_DESTROYED") return;
	if (stdioGone) return;
	stdioGone = true;
	if (TEST) setImmediate(() => app.quit());
}
process.stdout?.on?.("error", onStdioError);
process.stderr?.on?.("error", onStdioError);
function studioLog(...parts) {
	const line = `${new Date().toISOString()} ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`;
	if (TEST && !stdioGone) {
		try {
			process.stderr.write(`[log] ${line}`);
		} catch (error) {
			onStdioError(error);
		}
	}
	try {
		if (!logFile) {
			const dir = path.join(app.getPath("userData"), "logs");
			fs.mkdirSync(dir, { recursive: true });
			logFile = path.join(dir, "studio.log");
		}
		try {
			if (fs.statSync(logFile).size > 2_000_000) fs.renameSync(logFile, logFile.replace(/\.log$/, ".1.log"));
		} catch {}
		fs.appendFileSync(logFile, line);
	} catch {}
}
process.on("uncaughtException", (error) => {
	// a closed stdout / stderr is not a crash to log (logging it wrote into the closed pipe again, for ever)
	if (error?.code === "EPIPE") return onStdioError(error);
	studioLog("[main] uncaught", String(error?.stack ?? error));
});
process.on("unhandledRejection", (reason) => studioLog("[main] unhandled rejection", String(reason?.stack ?? reason)));

// ---------- Preferences (theme, window size) ----------

function prefsFile() {
	return path.join(app.getPath("userData"), "shell-prefs.json");
}
let prefs = {};
function loadPrefs() {
	try {
		prefs = JSON.parse(fs.readFileSync(prefsFile(), "utf8")) || {};
	} catch {
		prefs = {};
	}
}
function savePrefs() {
	try {
		fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
		fs.writeFileSync(prefsFile(), JSON.stringify(prefs));
	} catch {}
}

// Video editors are dark by default; the user can switch in «Вид → Оформление».
function applyTheme() {
	const theme = ["dark", "light", "system"].includes(prefs.theme) ? prefs.theme : "dark";
	nativeTheme.themeSource = theme;
	return theme;
}
function themeBackground() {
	return nativeTheme.shouldUseDarkColors ? "#07090c" : "#ffffff";
}

function savedBounds() {
	const b = prefs.bounds;
	if (!b || typeof b.width !== "number") return null;
	const area = screen.getDisplayMatching(b).workArea;
	const visible =
		b.x + 100 < area.x + area.width && b.y + 50 < area.y + area.height && b.x + b.width > area.x + 100 && b.y >= area.y - 10;
	return visible ? b : { width: b.width, height: b.height };
}

// ---------- Editor server ----------

// In the packaged app the server sits in Resources/web; while developing, point WEB_DIR at the standalone build.
function webDir() {
	if (process.env.WEB_DIR) return process.env.WEB_DIR;
	return path.join(process.resourcesPath, "web");
}

function serverEnv() {
	// Website-only services (accounts, blog, feedback) are not part of the app: their settings stay unset.
	return {
		...process.env,
		NODE_ENV: "production",
		PORT: String(PORT),
		HOSTNAME: "127.0.0.1",
		NEXT_TELEMETRY_DISABLED: "1",
		NEXT_PUBLIC_SITE_URL: ORIGIN,
		STUDIO_DATA_DIR: path.join(app.getPath("userData"), "Studio"),
		STUDIO_SUPPORT_DIR: app.getPath("userData"),
		STUDIO_BIN_DIR: path.join(process.resourcesPath, "bin"),
		// The app's own tools first: opened from the Dock the PATH is only /usr/bin:/bin…, and the AI helpers' audio
		// loaders look for ffmpeg there («ffmpeg not found» stopped every voice-over). Tests launched from a terminal
		// had Homebrew's ffmpeg and never saw it.
		PATH: [path.join(process.resourcesPath, "bin"), process.env.PATH].filter(Boolean).join(path.delimiter),
		STUDIO_DOWNLOADS_DIR: workspace.downloadsDir({ make: false }),
		...vpn.serverEnv(),
	};
}

function ping() {
	return new Promise((resolve) => {
		const req = http.get(`${ORIGIN}/api/health`, (res) => {
			res.resume();
			resolve(res.statusCode !== undefined && res.statusCode < 500);
		});
		req.on("error", () => resolve(false));
		req.setTimeout(1000, () => {
			req.destroy();
			resolve(false);
		});
	});
}

// The built-in server crashed while the app was running: restart it (3 tries per minute) and reload the windows,
// which reopen the project from their own storage. Only if that keeps failing, ask (never a blocking error box).
const restarts = [];
let recovering = false;
async function recoverServer(code) {
	if (recovering) return;
	recovering = true;
	serverReady = false;
	try {
		const now = Date.now();
		while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
		if (restarts.length < 3) {
			restarts.push(now);
			try {
				await startServer();
				serverReady = true;
				studioLog(`[server] restarted after exit code ${code}`);
				for (const win of BrowserWindow.getAllWindows()) reloadTelling(win, "server");
				return;
			} catch (error) {
				studioLog("[server] restart failed", String(error?.message ?? error).slice(0, 3000));
			}
		}
		if (quitting) return;
		const { response } = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
			type: "error",
			message: "The editor stopped",
			detail: "Gaziyav couldn't restart its editor engine. Your projects are saved. Restart the app to continue.",
			buttons: ["Restart Gaziyav", "Quit"],
			defaultId: 0,
			cancelId: 1,
		});
		quitting = true;
		if (response === 0) app.relaunch();
		app.quit();
	} finally {
		recovering = false;
	}
}

async function startServer() {
	if (await ping()) {
		throw new Error(
			`Port ${PORT} is used by another program. Quit it (or another copy of Gaziyav) and open the app again.`,
		);
	}
	const dir = webDir();
	const entry = path.join(dir, "apps", "web", "server.js");
	if (!fs.existsSync(entry)) {
		throw new Error(`Editor server not found: ${entry}. Reinstall the app.`);
	}

	const log = [];
	server = utilityProcess.fork(entry, [], {
		cwd: path.dirname(entry),
		env: serverEnv(),
		stdio: "pipe",
		serviceName: "Gaziyav server",
	});
	vpn.attachServer?.(server);
	require("./modules/provider-keys").attachServer(server, { fromApp, test: TEST });
	// The fal.ai key goes to the server as a message (never in its environment, never in a file in clear).
	server.on("message", (m) => {
		if (m?.type === "fal-key-request") sendFalKey();
		if (m?.type === "late-key-request") sendLateKey();
		if (m?.type === "late-key-checked") lateChecks.get(m.id)?.(m);
	});
	sendFalKey();
	sendLateKey();
	const keep = (chunk) => {
		log.push(chunk.toString());
		if (log.length > 200) log.shift();
	};
	server.stdout?.on("data", keep);
	server.stderr?.on("data", keep);
	// Server errors (stderr, and stdout lines that look like errors) go to the crash log.
	server.stderr?.on("data", (chunk) => studioLog("[server]", chunk.toString().trimEnd().slice(0, 4000)));
	server.stdout?.on("data", (chunk) => {
		const text = chunk.toString();
		if (/error|⨯|unhandled|exception|fatal/i.test(text)) studioLog("[server]", text.trimEnd().slice(0, 4000));
	});
	let exited = null;
	let up = false;
	server.on("exit", (code) => {
		exited = code;
		server = null;
		// a normal quit is one short line; a real failure keeps the server's last words
		if (quitting) studioLog(`[server] stopped (quit, code ${code})`);
		else studioLog(`[server] exited with code ${code}`, log.slice(-15).join("").slice(-3000));
		// A crash while running is recovered quietly; a failed start is reported by the caller.
		if (!quitting && up) recoverServer(code);
		// what the dead server had started (a render's Chrome, ffmpeg, a helper) is orphaned now: it goes at once
		setTimeout(() => reaper.sweep("after the server exited"), 1500).unref?.();
	});

	const started = Date.now();
	while (Date.now() - started < START_TIMEOUT_MS) {
		if (exited !== null) {
			throw new Error(`The editor server did not start (code ${exited}).\n\n${log.slice(-15).join("")}`);
		}
		if (await ping()) {
			up = true;
			return;
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`The editor server did not respond within ${START_TIMEOUT_MS / 1000} s.\n\n${log.slice(-15).join("")}`);
}

/** Shown the moment the app opens, while the editor's server starts (a cold start takes a few seconds). */
function splashURL() {
	const dark = nativeTheme.shouldUseDarkColors;
	// The mark: «Крыло» — three feathers (the same drawing as the app's icon, make_icon.swift, and the page's KryloMark).
	const feathers = [
		'<defs><linearGradient id="a" x2="1"><stop offset="0" stop-color="#585c66"/><stop offset="1" stop-color="#8b909b"/></linearGradient>',
		'<linearGradient id="b" x2="1"><stop offset="0" stop-color="#cfc9bd"/><stop offset="1" stop-color="#f6f3ec"/></linearGradient>',
		'<linearGradient id="c" x2="1"><stop offset="0" stop-color="#ff6f2c"/><stop offset="1" stop-color="#ffd98a"/></linearGradient>',
		'<radialGradient id="g"><stop offset="0" stop-color="#ff8a2b" stop-opacity=".32"/><stop offset="1" stop-color="#ff8a2b" stop-opacity="0"/></radialGradient></defs>',
		'<ellipse cx="262" cy="318" rx="170" ry="70" fill="url(#g)"/>',
		'<g stroke="#15171b" stroke-width="9" paint-order="stroke">',
		'<rect x="116" y="294" width="168" height="50" rx="25" fill="url(#a)" transform="rotate(-68 141 319)"/>',
		'<rect x="116" y="294" width="214" height="50" rx="25" fill="url(#b)" transform="rotate(-37 141 319)"/>',
		'<rect x="116" y="294" width="262" height="50" rx="25" fill="url(#c)" transform="rotate(-6 141 319)"/></g>',
	].join("");
	const html = `<!doctype html><meta charset="utf-8"><title>Gaziyav</title><style>
html,body{margin:0;height:100%;background:${themeBackground()};-webkit-app-region:drag;cursor:default}
body{display:grid;place-items:center}
svg{width:64px;height:64px;animation:p 1.6s ease-in-out infinite}
@keyframes p{0%,100%{opacity:.55;transform:scale(.96)}50%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){svg{animation:none}}
</style><svg viewBox="92 118 340 262">${feathers}</svg>`;
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function isInternal(url) {
	return url.startsWith(`${ORIGIN}/`) || url === ORIGIN;
}

// ---------- Window ----------

// ---------- Freeze watchdog ----------
// Every second the editor page is asked a cheap question (where it is, what runs). An answer later than 2 s is a
// freeze the user felt: one line with its length and what was running goes to the log (test/mcp-log-digest.py lists
// them), and one more while a freeze passes 10 s (a page that never comes back still leaves its line). The app itself
// standing still (a sleeping Mac, SIGSTOP) is not the page's freeze: it is told apart by the main process's own clock.
const FREEZE_MS = Number(process.env.STUDIO_TEST_FREEZE_MS) || 2000;
const PAGE_STATE = `(() => { try { const all = (window.__studioJobs?.store.getState().jobs || []).filter((j) => j.status === "running"); const jobs = all.map((j) => j.id + (j.progress ? " " + Math.round(j.progress * (j.progress <= 1 ? 100 : 1)) + "%" : "")); const ed = window.__studioBridge?.editor?.(); const playing = ed?.playback?.getIsPlaying?.() ? "playing" : ""; return { s: [location.pathname.replace(/\\/editor\\/[^/]+/, "/editor"), jobs.length ? "jobs: " + jobs.join(", ") : "", playing, document.hidden ? "hidden" : ""].filter(Boolean).join(" · "), j: all.map((j) => ({ id: j.id, kind: j.kind, title: j.title })) }; } catch (e) { return { s: location.pathname, j: [] }; } })()`;
function watchFreezes(win) {
	const wc = win.webContents;
	let generation = 0;
	let pending = 0;
	let warned = false;
	let lastState = "";
	let lastTick = Date.now();
	let stood = 0;
	const bump = () => {
		generation++;
		pending = 0;
		warned = false;
	};
	wc.on("did-start-loading", bump);
	wc.on("render-process-gone", bump);
	const timer = setInterval(() => {
		const now = Date.now();
		// this timer runs every second: a gap of seconds is the whole app standing still
		if (now - lastTick > 2500) {
			const gap = now - lastTick - 1000;
			stood += gap;
			studioLog(`[sleep] the app stood still for ${(gap / 1000).toFixed(0)} s (the Mac slept or the app was stopped)`);
		}
		lastTick = now;
		if (win.isDestroyed()) return clearInterval(timer);
		if (pending) {
			if (!warned && now - pending - (stood - pendingStood) > 10000) {
				warned = true;
				studioLog(`[hang] the editor window has not answered for 10 s · ${lastState || "?"}`);
			}
			return;
		}
		if (wc.isLoading() || wc.isCrashed()) return;
		const gen = generation;
		const sent = Date.now();
		pending = sent;
		pendingStood = stood;
		wc.executeJavaScript(PAGE_STATE, false)
			.then((answer) => {
				if (gen !== generation) return;
				const state = String(answer?.s ?? "");
				win.__gzRunningJobs = Array.isArray(answer?.j) ? answer.j : [];
				const ms = Date.now() - sent - (stood - pendingStood);
				pending = 0;
				warned = false;
				if (ms > FREEZE_MS) studioLog(`[hang] the editor window froze for ${(ms / 1000).toFixed(1)} s · ${lastState || "?"}${state && state !== lastState ? ` → ${state}` : ""}`);
				lastState = String(state ?? "");
			})
			.catch(() => {
				if (gen === generation) pending = 0;
			});
	}, 1000);
	let pendingStood = 0;
	timer.unref?.();
	win.on("closed", () => clearInterval(timer));
}

// A reload (the server, the graphics process or the page itself restarted) ends what the page was doing: those jobs
// are not left to vanish — after the reload each one says it stopped and why (the page's job list, localised here).
const RELOAD_WHY = {
	server: ["Gaziyav's engine restarted while this ran. Start it again.", "Движок Gaziyav перезапустился, пока это шло. Запустите ещё раз."],
	gpu: ["The graphics process restarted while this ran. Start it again.", "Графический процесс перезапустился, пока это шло. Запустите ещё раз."],
	gpuRepeat: ["The graphics process stopped several times in a minute. Gaziyav stays open; if the preview stays blank, restart Gaziyav.", "Графический процесс упал несколько раз за минуту. Газияв работает дальше; если просмотр пустой — перезапустите Газияв."],
	page: ["The editor reloaded after a crash while this ran. Start it again.", "Редактор перезагрузился после сбоя, пока это шло. Запустите ещё раз."],
};
async function reloadTelling(win, why) {
	if (win.isDestroyed()) return;
	// The server came back, and an export runs in the page (it needs the server only to hand the file over): the
	// export goes on to its end first, then the page reloads — the film is not thrown away for a server restart.
	if (why === "server" && (win.__gzRunningJobs || []).some((j) => j?.id === "export")) {
		studioLog("[studio] the server restarted during an export: the page reloads after it");
		const t0 = Date.now();
		while (!win.isDestroyed() && Date.now() - t0 < 30 * 60_000) {
			await new Promise((r) => setTimeout(r, 2000));
			const running = await Promise.race([win.webContents.executeJavaScript(`(window.__studioJobs?.store.getState().jobs || []).some((j) => j.id === "export" && j.status === "running")`).catch(() => false), new Promise((r) => setTimeout(() => r(false), 5000))]);
			if (!running) break;
		}
		if (win.isDestroyed()) return;
		win.__gzRunningJobs = (win.__gzRunningJobs || []).filter((j) => j?.id !== "export");
	}
	const lost = (win.__gzRunningJobs || []).filter((j) => j && j.id);
	win.__gzRunningJobs = [];
	// the graphics process keeps dying: one line says so even when nothing ran
	if (why === "gpu" && gpuLosses.length >= 3) lost.push({ id: "gpu-lost", kind: "other", title: menuLang() === "ru" ? "Графика" : "Graphics", repeat: true });
	const wc = win.webContents;
	wc.reload();
	if (!lost.length) return;
	studioLog(`[studio] reloaded (${why}) during: ${lost.map((j) => j.id).join(", ")}`);
	const text = RELOAD_WHY[why][menuLang() === "ru" ? 1 : 0];
	wc.once("did-finish-load", async () => {
		for (let i = 0; i < 40 && !win.isDestroyed(); i++) {
			const ok = await wc
				.executeJavaScript(`(() => { const c = window.__studioJobs?.jobCenter; if (!c) return false; for (const j of ${JSON.stringify(lost)}) c.upsert(j.id, { kind: ["lipsync","voice","montage","youtube","transcribe","export","other"].includes(j.kind) ? j.kind : "other", title: j.title || "", status: "error", message: j.repeat ? ${JSON.stringify(RELOAD_WHY.gpuRepeat[menuLang() === "ru" ? 1 : 0])} : ${JSON.stringify(text)} }); return true; })()`)
				.catch(() => false);
			if (ok) return;
			await new Promise((r) => setTimeout(r, 500));
		}
	});
}

function createWindow() {
	const bounds = savedBounds();
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 900,
		...(bounds ?? {}),
		minWidth: 720,
		minHeight: 600,
		title: "Gaziyav",
		backgroundColor: themeBackground(),
		show: false,
		// Traffic lights sit inside the editor header; the page leaves room for them.
		titleBarStyle: IS_MAC ? "hiddenInset" : "default",
		trafficLightPosition: { x: 14, y: 11 }, // CapCut 9.5: the window buttons centred in a 36 px title bar
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			sandbox: true,
			spellcheck: false,
			backgroundThrottling: false,
			// Cache compiled editor JS from the first run on (faster editor start).
			v8CacheOptions: "bypassHeatCheck",
			// Previews (link dialog, sounds, clips) start with sound as soon as Play is pressed.
			autoplayPolicy: "no-user-gesture-required",
			additionalArguments: [],
		},
	});
	if (prefs.maximized) mainWindow.maximize();
	const win = mainWindow;
	const wc = win.webContents;
	watchFreezes(win);
	let shown = false;
	// Tests run hidden; STUDIO_TEST_SHOW=1 shows the window without focus (real frames for performance runs).
	const showInTest = TEST && process.env.STUDIO_TEST_SHOW === "1";
	const show = () => {
		if (shown || (TEST && !showInTest) || win.isDestroyed()) return;
		shown = true;
		if (showInTest) {
			win.showInactive();
			// A visible test window takes no real pointer (tlc C1c): the OS's own moves at the real cursor's place were mixed
			// into the test's CDP input (a move with no button ended a trim there) and the owner's clicks could land in it.
			// CDP input still reaches the page.
			win.setIgnoreMouseEvents(true);
			// lane's window steps aside from the others by its debug port instead of all lying on one spot.
			const lane = (Number(process.env.STUDIO_DEBUG_PORT) || 0) % 16;
			try { win.setPosition(16 + lane * 52, 30 + lane * 24); } catch {}
		} else win.show();
	};
	win.once("ready-to-show", show);
	wc.on("did-finish-load", () => {
		if (isInternal(wc.getURL())) show();
		// Pinch never zooms the whole UI (the timeline gets its own ctrl+wheel zoom events).
		wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
		wc.setZoomLevel(0);
		markFullscreen();
	});
	win.on("closed", () => {
		if (mainWindow === win) mainWindow = null;
		letMacSleep();
	});

	// A crashed or hung editor must never leave a blank or frozen window. The project is
	// autosaved, so reloading the page brings the user back to it.
	let restartingRenderer = false;
	let lastRendererCrash = 0;
	const reloadEditor = () => {
		if (win.isDestroyed()) return;
		restartingRenderer = false;
		reloadTelling(win, "page");
	};
	// Page errors, panel crashes ("[panel:…] crashed") and route crashes land in the crash log too.
	wc.on("console-message", (...args) => {
		const e = args[0];
		const level = typeof args[1] === "number" ? ["verbose", "info", "warning", "error"][args[1]] : e?.level;
		const message = typeof args[2] === "string" ? args[2] : e?.message;
		if (level !== "error" || !message) return;
		studioLog("[page]", String(message).slice(0, 3000), e?.sourceId ? `(${String(e.sourceId).split("/").pop()}:${e.lineNumber})` : "");
	});
	wc.on("render-process-gone", (_event, details) => {
		letMacSleep();
		console.error(`[studio] editor process gone: ${details.reason} (exit code ${details.exitCode})`);
		studioLog(`[studio] editor process gone: ${details.reason} (exit code ${details.exitCode}) at ${wc.getURL()}`);
		if (details.reason === "clean-exit" || win.isDestroyed()) return;
		if (restartingRenderer || TEST) return reloadEditor();
		const repeated = Date.now() - lastRendererCrash < 20000;
		lastRendererCrash = Date.now();
		dialog
			.showMessageBox(win, {
				type: "error",
				message: "The editor stopped unexpectedly",
				detail: repeated
					? "It happened again right after reloading. Your project is saved; try closing heavy effects or restarting the app."
					: details.reason === "oom"
						? "It ran out of memory. Your project is saved and the editor will reload."
						: "Your project is saved and the editor will reload.",
				buttons: ["Reload"],
			})
			.catch(() => {})
			.finally(reloadEditor);
	});
	let unresponsiveDialogOpen = false;
	wc.on("responsive", () => studioLog("[studio] editor responds again"));
	wc.on("unresponsive", () => {
		console.error("[studio] editor is not responding");
		studioLog(`[studio] editor is not responding at ${wc.getURL()}`);
		if (TEST || unresponsiveDialogOpen || win.isDestroyed()) return;
		unresponsiveDialogOpen = true;
		dialog
			.showMessageBox(win, {
				type: "warning",
				message: "The editor is not responding",
				detail: "You can wait, or reload the editor. Your project is saved automatically.",
				buttons: ["Wait", "Reload"],
				defaultId: 0,
				cancelId: 0,
			})
			.then(({ response }) => {
				if (response !== 1 || win.isDestroyed()) return;
				restartingRenderer = true;
				// A hung page cannot reload itself: end it, then the crash handler reloads it.
				if (typeof wc.forcefullyCrashRenderer === "function") wc.forcefullyCrashRenderer();
				else reloadEditor();
			})
			.catch(() => {})
			.finally(() => {
				unresponsiveDialogOpen = false;
			});
	});

	// Remember size and position.
	const rememberBounds = () => {
		if (win.isDestroyed() || win.isFullScreen()) return;
		prefs.maximized = win.isMaximized();
		if (!prefs.maximized) prefs.bounds = win.getNormalBounds();
		savePrefs();
	};
	win.on("resized", rememberBounds);
	win.on("moved", rememberBounds);

	const markFullscreen = () => {
		if (win.isDestroyed()) return;
		const on = win.isFullScreen();
		wc.executeJavaScript(`document.documentElement.toggleAttribute("data-fullscreen", ${on})`).catch(() => {});
	};
	win.on("enter-full-screen", markFullscreen);
	win.on("leave-full-screen", markFullscreen);

	// Closing saves the open project first (and refreshes its thumbnail), then closes for real.
	let closeReady = false;
	win.on("close", (event) => {
		rememberBounds();
		if (closeReady || !serverReady || wc.isCrashed()) return;
		event.preventDefault();
		closeReady = true;
		// The page writes a recovery journal first, so a short wait is safe even if the save is slow.
		const timeout = new Promise((r) => setTimeout(r, 2500));
		Promise.race([wc.executeJavaScript("window.__studioBeforeClose ? window.__studioBeforeClose() : null"), timeout])
			.catch(() => {})
			.finally(() => {
				if (!win.isDestroyed()) win.close();
			});
	});
	// The page has already saved by then: never get stuck on "unsaved changes" when closing or quitting.
	wc.on("will-prevent-unload", (event) => event.preventDefault());

	// in Safari/Chrome, which would carry a work link past the VPN into the Mac's own history. The owner's own edition
	wc.setWindowOpenHandler(({ url }) => {
		if (!isInternal(url) && /^https?:/.test(url)) openOutside(url);
		return { action: "deny" };
	});
	// Files dropped where the editor doesn't take them must never replace the editor with the file.
	wc.on("will-navigate", (event, url) => {
		if (isInternal(url)) return;
		event.preventDefault();
		if (/^https?:/.test(url)) openOutside(url);
	});
	// The website's landing page is not part of the app: always land on the projects list.
	wc.on("did-navigate", (_e, url) => {
		if (url === `${ORIGIN}/`) wc.loadURL(`${ORIGIN}/projects`);
	});
	// Page zoom is a browser thing: ignore ctrl+wheel zoom requests (the timeline handles its own zoom).
	wc.on("zoom-changed", () => wc.setZoomLevel(0));

	// Right click: only our own menus; text fields get the native edit menu.
	wc.on("context-menu", (_event, params) => {
		if (TEST) testState.contextMenus.push({ editable: params.isEditable, x: params.x, y: params.y });
		if (!params.isEditable) return;
		const f = params.editFlags;
		const menu = Menu.buildFromTemplate([
			{ label: L("Undo"), enabled: f.canUndo, click: () => wc.undo() },
			{ label: L("Redo"), enabled: f.canRedo, click: () => wc.redo() },
			{ type: "separator" },
			{ label: L("Cut"), enabled: f.canCut, click: () => wc.cut() },
			{ label: L("Copy"), enabled: f.canCopy, click: () => wc.copy() },
			{ label: L("Paste"), enabled: f.canPaste, click: () => wc.paste() },
			{ type: "separator" },
			{ label: L("Select All"), enabled: f.canSelectAll, click: () => wc.selectAll() },
		]);
		if (!TEST || win.isVisible()) menu.popup({ window: win });
	});

	// The window shows at once with the splash; the projects page replaces it when the server is up.
	if (serverReady) wc.loadURL(`${ORIGIN}/projects`);
	else wc.loadURL(splashURL()).catch(() => {});
	return win;
}

function openOutside(link) {
	if (TEST) return void (testState.externalLinks ??= []).push(link);
	shell.openExternal(String(link)).catch(() => {});
}

function ensureWindow() {
	if (!mainWindow) createWindow();
	return mainWindow;
}

// ---------- Menus ----------

// Menu commands go to the page first (it knows whether a text field or the timeline has focus);
// what the page doesn't take falls back to the native action.
const NATIVE_FALLBACK = {
	undo: (wc) => wc.undo(),
	redo: (wc) => wc.redo(),
	cut: (wc) => wc.cut(),
	copy: (wc) => wc.copy(),
	paste: (wc) => wc.paste(),
	selectAll: (wc) => wc.selectAll(),
	projects: (wc) => wc.loadURL(`${ORIGIN}/projects`),
	"new-project": (wc) => wc.loadURL(`${ORIGIN}/projects`),
};

async function command(name, event) {
	const win = ensureWindow();
	if (!win || !serverReady) return;
	const wc = win.webContents;
	const viaKey = !!event?.triggeredByAccelerator;
	let handled = false;
	try {
		// userGesture: lets the page open a file picker in response to the menu.
		handled = !!(await wc.executeJavaScript(
			`window.__studioMenu ? window.__studioMenu(${JSON.stringify(name)}, ${viaKey}) : false`,
			true,
		));
	} catch {}
	if (TEST) testState.menuResults.push({ name, viaKey, handled });
	if (!handled) NATIVE_FALLBACK[name]?.(wc);
}

const item = (id, label, accelerator, extra = {}) => ({
	id,
	label,
	accelerator,
	click: (_menuItem, _window, event) => command(id, event),
	...extra,
});

// ---------- Menu language (Settings → General → Language; the page tells us, else the Mac's language) ----------

const MENU_RU = {
	"About Gaziyav": "О программе Gaziyav", "Settings…": "Настройки…", "Hide Gaziyav": "Скрыть Gaziyav", "Hide Others": "Скрыть остальные",
	"Show All": "Показать все", "Quit Gaziyav": "Завершить Gaziyav", File: "Файл", "New Project": "Новый проект", "Import Media…": "Импортировать медиа…",
	"Add from YouTube…": "Добавить с YouTube…", "Import from Link (YouTube)…": "Импорт по ссылке (YouTube)…", "Close Project": "Закрыть проект", "Export…": "Экспортировать…", "All Projects": "Все проекты", "Close Window": "Закрыть окно", Edit: "Правка",
	Undo: "Отменить", Redo: "Повторить", Cut: "Вырезать", Copy: "Копировать", Paste: "Вставить", "Select All": "Выделить всё", View: "Вид",
	Appearance: "Оформление", Dark: "Тёмное", Light: "Светлое", System: "Как в системе", "Enter Full Screen": "Перейти в полноэкранный режим", Window: "Окно",
	Minimize: "Свернуть", Zoom: "Изменить масштаб", "Bring All to Front": "Все окна — на передний план", Help: "Справка",
	"Keyboard Shortcuts": "Сочетания клавиш", "Lock Gaziyav": "Заблокировать Gaziyav", "Lock When the Mac Locks or Sleeps": "Блокировать вместе с Mac (экран, сон)", "Reload (development)": "Перезагрузить (разработка)", "Developer Tools": "Инструменты разработчика",
};
// The language the page shows (any of src/i18n/languages.ts with words in modules/i18n/<code>.json); the older
// code reads menuLang(): "ru" for every language but English (Russian is the fallback).
const shellI18n = require("./modules/i18n");
function menuCode() {
	if (shellI18n.has(prefs.language)) return prefs.language;
	return app.getLocale().toLowerCase().startsWith("ru") ? "ru" : "en";
}
function menuLang() {
	return menuCode() === "en" ? "en" : "ru";
}
const L = (label) => {
	const code = menuCode();
	return code === "en" ? label : (shellI18n.word(code, label) ?? MENU_RU[label] ?? label);
};

function buildMenu() {
	// About Gaziyav: name, version and the open-source / service credits (the only place besides Settings → API keys).
	app.setAboutPanelOptions({
		applicationName: "Gaziyav",
		applicationVersion: app.getVersion(),
		copyright: "© Gaziyav",
		credits:
			"Built on OpenCut (MIT, © OpenCut contributors). Fonts: Golos Text, Unbounded (OFL). FFmpeg (LGPL), yt-dlp (Unlicense), whisper.cpp (MIT), GL Transitions (MIT), Fluent Emoji (MIT). AI layers: Remotion. AI services on your own key: fal.ai (LatentSync, Sync, Qwen3-TTS, MiniMax, Seedream, Seedance, PixVerse, OpenRouter)." +
			"",
	});
	const template = [
		{
			label: app.name,
			submenu: [
				{ role: "about", label: L("About Gaziyav") },
				{ type: "separator" },
				item("keys", L("Settings…"), "CmdOrCtrl+,"),
				{ type: "separator" },
				...(WORKSPACE ? workspace.menuItems(L) : []),
				{ role: "hide", label: L("Hide Gaziyav") },
				{ role: "hideOthers", label: L("Hide Others") },
				{ role: "unhide", label: L("Show All") },
				{ type: "separator" },
				{ role: "quit", label: L("Quit Gaziyav") },
			],
		},
		{
			label: L("File"),
			submenu: [
				item("new-project", L("New Project"), "CmdOrCtrl+N"),
				item("import", L("Import Media…"), "CmdOrCtrl+I"),
				item("youtube", L("Import from Link (YouTube)…"), "CmdOrCtrl+Shift+Y"),
				item("export", L("Export…"), "CmdOrCtrl+E"),
				{ type: "separator" },
				// the keys the page's keymap gives them (presets.ts): one key per command, the menu shows the one that works
				item("projects", L("All Projects"), "Alt+CmdOrCtrl+Q"),
				{ type: "separator" },
				// ⌘W, the Mac's document-app rule: in the editor it closes the PROJECT (back to Home), at Home the window
				item("close-project", L("Close Project"), "CmdOrCtrl+W", { visible: false, enabled: false }),
				{ id: "close-window", role: "close", label: L("Close Window") },
			],
		},
		{
			label: L("Edit"),
			submenu: [
				item("undo", L("Undo"), "CmdOrCtrl+Z"),
				item("redo", L("Redo"), "Shift+CmdOrCtrl+Z"),
				{ type: "separator" },
				item("cut", L("Cut"), "CmdOrCtrl+X"),
				item("copy", L("Copy"), "CmdOrCtrl+C"),
				item("paste", L("Paste"), "CmdOrCtrl+V"),
				item("selectAll", L("Select All"), "CmdOrCtrl+A"),
			],
		},
		{
			label: L("View"),
			submenu: [
				// (light / dark lives in one place: Settings → Themes)
				{ role: "togglefullscreen", label: L("Enter Full Screen") },
			],
		},
		{
			label: L("Window"),
			role: "windowMenu",
			submenu: [
				{ role: "minimize", label: L("Minimize") },
				{ role: "zoom", label: L("Zoom") },
				{ type: "separator" },
				{ role: "front", label: L("Bring All to Front") },
			],
		},
		{
			label: L("Help"),
			role: "help",
			submenu: [
				item("shortcuts", L("Keyboard Shortcuts"), "CmdOrCtrl+/"),
				...(DEV
					? [
							{ type: "separator" },
							{ role: "reload", label: L("Reload (development)") },
							{ role: "toggleDevTools", label: L("Developer Tools") },
						]
					: []),
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
	setMenuContext("projects");
}

// Editor-only items are greyed out on the projects page.
function setMenuContext(context) {
	const menu = Menu.getApplicationMenu();
	if (!menu) return;
	// (YouTube adds to a project's Media; the shortcut table belongs to the editor; All Projects is Home itself)
	for (const id of ["import", "export", "youtube", "shortcuts", "projects"]) {
		const entry = menu.getMenuItemById(id);
		if (entry) entry.enabled = context === "editor";
	}
	// ⌘W: Close Project in the editor, Close Window at Home (only one of the two is live)
	const project = menu.getMenuItemById("close-project");
	const closeWindow = menu.getMenuItemById("close-window");
	if (project) project.visible = project.enabled = context === "editor";
	if (closeWindow) closeWindow.visible = closeWindow.enabled = context !== "editor";
}

// ---------- Messages from the page ----------

function fromApp(event) {
	const url = event.senderFrame?.url ?? "";
	return isInternal(url);
}

// Settings → General → Language: the menus follow the page's language.
// ---------- The fal.ai key: encrypted with the Mac's Keychain (Electron safeStorage), handed to the server ----------
// Self-tests keep a stand-in key in their own profile (the Keychain of the Mac is never touched by a test copy).
const falKeyFile = () => path.join(app.getPath("userData"), TEST ? "fal-key.test.txt" : "fal-key.bin");

function readFalKey() {
	try {
		const raw = fs.readFileSync(falKeyFile());
		if (TEST) return raw.toString("utf8").trim() || null;
		if (!safeStorage.isEncryptionAvailable()) return null;
		return safeStorage.decryptString(raw).trim() || null;
	} catch {
		return null;
	}
}

function sendFalKey() {
	try {
		server?.postMessage({ type: "fal-key", key: readFalKey() ?? "" });
	} catch {}
}

ipcMain.handle("gaziyav:fal-key-set", (event, value) => {
	if (!fromApp(event)) return { ok: false, error: "Refused" };
	const key = String(value ?? "").trim().replace(/^(Key|Bearer)\s+/i, "");
	if (!key || /\s/.test(key) || key.length < 16 || key.length > 400) return { ok: false, error: "That doesn't look like a whole fal.ai key. Copy it again." };
	try {
		if (TEST) fs.writeFileSync(falKeyFile(), key, { mode: 0o600 });
		else {
			if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "The Mac's Keychain isn't available. Unlock it and try again." };
			fs.writeFileSync(falKeyFile(), safeStorage.encryptString(key), { mode: 0o600 });
		}
		fs.chmodSync(falKeyFile(), 0o600);
	} catch (error) {
		return { ok: false, error: `The key couldn't be saved: ${String(error?.message ?? error)}` };
	}
	sendFalKey();
	return { ok: true };
});

ipcMain.handle("gaziyav:fal-key-clear", (event) => {
	if (!fromApp(event)) return { ok: false };
	fs.rmSync(falKeyFile(), { force: true });
	sendFalKey();
	return { ok: true };
});

// ---------- The Late key (Share → Post through Late's API): kept like the fal.ai key, handed to the server ----------
const lateKeyFile = () => path.join(app.getPath("userData"), TEST ? "late-key.test.txt" : "late-key.bin");

function readLateKey() {
	try {
		const raw = fs.readFileSync(lateKeyFile());
		if (TEST) return raw.toString("utf8").trim() || null;
		if (!safeStorage.isEncryptionAvailable()) return null;
		return safeStorage.decryptString(raw).trim() || null;
	} catch {
		return null;
	}
}

function sendLateKey() {
	try {
		server?.postMessage({ type: "late-key", key: readLateKey() ?? "" });
	} catch {}
}

// Save asks Late first (the server does the request, through the stand-in in self-tests): a key Late refuses is never
// kept — it was saved and shown as «Key saved …0000».
const lateChecks = new Map();
let lateCheckId = 0;
function checkLateKey(key) {
	return new Promise((resolve) => {
		const id = `check-${++lateCheckId}`;
		const done = (r) => {
			clearTimeout(timer);
			lateChecks.delete(id);
			resolve(r?.ok === true ? { ok: true } : { ok: false, error: String(r?.error || "Late didn't accept this key."), detail: r?.detail ? String(r.detail).slice(0, 500) : undefined });
		};
		const timer = setTimeout(() => done({ ok: false, error: "Late didn't answer in time. Check the internet connection and try again." }), 25_000);
		lateChecks.set(id, done);
		try {
			server.postMessage({ type: "late-key-check", id, key });
		} catch {
			done({ ok: false, error: "Gaziyav's local server is not responding. Restart Gaziyav." });
		}
	});
}

ipcMain.handle("gaziyav:late-key-set", async (event, value) => {
	if (!fromApp(event)) return { ok: false, error: "Refused" };
	const key = String(value ?? "").trim().replace(/^Bearer\s+/i, "");
	if (!key || /\s/.test(key) || key.length < 16 || key.length > 400) return { ok: false, error: "That doesn't look like a whole Late API key. Copy it again." };
	const check = await checkLateKey(key);
	if (!check.ok) return check;
	try {
		if (TEST) fs.writeFileSync(lateKeyFile(), key, { mode: 0o600 });
		else {
			if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "The Mac's Keychain isn't available. Unlock it and try again." };
			fs.writeFileSync(lateKeyFile(), safeStorage.encryptString(key), { mode: 0o600 });
		}
		fs.chmodSync(lateKeyFile(), 0o600);
	} catch (error) {
		return { ok: false, error: `The key couldn't be saved: ${String(error?.message ?? error)}` };
	}
	sendLateKey();
	return { ok: true };
});

ipcMain.handle("gaziyav:late-key-clear", (event) => {
	if (!fromApp(event)) return { ok: false };
	fs.rmSync(lateKeyFile(), { force: true });
	sendLateKey();
	return { ok: true };
});

// Connect (Settings → Share): Late's connect URL — the platform's own sign-in and permission screen — in a Gaziyav
// window; Late sends it back to ${ORIGIN}/api/share/late/done?connected=…|error=…, and the window closes by itself.
// Self-tests: the platform's page comes from the stand-in (STUDIO_FAKE_NET serves /<host>/<path>).
const LATE_PARTITION = "persist:late-connect";
let lateConnectWindow = null;
ipcMain.handle("gaziyav:late-connect", async (event, value) => {
	if (!fromApp(event)) return { ok: false, error: "Refused" };
	let start = String(value ?? "");
	if (!/^https:\/\//.test(start)) return { ok: false, error: "Late didn't give a sign-in page. Try again." };
	const fakeNet = TEST ? (process.env.STUDIO_FAKE_NET || "").replace(/\/$/, "") : "";
	if (fakeNet) {
		const u = new URL(start);
		start = `${fakeNet}/${u.host}${u.pathname}${u.search}`;
	}
	if (lateConnectWindow && !lateConnectWindow.isDestroyed()) lateConnectWindow.close();
	const ses = session.fromPartition(LATE_PARTITION);
	await vpn.applyToSession(ses);
	// Google and Meta refuse sign-in in a page that calls itself an embedded app: the plain Chrome user agent.
	ses.setUserAgent(ses.getUserAgent().replace(/\s*(Electron|Gaziyav)\/\S+/g, ""));
	const win = new BrowserWindow({
		width: 560,
		height: 760,
		title: "Connect · Gaziyav",
		show: !TEST,
		parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
		webPreferences: { partition: LATE_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
	});
	lateConnectWindow = win;
	win.webContents.setWindowOpenHandler(() => ({ action: "allow", overrideBrowserWindowOptions: { show: !TEST, webPreferences: { partition: LATE_PARTITION, contextIsolation: true, sandbox: true } } }));
	const done = `${ORIGIN}/api/share/late/done`;
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			if (TEST) (testState.lateConnect ??= []).push(result);
			resolve(result);
			setTimeout(() => {
				if (!win.isDestroyed()) win.close();
			}, 50);
		};
		const check = (url) => {
			if (typeof url !== "string" || !url.startsWith(done)) return;
			const q = new URL(url).searchParams;
			const error = q.get("error");
			finish(error ? { ok: false, error, message: (q.get("error_message") || "").slice(0, 300) } : { ok: true, platform: q.get("connected") || "", username: (q.get("username") || "").slice(0, 120) });
		};
		win.webContents.on("will-redirect", (e, url) => check(e?.url || url));
		win.webContents.on("will-navigate", (e, url) => check(e?.url || url));
		win.webContents.on("did-navigate", (_e, url) => check(url));
		win.on("closed", () => {
			if (lateConnectWindow === win) lateConnectWindow = null;
			if (!settled) {
				settled = true;
				if (TEST) (testState.lateConnect ??= []).push({ ok: false, closed: true });
				resolve({ ok: false, closed: true });
			}
		});
		win.loadURL(start).catch(() => {});
	});
});

ipcMain.on("studio:language", (event, value) => {
	if (fromApp(event)) workspace.rememberLanguage(value === "en" ? "en" : shellI18n.has(value) ? "ru" : value);
	if (!fromApp(event) || !shellI18n.has(value) || prefs.language === value) return;
	prefs.language = value;
	savePrefs();
	buildMenu();
});

// Settings → General → Appearance (same as View → Appearance).
ipcMain.on("studio:theme", (event, value) => {
	if (!fromApp(event) || !["dark", "light", "system"].includes(value)) return;
	prefs.theme = value;
	savePrefs();
	applyTheme();
	buildMenu();
});

ipcMain.on("studio:context", (event, context) => {
	if (fromApp(event)) setMenuContext(String(context));
});

// Dock progress bar while an export or a lipsync runs.
ipcMain.on("studio:progress", (event, value) => {
	if (!fromApp(event) || !mainWindow) return;
	const p = typeof value === "number" && Number.isFinite(value) ? (value > 1 ? 2 : Math.max(0, value)) : -1;
	if (TEST) testState.progress.push(p);
	mainWindow.setProgressBar(p);
	// While the bar shows (an export, a lipsync), the Mac does not go to sleep; the screen still may.
	if (p >= 0 && awakeBlock === null) awakeBlock = powerSaveBlocker.start("prevent-app-suspension");
	else if (p < 0) letMacSleep();
});
let awakeBlock = null;
/** The window that ran the job is gone (closed, its page crashed): nothing keeps the Mac awake any more. */
function letMacSleep() {
	if (awakeBlock === null) return;
	powerSaveBlocker.stop(awakeBlock);
	awakeBlock = null;
}

// "Show in Finder" for a file the app saved.
ipcMain.on("studio:reveal", (event, file) => {
	if (!fromApp(event) || typeof file !== "string" || !path.isAbsolute(file) || !fs.existsSync(file)) return;
	// Finder would open the hidden decrypted volume and remember it in «Recent Folders», readable after the lock.
	if (insideSpace(file)) return;
	shell.showItemInFolder(file);
});

// ───────────────────────── Share → Post through the sites ─────────────────────────
// Connect opens the site's own sign-in in a Share window (its own lasting browser session, «persist:share», shared by
// YouTube, Instagram and TikTok; Gaziyav never sees a password). A post opens the site's upload page in that window
// and runs the site's recipe (apps/web/src/share/sites/*.ts, read from the server) over the window's DevTools protocol:
// the file into the page's file input, the title and caption typed, the buttons clicked, the link read back. A step
// that finds nothing leaves the window open with what is already filled in, and the sheet says what to press.
// Self-tests: STUDIO_SHARE_SITES=http://127.0.0.1:<port> serves stand-in sites as /<host>/<path>.
const SHARE_SITES = TEST ? (process.env.STUDIO_SHARE_SITES || "").replace(/\/$/, "") : "";
const SHARE_PARTITION = "persist:share";
const shareUrl = (u) => {
	if (!SHARE_SITES) return u;
	try {
		const x = new URL(u);
		return `${SHARE_SITES}/${x.host}${x.pathname}${x.search}`;
	} catch {
		return u;
	}
};
let shareSessionValue = null;
function shareSession() {
	if (!shareSessionValue) {
		shareSessionValue = session.fromPartition(SHARE_PARTITION);
		// The sites see a plain Chrome (Google refuses sign-ins from browsers that call themselves Electron).
		shareSessionValue.setUserAgent(shareSessionValue.getUserAgent().replace(/\s*(Electron|Gaziyav)\/\S+/g, ""));
	}
	return shareSessionValue;
}
const shareAccountsFile = () => path.join(app.getPath("userData"), "share-accounts.json");
function readShareAccounts() {
	try {
		return JSON.parse(fs.readFileSync(shareAccountsFile(), "utf8"));
	} catch {
		return {};
	}
}
function writeShareAccounts(a) {
	fs.writeFileSync(shareAccountsFile(), JSON.stringify(a), { mode: 0o600 });
}
let shareRecipeCache = null;
async function shareRecipes() {
	if (shareRecipeCache && Date.now() - shareRecipeCache.at < 60_000) return shareRecipeCache.sites;
	const r = await fetch(`${ORIGIN}/api/share/sites`);
	const sites = await r.json();
	shareRecipeCache = { at: Date.now(), sites };
	return sites;
}
async function shareSignedIn(recipe) {
	const cookies = await shareSession().cookies.get({ url: shareUrl(recipe.signedIn.url) });
	return cookies.some((c) => recipe.signedIn.cookies.includes(c.name) && c.value);
}

/** A Share window (a child of the editor's window: above it, never blocking it). */
const shareWindows = new Map();
function openShareWindow(key, title) {
	const old = shareWindows.get(key);
	if (old && !old.isDestroyed()) {
		old.show();
		old.focus();
		return old;
	}
	const win = new BrowserWindow({
		width: 1180,
		height: 860,
		minWidth: 960,
		minHeight: 640,
		title,
		show: !TEST,
		parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
		webPreferences: { partition: SHARE_PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
	});
	// Sign-in pop-ups (Google, «Continue with…») open as windows of the same session.
	win.webContents.setWindowOpenHandler(() => ({ action: "allow", overrideBrowserWindowOptions: { show: !TEST, webPreferences: { partition: SHARE_PARTITION, contextIsolation: true, sandbox: true } } }));
	shareWindows.set(key, win);
	win.on("closed", () => {
		if (shareWindows.get(key) === win) shareWindows.delete(key);
	});
	return win;
}

// What runs in the site's page: the first visible match of a recipe's finds (shadow roots included).
const SHARE_FIND = `(finds) => {
	const all = [];
	const walk = (root) => { for (const el of root.querySelectorAll('*')) { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
	walk(document);
	const roots = [document, ...all.filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
	const visible = (e) => {
		if (e.tagName === 'INPUT' && e.type === 'file') return true;
		const r = e.getBoundingClientRect();
		const st = getComputedStyle(e);
		return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
	};
	const own = (e) => (e.innerText ?? e.textContent ?? '').trim();
	const CLICKABLE = 'button,a,input,[role=button],[role=menuitem],[role=radio],[role=link],[role=tab],[contenteditable=true],tp-yt-paper-radio-button,ytcp-button,tp-yt-paper-item';
	for (const f of finds) {
		let hits = [];
		if (f.css) for (const r of roots) { try { hits.push(...r.querySelectorAll(f.css)); } catch {} }
		if (f.text) { const re = new RegExp(f.text, 'i'); hits.push(...all.filter((e) => { const t = own(e); return t.length < 120 && re.test(t); })); }
		if (f.aria) { const re = new RegExp(f.aria, 'i'); hits.push(...all.filter((e) => re.test(e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('aria-placeholder') || e.getAttribute('alt') || ''))); }
		hits = hits.filter(visible);
		if (!hits.length) continue;
		return hits.find((e) => e.matches(CLICKABLE)) || hits[hits.length - 1];
	}
	return null;
}`;
const SHARE_TEXT = `(() => { const parts = [document.body ? document.body.innerText : '']; const walk = (root) => { for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { parts.push(el.shadowRoot.textContent || ''); walk(el.shadowRoot); } }; walk(document); return parts.join('\\n'); })()`;

class ShareStepError extends Error {}

function sharePage(win) {
	const wc = win.webContents;
	if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
	const send = (method, params = {}) => wc.debugger.sendCommand(method, params);
	const alive = () => !win.isDestroyed();
	const find = async (finds) => {
		const r = await send("Runtime.evaluate", { expression: `(${SHARE_FIND})(${JSON.stringify(finds)})`, returnByValue: false });
		return r.result && r.result.subtype !== "null" && r.result.objectId ? r.result.objectId : null;
	};
	const on = (objectId, fn) => send("Runtime.callFunctionOn", { objectId, functionDeclaration: fn, returnByValue: true }).then((r) => r.result.value);
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	/** Waits (20 s unless told otherwise) for a match; `enabled`: also not disabled. */
	const waitFor = async (finds, timeout = 20000, enabled = false) => {
		const t0 = Date.now();
		while (alive() && Date.now() - t0 < timeout) {
			const id = await find(finds).catch(() => null);
			if (id && (!enabled || !(await on(id, "function () { return !!(this.disabled || this.getAttribute('aria-disabled') === 'true' || this.hasAttribute('disabled')); }").catch(() => true)))) return id;
			await sleep(500);
		}
		return null;
	};
	const click = async (objectId) => {
		const box = await on(objectId, "function () { this.scrollIntoView({ block: 'center', inline: 'center' }); const r = this.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }");
		await sleep(150);
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
	};
	const type = async (objectId, text) => {
		await click(objectId);
		await on(objectId, "function () { this.focus(); }");
		await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: process.platform === "darwin" ? 4 : 2, commands: ["selectAll"] });
		await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: process.platform === "darwin" ? 4 : 2 });
		// A text field takes the line breaks as they are; a caption editor (contenteditable) gets each line typed and a
		// line break between them, the way the site's own editor makes one.
		const plain = await on(objectId, "function () { return this.tagName === 'TEXTAREA' || this.tagName === 'INPUT'; }").catch(() => false);
		const lines = plain ? [String(text)] : String(text).split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (i > 0) await send("Runtime.evaluate", { expression: "document.execCommand('insertLineBreak')" });
			if (lines[i]) await send("Input.insertText", { text: lines[i] });
		}
	};
	const text = async () => (await send("Runtime.evaluate", { expression: SHARE_TEXT, returnByValue: true })).result.value || "";
	return { send, find, on, waitFor, click, type, text, alive, sleep };
}

/** The account's name and picture from the signed-in site. */
async function shareProfile(recipe, win) {
	const page = sharePage(win);
	const pr = recipe.profile;
	let name = "";
	let avatar = "";
	try {
		if (pr.json) {
			const j = await page.send("Runtime.evaluate", { expression: `fetch(${JSON.stringify(shareUrl(pr.json.url))}, { credentials: 'include' }).then((r) => r.json())`, awaitPromise: true, returnByValue: true });
			const pick = (o, p) => p.split(".").reduce((v, k) => (v == null ? v : v[k]), o);
			name = String(pick(j.result.value, pr.json.name) || "");
			avatar = String((pr.json.avatar && pick(j.result.value, pr.json.avatar)) || "");
		} else {
			await win.loadURL(shareUrl(pr.url)).catch(() => {});
			const id = await page.waitFor(pr.name, 12000);
			if (id) name = String((await page.on(id, "function () { return (this.innerText || this.getAttribute('alt') || this.getAttribute('title') || this.getAttribute('aria-label') || '').trim(); }")) || "");
			if (pr.strip) name = name.replace(new RegExp(pr.strip, "i"), "").trim();
			const pic = pr.avatar ? await page.find(pr.avatar).catch(() => null) : null;
			if (pic) avatar = String((await page.on(pic, "function () { return this.currentSrc || this.src || ''; }")) || "");
		}
	} catch {}
	if (name && recipe.id !== "youtube" && !name.startsWith("@")) name = `@${name}`;
	return { name: name || `${recipe.name} account`, avatar: /^https?:/.test(avatar) ? avatar : undefined };
}

ipcMain.handle("studio:share-accounts", async (event) => {
	if (!fromApp(event)) return null;
	const sites = await shareRecipes().catch(() => null);
	if (!sites) return null;
	const saved = readShareAccounts();
	const out = {};
	for (const [id, recipe] of Object.entries(sites)) {
		const on = await shareSignedIn(recipe).catch(() => false);
		out[id] = on ? { connected: true, name: saved[id]?.name || `${recipe.name} account`, avatar: saved[id]?.avatar } : { connected: false };
	}
	return out;
});

ipcMain.handle("studio:share-connect", async (event, site) => {
	if (!fromApp(event)) return null;
	const recipe = (await shareRecipes())[String(site)];
	if (!recipe) return { connected: false, error: "Unknown service." };
	const win = openShareWindow(`login:${recipe.id}`, `${recipe.name} · Gaziyav`);
	if (!(await shareSignedIn(recipe))) await win.loadURL(shareUrl(recipe.login)).catch(() => {});
	const t0 = Date.now();
	while (!win.isDestroyed() && Date.now() - t0 < 15 * 60_000) {
		if (await shareSignedIn(recipe).catch(() => false)) {
			// On disk now: a quit right after signing in must not lose it.
			await shareSession().cookies.flushStore().catch(() => {});
			const profile = await shareProfile(recipe, win);
			const saved = readShareAccounts();
			saved[recipe.id] = { ...profile, at: Date.now() };
			writeShareAccounts(saved);
			if (!win.isDestroyed()) win.close();
			return { connected: true, ...profile };
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	if (!win.isDestroyed()) win.close();
	return { connected: false };
});

ipcMain.handle("studio:share-disconnect", async (event, site) => {
	if (!fromApp(event)) return null;
	const recipe = (await shareRecipes())[String(site)];
	if (!recipe) return false;
	const ses = shareSession();
	for (const origin of recipe.origins) {
		const at = shareUrl(`${origin}/`);
		for (const c of await ses.cookies.get({ url: at }).catch(() => [])) await ses.cookies.remove(at, c.name).catch(() => {});
		// The stand-in sites share one origin in the self-tests: their storage stays (cookies are what signs in).
		if (!SHARE_SITES) await ses.clearStorageData({ origin }).catch(() => {});
	}
	await ses.cookies.flushStore().catch(() => {});
	const saved = readShareAccounts();
	delete saved[recipe.id];
	writeShareAccounts(saved);
	return true;
});

ipcMain.handle("studio:share-show", (event, postId) => {
	if (!fromApp(event)) return false;
	const win = shareWindows.get(`post:${String(postId)}`);
	if (!win || win.isDestroyed()) return false;
	win.show();
	win.focus();
	return true;
});

const shareApi = (route, body) =>
	fetch(`${ORIGIN}/api/share/${route}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify(body) }).then((r) => r.json());

/** One post through its site; reports every step. */
async function sharePost(post) {
	const report = (r) => shareApi("report", { id: post.id, ...r }).catch(() => {});
	const recipe = (await shareRecipes())[post.platform];
	if (!recipe) return report({ state: "failed", error: "Unknown service." });
	if (!post.file || !fs.existsSync(post.file)) return report({ state: "failed", error: "The exported video for this post is gone. Post it again from the project." });
	if (!(await shareSignedIn(recipe).catch(() => false))) return report({ state: "failed", error: `Gaziyav isn't signed in to ${recipe.name}. Press Connect, then Retry.` });
	const win = openShareWindow(`post:${post.id}`, `${recipe.name} · ${post.title || "Post"} · Gaziyav`);
	const page = sharePage(win);
	const user = String(readShareAccounts()[recipe.id]?.name || "").replace(/^@/, "");
	const steps = recipe.upload;
	const publishAt = steps.findIndex((s) => s.do === "publish");
	const signedOut = new RegExp(recipe.signedOutUrl, "i");
	const value = (field) => (field === "title" ? post.title || post.caption.split("\n")[0] || "Video" : post.caption);
	let failedAt = null;
	for (let i = 0; i < steps.length; i++) {
		const s = steps[i];
		if (win.isDestroyed()) return report({ state: "failed", error: "The window was closed before the post was published. Press Retry." });
		void report({ state: "uploading", progress: (i / steps.length) * 0.9, stage: `${recipe.name}: ${s.label}` });
		const stepStart = Date.now();
		try {
			if (s.do === "goto") {
				await win.loadURL(shareUrl(s.url)).catch(() => {});
				if (signedOut.test(win.webContents.getURL())) {
					win.close();
					return report({ state: "failed", error: `${recipe.name} signed Gaziyav out. Press Connect, then Retry.` });
				}
				continue;
			}
			if (s.do === "wait") {
				const t0 = Date.now();
				let ok = false;
				while (page.alive() && Date.now() - t0 < stepLimit(s.timeout ?? 20000)) {
					if (s.text && new RegExp(s.text, "i").test(await page.text().catch(() => ""))) ok = true;
					if (!ok && s.find && (await page.find(s.find).catch(() => null))) ok = true;
					if (ok) break;
					await page.sleep(700);
				}
				if (!ok && !s.optional) throw new ShareStepError(s.label);
				continue;
			}
			const finds = s.do === "privacy" ? s.options[post.privacy] || s.options.public : s.find;
			const id = await page.waitFor(finds, stepLimit(s.timeout ?? (s.optional ? 5000 : 20000)), s.do === "publish");
			if (!id) {
				if (s.optional) continue;
				throw new ShareStepError(s.label);
			}
			if (s.do === "file") await page.send("DOM.setFileInputFiles", { objectId: id, files: [post.file] });
			else if (s.do === "type") await page.type(id, value(s.value));
			else await page.click(id);
			await page.sleep(s.do === "file" ? 1500 : 700);
		} catch (error) {
			failedAt = { step: s, index: i, error };
			// What the page showed when the step failed, for the next recipe fix (never the caption or the file).
			const seen = (await page.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
			studioLog(`[share] ${recipe.name}: step «${s.label}» (${s.do}) failed after ${Math.round((Date.now() - stepStart) / 1000)} s — ${error?.message || error}; url ${win.isDestroyed() ? "-" : win.webContents.getURL()}; page: ${seen}`);
			break;
		}
	}
	const publishLabel = publishAt >= 0 ? steps[publishAt].label : "Post";
	if (failedAt) {
		void report({
			state: "manual",
			stage:
				failedAt.index <= publishAt
					? `Gaziyav couldn't find «${failedAt.step.label}» on ${recipe.name}. Finish in the ${recipe.name} window: check the fields, then press ${publishLabel}.`
					: `Check the ${recipe.name} window: it hasn't confirmed the post yet.`,
		});
	}
	// Published when the page says so (also when the person finished it in the window).
	const d = recipe.done;
	const t0 = Date.now();
	const limit = failedAt ? 60 * 60_000 : stepLimit(d.timeout);
	while (page.alive() && Date.now() - t0 < limit) {
		const seen = (d.text && new RegExp(d.text, "i").test(await page.text().catch(() => ""))) || (d.find && (await page.find(d.find).catch(() => null)));
		if (seen) {
			let link = "";
			if (d.link) {
				const a = await page.waitFor(d.link, 5000);
				if (a) link = String((await page.on(a, "function () { return this.href || this.innerText || ''; }")) || "");
			}
			const url = /^https?:\/\//.test(link) ? link : user ? d.fallbackUrl.replace("{user}", user) : d.fallbackUrl.replace(/\{user\}\/?.*$/, "");
			await report({ state: "done", url, stage: failedAt ? `Finished in the ${recipe.name} window` : undefined });
			setTimeout(() => {
				if (!win.isDestroyed()) win.close();
			}, TEST ? 200 : 4000);
			return;
		}
		await page.sleep(1000);
	}
	if (!page.alive()) return report({ state: "failed", error: "The window was closed before the post was published. Press Retry." });
	await report({ state: "manual", stage: `Check the ${recipe.name} window: it hasn't confirmed the post. If it's posted, close the window.` });
}

let sharing = false;
setInterval(async () => {
	if (sharing || !serverReady) return;
	sharing = true;
	try {
		const { posts } = await shareApi("due");
		for (const post of posts || []) {
			if (!(await shareApi("claim", { id: post.id })).ok) continue;
			await sharePost(post).catch((error) => shareApi("report", { id: post.id, state: "failed", error: `The post stopped: ${error?.message || error}` }));
		}
	} catch {
	} finally {
		sharing = false;
	}
}, 2000).unref();

// Share (the editor's Share button): the Mac's own Share menu — AirDrop, Messages, Mail… — for a saved export.
// "missing" when the file was moved or deleted since, so the page can say so.
ipcMain.handle("studio:share", (event, file) => {
	if (!fromApp(event) || typeof file !== "string" || !path.isAbsolute(file)) return "missing";
	if (!fs.existsSync(file)) return "missing";
	if (TEST) testState.shared.push(file);
	else if (IS_MAC && mainWindow) new ShareMenu({ filePaths: [file] }).popup({ window: mainWindow });
	else shell.showItemInFolder(file);
	return "shared";
});

// A folder picker for settings (On-device AI → My library folder).
ipcMain.handle("studio:pick-folder", async (event, title) => {
	if (!fromApp(event)) return null;
	const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
	const result = await dialog.showOpenDialog(win, { title: String(title || "Choose a folder"), properties: ["openDirectory"] });
	return result.canceled ? null : (result.filePaths[0] ?? null);
});

// Exports written to disk as they are encoded, and every file the editor saves through a dialog: modules/export-ipc.js
// (a file is never written under its final name; a journal remembers exports in flight; room is counted per volume).
let exportFiles = null;
// Each folder carries the pid of the app that made it («Gaziyav-export-<pid>-…»): a crash, a force quit or a power loss
// in the middle of a long export left its file (gigabytes, one more per retry) in the Mac's temp folder for good. At the
// start the folders of apps that no longer run go — never one of a running copy (the user's app and test copies share
// the temp folder).
const EXPORT_TEMP = /^Gaziyav-export-(\d+)-/;
const OLD_EXPORT_TEMP = /^Gaziyav-export-[A-Za-z0-9]{6}$/;
function sweepExportTemps() {
	const dir = app.getPath("temp");
	let names = [];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return;
	}
	for (const name of names) {
		const pid = Number(EXPORT_TEMP.exec(name)?.[1] ?? 0);
		if (!pid && OLD_EXPORT_TEMP.test(name)) {
			// Made by a build before the pid was in the name (mkdtemp's six random characters): no owner to ask, so only a
			// folder nothing has touched for a day goes — a running export (the user's app may be an older build) keeps
			// writing into its folder, which moves its newest file's time forward.
			try {
				const full = path.join(dir, name);
				const newest = Math.max(fs.statSync(full).mtimeMs, ...fs.readdirSync(full).map((f) => fs.statSync(path.join(full, f)).mtimeMs));
				if (Date.now() - newest < 24 * 3600 * 1000) continue;
			} catch {
				continue;
			}
			studioLog(`[studio] removing the temp file of an old export cut short: ${name}`);
			fs.promises.rm(path.join(dir, name), { recursive: true, force: true }).catch(() => {});
			continue;
		}
		if (!pid || pid === process.pid) continue;
		let running = true;
		try {
			process.kill(pid, 0);
		} catch (error) {
			running = error?.code === "EPERM";
		}
		if (running) continue;
		studioLog(`[studio] removing the temp file of an export cut short: ${name}`);
		fs.promises.rm(path.join(dir, name), { recursive: true, force: true }).catch(() => {});
	}
}

// Gaziyav AI's eyes: a picture of part of the window (the preview frame, the timeline) exactly as the user sees it,
// as a JPEG data URL no taller than maxHeight. Only the app's own page may ask.
ipcMain.handle("studio:capture", async (event, rect) => {
	if (!fromApp(event)) return null;
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || win.isDestroyed()) return null;
	const n = (v) => Math.max(0, Math.round(Number(v) || 0));
	const area = rect && Number(rect.width) > 0 && Number(rect.height) > 0 ? { x: n(rect.x), y: n(rect.y), width: n(rect.width), height: n(rect.height) } : undefined;
	try {
		const image = await win.webContents.capturePage(area);
		if (image.isEmpty()) return null;
		const maxHeight = Math.min(1440, Math.max(120, n(rect?.maxHeight) || 720));
		const scaled = image.getSize().height > maxHeight ? image.resize({ height: maxHeight, quality: "good" }) : image;
		return `data:image/jpeg;base64,${scaled.toJPEG(82).toString("base64")}`;
	} catch {
		return null;
	}
});

// A finished AI generation dragged out of Media → Generate like a file from Finder: dropped on the timeline or into
// Media it is imported the usual way. Only files the app saved itself (…/ai-results/) can be dragged.
ipcMain.on("studio:start-drag", (event, file) => {
	if (!fromApp(event) || typeof file !== "string") return;
	const real = path.resolve(file);
	if (!real.includes(`${path.sep}ai-results${path.sep}`) || !/\.(mp4|mov|webm|png|jpe?g|webp|gif|mp3|wav|m4a|ogg)$/i.test(real) || !fs.existsSync(real)) return;
	let icon = /\.(png|jpe?g|webp|gif)$/i.test(real) ? nativeImage.createFromPath(real) : nativeImage.createEmpty();
	if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(process.resourcesPath, "electron.icns"));
	if (icon.isEmpty()) icon = nativeImage.createFromNamedImage("NSImageNameMultipleDocuments");
	event.sender.startDrag({ file: real, icon: icon.resize({ width: 96 }) });
});

// A finished job while the user is in another app: bounce the Dock icon and show a notification.
ipcMain.on("studio:notify", (event, payload) => {
	if (!fromApp(event) || !mainWindow) return;
	const title = String(payload?.title ?? "").slice(0, 120);
	// macOS keeps every notification in its own database, outside the space: with the space in use only the kind of
	// event goes there («Export done»), never what it was about (a file or project name, an error with a path)
	const body = workspace.isActive() ? "" : String(payload?.body ?? "").slice(0, 300);
	if (TEST) {
		testState.notifications.push({ title, body, focused: mainWindow.isFocused() });
		return;
	}
	if (mainWindow.isFocused()) return;
	if (IS_MAC) app.dock?.bounce("informational");
	if (Notification.isSupported()) {
		const note = new Notification({ title, body });
		note.on("click", () => {
			mainWindow?.show();
			mainWindow?.focus();
		});
		note.show();
	}
});

// ---------- App lifecycle ----------

// A test app is never seen by the owner (the lead, 11.11): no Dock icon, and a click on the Dock or a second launch
// never brings its window forward (one surfaced on his screen mid-day). STUDIO_TEST_SHOW=1 keeps the old behaviour.
const HIDDEN_TEST = TEST && process.env.STUDIO_TEST_SHOW !== "1";
if (HIDDEN_TEST && process.platform === "darwin") app.whenReady().then(() => app.dock?.hide());

app.on("second-instance", () => {
	if (HIDDEN_TEST) return;
	if (workspace.isLocked()) return undefined;
	const win = ensureWindow();
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
});

app.on("activate", () => {
	if (HIDDEN_TEST || !serverReady || workspace.isLocked()) return;
	const win = ensureWindow();
	win.show();
});

app.on("before-quit", () => {
	quitting = true;
});

app.on("will-quit", () => {
	vpn.stop();
	server?.kill();
	reaper.stop();
	exportFiles?.quit();
});

// Mac apps keep running without windows (click the Dock icon to reopen); tests just quit.
// GPU / utility process crashes are logged (Chromium restarts the GPU process by itself).
// The GPU process died (a driver fault, a kill): Chromium starts a new one, but the editor's WebGPU device went with
// the old one and the player stayed blank, exports failed. The page reloads into the same project (its edits are
// saved), as after an editor crash; a third loss within a minute stops that (Chromium then draws without the GPU).
const gpuLosses = [];
app.on("child-process-gone", (_event, details) => {
	console.error(`[studio] ${details.type} process gone: ${details.reason} (exit code ${details.exitCode})`);
	studioLog(`[studio] ${details.type}${details.name ? ` (${details.name})` : ""} process gone: ${details.reason} (exit code ${details.exitCode})`);
	if (details.type !== "GPU" || details.reason === "clean-exit" || quitting) return;
	const now = Date.now();
	while (gpuLosses.length && now - gpuLosses[0] > 60_000) gpuLosses.shift();
	gpuLosses.push(now);
	// every loss reloads the page (its WebGPU device went with the process); losses in a row wait a little longer
	const wait = gpuLosses.length >= 3 ? 3000 : 500;
	if (gpuLosses.length >= 3) studioLog(`[studio] the GPU process was lost ${gpuLosses.length} times in a minute; the app stays open`);
	setTimeout(() => {
		for (const win of BrowserWindow.getAllWindows()) reloadTelling(win, "gpu");
	}, wait);
});

app.on("window-all-closed", () => {
	// tests quit with their last window (no stray app), unless one checks the Mac's own way (mac-native: ⌘W, then the Dock)
	if (!IS_MAC || quitting || (TEST && process.env.STUDIO_TEST_STAY !== "1")) app.quit();
});

// Exported videos and every other file saved from the editor: a save dialog that starts in Movies — or in the work
// space's Export folder while it is open: the Mac's Movies folder is outside the encryption — and one rename into the
// chosen place when the file is whole (tests save straight to a folder). modules/export-ipc.js.
function handleDownloads() {
	// The editor's long jobs, one small file each (modules/jobs-journal.js): a kill loses none.
	jobsJournal.register({ fromApp });
	exportFiles = exportIpc.register({
		test: TEST,
		fromApp,
		ensureWindow,
		window: () => mainWindow,
		insideSpace,
		exportDir: () => (workspace.isUnlocked() ? path.join(workspace.dataRoot(), "Workspace", "Export") : app.getPath("videos")),
		lang: menuLang,
		log: studioLog,
	});
}
function insideSpace(file) {
	if (!workspace.isUnlocked()) return false;
	const root = `${path.resolve(workspace.dataRoot())}${path.sep}`;
	return path.resolve(String(file || "")).startsWith(root);
}

/**
 * Opened straight from the disk image (read-only, and gone once it is ejected): one question, then Gaziyav moves
 * itself to Applications and relaunches from there. Kept anywhere else on the Mac, it is left where it is.
 */
function offerMoveToApplications() {
	if (TEST || !app.isPackaged || app.isInApplicationsFolder()) return false;
	const where = app.getAppPath();
	if (!where.startsWith("/Volumes/") && !where.includes("/AppTranslocation/")) return false;
	const choice = dialog.showMessageBoxSync({
		type: "question",
		message: "Move Gaziyav to Applications?",
		detail: "It is running from the disk image.",
		buttons: ["Move to Applications", "Not Now"],
		defaultId: 0,
		cancelId: 1,
	});
	if (choice !== 0) return false;
	try {
		return app.moveToApplicationsFolder();
	} catch (error) {
		studioLog(`[studio] move to Applications failed: ${error?.message ?? error}`);
		return false;
	}
}

/**
 * A copy downloaded from the internet has the quarantine flag on every file inside, and macOS kills a flagged tool
 * the app starts (ffmpeg, whisper, uv, Python…) — SIGKILL, no message. The user has opened Gaziyav by now, so its
 * own files are cleared once, before anything runs. Not possible from the disk image (read-only): it moves first.
 */
function clearOwnQuarantine() {
	if (!app.isPackaged) return;
	const bundle = path.resolve(process.execPath, "..", "..", "..");
	if (bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/")) return;
	const flagged = (p) => spawnSync("/usr/bin/xattr", ["-p", "com.apple.quarantine", p], { stdio: "ignore" }).status === 0;
	if (!flagged(bundle) && !flagged(path.join(process.resourcesPath, "bin", "ffmpeg"))) return;
	const r = spawnSync("/usr/bin/xattr", ["-dr", "com.apple.quarantine", bundle], { stdio: "ignore", timeout: 120000 });
	studioLog(`[studio] cleared the download flag from ${bundle} (${r.status === 0 ? "ok" : `status ${r.status}`})`);
}

/**
 * The first run of a freshly installed yt-dlp waits while macOS checks its libraries (~8 s, once per install);
 * done here in the background, at low priority, so the user's first YouTube search or link answers at once.
 */
/**
 * macOS memory pressure (Resources/bin/mempressure, event-driven): on «warning» and «critical» the editor drops every
 * cache it can rebuild and the page's HTTP cache goes, before the system has to kill anything on an 8 GB Mac.
 */
function memoryPressure(level) {
	studioLog(`[studio] memory pressure: ${level}`);
	if (TEST) (testState.memoryPressure ??= []).push(level);
	if (level === "warning" || level === "critical") session.defaultSession.clearCache().catch(() => {});
	for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send("studio:memory-pressure", level);
}
/**
 * The app in the background (perf round B): every window hidden or minimised, or another app in front for a minute —
 * the editor's media caches shrink by half (platform/memory-budget.ts); in front again they refill as frames show.
 * The same channel, levels «background» / «foreground». Hidden test apps never send it (a test sends it itself).
 */
let backgroundTimer = null;
function watchBackground() {
	if (HIDDEN_TEST) return;
	const away = () => BrowserWindow.getAllWindows().every((w) => w.isDestroyed() || !w.isVisible() || w.isMinimized());
	const set = (on, delay = 0) => {
		clearTimeout(backgroundTimer);
		backgroundTimer = setTimeout(() => memoryPressure(on ? "background" : "foreground"), delay);
	};
	const hook = (win) => {
		for (const ev of ["minimize", "hide"]) win.on(ev, () => away() && set(true));
		for (const ev of ["restore", "show"]) win.on(ev, () => set(false));
	};
	BrowserWindow.getAllWindows().forEach(hook);
	app.on("browser-window-created", (_event, win) => hook(win));
	app.on("did-resign-active", () => set(true, 60_000));
	app.on("did-become-active", () => set(false));
}
function watchMemoryPressure() {
	watchBackground();
	const bin = path.join(process.resourcesPath, "bin", "mempressure");
	if (!app.isPackaged || !fs.existsSync(bin)) return;
	try {
		const child = require("node:child_process").spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] });
		child.on("error", () => {});
		let pending = "";
		child.stdout.on("data", (chunk) => {
			pending += chunk;
			const lines = pending.split("\n");
			pending = lines.pop();
			for (const line of lines) if (/^(normal|warning|critical)$/.test(line.trim())) memoryPressure(line.trim());
		});
	} catch {}
}
if (TEST) globalThis.__studioTest.memoryPressure = memoryPressure;

/**
 * macOS thermal state (Resources/bin/thermal, event-driven): the server pauses every model while the Mac is hot
 * (serious, critical: SIGSTOP) and continues them when it cools (POST /api/ondevice/thermal); the page shows the pause
 * in its job list (studio:thermal). STUDIO_FAKE_THERMAL=serious|… is the level at start (tests, a dev Mac that never
 * heats); in test mode __studioTest.thermal(level) is the same report.
 */
let thermalLevel = null;
function thermal(level) {
	if (!/^(nominal|fair|serious|critical)$/.test(level) || level === thermalLevel) return;
	thermalLevel = level;
	studioLog(`[studio] thermal: ${level}`);
	if (TEST) (testState.thermal ??= []).push(level);
	fetch(`${ORIGIN}/api/ondevice/thermal`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify({ level }) }).catch(() => {});
	for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send("studio:thermal", level);
}
function watchThermal() {
	const fake = String(process.env.STUDIO_FAKE_THERMAL || "").trim().toLowerCase();
	if (fake) {
		thermal(fake);
		return;
	}
	const bin = path.join(process.resourcesPath, "bin", "thermal");
	if (!app.isPackaged || !fs.existsSync(bin)) return;
	try {
		const child = require("node:child_process").spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] });
		child.on("error", () => {});
		let pending = "";
		child.stdout.on("data", (chunk) => {
			pending += chunk;
			const lines = pending.split("\n");
			pending = lines.pop();
			for (const line of lines) thermal(line.trim());
		});
	} catch {}
}
if (TEST) globalThis.__studioTest.thermal = thermal;

/**
 * The Force Touch trackpad's tap (Resources/bin/haptic, NSHapticFeedbackManager): the page asks for one with
 * studioApp.haptic(kind) when a snap engages, a guide aligns, a trim reaches its end or a drop lands (src/haptics, which
 * rate-limits and honours Settings → General → Trackpad feedback). One line per tap to the helper's stdin; the helper
 * ends when the pipe closes, so it never outlives the app. In test mode the helper also writes each tap with its time
 * to STUDIO_HAPTIC_LOG (default <STUDIO_TEST_OUT>/haptic.log).
 */
const HAPTIC_PATTERN = { snap: "alignment", align: "alignment", limit: "level", drop: "generic" };
let hapticChild = null;
let hapticFailures = 0;
function startHaptic() {
	if (hapticChild || hapticFailures > 3 || process.platform !== "darwin") return hapticChild;
	const bin = path.join(process.resourcesPath, "bin", "haptic");
	if (!app.isPackaged || !fs.existsSync(bin)) return null;
	try {
		const env = { ...process.env };
		if (TEST) env.HAPTIC_LOG = process.env.STUDIO_HAPTIC_LOG || (process.env.STUDIO_TEST_OUT ? path.join(process.env.STUDIO_TEST_OUT, "haptic.log") : "");
		else delete env.HAPTIC_LOG;
		const child = require("node:child_process").spawn(bin, [], { stdio: ["pipe", "ignore", "ignore"], env });
		child.on("error", () => {});
		child.stdin.on("error", () => {});
		child.on("exit", () => {
			if (hapticChild === child) hapticChild = null;
			hapticFailures += 1;
		});
		hapticChild = child;
	} catch {}
	return hapticChild;
}
ipcMain.on("studio:haptic", (_event, kind) => {
	const pattern = HAPTIC_PATTERN[kind];
	if (!pattern) return;
	if (TEST) (testState.haptics ??= []).push({ kind, at: Date.now() });
	startHaptic()?.stdin.write(`${pattern} ${kind}\n`);
});
app.on("will-quit", () => {
	try {
		hapticChild?.stdin.end();
	} catch {}
});

/** The space locked with the Mac and that stopped a job (an export, an AI job): said once, after unlocking. */
function tellLockNotice() {
	const notice = workspace.lockNotice?.();
	if (!notice?.cut?.length) return;
	const ru = menuLang() === "ru";
	const why = { sleep: ru ? "Mac ушёл в сон" : "the Mac went to sleep", "screen locked": ru ? "экран Mac заблокировался" : "the Mac's screen locked", screensaver: ru ? "включилась заставка" : "the screensaver started", "another user": ru ? "Mac перешёл к другому пользователю" : "another user took over the Mac" }[notice.reason] ?? notice.reason;
	const message = ru ? "Работа была остановлена" : "A job was stopped";
	const detail = ru ? `Газияв заблокировался, когда ${why}, и остановил то, что выполнялось (${notice.cut.join(", ")}). Проект сохранён — запустите заново.` : `Gaziyav locked when ${why} and stopped what was running (${notice.cut.join(", ")}). Your project is saved — run it again.`;
	if (TEST) {
		(testState.lockNotices ??= []).push({ reason: notice.reason, cut: notice.cut });
		return;
	}
	const win = ensureWindow();
	win.webContents.once("did-finish-load", () => dialog.showMessageBox(win, { type: "info", message, detail, buttons: ["OK"] }).catch(() => {}));
}

function warmYtdlp() {
	if (!app.isPackaged) return;
	// Not carried any more (fetched on the first import by link, without the download flag): nothing to warm then.
	const bin = path.join(process.resourcesPath, "bin", "yt-dlp");
	if (!fs.existsSync(bin)) return;
	try {
		const child = require("node:child_process").spawn("/usr/bin/nice", ["-n", "15", bin, "--version"], { stdio: "ignore", detached: false });
		child.on("error", () => {});
	} catch {}
}

app.whenReady().then(async () => {
	studioLog(`[studio] start ${app.getVersion()} electron ${process.versions.electron}${TEST ? " (test)" : ""}`);
	if (offerMoveToApplications()) return;
	clearOwnQuarantine();
	// Nothing of this bundle left behind: leftovers of the last run go now, a job's orphans every 15 s, and a guard
	// sweeps after a kill -9 of the app (modules/reaper.js).
	if (IS_MAC && app.isPackaged) reaper.start({ bundle: path.resolve(process.execPath, "..", "..", ".."), profile: app.getPath("userData"), log: studioLog });
	if (workspace.isLocked()) return undefined;
	workspace.register({ origin: ORIGIN, log: studioLog });
	loadPrefs();
	workspace.rememberLanguage(prefs.language);
	applyTheme();
	nativeTheme.on("updated", () => mainWindow?.setBackgroundColor(themeBackground()));
	buildMenu();
	handleDownloads();
	sweepExportTemps();
	exportFiles.sweep();
	await vpn.start().catch((error) => studioLog(`[vpn] ${error?.message ?? error}`));
	await vpn.applyToSession(session.defaultSession);
	// The window (and its renderer) warms up while the server starts.
	createWindow();
	// the user's media used where they are, handed to the window as files when a project opens (modules/originals.js)
	require("./modules/originals").register({ log: studioLog, own: [app.getPath("userData")] });
	// «ТВ и кино»: a channel's official page in Safari when it can't play inside Gaziyav (modules/tv.js)
	// edition never loads it (its files stay on disk untouched: modules/edition.js WORKSPACE)
	try {
		await startServer();
	} catch (error) {
		dialog.showErrorBox("Gaziyav could not start", String(error?.message ?? error));
		quitting = true;
		server?.kill();
		app.quit();
		return;
	}
	serverReady = true;
	// (after a restart inside the space: back on the project that was open)
	ensureWindow().webContents.loadURL(`${ORIGIN}${workspace.resumePath() ?? "/projects"}`);
	tellLockNotice();
	warmYtdlp();
	watchMemoryPressure();
	watchThermal();
	startHaptic();
	// The «with models» build: its AI sets itself up in the background (asking for the status starts it).
	if (fs.existsSync(path.join(process.resourcesPath, "seed", "seed.json"))) {
		fetch(`${ORIGIN}/api/ondevice/status`, { headers: { "X-Studio": "1" } }).catch(() => {});
	}
	// The quiet background download of the small AI models (ondevice/background.ts): once a project was ever opened, it
	// continues a couple of minutes after each launch. Asking for its status arms it; nothing shows.
	setTimeout(() => fetch(`${ORIGIN}/api/ondevice/background`, { headers: { "X-Studio": "1" } }).catch(() => {}), 5000).unref?.();
});

