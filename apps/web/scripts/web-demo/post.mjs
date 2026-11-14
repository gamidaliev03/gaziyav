// Gaziyav in the browser — the site around the static export (script/web-demo.sh site):
//   node post.mjs <next out dir> <site dir> <apps/web/scripts/web-demo dir> <docs assets dir> <connect-hosts.json> [<apps/web>]
// Makes <site>/: the landing page (index.html English, ru/index.html Russian), editor/ (the export, every path made
// relative so the site works under any /<repo>/), the sample media, a service worker that keeps the site's own files
// for offline use, the web-app manifest, a strict Content-Security-Policy in every page (inline scripts by hash),
// 404.html, .nojekyll — then checks it: no file over 50 MB, no symlinks, no private or family words, sizes.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [outDir, site, here, docs, hostsFile, webArg] = process.argv.slice(2);
const webDir = webArg ?? path.join(here, "../..");
if (!outDir || !site || !here) throw new Error("usage: post.mjs <out> <site> <here> <docs> <hosts>");
const PREFIX = "/__GZDEMO__/";
// public/ folders the browser edition never uses (motion graphics, sticker packs, voice samples…); the sound pack
// (sfx/, 1.4 MB) stays: it is the Sounds tab of the browser edition
const PRUNE = new Set(["stickers", "montage-bundle", "montage-fonts", "faces", "samples", "open-graph", "icons", "logos", "landing-page-dark.png", "_headers", "browserconfig.xml", "manifest.json", "favicon.ico", "404.html", "404"]);
const PRUNE_DEEP = ["trending/voices", "mograph/covers", "mograph/tiles", "mograph/lottie"];
// public/ folders the editor's code names by absolute path: made relative to the page (always <site>/editor/)
const PUBLIC_DIRS = ["fonts", "effects", "text-tiles", "text-scenes", "trending", "shapes", "platform-guides", "brand", "mograph"];
const TEXT = new Set([".html", ".js", ".css", ".json", ".txt", ".webmanifest", ".svg", ".map"]);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (from, to) => {
	const r = path.relative(from, to).split(path.sep).join("/");
	return r ? `${r}/` : "./";
};
const sha = (s) => `'sha256-${crypto.createHash("sha256").update(s).digest("base64")}'`;
const hosts = (() => {
	try {
		return JSON.parse(fs.readFileSync(hostsFile, "utf8")).connect ?? [];
	} catch {
		return [];
	}
})().map((h) => (h.startsWith("http") ? h : `https://${h}`));
// TEST-ONLY: GZ_TEST_PROVIDER=http://127.0.0.1:<port> makes a test site whose lipsync talks to a local stand-in
// provider (the page's placeholder below is filled, the CSP lets that one origin through). Unset (the published site),
// the placeholder stays as it is and the page never routes anywhere but the provider's own https hosts.
const TEST_PROVIDER = process.env.GZ_TEST_PROVIDER ?? "";
const PLACEHOLDER = "__GZ_TEST_PROVIDER_ORIGIN_UNSET__";
if (TEST_PROVIDER) {
	if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(TEST_PROVIDER)) throw new Error("GZ_TEST_PROVIDER must be http://127.0.0.1:<port>");
	hosts.push(TEST_PROVIDER);
	console.log(`TEST SITE: lipsync routed to ${TEST_PROVIDER} — never publish this folder`);
}

fs.rmSync(site, { recursive: true, force: true });
const editor = path.join(site, "editor");
fs.mkdirSync(editor, { recursive: true });

// 1. the editor: the export without what the browser edition never uses
for (const entry of fs.readdirSync(outDir)) {
	if (PRUNE.has(entry)) continue;
	fs.cpSync(path.join(outDir, entry), path.join(editor, entry), { recursive: true, dereference: true });
}
for (const p of PRUNE_DEEP) fs.rmSync(path.join(editor, p), { recursive: true, force: true });
fs.cpSync(path.join(webDir, "src/demo/static/demo-boot.js"), path.join(editor, "demo-boot.js"));
fs.cpSync(path.join(here, "sample"), path.join(editor, "sample"), { recursive: true });
fs.mkdirSync(path.join(editor, "media"), { recursive: true });
for (const lang of ["en", "ru"]) {
	const loop = path.join(docs, "loops", `lipsync-${lang}.mp4`);
	if (fs.existsSync(loop)) fs.cpSync(loop, path.join(editor, "media", `lipsync-${lang}.mp4`));
}

