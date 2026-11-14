// Draws HTML / SVG artwork into PNGs with Electron (the same engine the app ships), off screen, in one process.
// Electron: ELECTRON=<path to the electron binary>, else the desktop shell's own (node_modules/electron).
// Nothing is downloaded; a throwaway profile is used.
//   node assets/src/render.mjs                    → assets/brand/*.png from assets/brand/*.svg
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HERE = import.meta.dirname;
const BRAND = path.join(HERE, "..", "brand");
const CANDIDATES = [
	process.env.ELECTRON,
	path.join(process.env.CAPTURE_SHELL || "", "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
	path.join(HERE, "../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
].filter(Boolean);
export const ELECTRON = CANDIDATES.find((c) => fs.existsSync(c));

const MAIN = `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const jobs = JSON.parse(fs.readFileSync(process.env.GZ_JOBS, "utf8"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
	for (const j of jobs) {
		const w = new BrowserWindow({ show: false, width: j.w * j.scale, height: j.h * j.scale, useContentSize: true, transparent: true, frame: false,
			webPreferences: { offscreen: true, zoomFactor: j.scale, backgroundThrottling: false } });
		await w.loadURL(j.url);
		await new Promise((r) => setTimeout(r, j.wait || 600));
		const img = await w.webContents.capturePage({ x: 0, y: 0, width: j.w * j.scale, height: j.h * j.scale });
		fs.writeFileSync(j.png, img.toPNG());
		w.destroy();
		console.log("rendered", j.png);
	}
	app.quit();
});`;

/** jobs: [{ html | svg, png, w, h, scale }] — renders all of them in one Electron run. */
export function render(jobs) {
	if (!ELECTRON) throw new Error("no Electron found: set ELECTRON=<path> (or CAPTURE_SHELL=<the desktop shell folder>)");
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "gz-render-"));
	try {
		const list = jobs.map((j, i) => {
			let html = j.html;
			if (j.svg) {
				html = path.join(work, `p${i}.html`);
				fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}img{display:block;width:${j.w}px;height:${j.h}px}</style><img src="${pathToFileURL(j.svg).href}">`);
			}
			return { url: pathToFileURL(html).href, png: j.png, w: j.w, h: j.h, scale: j.scale ?? 2, wait: j.wait };
		});
		fs.writeFileSync(path.join(work, "jobs.json"), JSON.stringify(list));
		fs.writeFileSync(path.join(work, "main.cjs"), MAIN);
		fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "gz-render", main: "main.cjs" }));
		execFileSync(ELECTRON, [work, `--user-data-dir=${path.join(work, "profile")}`], { env: { ...process.env, GZ_JOBS: path.join(work, "jobs.json"), ELECTRON_ENABLE_LOGGING: "" }, stdio: ["ignore", "inherit", "ignore"], timeout: 15 * 60 * 1000 });
	} finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname.replace(/%20/g, " "))) {
	const jobs = fs.readdirSync(BRAND).filter((x) => x.endsWith(".svg")).map((f) => {
		const svg = path.join(BRAND, f);
		const m = /width="(\d+)" height="(\d+)"/.exec(fs.readFileSync(svg, "utf8"));
		return { svg, png: path.join(BRAND, f.replace(/\.svg$/, ".png")), w: Number(m[1]), h: Number(m[2]), scale: f.startsWith("social") ? 1 : 2 };
	});
	render(jobs);
}
