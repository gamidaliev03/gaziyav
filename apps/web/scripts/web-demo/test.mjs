// The proof of Gaziyav in the browser: serves the built site from a sub-path and drives it in a plain sandboxed
// Chromium window (the project's own Electron: no preload, no node integration — only a browser), or in Brave headless
// with a throwaway profile (GZ_BROWSER=brave). Checks: the landing page in English and Russian by browser language;
// the editor opens with the sample; a cut (⌘B), a trim (W), a title, undo / redo change the timeline as the app's
// suites assert; a look switches; an export writes an MP4 with the right frame count (in memory and streamed to a
// file); requests after load (to the server and to any other host); the console; offline start through the worker.
//   node script/web-demo/test.mjs <site dir> [port=4011] [debug port=10011]
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const [SITE, PORT = "4011", DEBUG = "10011"] = process.argv.slice(2);
const BASE = "/gaziyav-test";
const SCRATCH = process.env.GZ_SCRATCH ?? fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-web-"));
const BROWSER = process.env.GZ_BROWSER ?? "electron";
const ELECTRON = process.env.GZ_ELECTRON;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
	results.push({ name, ok: !!ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- the static server (sub-path, ranges), every request logged
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4", ".m4a": "audio/mp4", ".txt": "text/plain" };
const served = [];
let online = true;
const server = http.createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://x");
	served.push({ t: Date.now(), path: url.pathname });
	if (!online) {
		req.socket.destroy();
		return;
	}
	if (!url.pathname.startsWith(`${BASE}/`)) {
		res.writeHead(url.pathname === BASE ? 301 : 404, url.pathname === BASE ? { Location: `${BASE}/` } : {});
		return res.end();
	}
	let file = path.join(SITE, decodeURIComponent(url.pathname.slice(BASE.length)));
	if (!file.startsWith(path.resolve(SITE))) return res.writeHead(403).end();
	if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
		if (!url.pathname.endsWith("/")) {
			res.writeHead(301, { Location: `${url.pathname}/` });
			return res.end();
		}
		file = path.join(file, "index.html");
	}
	if (!fs.existsSync(file)) {
		res.writeHead(404, { "Content-Type": "text/html" });
		return res.end(fs.readFileSync(path.join(SITE, "404.html")));
	}
	const size = fs.statSync(file).size;
	const headers = { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "max-age=600" };
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
	if (range) {
		const start = range[1] ? Number(range[1]) : size - Number(range[2]);
		const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
		res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
		return fs.createReadStream(file, { start, end }).pipe(res);
	}
	res.writeHead(200, { ...headers, "Content-Length": size });
	fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(Number(PORT), "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SITE_URL = `${ORIGIN}${BASE}/`;

// ---- the browser
const profile = path.join(SCRATCH, `profile-${BROWSER}`);
const downloads = path.join(SCRATCH, `downloads-${BROWSER}`);
fs.rmSync(profile, { recursive: true, force: true });
fs.rmSync(downloads, { recursive: true, force: true });
fs.mkdirSync(downloads, { recursive: true });
let child;
if (BROWSER === "brave") {
	child = spawn("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", ["--headless=new", `--user-data-dir=${profile}`, "--no-first-run", `--remote-debugging-port=${DEBUG}`, "about:blank"], { stdio: "ignore" });
} else {
	const main = path.join(SCRATCH, "electron-browser", "main.js");
	fs.mkdirSync(path.dirname(main), { recursive: true });
	fs.writeFileSync(
		main,
		`// A plain browser window: sandboxed, no preload, no node integration. Downloads land in the test folder.
const { app, BrowserWindow, session } = require("electron");
app.commandLine.appendSwitch("remote-debugging-port", ${JSON.stringify(DEBUG)});
app.setPath("userData", ${JSON.stringify(profile)});
app.whenReady().then(() => {
	session.defaultSession.on("will-download", (_e, item) => item.setSavePath(require("path").join(${JSON.stringify(downloads)}, item.getFilename())));
	const w = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
	w.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
`,
	);
	fs.writeFileSync(path.join(path.dirname(main), "package.json"), JSON.stringify({ name: "plain-browser", main: "main.js" }));
	child = spawn(ELECTRON, [path.dirname(main)], { stdio: "ignore" });
}
const stop = () => {
	try {
		child.kill("SIGTERM");
	} catch {}
	server.close();
};
process.on("exit", stop);

async function target() {
	for (let i = 0; i < 80; i++) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
			const page = list.find((t) => t.type === "page");
			if (page) return page.webSocketDebuggerUrl;
		} catch {}
		await sleep(250);
	}
	throw new Error("no browser page");
}

