// Turns the raw captures of assets/capture.mjs into the README's pictures: every still in one consistent frame
// (a quiet window on the brand's night slate), the looks as one contact sheet, and the loops as GIF + MP4.
//   CAPTURE_RAW=/tmp/gz-capture-raw FFMPEG=<ffmpeg> node assets/src/frame.mjs
// Out: assets/screens/<lang>/<name>.jpg (1680 px wide), assets/screens/<lang>/looks.jpg, assets/loops/<name>-<lang>.gif|mp4
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { render } from "./render.mjs";

const HERE = import.meta.dirname;
const ASSETS = path.join(HERE, "..");
const RAW = path.resolve(process.env.CAPTURE_RAW || "/tmp/gz-capture-raw");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const WORK = fs.mkdtempSync(path.join(RAW, "frame-"));
const manifest = JSON.parse(fs.readFileSync(path.join(RAW, "manifest.json"), "utf8"));

// The stills the README uses (the rest stay raw). A still listed as missing for a language is skipped.
const STILLS = ["01-home", "02-editor", "03-guides", "04-export", "05-lipsync", "05-lipsync-sample", "06-lipsync-result", "07-media", "08-drag",
	// the tour and the manual (capture.mjs tourPass)
	"t-claude-before", "t-claude-after", "t-settings-ai", "t-settings-claude", "t-ondevice", "t-settings-share", "t-settings-edit", "t-settings-general",
	"t-tab-text", "t-tab-effects", "t-tab-transitions", "t-tab-filters", "t-tab-captions", "t-tab-audio", "t-link", "t-share", "t-post",
	"t-inspector-video", "t-inspector-title", "t-command", "t-keys", "t-web"];
const LOOK_NAMES = {
	en: { minimal: "Minimal", retro95: "95", terminal: "Terminal", pixel: "Pixel", neon: "Neon", midnight: "Midnight", glass: "Liquid glass", sand: "Sand", strict: "Strict", contrast: "High contrast", frost: "Frosted glass", comic: "Comic", sakura: "Sakura", rose: "Rose", arena: "Arena", film: "Film", analog: "Analog" },
	ru: { minimal: "Минимал", retro95: "95", terminal: "Терминал", pixel: "Пиксель", neon: "Неон", midnight: "Полночь", glass: "Жидкое стекло", sand: "Песок", strict: "Строгая", contrast: "Высокий контраст", frost: "Матовое стекло", comic: "Комикс", sakura: "Сакура", rose: "Роза", arena: "Арена", film: "Плёнка", analog: "Аналог" },
};
const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, sans-serif`;
const BG = `radial-gradient(120% 90% at 85% 100%, rgba(232,163,61,.20), transparent 60%), radial-gradient(80% 70% at 0% 0%, rgba(43,179,166,.14), transparent 60%), #07090C`;

