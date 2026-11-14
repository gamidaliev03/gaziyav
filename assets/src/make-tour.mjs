// The tour as a deck: docs/<lang>/tour.md (the one source) → tour/<lang>.html + tour/img/*, one slide per «---» block.
// Static, no outside hosts or fonts, works under any sub-path; ← / →, swipe, a progress line, #<n> deep links, and a
// print stylesheet with one slide per page. PDFs: `node assets/src/make-tour.mjs --pdf` (off-screen Electron).
//   node assets/src/make-tour.mjs [--pdf]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ELECTRON } from "./render.mjs";

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, "..", "..");
const OUT = path.join(ROOT, "tour");
const IMG = path.join(OUT, "img");
fs.mkdirSync(IMG, { recursive: true });

const UI = {
	en: { lang: "en", title: "Gaziyav — the tour", other: "ru", otherName: "Русский", prev: "Back", next: "Next", hint: "← → or swipe", download: "Download for macOS", browser: "Open in your browser", repo: "Source code" },
	ru: { lang: "ru", title: "Gaziyav — экскурсия", other: "en", otherName: "English", prev: "Назад", next: "Дальше", hint: "← → или свайп", download: "Скачать для macOS", browser: "Открыть в браузере", repo: "Исходный код" },
};

const esc = (s) => s.replace(/&(?!#?\w+;)/g, "&amp;");
/** Markdown inline → HTML: comments out, **bold**, [links](…) (relative doc links point to the repository). */
function inline(s) {
	return esc(s.replace(/<!--[\s\S]*?-->/g, "").trim())
		.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
			const url = /^https?:/.test(href) ? href : `https://github.com/gamidaliev03/gaziyav/blob/main/docs/LANG/${href}`;
			return `<a href="${url}">${text}</a>`;
		});
}

function slidesOf(lang) {
	const md = fs.readFileSync(path.join(ROOT, "docs", lang, "tour.md"), "utf8");
	return md.split(/\n---\n/).slice(1).map((block) => {
		const head = /^### (\d+) · (.+)$/m.exec(block);
		const img = /<img src="([^"]+)"[^>]*alt="([^"]*)"/.exec(block);
		const bullets = [...block.matchAll(/^- (.+)$/gm)].map((m) => inline(m[1]).replace(/docs\/LANG\//g, `docs/${lang}/`));
		let pic = null;
		if (img) {
			const src = path.resolve(path.join(ROOT, "docs", lang), img[1]);
			const ext = path.extname(src);
			const name = `${lang}-${head[1].padStart(2, "0")}${ext === ".gif" ? ".gif" : ".jpg"}`;
			if (fs.existsSync(src)) {
				if (ext === ".gif") fs.copyFileSync(src, path.join(IMG, name));
				else execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", "-Z", "1600", src, "--out", path.join(IMG, name)], { stdio: "ignore" });
				pic = { src: `img/${name}`, alt: img[2] };
				// a GIF prints as its last good frame: the still next to it
				if (ext === ".gif") {
					const still = path.join(ROOT, "assets", "screens", lang, "t-claude-after.jpg");
					if (fs.existsSync(still)) { execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", "-Z", "1600", still, "--out", path.join(IMG, `${lang}-${head[1].padStart(2, "0")}-print.jpg`)], { stdio: "ignore" }); pic.print = `img/${lang}-${head[1].padStart(2, "0")}-print.jpg`; }
				}
			}
		}
		return { n: Number(head[1]), title: inline(head[2]), bullets, pic };
	});
}

const KRYLO = fs.readFileSync(path.join(ROOT, "assets", "brand", "krylo.svg"), "utf8").replace(/<\?xml[^>]*>/, "").replace(/width="340" height="262"/, 'width="68" height="52" aria-hidden="true"');

function deck(lang) {
	const u = UI[lang];
	const slides = slidesOf(lang);
	const sec = slides.map((s, i) => {
		const first = i === 0;
		const pic = s.pic ? `<figure class="pic">${s.pic.print ? `<img class="screen-only" src="${s.pic.src}" alt="${s.pic.alt}"><img class="print-only" src="${s.pic.print}" alt="">` : `<img src="${s.pic.src}" alt="${s.pic.alt}" loading="${i < 2 ? "eager" : "lazy"}">`}</figure>` : "";
		const last = i === slides.length - 1
			? `<p class="cta"><a class="btn" href="https://github.com/gamidaliev03/gaziyav/releases/latest">${u.download}</a><a class="btn ghost" href="https://gamidaliev03.github.io/gaziyav/editor/">${u.browser}</a><a class="btn ghost" href="https://github.com/gamidaliev03/gaziyav">${u.repo}</a></p>`
			: "";
		return `<section class="slide${first ? " cover" : ""}" id="s${s.n}" aria-label="${s.n}">
	<div class="text">
		<p class="num">${String(s.n).padStart(2, "0")} <span>/ ${slides.length}</span></p>
		<h2>${s.title}</h2>
		<ul>${s.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>${last}
	</div>
	${pic}
</section>`;
	}).join("\n");
	return `<!doctype html>
<html lang="${u.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${u.title}</title>
<link rel="stylesheet" href="tour.css">
</head>
<body>
<header class="bar">
	<span class="mark">${KRYLO}<b>Gaziyav</b></span>
	<nav><a href="${u.other}.html" data-lang="${u.other}" class="lang">${u.otherName}</a></nav>
</header>
<main id="deck">
${sec}
</main>
<footer class="ctl">
	<button type="button" id="prev" aria-label="${u.prev}">←</button>
	<span id="count" aria-live="polite"></span>
	<button type="button" id="next" aria-label="${u.next}">→</button>
	<span class="hint">${u.hint}</span>
</footer>
<div class="progress"><i id="bar"></i></div>
<script src="tour.js"></script>
</body>
</html>
`;
}

for (const lang of ["en", "ru"]) {
	fs.writeFileSync(path.join(OUT, `${lang}.html`), deck(lang));
	console.log("deck", lang, slidesOf(lang).length, "slides");
}

if (process.argv.includes("--pdf")) {
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "gz-tour-"));
	const jobs = ["en", "ru"].map((lang) => ({ url: pathToFileURL(path.join(OUT, `${lang}.html`)).href, pdf: path.join(OUT, `Gaziyav-tour-${lang}.pdf`) }));
	fs.writeFileSync(path.join(work, "jobs.json"), JSON.stringify(jobs));
	fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "gz-tour", main: "main.cjs" }));
	fs.writeFileSync(path.join(work, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const jobs = JSON.parse(fs.readFileSync(process.env.GZ_JOBS, "utf8"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
	for (const j of jobs) {
		const w = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { offscreen: true } });
		await w.loadURL(j.url);
		await w.webContents.executeJavaScript("Promise.all([...document.images].map((i) => { i.loading = 'eager'; return i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }); }))");
		await new Promise((r) => setTimeout(r, 800));
		const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: "none" } });
		fs.writeFileSync(j.pdf, pdf);
		console.log("pdf", j.pdf, pdf.length);
		w.destroy();
	}
	app.quit();
});`);
	execFileSync(ELECTRON, [work, `--user-data-dir=${path.join(work, "profile")}`], { env: { ...process.env, GZ_JOBS: path.join(work, "jobs.json") }, stdio: ["ignore", "inherit", "ignore"], timeout: 5 * 60 * 1000 });
	fs.rmSync(work, { recursive: true, force: true });
}
