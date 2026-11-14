// The reference screenshots and loops of the README, made by driving a test copy of the built app.
//
// Everything on screen is generated here (ffmpeg test sources, the app's own sample face, sine-wave music):
// no real footage, no real project, no real profile, no real API key — AI runs against the test stand-in
// for fal.ai (test/fake-fal.mjs), so nothing is paid and nothing leaves the computer.
//
//   cd <the desktop shell folder>          # the folder with test/editor4-lib.mjs and test/slot.sh
//   zsh test/slot.sh env STUDIO_APP_BUNDLE=dist/<build>/Gaziyav.app \
//       STUDIO_PORT=4021 STUDIO_DEBUG_PORT=10021 STUDIO_TEST_DIR=/tmp/gz-capture \
//       CAPTURE_OUT=<repo>/assets CAPTURE_RAW=/tmp/gz-capture-raw \
//       node <repo>/assets/capture.mjs
//   node <repo>/assets/src/frame.mjs        # frames the stills, builds the GIF / MP4 loops
//
// env: CAPTURE_LANGS=en,ru (default both) · CAPTURE_SHELL=<shell folder> (default: the current folder)
//      CAPTURE_TOUR=0 skips the tour / manual pictures (t-*, the «claude» loop) · CAPTURE_README=0 skips the README pass
//      CAPTURE_ONLY=claude makes only the «Claude edits inside» loop (the connector's own MCP server, driven by this script)
// Writes CAPTURE_RAW/<lang>/<nn>-<screen>.png (2× stills), CAPTURE_RAW/<lang>/loop-<name>/f-0000.jpg (loop frames)
// and CAPTURE_RAW/manifest.json (what was captured, what could not be reached on this build and why).
// Re-run it on every release build: the pictures must show the build that is offered for download.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SHELL = path.resolve(process.env.CAPTURE_SHELL || process.cwd());
const TEST = path.join(SHELL, "test");
const RAW = path.resolve(process.env.CAPTURE_RAW || "/tmp/gz-capture-raw");
const LANGS = (process.env.CAPTURE_LANGS || "en,ru").split(",").filter(Boolean);
fs.mkdirSync(RAW, { recursive: true });

const { FAKE_KEY, startFakeFal } = await import(path.join(TEST, "fake-fal.mjs"));
const { APP } = await import(path.join(TEST, "cdp.mjs"));
const RES = path.join(path.dirname(path.dirname(APP)), "Resources");
const FFMPEG = path.join(RES, "bin", "ffmpeg");
const fal = await startFakeFal({ ffmpeg: FFMPEG, dir: fs.mkdtempSync(path.join(RAW, "fal-")) });
process.env.STUDIO_FAKE_NET = fal.url;
const L = await import(path.join(TEST, "editor4-lib.mjs"));
const { sleep, ED } = L;

const manifest = { build: APP, started: new Date().toISOString(), langs: {} };
const W = 1440;
const H = 900;

// ---------- generated media: four pictures that look like footage, one presenter, one music bed ----------
const MEDIA = path.join(RAW, "media");
fs.mkdirSync(MEDIA, { recursive: true });
const ff = (args) => execFileSync(FFMPEG, ["-y", "-v", "error", ...args]);
const make = (name, args) => {
	const f = path.join(MEDIA, name);
	if (!fs.existsSync(f)) ff([...args, f]);
	return f;
};
const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"];
const media = {
	dawn: make("dawn.mp4", ["-f", "lavfi", "-i", "gradients=s=1920x1080:c0=0x0b1a2e:c1=0xe8a33d:c2=0xff6f2c:c3=0x2bb3a6:n=4:speed=0.012:type=radial:d=8:r=30", ...enc]),
	coast: make("coast.mp4", ["-f", "lavfi", "-i", "gradients=s=1920x1080:c0=0x07343f:c1=0x2bb3a6:c2=0xf6f3ec:n=3:speed=0.02:type=linear:d=8:r=30", ...enc]),
	city: make("city.mp4", ["-f", "lavfi", "-i", "life=s=320x180:mold=8:r=30:ratio=0.12:death_color=#0E1116:life_color=#E8A33D:mold_color=#2BB3A6,scale=1920:1080:flags=neighbor", "-t", "8", ...enc]),
	depth: make("depth.mp4", ["-f", "lavfi", "-i", "mandelbrot=s=1920x1080:r=30:maxiter=400:start_scale=2.5:end_scale=0.05", "-t", "8", ...enc]),
	theme: make("theme.m4a", ["-f", "lavfi", "-i", "aevalsrc=0.18*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.12*sin(2*PI*277.2*t)+0.1*sin(2*PI*329.6*t)+0.25*sin(2*PI*55*t)*exp(-8*mod(t\\,0.5)):s=48000:d=30", "-c:a", "aac", "-b:a", "160k"]),
};
// the presenter: the app's own sample face, speaking with macOS's built-in synthetic voice (made here, nothing downloaded),
// and the new line it should say — real speech, so the lipsync panel offers its 3-second sample
const SAY = (file, text) => { const aiff = file.replace(/\.m4a$/, ".aiff"); if (!fs.existsSync(file)) { execFileSync("/usr/bin/say", ["-v", "Samantha", "-o", aiff, text]); ff(["-i", aiff, "-ar", "48000", "-ac", "1", "-c:a", "aac", "-b:a", "128k", file]); } return file; };
const hostVoice = SAY(path.join(MEDIA, "host-voice.m4a"), "Welcome back to the channel. Today I am showing you three quick edits for your reels. Let's start with the first one, it takes ten seconds.");
media.line = SAY(path.join(MEDIA, "new-line.m4a"), "Hi! This whole clip was edited for free, and my lips were synced for a few cents. Try it yourself.");
media.host = path.join(MEDIA, "host.mp4");
if (!fs.existsSync(media.host)) {
	const photo = path.join(RES, "web", "apps", "web", "public", "faces", "hero.jpg");
	ff(["-f", "lavfi", "-i", "color=c=0x3a3f48:s=1080x1920:r=30:d=12", "-loop", "1", "-i", photo, "-i", hostVoice, "-filter_complex", "[1:v]scale=900:900[f];[0:v][f]overlay=x='90+30*sin(t*0.9)':y='420+20*cos(t*0.7)':shortest=1,format=yuv420p[v]", "-map", "[v]", "-map", "2:a", "-t", "12", ...enc, "-c:a", "aac", media.host]);
}

