// Shared helpers for the editor stability tests (editor4-*.mjs): launch a hidden test copy with an
// error hook, open a new project, import files through the Media panel, find things on screen.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { APP, launch, sleep } from "./cdp.mjs";

export { sleep };
export const HERE = import.meta.dirname;
export const MEDIA = path.join(HERE, "media");
export const OUT = process.env.STUDIO_TEST_OUT || path.join(os.tmpdir(), "editor4-out");
fs.mkdirSync(OUT, { recursive: true });
export const ED = `window.__studioBridge.editor()`;

/**
 * A 6 s clip of a person — the app's own face photo gliding across a grey 9:16 frame, with a tone — for anything that
 * needs a face (face tracking, cut-outs): media/clip.mp4 is a test pattern with nobody in it.
 */
export function personClip() {
	const file = path.join(OUT, "person.mp4");
	if (fs.existsSync(file)) return file;
	const res = path.dirname(path.dirname(APP));
	const photo = path.join(res, "Resources", "web", "apps", "web", "public", "faces", "hero.jpg");
	execFileSync(path.join(res, "Resources", "bin", "ffmpeg"), ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x4a4a4a:s=720x1280:r=30:d=6",
		"-loop", "1", "-i", photo, "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000",
		"-filter_complex", "[1:v]scale=480:480[f];[0:v][f]overlay=x='120+80*sin(t*1.5)':y='400+40*cos(t)':shortest=1,format=yuv420p[v]",
		"-map", "[v]", "-map", "2:a", "-t", "6", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", file + ".part.mp4"]);
	fs.renameSync(file + ".part.mp4", file);
	return file;
}

// Installed before any page script: page errors, unhandled rejections, panel crashes, long frames.
// The timeline's invariants are checked after every step, ⌘Z and ⇧⌘Z (core/managers/timeline-audit.ts); health()
// reports what failed with the page's errors. NO_INVARIANTS=1 leaves them off (speed tests that time a single ⌘Z).
const HOOK = `(() => {
	if (window.__e4) return;
	__INVARIANTS__
	const G = window.__e4 = { errors: [], rejections: [], loafs: [] };
	addEventListener('error', (e) => { if (/ResizeObserver loop/.test(e.message || '')) return; G.errors.push(String((e.error && e.error.stack) || e.message).slice(0, 600)); });
	addEventListener('unhandledrejection', (e) => G.rejections.push(String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).slice(0, 600)));
	try { new PerformanceObserver((l) => { for (const e of l.getEntries()) G.loafs.push(Math.round(e.duration)); }).observe({ type: 'long-animation-frame', buffered: true }); } catch {}
})();`;

/**
 * The apps this test process started (polish, 11.11): `finish` ends them, and so does a SIGINT / SIGTERM of the test —
 * each by its own pid, never by bundle path. Tests that ended through `finish` left their app running and node waiting
 * on its pipes for ever (three test apps found alive hours later, one at 99.7 % of a core).
 */
const started = [];
export function endApps() {
	for (const p of started.splice(0)) {
		const c = p.child;
		try { p.ws?.close(); } catch {}
		if (c.exitCode !== null || c.signalCode !== null) continue;
		try { c.kill("SIGTERM"); } catch {}
		const pid = c.pid;
		setTimeout(() => { try { process.kill(pid, "SIGKILL"); } catch {} c.stdout?.destroy(); c.stderr?.destroy(); }, 3000);
	}
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, () => { endApps(); setTimeout(() => process.exit(130), 3500); });

export async function start({ fresh = true } = {}) {
	const p = await launch({ fresh });
	started.push(p);
	const invariants = process.env.NO_INVARIANTS ? "" : "globalThis.__gaziyavInvariants = true;";
	await p.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK.replace("__INVARIANTS__", invariants) });
	await p.send("Page.reload");
	await sleep(600);
	await p.waitFor(`location.pathname.startsWith('/projects') && document.readyState === 'complete' && !!window.__e4`, { label: "projects page", timeout: 30000 });
	await sleep(800);
	if (invariants) watchInvariants(p);
	return p;
}

/** The test's last check: a broken invariant prints with the check it came after. */
let lastCheck = "start";

