// The lipsync walk of Gaziyav in the browser, on a TEST site (GZ_TEST_PROVIDER, web-demo.sh) against the stand-in
// provider (the desktop's test/fake-fal.mjs behind a cross-origin front that answers CORS like the real hosts) — no real
// key, no real call, ever. In the plain sandboxed Chromium window of test.mjs: no key → nothing sent anywhere; a clip
// selected → the AI tab → words typed → the price shown → run → the take lands on the clip on the timeline and plays;
// a reload in the middle → collected once (the stand-in counts one submission); cancel; a failure → one sentence.
//   GZ_TEST_PROVIDER=http://127.0.0.1:4014 zsh apps/web/scripts/web-demo.sh site <tree>   (the TEST site)
//   GZ_ELECTRON=<Electron> node apps/web/scripts/web-demo/test-lipsync.mjs <test site> [port=4013] [debug=10013] <tree>
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [SITE, PORT = "4013", DEBUG = "10013", TREE_ARG] = process.argv.slice(2);
const TREE = TREE_ARG ?? path.resolve(import.meta.dirname, "../../../..");
const FRONT_PORT = Number(process.env.GZ_FRONT_PORT ?? Number(PORT) + 1);
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

// ---- the stand-in provider (the desktop's own test/fake-fal.mjs) behind a cross-origin front, as the real hosts answer
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const fakeDir = fs.mkdtempSync(path.join(SCRATCH, "fake-"));
const { startFakeFal, FAKE_KEY } = await import(pathToFileURL(process.env.GZ_FAKE_FAL ?? path.join(TREE, "desktop/test/fake-fal.mjs")).href);
const fake = await startFakeFal({ ffmpeg: FFMPEG, dir: fakeDir });
const front = [];
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "86400" };
const frontServer = http.createServer((req, res) => {
	front.push({ method: req.method, url: req.url, auth: req.headers.authorization ? "key" : null, at: Date.now() });
	if (req.method === "OPTIONS") return res.writeHead(204, CORS), res.end();
	const headers = { ...req.headers };
	delete headers.host;
	delete headers.origin;
	const up = http.request(`${fake.url}${req.url}`, { method: req.method, headers }, (r) => {
		res.writeHead(r.statusCode, { ...r.headers, ...CORS });
		r.pipe(res);
	});
	up.on("error", () => (res.writeHead(502, CORS), res.end()));
	req.pipe(up);
});
await new Promise((r) => frontServer.listen(FRONT_PORT, "127.0.0.1", r));
const submits = () => front.filter((r) => r.method === "POST" && /^\/queue\.fal\.run\//.test(r.url));
const lipSubmits = () => submits().filter((r) => /latentsync|lipsync/.test(r.url));

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
	child = spawn("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", ["--headless=new", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${DEBUG}`, "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
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
	const w = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
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
	frontServer.close();
	try {
		fake.close();
	} catch {}
};
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

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
if (BROWSER === "brave") await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads }).catch(() => {});
const ua = (await send("Browser.getVersion")).userAgent;
const lang = (l) => send("Network.setUserAgentOverride", { userAgent: ua, acceptLanguage: l, platform: "MacIntel" });
const go = async (url) => {
	await send("Page.navigate", { url });
	await sleep(600);
	await waitFor(`document.readyState === "complete"`, 30000, `load ${url}`);
};
const clearSite = () => send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "all" });

const ED = "window.__studioBridge.editor()";
const TR = `${ED}.scenes.getActiveScene().tracks`;
const STORE = "window.__studioStore.getState()";
const external = () => requests.filter((r) => !r.url.startsWith(ORIGIN) && !/^(blob|data|about|chrome|devtools):/.test(r.url));
const typeText = async (sel, text) => {
	await click(sel);
	await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select?.(); })()`);
	await send("Input.insertText", { text });
	await sleep(300);
};
const boot = async () => {
	await waitFor(`document.documentElement.dataset.demoReady === "1"`, Number(process.env.GZ_READY_MS ?? 180000), "editor ready");
	await waitFor(`!!document.querySelector("[data-timeline-element-id]")`, 30000, "timeline drawn");
	await sleep(1200);
};

// a control port for finding the way by hand (GZ_EXPLORE=<port>; GZ_EXPLORE_ON_FAIL=1: only after a failure): POST a
// JS expression for the page, or «@» + one for this script; the answer is its value
async function explore() {
	const ctl = http.createServer(async (req, res) => {
		let body = "";
		for await (const c of req) body += c;
		let out;
		try {
			out = body.startsWith("@") ? eval(body.slice(1)) : await evaluate(body);
			if (out instanceof Promise) out = await out;
		} catch (e) {
			out = { error: String(e) };
		}
		res.end(JSON.stringify(out, null, 1));
	});
	ctl.listen(Number(process.env.GZ_EXPLORE), "127.0.0.1");
	console.log(`EXPLORE on ${process.env.GZ_EXPLORE}`);
	await new Promise(() => {});
}

try {
	await clearSite();
	await lang("ru-RU,ru");
	await go(`${SITE_URL}editor/`);
	await boot();
	check("the test site routes lipsync to the stand-in only", (await evaluate("window.__gzTestProvider ?? ''")) === `http://127.0.0.1:${FRONT_PORT}`);
	if (process.env.GZ_EXPLORE && !process.env.GZ_EXPLORE_ON_FAIL) await explore();
	// ---- helpers: the timeline by media name, the clip's runs, the stand-in's lipsync submissions
	const tl = () => evaluate(`(() => { const ed = ${ED}; const S = window.__studioBridge.ticksPerSecond(); const nm = (e) => ed.media.getAssets().find((a) => a.id === e.mediaId)?.name ?? e.type; return ${TR}.main.elements.map((e) => ({ id: e.id, name: nm(e), s: +(e.startTime / S).toFixed(2), d: +(e.duration / S).toFixed(2) })).sort((a, b) => a.s - b.s); })()`);
	const select = async (name) => {
		await evaluate(`(() => { const ed = ${ED}; const t = ${TR}.main; const el = t.elements.find((e) => ed.media.getAssets().find((a) => a.id === e.mediaId)?.name === ${JSON.stringify(name)}); ed.selection.setSelectedElements({ elements: [{ trackId: t.id, elementId: el.id }] }); })()`);
		await waitFor(`(document.querySelector("[data-testid=clip-card]")?.innerText ?? "").includes(${JSON.stringify(name)})`, 15000, `clip card ${name}`);
	};
	const runOf = (kind) => evaluate(`(() => { const r = Object.values(${STORE}.clipRuns).filter((x) => x.kind === ${JSON.stringify(kind)}).sort((a, b) => b.startedAt - a.startedAt)[0]; return r ? { status: r.job?.status ?? (r.error ? "failed" : "running"), error: r.error ?? null, done: r.done ?? null, cost: r.job?.cost ?? 0, id: r.job?.id ?? null } : null; })()`);
	const words = async (text) => {
		await typeText("[data-lipsync-text]", text);
		await waitFor(`/¢|\\$/.test(document.querySelector("[data-testid=lipsync-price]")?.innerText ?? "")`, 20000, "price");
		await sleep(800);
	};
	const goButton = async () => {
		await waitFor(`document.querySelector("[data-testid=lipsync-go]")?.disabled === false`, 20000, "lipsync button ready");
		await click("[data-testid=lipsync-go]");
		if (await evaluate(`!!document.querySelector("[data-confirm-go]")`)) await click("[data-confirm-go]");
	};
	const reqOf = (r) => /requests\/(req-\d+)/.exec(r.url)?.[1];
	const lipReqs = () => front.filter((r) => /latentsync\/requests\/req-\d+\/status/.test(r.url)).map(reqOf);

	// ---- 1. no key: the AI tab, a clip, the words, the price — and nothing sent anywhere
	await click(`[data-tab-group="avatar"]`);
	// (the AI tab's sections: AI image · AI video · Lipsync)
	await waitFor(`!!document.querySelector('[data-materials="avatar"] [data-nav-item="photo"]')`, 15000, "the AI tab's sections");
	await click(`[data-materials="avatar"] [data-nav-item="photo"]`);
	await waitFor(`!!document.querySelector("[data-demo-lipsync-beta] [data-lipsync-window]")`, 15000, "the lipsync view in the AI tab");
	await select("clip-1.mp4");
	await words("Привет! Это проверка липсинка в браузере.");
	const noKey = await evaluate(`({ price: document.querySelector("[data-testid=lipsync-price]")?.innerText, go: document.querySelector("[data-testid=lipsync-go]")?.disabled, hint: document.querySelector("[data-testid=footer-hint]")?.innerText ?? "", settingsLink: !!document.querySelector("[data-ai-open-settings]")?.offsetParent, addKey: !!document.querySelector("[data-lipsync-nokey]")?.offsetParent, tryCard: !!document.querySelector("[data-demo-try]")?.offsetParent })`);
	await sleep(1500);
	check("no key pasted: price shown, Run waits for the key, 0 requests to any other host (stand-in front 0)", noKey.go === true && /¢/.test(noKey.price ?? "") && front.length === 0 && external().length === 0, `${JSON.stringify(noKey)}; front ${front.length}, other hosts ${external().length}`);
	check("no dead ends in the AI tab: no «Settings → AI» link, no «Add key» button, the «Try it» card does not cover Run", !noKey.settingsLink && !noKey.addKey && !noKey.tryCard, JSON.stringify(noKey));

	// ---- 2. the key, pasted in the AI tab's key panel (the stand-in's test key)
	await typeText("[data-weblip-key] input", FAKE_KEY);
	await click("[data-weblip-key] button[type=submit]");
	await waitFor(`/…cdef/.test(document.querySelector("[data-weblip-key]")?.innerText ?? "")`, 10000, "key saved");
	check("the key is kept in this browser and shown as «…cdef»", (await evaluate(`Object.keys(localStorage).filter((k) => /lipsync-key/.test(k)).length`)) === 1);

	// ---- 3. the golden path: words → price → run → the take on the clip, on the timeline, and it plays
	await sleep(1500);
	const price = await evaluate(`({ text: document.querySelector("[data-testid=lipsync-price]")?.innerText, usd: Number(document.querySelector("[data-testid=lipsync-price]")?.dataset.usd ?? NaN) })`);
	check("the price is shown before the run", /¢/.test(price.text ?? "") && price.usd > 0, JSON.stringify(price));
	const before1 = await tl();
	const lip0 = lipSubmits().length;
	const t1 = Date.now();
	await goButton();
	await waitFor(`(() => { const r = Object.values(${STORE}.clipRuns).find((x) => x.kind === "lipsync"); return r && (r.job?.status === "done" || r.error); })()`, 180000, "lipsync done");
	// the take is placed once its file is in the page (after the job says done): waited for, not raced
	const placedIn = Date.now();
	await waitFor(`(() => { const ed = ${ED}; return ${TR}.main.elements.some((e) => /^Lipsync · clip-1/.test(ed.media.getAssets().find((a) => a.id === e.mediaId)?.name ?? "")); })()`, 60000, "the take on the timeline").catch(() => {});
	const placedMs = Date.now() - placedIn;
	const golden = await runOf("lipsync");
	const voice = await runOf("voiceover");
	const after1 = await tl();
	const take = after1.find((e) => /^Lipsync · clip-1/.test(e.name));
	check("Run: the voice, then the lipsync, done on the stand-in", golden?.status === "done" && voice?.status === "done", `${((Date.now() - t1) / 1000).toFixed(1)} s; voice ${voice?.status} ${voice?.cost} $, lipsync ${golden?.status} ${golden?.cost} $; ${golden?.error ?? ""}`);
	check("the take lands on the clip (at its place, the clip's start)", !!take && take.s === before1.find((e) => e.name === "clip-1.mp4").s && !after1.some((e) => e.name === "clip-1.mp4"), `${placedMs} ms after done; ${before1.map((e) => `${e.name}@${e.s}+${e.d}`).join(" ")} → ${after1.map((e) => `${e.name}@${e.s}+${e.d}`).join(" ")}`);
	check("one lipsync submission for the run; charged = the price shown", lipSubmits().length - lip0 === 1 && Math.abs(golden.cost + voice.cost - price.usd) < 0.005, `submissions ${lipSubmits().length - lip0}; charged ${(golden.cost + voice.cost).toFixed(5)} $ vs shown ${price.usd} $`);
	const play = await evaluate(`(async () => { const ed = ${ED}; const S = window.__studioBridge.ticksPerSecond(); const p = ed.playback; const c = document.querySelector("canvas"); const h = () => { const d = c.toDataURL("image/png"); let x = 0; for (let i = 0; i < d.length; i += 97) x = (x * 31 + d.charCodeAt(i)) | 0; return x; }; p.seek({ time: Math.round(${take?.s ?? 0} * S + 0.2 * S) }); await new Promise((r) => setTimeout(r, 700)); const a = h(), t0 = p.getCurrentTime() / S; p.play(); await new Promise((r) => setTimeout(r, 1500)); const t1 = p.getCurrentTime() / S, b = h(); p.pause(); return { t0, t1, changed: a !== b }; })()`);
	check("the take plays (the playhead runs over it, the picture changes)", play.t1 - play.t0 > 0.8 && play.t1 < (take?.s ?? 0) + (take?.d ?? 0) + 0.1 && play.changed, JSON.stringify(play));

	const preview = await evaluate(`(async () => { const a = document.querySelector("[data-demo-lipsync-beta] audio"); if (!a) return null; for (let i = 0; i < 50 && !(a.readyState >= 1 && a.src); i++) await new Promise((r) => setTimeout(r, 100)); return { blob: a.src.startsWith("blob:"), ready: a.readyState, duration: Number(a.duration.toFixed(2)) }; })()`);
	check("the voice's own player (Listen) plays it from the page, not from a server address", preview?.blob && preview.duration > 1, JSON.stringify(preview));

	// ---- 4. a reload in the middle of the lipsync: collected once (the stand-in counts one submission)
	await select("clip-2.mp4");
	await words("Второй клип: перезагрузка посередине.");
	fake.mode.lipPolls = () => 1e9;
	const lip1 = lipSubmits().length;
	await goButton();
	const end4 = Date.now() + 120000;
	while (lipSubmits().length === lip1 || lipReqs().length === 0 || !front.some((r) => r.at > lipSubmits().at(-1).at && /latentsync\/requests\/.*\/status/.test(r.url))) {
		if (Date.now() > end4) throw new Error("timeout: lipsync submitted and polled");
		await sleep(200);
	}
	const heldReq = lipReqs().at(-1);
	const reloadAt = Date.now();
	await go(`${SITE_URL}editor/`);
	await boot();
	await sleep(1500);
	const polledAfter = front.some((r) => r.at > reloadAt && reqOf(r) === heldReq && /status/.test(r.url));
	fake.mode.lipPolls = null;
	await waitFor(`(() => { const ed = ${ED}; return ${TR}.main.elements.some((e) => /^Lipsync · clip-2/.test(ed.media.getAssets().find((a) => a.id === e.mediaId)?.name ?? "")); })()`, 120000, "the reloaded run's take");
	await sleep(1000);
	check("reload mid-run: the page asks for the same request again, the take lands, ONE submission at the stand-in", polledAfter && lipSubmits().length - lip1 === 1, `held ${heldReq} (IN_PROGRESS at the stand-in when the page reloaded), polled after reload ${polledAfter}, submissions for the run ${lipSubmits().length - lip1}; ${(await tl()).map((e) => e.name).join(" | ")}`);

	// ---- 5. cancel while the stand-in works on it
	await click(`[data-tab-group="avatar"]`);
	await waitFor(`!!document.querySelector("[data-demo-lipsync-beta] [data-lipsync-window]")`, 15000, "the lipsync view");
	await select("clip-3.mp4");
	await words("Третий клип: отмена.");
	fake.mode.lipPolls = () => 1e9;
	const lip2 = lipSubmits().length;
	const before5 = await tl();
	await goButton();
	const end5 = Date.now() + 120000;
	while (lipSubmits().length === lip2) {
		if (Date.now() > end5) throw new Error("timeout: lipsync submitted");
		await sleep(200);
	}
	await sleep(1200);
	const stopped = await evaluate(`(() => { const b = [...document.querySelectorAll("[data-lipsync-window] button")].find((x) => /^(Стоп|Stop)$/.test(x.innerText.trim())); if (!b) return false; b.click(); return true; })()`);
	await sleep(1500);
	const cancelReq = lipReqs().at(-1);
	const n5 = front.length;
	await sleep(3000);
	const cancelled = await runOf("lipsync");
	const cancelPut = front.some((r) => r.method === "PUT" && reqOf(r) === cancelReq && /cancel$/.test(r.url));
	const footer5 = await evaluate(`document.querySelector("[data-lipsync-footer]")?.innerText ?? ""`);
	check("Stop: the stand-in's job is cancelled, polling stops, the timeline is as it was", stopped && cancelPut && front.length === n5 && JSON.stringify(await tl()) === JSON.stringify(before5), `stop ${stopped}, cancel PUT ${cancelPut}, requests after ${front.length - n5}, run ${cancelled?.status}; «${footer5.split("\n").find((l) => /Отменено|Cancelled|Stopped|Остановлено/.test(l)) ?? footer5.slice(0, 80)}»`);
	fake.mode.lipPolls = null;

	// ---- 6. a failure at the stand-in: one sentence, the timeline unchanged
	fake.mode.lipFail = [lipSubmits().length + 1];
	await goButton();
	await waitFor(`(() => { const r = Object.values(${STORE}.clipRuns).filter((x) => x.kind === "lipsync").sort((a, b) => b.startedAt - a.startedAt)[0]; return r && (r.error || r.job?.status === "done"); })()`, 120000, "the failed run");
	const failed6 = await runOf("lipsync");
	const shown = await evaluate(`document.querySelector("[data-lipsync-footer]")?.innerText ?? ""`);
	const sentence = failed6?.error ?? "";
	check("a failure says one sentence (and offers Retry); the timeline is as it was", !!sentence && !/\n/.test(sentence) && (sentence.match(/[.!?](\s|$)/g) ?? []).length === 1 && shown.includes(sentence) && /Повторить|Retry/.test(shown) && JSON.stringify(await tl()) === JSON.stringify(before5), `«${sentence}»`);

	// ---- 6b. AI image and AI video on the same key (web/generate): the price first, one submission each, the file kept
	//          in the page and put on the timeline
	{
		const imageSubmits = () => submits().filter((r) => /seedream|flux|nano-banana/.test(r.url)).length;
		const videoSubmits = () => submits().filter((r) => /seedance|kling|veo|wan|minimax|pixverse|ltx|vidu|hailuo|luma/.test(r.url) && !/latentsync|lipsync/.test(r.url)).length;
		const mediaCount = () => evaluate(`${ED}.media.getAssets().length`);
		await click(`[data-materials="avatar"] [data-nav-item="ai-image"]`);
		await waitFor(`!!document.querySelector('[data-demo-generate="ai-image"] [data-point-field="prompt"]')`, 15000, "the AI image form");
		const images0 = imageSubmits();
		await typeText(`[data-demo-generate="ai-image"] [data-point-field="prompt"]`, "Красный воздушный змей над морем");
		await waitFor(`(() => { const b = document.querySelector('[data-demo-generate="ai-image"] [data-point-generate]'); return !!b && !b.disabled && /\\$|¢/.test(b.innerText); })()`, 20000, "the picture's price on the button");
		const imagePrice = await evaluate(`document.querySelector('[data-demo-generate="ai-image"] [data-point-generate]').innerText`);
		const assets0 = await mediaCount();
		await click(`[data-demo-generate="ai-image"] [data-point-generate]`);
		if (await evaluate(`!!document.querySelector("[data-confirm-go]")`)) await click("[data-confirm-go]");
		await waitFor(`!!document.querySelector('[data-point-result][data-point-state="succeeded"]')`, 60000, "the picture is made");
		await waitFor(`(() => { const i = document.querySelector('[data-point-result][data-point-state="succeeded"] img'); return !!i && /^blob:/.test(i.src) && i.naturalWidth > 0; })()`, 20000, "the picture shows");
		check("AI image: the price on the button, one submission to the stand-in, the picture shown from the page's own copy", /\$|¢/.test(imagePrice) && imageSubmits() - images0 === 1, `${imagePrice.replace(/\s+/g, " ")}; submissions ${imageSubmits() - images0}`);
		await click(`[data-point-result][data-point-state="succeeded"] [data-point-to-media]`);
		await waitFor(`${ED}.media.getAssets().length === ${assets0 + 1}`, 20000, "the picture is in Media");
		const picture = await evaluate(`(() => { const a = ${ED}.media.getAssets().at(-1); return { name: a.name, type: a.type, bytes: a.file.size }; })()`);
		check("AI image: «to Media» puts the picture in the project", picture.type === "image" && picture.bytes > 0, JSON.stringify(picture));

		await click(`[data-materials="avatar"] [data-nav-item="ai-video"]`);
		await waitFor(`!!document.querySelector('[data-demo-generate="ai-video"] [data-point-field="prompt"]')`, 15000, "the AI video form");
		const videos0 = videoSubmits();
		await typeText(`[data-demo-generate="ai-video"] [data-point-field="prompt"]`, "Змей поднимается над волнами, камера летит следом");
		await waitFor(`(() => { const b = document.querySelector('[data-demo-generate="ai-video"] [data-point-generate]'); return !!b && !b.disabled; })()`, 20000, "the clip's Generate button");
		const videoPrice = await evaluate(`Number(document.querySelector('[data-demo-generate="ai-video"] [data-video-price]')?.dataset.videoPrice ?? NaN)`);
		await click(`[data-demo-generate="ai-video"] [data-point-generate]`);
		if (await evaluate(`!!document.querySelector("[data-confirm-go]")`)) await click("[data-confirm-go]");
		await waitFor(`!!document.querySelector('[data-demo-generate="ai-video"] [data-point-result][data-point-state="succeeded"] video')`, 90000, "the clip is made");
		check("AI video: the price before the run, one submission to the stand-in, the clip kept in the page", videoPrice > 0 && videoSubmits() - videos0 === 1, `price ${videoPrice} $; submissions ${videoSubmits() - videos0}`);
		const elements0 = await evaluate(`${TR}.main.elements.length + ${TR}.overlay.reduce((n, t) => n + t.elements.length, 0)`);
		await click(`[data-demo-generate="ai-video"] [data-point-result][data-point-state="succeeded"] [data-point-to-timeline]`);
		await waitFor(`${TR}.main.elements.length + ${TR}.overlay.reduce((n, t) => n + t.elements.length, 0) === ${elements0 + 1}`, 30000, "the clip is on the timeline");
		check("AI video: «to the timeline» places the clip", true);
	}

	// ---- 7. the key and the hosts
	const keyed = front.filter((r) => r.auth);
	check("the key went only to the provider's queue / storage desk, never in a URL; nothing but the stand-in was reached", keyed.length > 0 && keyed.every((r) => /^\/(queue\.fal\.run|rest\.fal\.ai)\//.test(r.url)) && !front.some((r) => r.url.includes(FAKE_KEY)) && external().every((r) => r.url.startsWith(`http://127.0.0.1:${FRONT_PORT}/`)), `${keyed.length} keyed of ${front.length} stand-in requests; other hosts: ${[...new Set(external().map((r) => new URL(r.url).host))].join(" ")}`);
	const noisy = consoleErrors.filter((l) => !/Electron Security Warning|Download the React DevTools/.test(l));
	check("nothing in the console", noisy.length === 0, noisy.slice(0, 6).join(" || "));
	console.log(`NUMBERS walk: lipsync submissions at the stand-in ${lipSubmits().length}, stand-in requests ${front.length}, price shown ${price.usd} $`);
} catch (error) {
	check("the walk finished", false, String(error?.stack ?? error).slice(0, 600));
	console.log(`console:\n  ${consoleErrors.slice(0, 15).join("\n  ")}`);
	try {
		const shot = await send("Page.captureScreenshot", { format: "png" });
		fs.writeFileSync(path.join(SCRATCH, "lipsync-fail.png"), Buffer.from(shot.data, "base64"));
	} catch {}
	if (process.env.GZ_EXPLORE) await explore();
} finally {
	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} passed (lipsync walk, ${BROWSER})`);
	ws.close();
	stop();
	process.exit(failed.length ? 1 : 0);
}
