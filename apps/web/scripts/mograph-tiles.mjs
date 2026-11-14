// Prebuilds the still of every motion-graphic tile and template cover with the export engine, as transparent WebP over
// which the panel lays the theme photo: a long list then scrolls over plain pictures, and the live Remotion preview is
// built only for the tile under the pointer (src/components/editor/panels/assets/list-scroll.ts).
// Run after changing a graphic or a template:  node scripts/montage-bundle.mjs && node scripts/mograph-tiles.mjs [Id,Id]
// Needs bun and ffmpeg (libwebp); the renderer and its Chrome come from the installed Gaziyav (MONTAGE_RENDERER_DIR).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(WEB, "public");
const engine = process.env.MONTAGE_RENDERER_DIR || "/Applications/Gaziyav.app/Contents/Resources/remotion";
const require = createRequire(path.join(engine, "package.json"));
const { openBrowser, renderStill, selectComposition } = require("@remotion/renderer");
const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
if (!fs.existsSync(path.join(PUBLIC, "montage-bundle", "index.html"))) throw new Error("no public/montage-bundle: run node scripts/montage-bundle.mjs first");

// The app's public files (bundle, photos, Lottie) from one origin, as the export renderer loads them.
const types = { ".json": "application/json", ".js": "text/javascript", ".html": "text/html", ".jpg": "image/jpeg", ".png": "image/png", ".css": "text/css", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = http
	.createServer((req, res) => {
		let file = path.join(PUBLIC, decodeURIComponent((req.url ?? "/").split("?")[0]));
		if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
		if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) {
			res.writeHead(404);
			res.end();
			return;
		}
		res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" });
		fs.createReadStream(file).pipe(res);
	})
	.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const serveUrl = `${origin}/montage-bundle`;

const raw = execFileSync("bun", [path.join(WEB, "scripts", "mograph-tiles-input.ts")], { cwd: WEB, maxBuffer: 64 << 20 }).toString();
// What each still was made from (before the origin goes in): the test compares it with the catalog.
const hash = (job) => createHash("sha1").update(JSON.stringify({ at: job.at, seconds: job.seconds, items: job.items })).digest("hex").slice(0, 12);
const plain = JSON.parse(raw);
const MANIFEST = path.join(PUBLIC, "mograph", "tiles", "manifest.json");
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const { kinds, templates } = JSON.parse(raw.replaceAll("@ORIGIN@", origin));
const jobs = [
	...kinds.map((k) => ({ ...k, w: 1080, h: 1080, out: path.join(PUBLIC, "mograph", "tiles", `${k.id}.webp`), scale: "216:216" })),
	...templates.map((t) => ({ ...t, w: 1080, h: 1920, out: path.join(PUBLIC, "mograph", "covers", `${t.id}.webp`), scale: "216:384" })),
].filter((j) => !only || only.has(j.id));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mograph-tiles-"));
const shell = { "darwin-arm64": "mac-arm64", "darwin-x64": "mac-x64", "linux-x64": "linux64", "win32-x64": "win64" }[`${process.platform}-${process.arch}`];
if (!shell) throw new Error(`no chrome-headless-shell for ${process.platform}-${process.arch}`);
const exe = path.join(engine, "chrome-headless-shell", shell, `chrome-headless-shell-${shell}`, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
const browser = await openBrowser("chrome", { browserExecutable: exe, chromiumOptions: { gl: "angle" }, logLevel: "error" });
const errors = [];
const onBrowserLog = (log) => {
	const text = String(log.text ?? "");
	if (text.includes("[montage-error]") || log.type === "error") errors.push(text.slice(0, 200));
};
try {
	for (const job of jobs) {
		const fps = 30;
		const input = { items: job.items, words: [], origin, width: job.w, height: job.h, fps, durationInFrames: Math.max(2, Math.round(job.seconds * fps)) };
		const composition = await selectComposition({ serveUrl, id: "Montage", inputProps: input, puppeteerInstance: browser, logLevel: "error", onBrowserLog });
		const png = path.join(tmp, `${job.id}.png`);
		const frame = Math.min(input.durationInFrames - 1, Math.round(job.at * fps));
		await renderStill({ composition, serveUrl, inputProps: input, output: png, frame, imageFormat: "png", puppeteerInstance: browser, onBrowserLog, logLevel: "error" });
		fs.mkdirSync(path.dirname(job.out), { recursive: true });
		execFileSync("ffmpeg", ["-v", "error", "-y", "-i", png, "-vf", `scale=${job.scale}:flags=lanczos`, "-c:v", "libwebp", "-quality", "82", "-pix_fmt", "yuva420p", job.out]);
		const source = [...plain.kinds, ...plain.templates.map((t) => ({ ...t, id: `cover:${t.id}` }))].find((j) => j.id === (job.h > job.w ? `cover:${job.id}` : job.id));
		if (source) manifest[source.id] = hash(source);
		console.log(path.relative(PUBLIC, job.out), `${Math.round(fs.statSync(job.out).size / 1024)} KB`);
	}
} finally {
	fs.writeFileSync(MANIFEST, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1)}\n`);
	await browser.close({ silent: true }).catch(() => {});
	server.close();
	fs.rmSync(tmp, { recursive: true, force: true });
}
if (errors.length) {
	console.error("ERRORS", JSON.stringify(errors));
	process.exit(1);
}