const NAMES = {
	en: { project: "Launch reel", title: "Made in Gaziyav", line: "Hi! This whole clip was edited for free — and my lips were synced for twenty cents." },
	ru: { project: "Рилс к запуску", title: "Монтаж: Gaziyav", line: "Привет! Этот ролик смонтирован бесплатно, а губы синхронизированы за двадцать центов." },
};

// ---------- helpers ----------
const p = await L.start();
const esc = async (n = 1) => { for (let i = 0; i < n; i++) { await p.key("Escape", { code: "Escape" }); await sleep(300); } };
const dir = (lang) => { const d = path.join(RAW, lang); fs.mkdirSync(d, { recursive: true }); return d; };
async function still(lang, name) {
	const s = await p.send("Page.captureScreenshot", { format: "png" });
	fs.writeFileSync(path.join(dir(lang), `${name}.png`), Buffer.from(s.data, "base64"));
	manifest.langs[lang].got.push(name);
}
function loop(lang, name) {
	const d = path.join(dir(lang), `loop-${name}`);
	fs.rmSync(d, { recursive: true, force: true });
	fs.mkdirSync(d, { recursive: true });
	let n = 0;
	return {
		async frame(times = 1) {
			for (let i = 0; i < times; i++) {
				const s = await p.send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
				fs.writeFileSync(path.join(d, `f-${String(n++).padStart(4, "0")}.jpg`), Buffer.from(s.data, "base64"));
			}
		},
		get count() { return n; },
	};
}
const miss = (lang, what) => { manifest.langs[lang].miss.push(what); console.log(`  [${lang}] missing: ${what}`); };
const tracks = `${ED}.scenes.getActiveScene().tracks`;
const asset = (name) => `${ED}.media.getAssets().find((a) => a.name === ${JSON.stringify(name)})`;
async function select(name) {
	return p.eval(`(() => { const t = ${tracks}; for (const tr of [t.main, ...(t.overlay || []), ...(t.audio || [])]) for (const e of tr.elements) { const a = ${ED}.media.getAssets().find((x) => x.id === e.mediaId); if (a && a.name === ${JSON.stringify(name)}) { ${ED}.selection.setSelectedElements({ elements: [{ trackId: tr.id, elementId: e.id }] }); return e.id; } } return null; })()`);
}
async function clipBox(id) {
	return p.eval(`(() => { const r = document.querySelector('[data-timeline-element-id="${id}"]')?.getBoundingClientRect(); return r ? { x: r.x + Math.min(48, r.width / 2), y: r.y + r.height / 2 } : null; })()`);
}
async function openSettings(section) {
	const ok = await p.eval(`(() => { const b = window.__studioBridge; if (b?.openSettings) { b.openSettings(${JSON.stringify(section)}); return true; } window.__studioMenu?.('keys'); return false; })()`);
	await sleep(700);
	if (!ok) {
		const b = await L.boxOf(p, `[data-settings-section="${section}"]`);
		if (b) await p.mouse(b.x, b.y);
		await sleep(500);
	}
}