const page = (body, w, h) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${BG};font-family:${FONT}}
.win{position:absolute;border-radius:14px;overflow:hidden;background:#0E1116;box-shadow:0 0 0 1px rgba(255,255,255,.09),0 24px 60px rgba(0,0,0,.55),0 4px 14px rgba(0,0,0,.4)}
.bar{height:30px;background:#14181e;display:flex;align-items:center;gap:8px;padding-left:14px;border-bottom:1px solid rgba(255,255,255,.06)}
.bar i{width:11px;height:11px;border-radius:50%;background:#3a3f48;display:block}
.win img{display:block;width:100%}
.label{position:absolute;color:#ECEEF2;font-size:22px;font-weight:600;letter-spacing:-.2px}
</style>${body}`;

const jobs = [];
const after = [];
for (const lang of Object.keys(manifest.langs)) {
	const got = new Set(manifest.langs[lang].got);
	const out = path.join(ASSETS, "screens", lang);
	fs.mkdirSync(out, { recursive: true });
	for (const name of STILLS) {
		const src = path.join(RAW, lang, `${name}.png`);
		if (!got.has(name) || !fs.existsSync(src)) continue;
		if (manifest.langs[lang].miss.some((m) => m.startsWith(name.slice(0, 2) + " ") && /no guides|older panel/.test(m) && name === "03-guides")) continue;
		const W = 1680, H = 1094;
		const html = path.join(WORK, `${lang}-${name}.html`);
		fs.writeFileSync(html, page(`<div class="win" style="left:40px;top:32px;width:1600px"><div class="bar"><i></i><i></i><i></i></div><img src="${pathToFileURL(src).href}"></div>`, W, H));
		const png = path.join(WORK, `${lang}-${name}.png`);
		jobs.push({ html, png, w: W, h: H, scale: 1, wait: 900 });
		after.push([png, path.join(out, `${name}.jpg`)]);
	}
	// the looks: a sheet with each look's name (3 columns; 4 when there are more than nine)
	const looks = (manifest.langs[lang].looks || []).filter((id) => fs.existsSync(path.join(RAW, lang, `09-look-${id}.png`)));
	if (looks.length) {
		const cw = 800, ch = 500, gap = 40, pad = 48, lab = 44;
		const cols = looks.length > 9 ? 4 : 3, rows = Math.ceil(looks.length / cols);
		const W = pad * 2 + cols * cw + (cols - 1) * gap, H = pad * 2 + rows * (ch + 30 + lab) + (rows - 1) * gap;
		const cells = looks.map((id, i) => {
			const x = pad + (i % cols) * (cw + gap), y = pad + Math.floor(i / cols) * (ch + 30 + lab + gap);
			return `<div class="win" style="left:${x}px;top:${y}px;width:${cw}px"><div class="bar" style="height:22px"><i></i><i></i><i></i></div><img src="${pathToFileURL(path.join(RAW, lang, `09-look-${id}.png`)).href}"></div>
			<div class="label" style="left:${x + 4}px;top:${y + ch + 22 + 12}px">${LOOK_NAMES[lang][id] ?? id}</div>`;
		}).join("");
		const html = path.join(WORK, `${lang}-looks.html`);
		fs.writeFileSync(html, page(cells, W, H));
		const png = path.join(WORK, `${lang}-looks.png`);
		jobs.push({ html, png, w: W, h: H, scale: 1, wait: 1200 });
		after.push([png, path.join(out, "looks.jpg"), 1680]);
	}
}
render(jobs);
for (const [png, jpg, width] of after) {
	execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "86", ...(width ? ["-Z", String(width)] : []), png, "--out", jpg], { stdio: "ignore" });
	console.log("framed", path.relative(ASSETS, jpg));
}

// Loops: frames → a palette GIF (≤ 6 MB, 960 px) and an H.264 MP4 (for the release page and posts).
// A loop whose frames stop changing is cut where the picture settles (+ a 1.5 s hold).
const LOOPS = { edit: { fps: 8 }, lipsync: { fps: 8 }, claude: { fps: 8 } };
fs.mkdirSync(path.join(ASSETS, "loops"), { recursive: true });
for (const lang of Object.keys(manifest.langs)) {
	for (const [name, o] of Object.entries(LOOPS)) {
		const dir = path.join(RAW, lang, `loop-${name}`);
		if (!fs.existsSync(dir)) continue;
		let files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
		if (files.length < 6) continue;
		// last frame where the picture changed
		const sizes = files.map((f) => fs.statSync(path.join(dir, f)).size);
		let last = sizes.length - 1;
		while (last > 1 && Math.abs(sizes[last] - sizes[last - 1]) < 64) last--;
		files = files.slice(0, Math.min(files.length, last + 1 + o.fps * 1.5));
		const list = path.join(WORK, `${lang}-${name}.txt`);
		fs.writeFileSync(list, files.map((f) => `file '${path.join(dir, f)}'\nduration ${1 / o.fps}`).join("\n") + `\nfile '${path.join(dir, files.at(-1))}'\n`);
		const gif = path.join(ASSETS, "loops", `${name}-${lang}.gif`);
		const mp4 = path.join(ASSETS, "loops", `${name}-${lang}.mp4`);
		for (const width of [960, 800, 720]) {
			execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=${o.fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", gif]);
			if (fs.statSync(gif).size <= 6 * 1024 * 1024) break;
		}
		execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=${o.fps * 3},scale=1440:-2:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-crf", "24", "-preset", "veryfast", "-movflags", "+faststart", mp4]);
		console.log("loop", path.relative(ASSETS, gif), (fs.statSync(gif).size / 1048576).toFixed(2), "MB");
	}
}
fs.rmSync(WORK, { recursive: true, force: true });