// ---- a tiny CDP client
const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener("message", (m) => {
	const msg = JSON.parse(m.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
	} else for (const l of listeners) l(msg);
});
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = ++seq;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
const evaluate = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`.slice(0, 400));
	return r.result.value;
};
const waitFor = async (expr, ms = 60000, label = expr) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			if (await evaluate(expr)) return true;
		} catch {}
		await sleep(250);
	}
	throw new Error(`timeout: ${label}`);
};
const key = async (code, k, modifiers = 0) => {
	const base = { code, key: k, modifiers, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 };
	await send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(k.length === 1 && !modifiers ? { text: k } : {}) });
	await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
	await sleep(300);
};
const click = async (sel) => {
	const b = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "nearest" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	if (!b) throw new Error(`no ${sel}`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: b.x, y: b.y, button: "left", clickCount: 1 });
	await sleep(350);
};
const META = 4,
	SHIFT = 8;

const consoleErrors = [];
const requests = [];
listeners.push((msg) => {
	if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning"))
		consoleErrors.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200)}`);
	if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(`exception: ${msg.params.exceptionDetails.exception?.description?.slice(0, 200) ?? msg.params.exceptionDetails.text}`);
	if (msg.method === "Log.entryAdded" && (msg.params.entry.level === "error" || msg.params.entry.level === "warning")) consoleErrors.push(`log ${msg.params.entry.level}: ${msg.params.entry.text.slice(0, 200)} ${msg.params.entry.url ?? ""}`);
	if (msg.method === "Network.requestWillBeSent") requests.push({ t: Date.now(), id: msg.params.requestId, url: msg.params.request.url });
	// where each answer came from: the network, or the worker's copy / the browser's cache
	if (msg.method === "Network.responseReceived") {
		const r = msg.params.response;
		const q = requests.find((x) => x.id === msg.params.requestId);
		if (q) q.local = !!(r.fromServiceWorker || r.fromDiskCache || r.fromPrefetchCache || r.fromEarlyHints);
	}
});
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await send("Page.enable");
// headless Brave starts at 800×600: the editor's window size (no extra command-line switch)
if (BROWSER === "brave") await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
if (BROWSER === "brave") await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads }).catch(() => {});
const ua = (await send("Browser.getVersion")).userAgent;
const lang = (l) => send("Network.setUserAgentOverride", { userAgent: ua, acceptLanguage: l, platform: "MacIntel" });
const go = async (url) => {
	await send("Page.navigate", { url });
	await sleep(600);
	await waitFor(`document.readyState === "complete"`, 30000, `load ${url}`);
};
const clearSite = () => send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "all" });