/** Prints each broken invariant as it happens (polled), under the test step it came in. */
function watchInvariants(p) {
	let printed = 0;
	const timer = setInterval(async () => {
		const list = await p.eval(`(globalThis.__gaziyavInvariantViolations ?? []).slice(${printed})`).catch(() => null);
		if (!list?.length) return;
		printed += list.length;
		for (const v of list) console.log(`INVARIANT ${v.rule} after ${v.at}: ${v.detail} (test: after «${lastCheck}»)`);
	}, 400);
	// A page the test killed (durability: pkill -9, then a new start) is never closed through p.close(): its poll must
	// not keep node alive for ever (two durability runs sat for hours holding a test slot each).
	timer.unref();
	const close = p.close.bind(p);
	p.close = async (...args) => {
		clearInterval(timer);
		return close(...args);
	};
}

export async function clickText(p, re, scope = "body") {
	const box = await p.eval(`(() => {
		const re = new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags)});
		const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
		const els = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button, ' + ${JSON.stringify(scope)} + ' [role=button], ' + ${JSON.stringify(scope)} + ' [role=menuitem], ' + ${JSON.stringify(scope)} + ' [role=tab], ' + ${JSON.stringify(scope)} + ' a')].filter(vis);
		const el = els.find((e) => re.test((e.innerText || '').trim()) || re.test(e.getAttribute('aria-label') || '') || re.test(e.getAttribute('title') || ''));
		if (!el) return null;
		el.scrollIntoView({ block: 'center' });
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40) };
	})()`);
	if (!box) return null;
	await p.mouse(box.x, box.y);
	return box;
}

export async function newProject(p) {
	const b = await clickText(p, /^(\+\s*)?(New project|Create project)$/i);
	if (!b) await clickText(p, /New/);
	// (exp2, 14.11: at a load of 50+ the first click on a just-loaded projects page was lost now and then — the whole
	// suite then ended at its first line; one more click after 30 s, as a person would)
	const opened = await p.waitFor(`location.pathname.startsWith('/editor/')`, { label: "editor opens", timeout: 30000 }).then(() => true, () => false);
	if (!opened) {
		if (!(await clickText(p, /^(\+\s*)?(New project|Create project)$/i))) await clickText(p, /New/);
		await p.waitFor(`location.pathname.startsWith('/editor/')`, { label: "editor opens", timeout: 60000 });
	}
	await p.waitFor(`!!window.__studioBridge && !!${ED}.project.getActive()`, { label: "editor core", timeout: 20000 });
	await sleep(1500);
	if (await p.eval(`!![...document.querySelectorAll('[role=dialog]')].find(d => d.getBoundingClientRect().width > 0)`)) {
		await p.key("Escape", { code: "Escape" });
		await sleep(300);
	}
}

/** Imports through the Media panel's multi-file input; waits until all assets have a duration. */
export async function importFiles(p, files, { keepPlaced = false } = {}) {
	await openTab(p, "Media");
	const ok = await p.eval(`(() => {
		document.querySelectorAll('[data-e4-import]').forEach((i) => i.removeAttribute('data-e4-import'));
		const inputs = [...document.querySelectorAll('input[type=file]')].filter((i) => i.multiple && /video/.test(i.accept || ''));
		const el = inputs.find((i) => (i.accept || '').split(',').length > 3) || inputs[0];
		if (el) el.setAttribute('data-e4-import', '1');
		return !!el;
	})()`);
	if (!ok) throw new Error("no Media file input");
	const before = await p.eval(`${ED}.media.getAssets().length`);
	await p.setFiles("input[data-e4-import]", files);
	await p.waitFor(`${ED}.media.getAssets().length >= ${before + files.length} && ${ED}.media.getAssets().every(a => a.duration > 0 || a.type === 'image')`, { label: "assets imported", timeout: 120000 });
	await sleep(800);
	if (!keepPlaced) await clearTimeline(p);
}

export async function clearTimeline(p) {
	await p.eval(`(() => {
		const ed = ${ED}; let t = ed.scenes.getActiveScene().tracks;
		// a track left locked by an earlier step (its 🔒, redone) refuses the whole clearing step since tlc2 (a locked
		// track takes no edit, whatever path): unlock first — a test reset, not a step of the history
		const unlock = (tr) => { if (!tr.locked) return tr; const { locked, ...rest } = tr; return rest; };
		if ([t.main, ...(t.overlay || []), ...(t.audio || [])].some((tr) => tr.locked)) { ed.timeline.updateTracks({ overlay: (t.overlay || []).map(unlock), main: unlock(t.main), audio: (t.audio || []).map(unlock) }); t = ed.scenes.getActiveScene().tracks; }
		const els = [t.main, ...(t.overlay || []), ...(t.audio || [])].flatMap(tr => tr.elements.map(e => ({ trackId: tr.id, elementId: e.id })));
		if (els.length) ed.timeline.deleteElements({ elements: els });
		return els.length;
	})()`);
	await sleep(300);
}

