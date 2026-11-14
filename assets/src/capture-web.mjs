// The browser edition's picture (t-web): the built site, served locally, opened in Electron (the engine the app ships)
// at 1440 × 900, its sample project on the timeline and a video clip selected — in each language.
// Nothing is downloaded and nothing but the local server is reached; a throwaway profile is used.
//   (serve a copy of the built site, e.g. `python3 -m http.server 4165 --bind 127.0.0.1` in it)
//   WEB_URL=http://127.0.0.1:4165/editor/ CAPTURE_RAW=/tmp/gz-capture-raw CAPTURE_SHELL=<shell folder> node assets/src/capture-web.mjs
//   node assets/src/frame.mjs                    # frames RAW/<lang>/t-web.png into assets/screens/<lang>/t-web.jpg
// Adds «t-web» to CAPTURE_RAW/manifest.json (made by capture.mjs, or a new one).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ELECTRON } from "./render.mjs";

const RAW = path.resolve(process.env.CAPTURE_RAW || "/tmp/gz-capture-raw");
const URL = process.env.WEB_URL || "http://127.0.0.1:4165/editor/";
const LANGS = (process.env.CAPTURE_LANGS || "en,ru").split(",").filter(Boolean);
if (!ELECTRON) throw new Error("no Electron found: set ELECTRON=<path> (or CAPTURE_SHELL=<the desktop shell folder>)");

const MAIN = `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const job = JSON.parse(fs.readFileSync(process.env.GZ_JOB, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
	const w = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true, focusable: false, webPreferences: { backgroundThrottling: false } });
	w.showInactive();
	const js = (code) => w.webContents.executeJavaScript(code, true);
	const out = {};
	for (const lang of job.langs) {
		try {
			await w.loadURL(job.url);
			await js("localStorage.setItem('gaziyav.language', " + JSON.stringify(lang) + ")");
			await w.loadURL(job.url);
			const t0 = Date.now();
			while (Date.now() - t0 < 90000 && !(await js("document.querySelectorAll('[data-timeline-element-id]').length > 2"))) await sleep(500);
			await sleep(5000);
			// a video clip selected: the inspector shows its tabs
			const box = await js("(() => { const e = [...document.querySelectorAll('[data-timeline-element-id]')].find((x) => /clip-1/.test(x.innerText || '')) ?? document.querySelectorAll('[data-timeline-element-id]')[1]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + Math.min(60, r.width / 2)), y: Math.round(r.y + r.height / 2) }; })()");
			if (box) {
				w.webContents.sendInputEvent({ type: "mouseMove", x: box.x, y: box.y });
				w.webContents.sendInputEvent({ type: "mouseDown", x: box.x, y: box.y, button: "left", clickCount: 1 });
				w.webContents.sendInputEvent({ type: "mouseUp", x: box.x, y: box.y, button: "left", clickCount: 1 });
			}
			await sleep(2500);
			w.webContents.sendInputEvent({ type: "mouseMove", x: 720, y: 890 });
			await sleep(800);
			const img = await w.webContents.capturePage();
			fs.mkdirSync(path.join(job.raw, lang), { recursive: true });
			fs.writeFileSync(path.join(job.raw, lang, "t-web.png"), img.toPNG());
			out[lang] = { ok: true, selected: !!box, size: img.getSize() };
		} catch (e) { out[lang] = { ok: false, error: String(e && e.message || e) }; }
	}
	fs.writeFileSync(process.env.GZ_OUT, JSON.stringify(out));
	app.quit();
});`;

const work = fs.mkdtempSync(path.join(os.tmpdir(), "gz-web-"));
try {
	fs.writeFileSync(path.join(work, "main.cjs"), MAIN);
	fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "gz-web-capture", main: "main.cjs" }));
	fs.writeFileSync(path.join(work, "job.json"), JSON.stringify({ url: URL, raw: RAW, langs: LANGS }));
	execFileSync(ELECTRON, [work, `--user-data-dir=${path.join(work, "profile")}`], { env: { ...process.env, GZ_JOB: path.join(work, "job.json"), GZ_OUT: path.join(work, "out.json") }, stdio: ["ignore", "inherit", "ignore"], timeout: 10 * 60 * 1000 });
	const out = JSON.parse(fs.readFileSync(path.join(work, "out.json"), "utf8"));
	const file = path.join(RAW, "manifest.json");
	const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { langs: {} };
	for (const [lang, r] of Object.entries(out)) {
		manifest.langs[lang] ??= { got: [], miss: [], loops: {} };
		if (r.ok) manifest.langs[lang].got.push("t-web");
		else manifest.langs[lang].miss.push(`t-web: ${r.error}`);
	}
	fs.writeFileSync(file, JSON.stringify(manifest, null, 1));
	console.log(JSON.stringify(out));
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