// 2. every path relative: the export's prefix, and the public folders the code names from the site's root.
// Worker scripts come out as «.ts» (GitHub Pages would serve them as MPEG video): renamed «.js».
const renamed = [];
const media = path.join(editor, "_next", "static", "media");
// the speech model's runtime (captions run in the desktop app only): 21 MB nobody in the browser edition loads
if (fs.existsSync(media)) for (const f of fs.readdirSync(media)) if (/^ort-wasm.*\.wasm$/.test(f)) fs.rmSync(path.join(media, f));
if (fs.existsSync(media))
	for (const f of fs.readdirSync(media))
		if (f.endsWith(".ts")) {
			fs.renameSync(path.join(media, f), path.join(media, `${f.slice(0, -3)}.js`));
			renamed.push(f);
		}
// In scripts the prefix becomes the editor's folder worked out at run time — from the page (…/editor/) or from a
// worker inside it (…/editor/_next/…) — so chunks and workers load under any /<repo>/.
// In the page it stays «./» (the runtime matches its chunks by the page's own relative script paths); in a worker it is
// the absolute folder (a worker's «./» would be its own folder).
// A blob worker of the runtime (its chunks are TURBOPACK_WORKER_LOCATION + this path) also keeps «./».
const BASE_EXPR = `(typeof document!=="undefined"||/^blob:/.test(self.location.href)?"./":(function(h){var i=h.indexOf("/_next/");return i>=0?h.slice(0,i+1):new URL("./",h).href})(self.location.href))`;
const publicRe = new RegExp(`(["'\`(])/(${PUBLIC_DIRS.join("|")})/`, "g");
for (const file of walk(editor)) {
	if (!TEXT.has(path.extname(file))) continue;
	let s = fs.readFileSync(file, "utf8");
	const before = s;
	const dir = path.dirname(file);
	if (file.endsWith(".js")) {
		// scripts run in the page at <site>/editor/: their paths are the page's
		s = s.replace(/"\/__GZDEMO__\/([^"]*)"/g, (_m, rest) => `(${BASE_EXPR}+${JSON.stringify(rest)})`);
		s = s.split(PREFIX).join("./").split(PREFIX.slice(0, -1)).join(".");
		s = s.replace(publicRe, "$1./$2/");
		for (const f of renamed) s = s.split(f).join(`${f.slice(0, -3)}.js`);
		if (TEST_PROVIDER) s = s.split(PLACEHOLDER).join(TEST_PROVIDER);
		// the runtime's blob workers load chunks from the site's origin + the page's chunk path: from the editor's folder
		s = s.split("self.TURBOPACK_WORKER_LOCATION = ${JSON.stringify(location.origin)}").join('self.TURBOPACK_WORKER_LOCATION = ${JSON.stringify(new URL("./", location.href).href)}');
		// the caption style «karaoke» reads «word highlight» in Russian here (the public edition's word list)
		s = s.replace(/\u041a\u0430\u0440\u0430\u043e\u043a\u0435/g, "\u041f\u043e\u0434\u0441\u0432\u0435\u0442\u043a\u0430 \u0441\u043b\u043e\u0432").replace(/\u043a\u0430\u0440\u0430\u043e\u043a\u0435/g, "\u043f\u043e\u0434\u0441\u0432\u0435\u0442\u043a\u0430 \u0441\u043b\u043e\u0432");
	} else if (file.endsWith(".css")) {
		s = s.split(PREFIX).join(rel(dir, editor));
		s = s.replace(/url\((["']?)\/(fonts|effects|shapes|brand)\//g, (_m, q, d) => `url(${q}${rel(dir, editor)}${d}/`);
	} else {
		s = s.split(PREFIX).join(rel(dir, editor)).split(PREFIX.slice(0, -1)).join(rel(dir, editor).replace(/\/$/, ""));
		s = s.replace(publicRe, "$1./$2/");
	}
	if (s !== before) fs.writeFileSync(file, s);
}

// 3. the page: manifest, Content-Security-Policy with the hashes of its inline scripts
const connect = ["'self'", "blob:", "data:", ...hosts].join(" ");
function cspFor(html, { editorPage }) {
	const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => sha(m[1]));
	return [
		"default-src 'self'",
		// the editor: its WebAssembly engine, and the sound meters' audio worklet (a module the page writes itself, as a blob)
		`script-src 'self' ${[...new Set(inline)].join(" ")}${editorPage ? " 'wasm-unsafe-eval' blob:" : ""}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' blob: data:",
		"media-src 'self' blob: data:",
		"font-src 'self' blob: data:",
		`connect-src ${connect}`,
		"worker-src 'self' blob:",
		"manifest-src 'self'",
		"frame-src 'none'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'none'",
	].join("; ");
}
const editorHtml = path.join(editor, "index.html");
{
	let html = fs.readFileSync(editorHtml, "utf8");
	html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, "");
	// (an export made before the icon moved named ../favicon.png; the site's icon is icons/icon-32.png)
	html = html.split("../favicon.png").join("../icons/icon-32.png");
	const head = `<meta http-equiv="Content-Security-Policy" content="${cspFor(html, { editorPage: true })}"><meta name="referrer" content="no-referrer"><link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="../icons/icon-180.png">`;
	html = html.replace(/<head>/, `<head>${head}`);
	fs.writeFileSync(editorHtml, html);
}
fs.writeFileSync(
	path.join(editor, "manifest.webmanifest"),
	JSON.stringify(
		{
			name: "Gaziyav",
			short_name: "Gaziyav",
			description: "A free, open-source video editor that runs in your browser.",
			start_url: "./",
			scope: "./",
			display: "standalone",
			background_color: "#0b0a09",
			theme_color: "#0b0a09",
			icons: [
				{ src: "../icons/icon-192.png", sizes: "192x192", type: "image/png" },
				{ src: "../icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
			],
		},
		null,
		"\t",
	),
);

// 4. the landing page in two languages
const S = path.join(here, "site");
const TOUR = path.join(S, "tour");
fs.cpSync(path.join(S, "icons"), path.join(site, "icons"), { recursive: true });
fs.cpSync(path.join(S, "site.css"), path.join(site, "site.css"));
fs.cpSync(path.join(S, "site.js"), path.join(site, "site.js"));
const TEXTS = JSON.parse(fs.readFileSync(path.join(S, "texts.json"), "utf8"));
const template = fs.readFileSync(path.join(S, "landing.html"), "utf8");
for (const lang of ["en", "ru"]) {
	const t = TEXTS[lang];
	const base = lang === "en" ? "./" : "../";
	// the docs' cover and social picture, unless they still headline lipsync (it is an extra, never the headline)
	const headlinesLipsync = (svg) => fs.existsSync(svg) && /lipsync|липсинк/i.test(fs.readFileSync(svg, "utf8"));
	const banner = path.join(docs, "brand", `banner-${lang}-dark.svg`);
	let bannerTag = "";
	if (fs.existsSync(banner) && !headlinesLipsync(banner)) {
		fs.cpSync(banner, path.join(site, `banner-${lang}.svg`));
		bannerTag = `<img class="banner" src="${base}banner-${lang}.svg" width="1280" height="400" alt="${t.bannerAlt}">`;
	}
	const og = path.join(docs, "brand", `social-preview-${lang}.png`);
	if (fs.existsSync(og) && !headlinesLipsync(og.replace(/\.png$/, ".svg"))) fs.cpSync(og, path.join(site, `og-${lang}.png`));
	else drawPreview(path.join(site, `og-${lang}.png`), t);
	const vars = {
		lang,
		base,
		path: lang === "en" ? "" : "ru/",
		homePath: lang === "en" ? "" : "ru/",
		ogLocale: lang === "en" ? "en_US" : "ru_RU",
		otherLang: lang === "en" ? "ru" : "en",
		otherName: lang === "en" ? "Русский" : "English",
		otherHref: lang === "en" ? "ru/" : "../",
		banner: bannerTag,
		tourLink: fs.existsSync(path.join(TOUR, `${lang}.html`)) ? `<a href="${base}tour/${lang}.html">${t.t_tour}</a>` : "",
		tourHero: fs.existsSync(path.join(TOUR, `${lang}.html`)) ? ` <a class="plain" href="${base}tour/${lang}.html" data-tour>${t.t_tour} →</a>` : "",
		...Object.fromEntries(Object.entries(t).map(([k, v]) => [k.startsWith("t_") ? k : k, v])),
	};
	let html = template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k === "OWNER" || k === "REPO" || k === "csp" ? m : (vars[k] ?? m)));
	html = html.replace("{{csp}}", cspFor(html, { editorPage: false }));
	const dir = lang === "en" ? site : path.join(site, "ru");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "index.html"), html);
}
function drawPreview(file, t) {
	// no picture from the docs: a plain one, drawn here (the editor's own bundled font)
	const font = path.join(webDir, "public/fonts/bundled/GolosText.ttf");
	const esc = (s) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");
	execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x0e0f12:s=1280x640:d=1", "-vf",
		`drawtext=fontfile='${font}':text='Gaziyav':fontcolor=0xe8a33d:fontsize=96:x=90:y=200,drawtext=fontfile='${font}':text='${esc(t.ogLine)}':fontcolor=0xf2efe9:fontsize=40:x=90:y=340`,
		"-frames:v", "1", file]);
}

// the feature tour (the docs' deck, static pages + PDFs, kept in site/tour/), as it is, when it is there
if (fs.existsSync(path.join(TOUR, "index.html"))) fs.cpSync(TOUR, path.join(site, "tour"), { recursive: true, dereference: true });

// 5. the old address, 404, .nojekyll
fs.mkdirSync(path.join(site, "demo"), { recursive: true });
fs.writeFileSync(path.join(site, "demo", "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=../editor/"><title>Gaziyav</title></head><body><a href="../editor/">Gaziyav</a></body></html>\n`);
{
	const script = `var p=location.pathname.split("/").filter(Boolean);location.replace(/\\.github\\.io$/.test(location.hostname)&&p.length?"/"+p[0]+"/":"/");`;
	fs.writeFileSync(
		path.join(site, "404.html"),
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src ${sha(script)}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gaziyav</title></head><body><p><a href="/">Gaziyav</a></p><script>${script}</script></body></html>\n`,
	);
}
fs.writeFileSync(path.join(site, ".nojekyll"), "");

// 6. the service worker: the site's own files, kept for offline use (cache first; a new version replaces them all)
{
	const files = walk(site)
		.map((f) => path.relative(site, f).split(path.sep).join("/"))
		.filter((f) => !f.startsWith(".") && f !== "sw.js" && f !== "404.html" && !f.startsWith("og-") && !f.startsWith("tour/") && !f.startsWith("editor/ort/")); // the tour (slides, PDFs) is read online, not kept; the speech runtime (21 MB) is kept after its first use
	const version = crypto.createHash("sha256").update(files.map((f) => `${f}:${fs.statSync(path.join(site, f)).size}`).join("\n")).digest("hex").slice(0, 12);
	const list = files.map((f) => (f.endsWith("/index.html") ? f.slice(0, -"index.html".length) : f === "index.html" ? "./" : f));
	fs.writeFileSync(path.join(site, "sw.js"), fs.readFileSync(path.join(S, "sw.template.js"), "utf8").replace("__VERSION__", version).replace("__FILES__", JSON.stringify(list)));
}

// 7. checks: sizes, no symlinks, no file over 50 MB (the words are the leak scan's: GZ_LEAK_SCAN=<leak-scan.mjs>)
const all = walk(site);
let total = 0;
const big = [];
const bad = [];
for (const f of all) {
	const st = fs.lstatSync(f);
	if (st.isSymbolicLink()) bad.push(`symlink ${f}`);
	total += st.size;
	if (st.size > 50 * 1024 * 1024) big.push(f);
}
const first = ["index.html", "site.css", "site.js", "icons/icon-32.png", "banner-en.svg"].map((f) => path.join(site, f)).filter((f) => fs.existsSync(f)).reduce((n, f) => n + fs.statSync(f).size, 0);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(`SITE ${site}: ${all.length} files, ${mb(total)}; landing first screen ${(first / 1024).toFixed(0)} KB; editor ${mb(walk(editor).reduce((n, f) => n + fs.statSync(f).size, 0))}`);
if (big.length) console.log(`OVER 50 MB: ${big.join(", ")}`);
if (bad.length) console.log(`SYMLINKS:\n  ${bad.join("\n  ")}`);
let leak = 0;
if (process.env.GZ_LEAK_SCAN) {
	try {
		execFileSync("node", [process.env.GZ_LEAK_SCAN, site], { stdio: "inherit", env: { ...process.env, LEAK_ANY: "1" } });
	} catch {
		leak = 1;
	}
}
process.exitCode = big.length || bad.length || leak ? 1 : 0;