export async function openTab(p, name) {
	// CapCut's tabs: cdp.mjs click() opens them by key.
	if (["Media", "Audio", "Text", "Stickers", "Effects", "Transitions", "Captions", "Filters", "Color", "Adjustment", "Templates", "AI", "AI avatar"].includes(name)) {
		await p.click(name);
		await sleep(500);
		return;
	}
	const box = await p.eval(`(() => {
		const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
		const el = [...document.querySelectorAll('[data-assets-panel] button, [role=tab], button')].filter(vis)
			.find((b) => (b.getAttribute('aria-label') || b.innerText || b.title || '').trim().toLowerCase() === ${JSON.stringify(name.toLowerCase())});
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	})()`);
	if (!box) throw new Error(`no tab ${name}`);
	await p.mouse(box.x, box.y);
	await sleep(500);
}

/**
 * Where a materials key lives: [tab button key, sub-tab key or null]. Up to 1.0.78 every key had its own tab; from
 * 1.0.79 Transitions / Filters are sub-tabs of Effects, Captions of Text, and Adjustment («color») is Filters' first tile.
 */
export async function placeOf(p, key) {
	if (await p.eval(`!!document.querySelector('[data-tab-group="${key}"]')`)) return [key, null];
	const tab = { transitions: "effects", filters: "effects", color: "effects", captions: "text", motion: "templates" }[key] ?? key;
	return [tab, key === "color" ? "filters" : key];
}