/** The project: four «shots» on the main track, the presenter above, music under, a title, the playhead on a shot. */
async function buildProject(lang) {
	const n = NAMES[lang];
	await p.eval(`(async () => {
		const b = window.__studioBridge, ed = b.editor(), tps = b.ticksPerSecond();
		const t0 = ${tracks};
		const all = [t0.main, ...(t0.overlay || []), ...(t0.audio || [])].flatMap((tr) => tr.elements.map((e) => ({ trackId: tr.id, elementId: e.id })));
		if (all.length) ed.timeline.deleteElements({ elements: all });
		const a = (n) => ed.media.getAssets().find((x) => x.name === n);
		let at = 0;
		for (const n of ['dawn.mp4', 'city.mp4', 'coast.mp4', 'depth.mp4']) { b.placeOnTimeline(ed, a(n), at); at += 8; }
		b.placeOnTimeline(ed, a('theme.m4a'), 0);
		ed.timeline.insertElement({ placement: { mode: 'auto', trackType: 'text' }, element: { type: 'text', name: ${JSON.stringify(n.title)}, startTime: 1 * tps, duration: 4 * tps, trimStart: 0, trimEnd: 0, params: { content: ${JSON.stringify(n.title)} } } });
		try { await ed.project.renameProject({ id: ed.project.getActive().metadata.id, name: ${JSON.stringify(n.project)} }); } catch {}
		ed.playback.seek({ time: 2.5 * tps });
	})()`);
	await sleep(2500);
}

async function setLanguage(lang) {
	await p.eval(`localStorage.setItem('gaziyav.language', ${JSON.stringify(lang)}); location.reload()`).catch(() => null);
	await sleep(3000);
	await p.waitFor(`document.readyState === 'complete' && (!location.pathname.startsWith('/editor/') || !!${ED}?.project?.getActive?.())`, { timeout: 60000, label: `reload in ${lang}` });
	await sleep(2500);
}