try {
	// ---- 1. the landing page by browser language
	if (process.env.GZ_SKIP_LANDING !== "1") {
	await lang("en-US,en");
	await go(SITE_URL);
	await sleep(500);
	const en = await evaluate(`({ lang: document.documentElement.lang, path: location.pathname, h1: document.querySelector("h1")?.textContent, open: document.querySelector("[data-open-editor]")?.textContent, og: document.querySelector('meta[property="og:image"]')?.content, csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') })`);
	check("landing in English for an English browser", en.lang === "en" && en.path === `${BASE}/` && en.open === "Open the editor" && en.csp && /og-en\.png$/.test(en.og), JSON.stringify(en));
	await clearSite();
	await lang("ru-RU,ru,en");
	await go(SITE_URL);
	await waitFor(`location.pathname.endsWith("/ru/")`, 8000, "redirect to /ru/");
	const ru = await evaluate(`({ lang: document.documentElement.lang, path: location.pathname, open: document.querySelector("[data-open-editor]")?.textContent, og: document.querySelector('meta[property="og:image"]')?.content })`);
	check("landing in Russian for a Russian browser (first visit, remembered)", ru.lang === "ru" && ru.open === "Открыть редактор" && /og-ru\.png$/.test(ru.og), JSON.stringify(ru));
	await click("[data-lang]");
	await sleep(800);
	const switched = await evaluate(`({ lang: document.documentElement.lang, stored: localStorage.getItem("gaziyav.language") })`);
	check("the language switch goes to English and is remembered", switched.lang === "en" && switched.stored === "en", JSON.stringify(switched));
	const landingBytes = await evaluate(`performance.getEntriesByType("resource").concat(performance.getEntriesByType("navigation")).reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0)`);
	check("landing first screen under 300 KB", landingBytes < 300 * 1024, `${Math.round(landingBytes / 1024)} KB transferred`);
	// the landing's own words: the owner's headline, no Windows build offered, the tour link (when there) is not dead
	const words = await evaluate(`({ h1: document.querySelector("h1")?.textContent, win: /windows/i.test([...document.querySelectorAll("a")].map((a) => a.textContent).join(" ")), other: !!/Windows, Linux/.test(document.body.innerText), tours: [...document.querySelectorAll("a[href*='tour/']")].map((a) => a.href) })`);
	const tourOk = [];
	for (const href of [...new Set(words.tours)]) tourOk.push((await fetch(href)).status === 200);
	check("landing: «The video editor, reinvented with AI», no Windows download, the browser line for other computers, tour links live", words.h1 === "The video editor, reinvented with AI" && !words.win && words.other && tourOk.every(Boolean), `${JSON.stringify(words)} ${JSON.stringify(tourOk)}`);
	}

	// ---- 2. the editor opens with the sample (Russian browser: the Russian sample and UI)
	await clearSite();
	await lang("ru-RU,ru");
	consoleErrors.length = 0;
	const t0 = Date.now();
	await go(`${SITE_URL}editor/`);
	await waitFor(`document.documentElement.dataset.demoReady === "1"`, Number(process.env.GZ_READY_MS ?? 180000), "editor ready");
	await waitFor(`!!document.querySelector("[data-timeline-element-id]")`, 30000, "timeline drawn");
	const readyMs = Date.now() - t0;
	await sleep(1500);
	const loadBytes = await evaluate(`performance.getEntriesByType("resource").concat(performance.getEntriesByType("navigation")).reduce((n, e) => n + (e.transferSize || 0), 0)`);
	const ED = "window.__studioBridge.editor()";
	const TR = `${ED}.scenes.getActiveScene().tracks`;
	const S = await evaluate(`window.__studioBridge.ticksPerSecond()`);
	const state = () => evaluate(`(() => { const t = ${TR}; const m = (e) => ({ id: e.id, type: e.type, s: e.startTime / ${S}, d: e.duration / ${S}, text: e.content ?? null }); return { main: t.main.elements.map(m), overlay: t.overlay.flatMap((x) => x.elements.map(m)), audio: t.audio.flatMap((x) => x.elements.map(m)) }; })()`);
	let st = await state();
	check("the editor opens with the sample project (3 clips, voice + music, a title)", st.main.length === 3 && st.audio.length === 2 && st.overlay.some((e) => e.type === "text"), `${readyMs} ms; main ${st.main.length}, audio ${st.audio.length}, overlay ${st.overlay.map((e) => e.type)}`);
	const ui = await evaluate(`({ lang: document.documentElement.lang, file: document.querySelector("[data-demo-file]")?.textContent, export: document.querySelector("[data-demo-export]")?.textContent, demoWord: /\\bdemo\\b|демо/i.test(document.body.innerText), tabs: [...document.querySelectorAll("[data-tab-group]")].map((e) => e.getAttribute("data-tab-group")), title: JSON.stringify(${TR}.overlay.flatMap((x) => x.elements).find((e) => e.type === "text")) })`);
	check("the editor speaks Russian (UI and sample), never says «demo»", ui.lang === "ru" && ui.file === "Файл" && ui.export === "Экспорт" && !ui.demoWord && /Привет/.test(ui.title ?? ""), JSON.stringify(ui));
	check("the panel has no AI generators, no sound library, no captions (AI = one card)", JSON.stringify(ui.tabs) === JSON.stringify(["media", "text", "effects", "avatar"]), JSON.stringify(ui.tabs));
	await click(`[data-tab-group="avatar"]`);
	await sleep(800);
	const lip = await evaluate(`({ beta: document.querySelector("[data-demo-lipsync-beta]")?.innerText.split("\\n")[0], all: document.querySelector("[data-demo-lipsync-beta]")?.innerText.slice(0, 60), key: !!document.querySelector("[data-weblip-key]"), keyStored: Object.keys(localStorage).filter((k) => /lipsync-key/.test(k)).length })`);
	check("AI tab: «Lipsync with your own key — beta», the key panel and the app's lipsync view; no key, nothing sent", /своим ключом|own key/.test(lip.beta ?? "") && /бета|beta/i.test(lip.all ?? "") && lip.key && lip.keyStored === 0, JSON.stringify(lip));
	await click(`[data-tab-group="media"]`);
	const serverAtReady = served.length;
	const requestsAtReady = requests.length;

	// ---- 3. cut, trim, title, undo / redo (the app's own keys, as its timeline suites press them)
	const first = st.main[0];
	await click(`[data-timeline-element-id="${first.id}"]`);
	await evaluate(`${ED}.playback.seek({ time: ${Math.round(2 * S)} })`);
	await sleep(300);
	await key("KeyB", "b", META);
	st = await state();
	check("⌘B cuts the first clip at 2 s (two pieces 0–2, 2–4)", st.main.length === 4 && Math.abs(st.main[0].d - 2) < 0.05 && Math.abs(st.main[1].s - 2) < 0.05, JSON.stringify(st.main.map((e) => [e.s, e.d])));
	await key("KeyZ", "z", META);
	st = await state();
	check("⌘Z undoes the cut", st.main.length === 3, `${st.main.length} clips`);
	await key("KeyZ", "z", META | SHIFT);
	st = await state();
	check("⇧⌘Z redoes it", st.main.length === 4, `${st.main.length} clips`);
	const second = st.main[1];
	await click(`[data-timeline-element-id="${second.id}"]`);
	await evaluate(`${ED}.playback.seek({ time: ${Math.round(3 * S)} })`);
	await sleep(300);
	const lenBefore = (await state()).main.reduce((n, e) => n + e.d, 0);
	await key("KeyW", "w");
	st = await state();
	const lenAfter = st.main.reduce((n, e) => n + e.d, 0);
	check("W trims the selected clip's end to the playhead (the timeline 1 s shorter, closed up)", Math.abs(lenBefore - lenAfter - 1) < 0.05, `${lenBefore.toFixed(2)} → ${lenAfter.toFixed(2)} s`);
	await key("KeyZ", "z", META);
	check("⌘Z gives the trim back", Math.abs((await state()).main.reduce((n, e) => n + e.d, 0) - lenBefore) < 0.05);
	const textsBefore = (await state()).overlay.filter((e) => e.type === "text").length;
	await click(`[data-tab-group="text"]`);
	await waitFor(`!!document.querySelector("[data-assets-panel] [data-tile-add]")`, 10000, "text tiles");
	await click(`[data-assets-panel] [data-tile-add]`);
	await sleep(600);
	const textsAfter = (await state()).overlay.filter((e) => e.type === "text").length;
	check("Text → Add text puts a title on the timeline", textsAfter === textsBefore + 1, `${textsBefore} → ${textsAfter}`);
	await key("KeyZ", "z", META);
	check("⌘Z takes the title away", (await state()).overlay.filter((e) => e.type === "text").length === textsBefore);
	await key("KeyZ", "z", META | SHIFT);

	// ---- 4. a look switches
	const look0 = await evaluate(`[document.documentElement.className, getComputedStyle(document.documentElement).getPropertyValue("--background")].join("|")`);
	await click("[data-demo-looks]");
	await waitFor(`!!document.querySelector("[data-theme-tile]")`, 10000, "theme tiles");
	const tiles = await evaluate(`[...document.querySelectorAll("[data-theme-tile]")].map((e) => e.getAttribute("data-theme-tile"))`);
	await click(`[data-theme-tile="${tiles[tiles.length - 1]}"]`);
	await sleep(600);
	const look1 = await evaluate(`[document.documentElement.className, getComputedStyle(document.documentElement).getPropertyValue("--background")].join("|")`);
	check("Themes: another look changes the window", look1 !== look0, `${tiles.length} looks; ${look0.slice(0, 60)} → ${look1.slice(0, 60)}`);
	await key("Escape", "Escape");
	await sleep(400);
	const tried = await evaluate(`[...document.querySelectorAll("[data-demo-try-step]")].map((e) => e.getAttribute("data-demo-try-step") + "=" + e.getAttribute("data-done"))`);
	check("«Try it in a minute» ticked cut, title and look by itself", ["cut=1", "title=1", "look=1"].every((x) => tried.includes(x)), JSON.stringify(tried));

	// ---- 5. export: in memory → a downloaded file; streamed to a picked file → its bytes
	const fps = await evaluate(`(() => { const f = ${ED}.project.getActive().settings.fps; return typeof f === "number" ? f : f.numerator / f.denominator; })()`);
	const total = await evaluate(`${ED}.timeline.getTotalDuration() / ${S}`);
	const ffFrames = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height", "-of", "csv=p=0", file], { encoding: "utf8" }).trim().split(",").pop());
	const ffSize = (file) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" }).trim();
	await evaluate(`window.showSaveFilePicker = undefined; true`);
	const exportStart = Date.now();
	await evaluate(`document.querySelector("[data-demo-export]").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); true`);
	await waitFor(`!!document.querySelector("[data-demo-export-size]")`, 5000, "export menu");
	const sizes = await evaluate(`[...document.querySelectorAll("[data-demo-export-size]")].map((e) => e.getAttribute("data-demo-export-size"))`);
	await evaluate(`document.querySelector('[data-demo-export-size="1280x720"]').click(); true`);
	await waitFor(`!!window.__demoExport`, 300000, "export done");
	const exp = await evaluate(`({ ...window.__demoExport, buffer: undefined })`);
	const exportMs = Date.now() - exportStart;
	await sleep(1500);
	const file = fs.readdirSync(downloads).find((f) => f.endsWith(".mp4"));
	const expected = Math.round(total * fps);
	if (file) {
		const frames = ffFrames(path.join(downloads, file));
		check("Export → MP4 1280×720 writes a file with every frame", Math.abs(frames - expected) <= 1 && ffSize(path.join(downloads, file)) === "1280,720", `${file}: ${frames} frames (expected ${expected} = ${total.toFixed(2)} s × ${fps}), ${ffSize(path.join(downloads, file))}, ${(exp.bytes / 1024).toFixed(0)} KB in ${(exportMs / 1000).toFixed(1)} s; sizes offered ${JSON.stringify(sizes)}`);
	} else {
		// a headless browser may keep the download to itself: the bytes the page made
		const b64 = await evaluate(`(async () => { const b = new Uint8Array(window.__demoExport.buffer); let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); })()`);
		const out = path.join(downloads, "memory.mp4");
		fs.writeFileSync(out, Buffer.from(b64, "base64"));
		const frames = ffFrames(out);
		check("Export → MP4 1280×720 (the page's bytes; no download folder here)", Math.abs(frames - expected) <= 1, `${frames} frames (expected ${expected}), ${(exp.bytes / 1024).toFixed(0)} KB in ${(exportMs / 1000).toFixed(1)} s`);
	}
	// the streamed path (Chrome / Edge's file picker): a stand-in picker that keeps what the page writes
	await evaluate(`(() => { window.__disk = []; window.__demoExport = null; window.showSaveFilePicker = async () => ({ createWritable: async () => { const parts = []; return { write: async (d) => { if (d && d.type === "write") parts.push([d.position, new Uint8Array(d.data)]); else if (d && d.type === "truncate") parts.length = 0; }, close: async () => { let n = 0; for (const [p, b] of parts) n = Math.max(n, p + b.length); const out = new Uint8Array(n); for (const [p, b] of parts) out.set(b, p); window.__disk = out; }, abort: async () => {} }; } }); return true; })()`);
	await evaluate(`document.querySelector("[data-demo-export]").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); true`);
	await waitFor(`!!document.querySelector("[data-demo-export-size]")`, 5000, "export menu 2");
	await evaluate(`document.querySelector("[data-demo-export-size]").click(); true`);
	await waitFor(`!!window.__demoExport`, 300000, "streamed export done");
	const b64 = await evaluate(`(() => { const b = window.__disk; let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); })()`);
	const streamed = path.join(downloads, "streamed.mp4");
	fs.writeFileSync(streamed, Buffer.from(b64, "base64"));
	const sframes = ffFrames(streamed);
	check("Export streamed to a picked file (any length) has every frame", Math.abs(sframes - expected) <= 1, `${sframes} frames at ${ffSize(streamed)}, ${(fs.statSync(streamed).size / 1024).toFixed(0)} KB`);
	const tried2 = await evaluate(`document.querySelector('[data-demo-try-step="export"]')?.getAttribute("data-done")`);
	check("«Try it in a minute» ticked the export", tried2 === "1");

	// ---- 6. a project file: saved, opened back as a new project with the same timeline
	const fileBack = await evaluate(`(async () => { const ed = ${ED}; await ed.project.saveCurrentProject(); const { projectFileBlob, importProjectFile } = window.__demoProjectFile; const blob = await projectFileBlob(ed.project.getActive().metadata.id); const id = await importProjectFile(blob); const { storageService } = window.__demoStorage; const p = await storageService.loadProject({ id }); const media = await storageService.loadAllMediaAssets({ projectId: id }); return { bytes: blob.size, main: p.project.scenes[0].tracks.main.elements.length, media: media.length }; })()`).catch((e) => ({ error: String(e) }));
	check("Save project file → Open project file brings the same timeline and its media back", fileBack.main === (await state()).main.length && fileBack.media === 5, JSON.stringify(fileBack));

	// ---- 7. requests after load, other hosts, the console
	const after = served.slice(serverAtReady).map((r) => r.path);
	const external = requests.filter((r) => !r.url.startsWith(ORIGIN) && !/^(blob|data|chrome|devtools|about):/.test(r.url));
	const outside = served.filter((r) => !r.path.startsWith(`${BASE}/`) && r.path !== BASE).map((r) => r.path);
	check("nothing asked outside the site's own folder (the paths work under a sub-path)", outside.length === 0, outside.slice(0, 5).join(" "));
	check("no request to any other host, ever", external.length === 0, external.slice(0, 5).map((r) => r.url).join(" "));
	const afterPage = requests.slice(requestsAtReady).filter((r) => r.url.startsWith(ORIGIN));
	const fromNet = afterPage.filter((r) => r.local === false);
	console.log(`INFO first visit: ${fromNet.length} own file(s) fetched from the site after ready (opened before the worker's copy had them)`);
	check(
		"first visit, after load: nothing but the site's own files, and only those the copy had not reached yet",
		fromNet.every((r) => r.url.startsWith(SITE_URL)),
		`page asked ${afterPage.length} own files after ready, ${fromNet.length} over the network ${fromNet.slice(0, 4).map((r) => r.url.replace(SITE_URL, "")).join(" ")}; the server saw ${after.length} after ready (the worker filling its offline copy in the background)`,
	);
	const noisy = consoleErrors.filter((e) => !/Download the React DevTools/.test(e));
	check("nothing in the console", noisy.length === 0, noisy.slice(0, 8).join(" || "));

	// ---- 8. offline: the worker has the site; the server goes away; the editor opens with the project
	if (BROWSER !== "brave" || process.env.GZ_OFFLINE === "1") {
		await waitFor(`navigator.serviceWorker && navigator.serviceWorker.controller !== null`, 120000, "worker in control");
		await waitFor(`(async () => { const k = (await caches.keys()).find((x) => x.startsWith("gz-")); if (!k) return false; const n = (await (await caches.open(k)).keys()).length; return n > 50; })()`, 300000, "worker cache filled");
		const want = JSON.parse(/const FILES = (\[.*?\]);/s.exec(fs.readFileSync(path.join(SITE, "sw.js"), "utf8"))[1]).length;
		const wantList = JSON.parse(/const FILES = (\[.*?\]);/s.exec(fs.readFileSync(path.join(SITE, "sw.js"), "utf8"))[1]);
		await waitFor(`(async () => { const k = (await caches.keys()).find((x) => x.startsWith("gz-")); if (!k) return false; const c = await caches.open(k); const have = new Set((await c.keys()).map((r) => r.url)); const scope = (await navigator.serviceWorker.ready).scope; return ${JSON.stringify(wantList)}.every((f) => have.has(new URL(f, scope).href)); })()`, 300000, "worker copy complete (every listed file)");
		const cached = await evaluate(`(async () => { const k = (await caches.keys()).find((x) => x.startsWith("gz-")); return (await (await caches.open(k)).keys()).length; })()`);
		await sleep(1000);
		// with the copy complete: every panel again, the looks, the export menu — not one request reaches the server
		const s0 = served.length;
		const r0 = requests.length;
		for (const g of ["media", "text", "effects", "avatar", "text"]) await click(`[data-tab-group="${g}"]`);
		await click("[data-demo-looks]");
		await sleep(800);
		await key("Escape", "Escape");
		await sleep(1500);
		const net = requests.slice(r0).filter((r) => r.local === false && /^https?:/.test(r.url));
		check("with the worker's copy in place: 0 requests reach the network (every panel, looks)", served.length - s0 === 0 && net.length === 0, `server ${served.length - s0} ${served.slice(s0, s0 + 5).map((r) => r.path.replace(BASE, "")).join(" ")}, page ${requests.length - r0} asked (${net.length} not marked as the worker's: ${net.slice(0, 3).map((r) => r.url.replace(SITE_URL, "")).join(" ")})`);
		online = false;
		await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
		const before = served.length;
		await send("Page.reload", { ignoreCache: false });
		await sleep(1000);
		await waitFor(`document.documentElement.dataset.demoReady === "1"`, 120000, "offline ready");
		await waitFor(`!!document.querySelector("[data-timeline-element-id]")`, 30000, "offline timeline");
		const offState = await state();
		check("offline: the editor opens from the worker's copy with the project (no server, no network)", offState.main.length >= 3, `${cached} files kept; main ${offState.main.length}; server hits while offline ${served.length - before} (refused)`);
		await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
		online = true;
	}
	console.log(`NUMBERS ready ${readyMs} ms, first load ${(loadBytes / 1048576).toFixed(1)} MB transferred, export ${exp.length?.toFixed?.(1)} s video in ${(exp.seconds ?? 0).toFixed(1)} s`);
} catch (error) {
	check("the run finished", false, String(error?.stack ?? error).slice(0, 600));
	console.log(`console:\n  ${consoleErrors.slice(0, 15).join("\n  ")}`);
	try {
		console.log("probe", JSON.stringify(await evaluate(`({ api: typeof window.__demoApi, calls: window.__demoApi ? window.__demoApi().slice(0, 20) : null, bridge: typeof window.__studioBridge, ready: document.documentElement.dataset.demoReady, booting: !!document.querySelector("[data-demo-booting]"), msg: document.querySelector("[data-demo-message]")?.innerText, scripts: document.querySelectorAll("script[src]").length, res: performance.getEntriesByType("resource").filter((e) => e.responseStatus >= 400 || e.transferSize === 0).map((e) => e.name.split("/").pop() + ":" + e.responseStatus).slice(0, 20) })`)));
	} catch (e) {
		console.log("probe failed", String(e));
	}
	try {
		const shot = await send("Page.captureScreenshot", { format: "png" });
		fs.writeFileSync(path.join(SCRATCH, `fail-${BROWSER}.png`), Buffer.from(shot.data, "base64"));
	} catch {}
} finally {
	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} passed (${BROWSER})`);
	try {
		const shot = await send("Page.captureScreenshot", { format: "png" });
		fs.writeFileSync(path.join(SCRATCH, `last-${BROWSER}.png`), Buffer.from(shot.data, "base64"));
	} catch {}
	ws.close();
	stop();
	process.exit(failed.length ? 1 : 0);
}