/** Opens a materials key with a real click on its tab (and its sub-tab), then the section in the column on the left. */
export async function openPlace(p, key, section) {
	const [tab, sub] = await placeOf(p, key);
	const at = (sel) => p.eval(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; e.scrollIntoView({ inline: 'nearest', block: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2, on: e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-checked') === 'true' || e.getAttribute('data-state') === 'on' } : null; })()`);
	const t = await at(`[data-tab-group="${tab}"]`);
	if (t && !t.on) await p.mouse(t.x, t.y);
	await sleep(500);
	// the sub-tab — also the group's own one (Text in Text | Captions): the group button opens its last sub-tab
	const s = await at(`[data-sub-tab="${sub ?? tab}"]`);
	if (s) {
		await p.mouse(s.x, s.y);
		await sleep(500);
	}
	const shown = sub ?? tab;
	if (section && section !== "-") {
		const it = await at(`[data-materials="${shown}"] [data-nav-item="${section}"]`);
		if (it) await p.mouse(it.x, it.y);
		await sleep(700);
	}
	return { tab, sub, shown, opened: !!t && (await p.eval(`document.querySelector('[data-tab-group="${tab}"]')?.getAttribute('aria-pressed') === 'true'`)) };
}

export const elementCount = `(() => { const t = ${ED}.scenes.getActiveScene().tracks; return [t.main, ...(t.overlay || []), ...(t.audio || [])].reduce((a, x) => a + x.elements.length, 0); })()`;
export const isPlaying = `${ED}.playback.getIsPlaying()`;

/** Page errors, panel crash screens and renderer-gone lines collected so far. */
export async function health(p) {
	const page = await p.eval(`(() => ({
		errors: window.__e4?.errors ?? [], rejections: window.__e4?.rejections ?? [],
		panels: [...document.querySelectorAll('[data-panel-error]')].map(e => e.getAttribute('data-panel-error') + ': ' + (e.querySelector('details p')?.textContent || '')),
		crash: !!document.querySelector('[data-crash-screen]'),
		loafs: (window.__e4?.loafs ?? []).filter(d => d > 200),
		invariants: window.__studioBridge?.invariantViolations?.() ?? null,
	}))()`).catch((e) => ({ evalError: e.message }));
	const gone = p.log.join("").split("\n").filter((l) => /process gone|not responding/.test(l));
	const consoleErrors = p.console.filter((l) => /^(error|EXCEPTION)/.test(l) && !/ResizeObserver loop/.test(l));
	// a broken invariant fails "no page errors" in every test, first in the list
	const broken = (page.invariants?.violations ?? []).map((v) => `invariant ${v.rule} after ${v.at}: ${v.detail}`);
	return { ...page, errors: [...broken, ...(page.errors ?? [])], gone, consoleErrors };
}

export function makeChecker(name) {
	const results = [];
	const check = (id, ok, detail = "") => {
		lastCheck = id.slice(0, 60);
		results.push({ id, ok: !!ok, detail });
		console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
	};
	const finish = () => {
		fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(results, null, 1));
		const failed = results.filter((r) => !r.ok);
		console.log(`\n${name}: ${results.length - failed.length}/${results.length} pass`);
		process.exitCode = failed.length ? 1 : 0;
		// the test's own apps end with it, and node with them (polish, 11.11)
		endApps();
		setTimeout(() => process.exit(process.exitCode ?? 0), 4000);
	};
	return { check, finish, results };
}

/** Center of the first visible element matching a selector (optionally whose text matches). */
export async function boxOf(p, selector, textRe = null) {
	return p.eval(`(() => {
		const re = ${textRe ? `new RegExp(${JSON.stringify(textRe.source)}, ${JSON.stringify(textRe.flags)})` : "null"};
		const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!re || re.test((e.innerText || e.getAttribute('aria-label') || e.title || '').trim())); });
		if (!el) return null;
		el.scrollIntoView({ block: 'nearest' });
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
	})()`);
}

export async function space(p) {
	await p.key(" ", { code: "Space", text: " " });
}

/** A letter key by its physical position (works on any keyboard layout). */
export async function key(p, letter) {
	await p.key(letter, { code: `Key${letter.toUpperCase()}`, text: letter });
}

/**
 * The one-list inspector (insp-A, 12.11) has no tabs: a tool (Mask, Face swap, Cutout…) is a section in the folded
 * «Tools» part at the end of the selected clip's list. Opens Tools and then the section the way a person does (real
 * clicks on the two heads). True when the section is in the clip's list and open.
 */
export async function openInspectorTool(p, sectionId) {
	const open = () => p.eval(`document.querySelector('[data-inspector-block="insp.tools"]')?.getAttribute('data-open') ?? null`);
	if ((await open()) === "false") {
		const t = await boxOf(p, '[data-inspector-block-toggle="insp.tools"]');
		if (t) await p.mouse(t.x, t.y);
		await p.waitFor(`document.querySelector('[data-inspector-block="insp.tools"]')?.getAttribute('data-open') === 'true'`, { timeout: 4000, label: "Tools open" }).catch(() => {});
	}
	const sel = `[data-inspector-section="${sectionId}"]`;
	const head = await p.eval(`(() => { const s = document.querySelector('${sel}'); if (!s) return null; const g = s.querySelector('[data-inspector-group]'); if (!g || g.querySelector('[data-inspector-group-body]')) return 'open'; const b = g.querySelector('button'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
	if (!head) return false;
	if (head !== "open") {
		await p.mouse(head.x, head.y);
		await p.waitFor(`!!document.querySelector('${sel} [data-inspector-group-body]')`, { timeout: 4000, label: `${sectionId} open` }).catch(() => {});
	}
	return p.eval(`!!document.querySelector('${sel}')`);
}

/**
 * while the shelf has files — the same list (`[data-downloads-view]`) in a small window. Returns true once it is open.
 */
export async function openShelf(p) {
	await openPlace(p, "media", "-");
	if (await p.eval(`!!document.querySelector('[data-materials="media"] [data-nav-item="downloads"]')`)) {
		await openPlace(p, "media", "downloads");
		return true;
	}
	const plus = await boxOf(p, "[data-testid=media-add]");
	if (!plus) return false;
	await p.mouse(plus.x, plus.y);
	const item = await p
		.waitFor(`(() => { const e = document.querySelector('[data-media-add="downloads"]'); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`, { label: "«From downloads…»", timeout: 3000 })
		.catch(() => null);
	if (!item) {
		await p.key("Escape", { code: "Escape" });
		return false;
	}
	await p.mouse(item.x, item.y);
	await p.waitFor(`!!document.querySelector('[data-downloads-view]')`, { label: "the shelf", timeout: 5000 }).catch(() => {});
	return true;
}