// ---------- the screens ----------
async function pass(lang) {
	manifest.langs[lang] = { got: [], miss: [], loops: {} };
	await setLanguage(lang);
	await buildProject(lang);

	// 02 the editor with the project
	await select("dawn.mp4");
	await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: W / 2, y: H - 20 });
	await sleep(1200);
	await still(lang, "02-editor");

	// 03 guides in the player («Markup» button; older builds: the safe-zones button)
	try {
		const mk = await L.boxOf(p, "[data-markup-button]");
		if (!mk) throw new Error("no guides button in the player bar on this build");
		await p.mouse(mk.x, mk.y);
		await sleep(700);
		for (const layer of ["thirds", "title", "action", "text"]) {
			const t = await L.boxOf(p, `[data-markup-toggle="${layer}"]`);
			if (t && (await p.eval(`document.querySelector('[data-markup-toggle="${layer}"]').getAttribute('aria-checked')`)) !== "true") { await p.mouse(t.x, t.y); await sleep(250); }
		}
		await esc();
		await sleep(500);
		const guides = await p.eval(`document.querySelectorAll('[data-markup-guide], [data-safe-zone], [data-safe-zones] *').length`);
		if (!guides) { await p.mouse(mk.x, mk.y); await sleep(300); await esc(); throw new Error("no guides drawn over the player on this build (the «Markup» button arrives with the release build)"); }
		await still(lang, "03-guides");
		// every guide off again: the later pictures show a clean player
		await p.mouse(mk.x, mk.y); await sleep(500);
		for (const layer of ["thirds", "title", "action", "text", "social", "platform", "safe"]) {
			const t = await L.boxOf(p, `[data-markup-toggle="${layer}"]`);
			if (t && (await p.eval(`document.querySelector('[data-markup-toggle="${layer}"]').getAttribute('aria-checked')`)) === "true") { await p.mouse(t.x, t.y); await sleep(250); }
		}
		await p.eval(`[...document.querySelectorAll('[data-markup-toggle][aria-checked="true"]')].forEach((e) => e.click())`).catch(() => {});
		await sleep(300); await esc();
	} catch (e) { miss(lang, `03 guides: ${e.message}`); }

	// 04 the export window
	try {
		const ex = await L.boxOf(p, '[data-testid="export-button"]');
		if (!ex) throw new Error("no Export button");
		await p.mouse(ex.x, ex.y);
		await sleep(1500);
		await still(lang, "04-export");
		await esc();
	} catch (e) { miss(lang, `04 export: ${e.message}`); }

	// 05 lipsync: the presenter above the shots, its clip menu → Lipsync, the words typed
	const lip = loop(lang, "lipsync");
	try {
		await p.eval(`(() => { const b = window.__studioBridge, ed = b.editor(); const a = ${asset("host.mp4")}; const t = ed.scenes.getActiveScene().tracks; if (![t.main, ...(t.overlay || [])].some((tr) => tr.elements.some((e) => e.mediaId === a.id))) b.placeOnTimeline(ed, a, 32); })()`);
		await sleep(1200);
		const id = await select("host.mp4");
		await p.eval(`${ED}.playback.seek({ time: 33 * window.__studioBridge.ticksPerSecond() })`);
		await sleep(1200);
		await lip.frame(6);
		const box = await clipBox(id);
		await p.key("¬", { code: "KeyL", modifiers: 1 });
		await sleep(1500);
		let opened = !!(await p.eval(`!!document.querySelector('[data-lipsync-text], [data-lipsync-sound]')`));
		if (!opened && box) {
			await p.mouse(box.x, box.y, { button: "right" });
			await sleep(700);
			await lip.frame(4);
			const item = await p.eval(`(() => { const e = document.querySelector('[data-lipsync-menu]') ?? [...document.querySelectorAll('[role=menuitem]')].find((m) => /lip ?sync|липсинк/i.test(m.innerText)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
			if (item) { await p.mouse(item.x, item.y); await sleep(1500); } else await esc();
			opened = !!(await p.eval(`!!(document.querySelector('[data-lipsync-text]') || document.querySelector('[data-lipsync-window]'))`));
		}
		if (!opened) throw new Error("the lipsync panel did not open from the clip's menu");
		await lip.frame(5);
		// the words field: the release build's [data-lipsync-text]; older builds: the panel's own text box
		await p.eval(`(() => { if (document.querySelector('[data-lipsync-text]')) return; const t = [...document.querySelectorAll('textarea')].find((x) => x.getBoundingClientRect().width > 0 && /what they say|что (он |она )?говор|текст|words/i.test(x.placeholder || '')); if (t) t.setAttribute('data-capture-words', ''); })()`);
		const legacy = !(await L.boxOf(p, "[data-lipsync-text]"));
		const field = (await L.boxOf(p, "[data-lipsync-text]")) ?? (await L.boxOf(p, "[data-capture-words]"));
		const clickText = async (re) => {
			const b = await p.eval(`(() => { const re = new RegExp(${JSON.stringify(re.source)}, 'i'); const e = [...document.querySelectorAll('button')].find((x) => x.getBoundingClientRect().width > 0 && !x.disabled && re.test((x.innerText || '').trim())); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
			if (b) await p.mouse(b.x, b.y);
			return !!b;
		};
		if (field && legacy) {
			await p.mouse(field.x, field.y);
			const words = NAMES[lang].line.split(" ");
			for (let i = 0; i < words.length; i += 2) { await p.type(words.slice(i, i + 2).join(" ") + " "); await lip.frame(); }
			await sleep(800);
			await lip.frame(4);
			await still(lang, "05-lipsync");
			// older panel: «Voice it» first, then the pinned «Lipsync · ≈ $…» button and its price dialog
			if (await clickText(/^(voice it|озвучить)/)) {
				const tv = Date.now();
				while (Date.now() - tv < 30000) { await lip.frame(); await sleep(500); if (await p.eval(`!![...document.querySelectorAll('button')].find((x) => /^(lipsync|липсинк)\\s*·/i.test((x.innerText || '').trim()) && !x.disabled)`)) break; }
			}
			await clickText(/^(lipsync|липсинк)\s*·/);
			await sleep(700);
			await lip.frame(3);
			await clickText(/^(lipsync|липсинк|run|start|запустить|ok|да)\b/);
			const t0 = Date.now();
			while (Date.now() - t0 < 60000) {
				await lip.frame();
				const done = await p.eval(`/before\\/after|до\\/после|до \\/ после/i.test(document.body.innerText)`).catch(() => false);
				if (done) break;
				await sleep(400);
			}
			await sleep(1200);
			await lip.frame(10);
			await still(lang, "06-lipsync-result");
			manifest.langs[lang].loops.lipsync = lip.count;
			miss(lang, "05/06 lipsync: older panel on this build (voice, then lipsync with a price dialog) — the two-click panel arrives with the release build");
			throw new Error("legacy panel captured");
		}
		const boxClick = async (sel) => { const b = await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`); if (b) { await p.mouse(b.x, b.y); await sleep(500); } return !!b; };
		// the sound: the new line from Media (real speech → the panel offers a sample)
		const lineId = await p.eval(`${asset("new-line.m4a")}?.id ?? null`);
		let sound = false;
		if (lineId && (await boxClick("[data-lipsync-sound]"))) {
			await lip.frame(3);
			sound = await boxClick(`[data-lipsync-sound-option="media:${lineId}"]`);
			if (!sound) await esc();
		}
		if (!sound) {
			miss(lang, "05 lipsync: the new line was not in the «Sound» list — typed the words instead");
			if (field) { await p.mouse(field.x, field.y); const words = NAMES[lang].line.split(" "); for (let i = 0; i < words.length; i += 2) { await p.type(words.slice(i, i + 2).join(" ") + " "); await lip.frame(); } }
		}
		await p.waitFor(`!!document.querySelector('[data-testid=lipsync-price]')?.hasAttribute('data-usd')`, { timeout: 20000, label: "price" }).catch(() => {});
		await p.waitFor(`!!document.querySelector('[data-testid=sample-go]')`, { timeout: 20000, label: "sample offer" }).catch(() => miss(lang, "05 lipsync: no sample offer on the panel"));
		await sleep(800);
		await lip.frame(6);
		// the model list, open: every model with its price for this clip
		if (await boxClick("[data-lipsync-model-trigger]")) {
			await p.waitFor(`document.querySelectorAll('[data-lipsync-model]').length > 1`, { timeout: 8000, label: "model list" }).catch(() => miss(lang, "05 lipsync: the model list did not open"));
			await sleep(600);
			await lip.frame(8);
			await still(lang, "05-lipsync");
			await boxClick("[data-lipsync-model-trigger]");
			await sleep(400);
		} else { miss(lang, "05 lipsync: no model list trigger"); await still(lang, "05-lipsync"); }
		// the 3-second sample, played in the panel
		if (await boxClick("[data-testid=sample-go]")) {
			await p.waitFor(`!!document.querySelector('[data-lipsync-sample] video')`, { timeout: 45000, label: "the sample" }).then(async () => {
				await boxClick("[data-sample-play]");
				await sleep(1200);
				await lip.frame(10);
				await still(lang, "05-lipsync-sample");
			}).catch(() => miss(lang, "05 lipsync: the sample did not land"));
		}
		// the whole clip: «Make the whole» under the sample (else ⌘↵) runs it against the stand-in; frames until the result lands (or 45 s)
		if (!(await boxClick("[data-sample-whole]"))) await p.key("Enter", { code: "Enter", modifiers: 4 });
		await sleep(600);
		const confirm = await L.boxOf(p, "[data-confirm-go]");
		if (confirm) await p.mouse(confirm.x, confirm.y);
		const t0 = Date.now();
		while (Date.now() - t0 < 45000) {
			await lip.frame();
			const done = await p.eval(`(() => { const s = window.__studioStore?.getState?.(); if (!s) return false; return Object.values(s.clipRuns ?? {}).some((r) => r?.done || r?.error) || Object.values(s.runs ?? {}).some((r) => r?.done || r?.error); })()`).catch(() => false);
			if (done) break;
			await sleep(400);
		}
		await sleep(1500);
		await lip.frame(10);
		await still(lang, "06-lipsync-result");
		manifest.langs[lang].loops.lipsync = lip.count;
	} catch (e) { if (e.message !== "legacy panel captured") miss(lang, `05/06 lipsync: ${e.message}`); manifest.langs[lang].loops.lipsync = lip.count; }
	await esc(2);

	// loop «edit»: Media tile → timeline drag, a cut at the playhead (⌘B), a title, the Export window
	const ed = loop(lang, "edit");
	try {
		await buildProject(lang);
		await p.eval(`(() => { const t = ${tracks}; const all = t.main.elements.filter((e) => ${ED}.media.getAssets().find((a) => a.id === e.mediaId)?.name !== 'dawn.mp4').map((e) => ({ trackId: t.main.id, elementId: e.id })); if (all.length) ${ED}.timeline.deleteElements({ elements: all }); })()`);
		await L.openTab(p, "Media").catch(() => {});
		await sleep(900);
		await ed.frame(6);
		const tile = await p.eval(`(() => { const e = [...document.querySelectorAll('[data-assets-panel] [data-asset-tile], [data-assets-panel] [aria-label]')].find((x) => /city\\.mp4/.test(x.getAttribute('aria-label') || x.innerText || '')); const r = e?.getBoundingClientRect(); return r && r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
		const dropAt = await p.eval(`(() => { const t = ${tracks}; const e = t.main.elements[0]; const r = e && document.querySelector('[data-timeline-element-id="' + e.id + '"]')?.getBoundingClientRect(); return r ? { x: r.right + 60, y: r.y + r.height / 2 } : null; })()`);
		if (!tile || !dropAt) throw new Error(`drag: tile ${!!tile}, drop place ${!!dropAt}`);
		await still(lang, "07-media");
		await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tile.x, y: tile.y });
		await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x: tile.x, y: tile.y, button: "left", clickCount: 1 });
		const steps = 18;
		for (let i = 1; i <= steps; i++) {
			const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
			await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tile.x + (dropAt.x - tile.x) * e, y: tile.y + (dropAt.y - tile.y) * e, button: "left", buttons: 1 });
			await sleep(40);
			await ed.frame();
			if (i === Math.round(steps * 0.8)) await still(lang, "08-drag");
		}
		await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dropAt.x, y: dropAt.y, button: "left", clickCount: 1 });
		await sleep(900);
		await ed.frame(6);
		await p.eval(`${ED}.playback.seek({ time: 4 * window.__studioBridge.ticksPerSecond() })`);
		await select("dawn.mp4");
		await sleep(500);
		await ed.frame(3);
		await p.key("b", { code: "KeyB", modifiers: 4 });
		await sleep(700);
		await ed.frame(6);
		await ed.frame(4);
		const ex = await L.boxOf(p, '[data-testid="export-button"]');
		if (ex) { await p.mouse(ex.x, ex.y); await sleep(1200); await ed.frame(10); await esc(); }
		manifest.langs[lang].loops.edit = ed.count;
	} catch (e) { miss(lang, `edit loop: ${e.message}`); manifest.langs[lang].loops.edit = ed.count; }

	// 09 the looks: six tiles of Settings → Appearance, the editor in each
	try {
		await openSettings("appearance");
		const tiles = await p.eval(`[...document.querySelectorAll('[data-theme-tile]')].map((e) => e.getAttribute('data-theme-tile'))`);
		await esc();
		const SKINS = ["minimal", "pixel", "neon", "comic", "sakura", "rose", "arena", "film", "analog", "terminal", "retro95", "midnight"];
		const six = SKINS.filter((id) => tiles.includes(id));
		for (const id of SKINS) if (!tiles.includes(id)) miss(lang, `look ${id}: no tile in Settings → Themes`);
		manifest.langs[lang].looks = six;
		for (const id of six) {
			await openSettings("appearance");
			let b = await L.boxOf(p, `[data-theme-tile="${id}"]`);
			if (!b) for (const m of ["dark", "light"]) { const mb = await L.boxOf(p, `[data-theme-mode="${m}"]`); if (mb) { await p.mouse(mb.x, mb.y); await sleep(300); } b = await L.boxOf(p, `[data-theme-tile="${id}"]`); if (b) break; }
			if (!b) { miss(lang, `look ${id}: no tile`); await esc(); continue; }
			await p.mouse(b.x, b.y);
			await sleep(600);
			await esc();
			await select("dawn.mp4");
			await sleep(900);
			await still(lang, `09-look-${id}`);
		}
		await openSettings("appearance");
		const m = await L.boxOf(p, `[data-theme-tile="minimal"]`);
		if (m) await p.mouse(m.x, m.y);
		await sleep(400);
		await esc();
	} catch (e) { miss(lang, `09 looks: ${e.message}`); }

	// 01 Home (last: it leaves the editor)
	try {
		await p.eval(`location.href = '/projects'`);
		await p.waitFor(`location.pathname.startsWith('/projects') && document.querySelectorAll('[data-project-card]').length > 0`, { label: "home", timeout: 30000 });
		await sleep(2000);
		await still(lang, "01-home");
		const card = await p.eval(`(() => { const r = document.querySelector('[data-project-card]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 60) }; })()`);
		await p.mouse(card.x, card.y);
		await p.waitFor(`location.pathname.startsWith('/editor/') && !!${ED}?.project?.getActive?.()`, { label: "back to the project", timeout: 30000 });
		await sleep(2000);
	} catch (e) { miss(lang, `01 home: ${e.message}`); }
}


// ---------- the tour and the manual: one picture per slide / page (CAPTURE_TOUR=0 skips) ----------
// «Claude edits inside»: the connector's own MCP server (Resources/mcp/gaziyav-mcp, over stdio, as Claude for Mac
// starts it) is driven by this script — no Claude, no account: the instruction is shown as a caption over the app,
// the tool call runs, the timeline changes, the frames are the loop.
const TOUR = {
	en: { ask: "remove the pauses", done: "Done on your timeline · one ⌘Z undoes it", who: "You → Claude" },
	ru: { ask: "убери паузы", done: "Сделано на твоём таймлайне · ⌘Z отменяет", who: "Ты → Claude" },
};
media.talk = make("talk.mp4", ["-f", "lavfi", "-i", "gradients=s=1920x1080:c0=0x1b2430:c1=0x2bb3a6:c2=0xe8a33d:n=3:speed=0.01:type=radial:d=12:r=30", "-f", "lavfi", "-i", "aevalsrc=0.35*sin(2*PI*190*t)*(0.55+0.45*sin(2*PI*5*t))*(lt(t\\,2.4)+between(t\\,4\\,6.8)+gte(t\\,8.6)):s=48000:d=12", "-shortest", ...enc, "-c:a", "aac"]);
async function caption(text, sub = "") {
	await p.eval(`(() => { let d = document.getElementById('gz-capture-say'); if (!d) { d = document.createElement('div'); d.id = 'gz-capture-say'; document.body.appendChild(d); }
		d.style.cssText = 'position:fixed;right:28px;top:72px;z-index:2147483647;display:${text ? "flex" : "none"};flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none;font:600 22px -apple-system,system-ui,sans-serif';
		d.innerHTML = '<div style="font:500 13px -apple-system,system-ui;color:#B0B9C6;background:#0E1116cc;padding:3px 10px;border-radius:99px">' + ${JSON.stringify(sub)} + '</div><div style="background:#E8A33D;color:#1A1206;padding:12px 22px;border-radius:24px 24px 6px 24px;box-shadow:0 8px 30px #0008">' + ${JSON.stringify(text)} + '</div>'; })()`);
}
async function tourPass(lang) {
	const T = TOUR[lang];
	const m = manifest.langs[lang];
	// t-claude: the loop + two stills
	const lp = loop(lang, "claude");
	let mcp;
	try {
		await p.eval(`(() => { const b = window.__studioBridge, ed = b.editor(); const t0 = ${tracks}; const all = [t0.main, ...(t0.overlay || []), ...(t0.audio || [])].flatMap((tr) => tr.elements.map((e) => ({ trackId: tr.id, elementId: e.id }))); if (all.length) ed.timeline.deleteElements({ elements: all }); const a = ed.media.getAssets().find((x) => x.name === 'talk.mp4'); b.placeOnTimeline(ed, a, 0); ed.playback.seek({ time: 0 }); })()`);
		await sleep(2500);
		await p.eval(`document.querySelector('[data-timeline-zoom-fit], [aria-label="Fit"], [aria-label="Zoom to fit"]')?.click()`).catch(() => {});
		await p.eval(`${ED}.selection.setSelectedElements({ elements: [] })`).catch(() => {});
		await p.key("Z", { code: "KeyZ", modifiers: 8 }).catch(() => {});
		await esc();
		await sleep(800);
		await lp.frame(8);
		await caption(T.ask, T.who);
		await lp.frame(16);
		await still(lang, "t-claude-before");
		const { McpClient } = await import(path.join(RES, "mcp", "client.mjs"));
		mcp = new McpClient(path.join(RES, "mcp", "gaziyav-mcp"), [], { GAZIYAV_URL: `http://127.0.0.1:${process.env.STUDIO_PORT}`, GAZIYAV_SUPPORT_DIR: path.join(path.resolve(process.env.STUDIO_TEST_DIR), "userdata"), GAZIYAV_NO_LAUNCH: "1", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" });
		await mcp.initialize();
		const before = await p.eval(`${tracks}.main.elements.length`);
		let how = "remove_pauses";
		let done = false;
		const run = mcp.call("edit", { ops: [{ op: "remove_pauses", id: "clip 1" }] }, 90_000).then((r) => { done = true; return r; }, (e) => { done = true; return { error: e.message }; });
		const t0 = Date.now();
		while (!done && Date.now() - t0 < 90_000) { await lp.frame(); await sleep(250); }
		const r1 = await run;
		console.log(`  [${lang}] remove_pauses answered:`, JSON.stringify(r1).slice(0, 400));
		let after = await p.eval(`${tracks}.main.elements.length`);
		if (after <= before) {
			// no speech model in a test profile: the same instruction as the cut a person would ask for by times
			how = `cut_out (remove_pauses answered: ${JSON.stringify(r1).slice(0, 160)})`;
			const r2 = await mcp.call("edit", { ops: [{ op: "cut_out", ranges: [{ from: 2.5, to: 4 }, { from: 6.9, to: 8.5 }] }] }, 60_000).catch((e) => ({ error: e.message }));
			console.log(`  [${lang}] cut_out answered:`, JSON.stringify(r2).slice(0, 400));
			for (let i = 0; i < 6; i++) { await lp.frame(); await sleep(200); }
			after = await p.eval(`${tracks}.main.elements.length`);
		}
		if (after <= before) {
			// no speech model in a test profile (574 MB, never downloaded here): the same pauses cut by plain editor steps
			how += " → split + ripple delete";
			const r3 = await mcp.call("edit", { ops: [{ op: "split", time: 2.45 }, { op: "split", time: 3.95 }, { op: "split", time: 6.85 }, { op: "split", time: 8.55 }, { op: "delete", ids: ["clip 4", "clip 2"], closeGap: true }] }, 60_000).catch((e) => ({ error: e.message }));
			console.log(`  [${lang}] split+delete answered:`, JSON.stringify(r3).slice(0, 400));
			for (let i = 0; i < 6; i++) { await lp.frame(); await sleep(200); }
			after = await p.eval(`${tracks}.main.elements.length`);
		}
		m.claude = { how, before, after };
		if (after <= before) { await caption(""); throw new Error(`the timeline did not change (${how})`); }
		await caption(T.done, T.who);
		await lp.frame(30);
		await still(lang, "t-claude-after");
		await caption("");
		m.loops.claude = lp.count;
	} catch (e) { miss(lang, `t-claude: ${e.message}`); m.loops.claude = lp.count; await caption("").catch(() => {}); }
	try { mcp?.close?.(); mcp?.proc?.kill?.(); } catch {}
	if (process.env.CAPTURE_ONLY === "claude") return;
	await buildProject(lang);
	await select("dawn.mp4");
	// Settings → AI (on-device models, Claude, the key): scrolled stills
	try {
		await openSettings("ai");
		await sleep(800);
		await still(lang, "t-settings-ai");
		for (const [sel, name] of [["[data-settings-claude]", "t-settings-claude"], ["[data-ondevice-models], [data-model-row], [data-ondevice]", "t-ondevice"]]) {
			const ok = await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); return true; })()`);
			await sleep(600);
			if (ok) await still(lang, name); else miss(lang, `${name}: ${sel} not found`);
		}
		await esc();
	} catch (e) { miss(lang, `settings ai: ${e.message}`); await esc(); }
	// Settings → Share, → Edit, → Keys
	for (const s of ["share", "edit", "general"]) {
		try { await openSettings(s); await sleep(700); await still(lang, `t-settings-${s}`); await esc(); } catch (e) { miss(lang, `settings ${s}: ${e.message}`); }
	}
	// the side panel's tabs: Text, Effects, Transitions, Filters, Captions…
	for (const tab of ["Text", "Effects", "Transitions", "Filters", "Captions", "Audio"]) {
		try { await L.openTab(p, tab); await sleep(900); await still(lang, `t-tab-${tab.toLowerCase()}`); } catch (e) { miss(lang, `tab ${tab}: ${e.message}`); }
	}
	await L.openTab(p, "Media").catch(() => {});
	// a link straight into the edit: the link dialog
	try {
		const ok = await p.eval(`(() => { const s = window.__studioStore?.getState?.(); if (s?.setYoutubeOpen) { s.setYoutubeOpen(true); return true; } return false; })()`);
		if (!ok) throw new Error("no link dialog hook on this build");
		await sleep(1200);
		await still(lang, "t-link");
		await esc();
	} catch (e) { miss(lang, `t-link: ${e.message}`); await esc(); }
	// Share → Post: the popover, then the post sheet
	try {
		const b = await L.boxOf(p, "[data-share-button]");
		if (!b) throw new Error("no Share button");
		await p.mouse(b.x, b.y); await sleep(700);
		await still(lang, "t-share");
		const pb = await L.boxOf(p, "[data-share-post]");
		if (pb) { await p.mouse(pb.x, pb.y); await sleep(1300); await still(lang, "t-post"); }
		await esc(2);
	} catch (e) { miss(lang, `t-share: ${e.message}`); await esc(2); }
	// the inspector of a selected clip (speed, colour, keyframes live there) and of a title
	try {
		await select("dawn.mp4"); await sleep(900); await still(lang, "t-inspector-video");
		const tid = await p.eval(`(() => { const t = ${tracks}; for (const tr of t.overlay || []) for (const e of tr.elements) if (e.type === 'text') { ${ED}.selection.setSelectedElements({ elements: [{ trackId: tr.id, elementId: e.id }] }); return e.id; } return null; })()`);
		if (tid) { await sleep(900); await still(lang, "t-inspector-title"); }
	} catch (e) { miss(lang, `inspector: ${e.message}`); }
	// ⌘K and the keys list
	try { await p.key("k", { code: "KeyK", modifiers: 4 }); await sleep(900); await still(lang, "t-command"); await esc(); } catch (e) { miss(lang, `⌘K: ${e.message}`); }
	try { await p.key("/", { code: "Slash", modifiers: 4 }); await sleep(900); await still(lang, "t-keys"); await esc(); } catch (e) { miss(lang, `⌘/: ${e.message}`); }
}

try {
	await p.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
	await sleep(500);
	await L.newProject(p);
	await L.importFiles(p, Object.values(media), { keepPlaced: true });
	await sleep(1500);
	// the stand-in key, typed where a person types it (Settings → AI); prices then show on the buttons
	try {
		await openSettings("ai");
		const f = await L.boxOf(p, "[data-fal-key-input]");
		if (f) {
			await p.mouse(f.x, f.y);
			await p.type(FAKE_KEY);
			const s = await L.boxOf(p, "[data-fal-save]");
			if (s) await p.mouse(s.x, s.y);
			await sleep(1500);
		}
		await esc();
	} catch {}
	for (const lang of LANGS) {
		console.log(`pass ${lang}`);
		if (process.env.CAPTURE_TOUR !== "0") { manifest.langs[lang] = { got: [], miss: [], loops: {} }; await setLanguage(lang); await buildProject(lang); await tourPass(lang); }
		if (process.env.CAPTURE_README !== "0") { const keep = manifest.langs[lang]; await pass(lang); if (keep) { manifest.langs[lang].got.unshift(...keep.got); manifest.langs[lang].miss.unshift(...keep.miss); Object.assign(manifest.langs[lang].loops, keep.loops); if (keep.claude) manifest.langs[lang].claude = keep.claude; } }
	}
} catch (e) {
	console.log(`capture stopped: ${e.stack || e.message}`);
	manifest.error = String(e.message);
}
manifest.finished = new Date().toISOString();
manifest.falCalls = fal.log?.length ?? null;
fs.writeFileSync(path.join(RAW, "manifest.json"), JSON.stringify(manifest, null, 1));
await p.close().catch(() => {});
await fal.close?.();
L.endApps?.();
console.log(JSON.stringify(manifest.langs, null, 1));
process.exit(0);
