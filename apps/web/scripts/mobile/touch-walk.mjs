// The phone layout under real touch events (Chromium's own, through the debug port — not mouse clicks): a headless
// browser with a throwaway profile, a 390 × 844 phone with a coarse pointer, the built site. What a hand does first:
// the layout is the phone's by itself, a tap selects a clip, the quick actions cut it, undo, a swipe scrolls and
// never edits, the fat edge trims, play / pause, a tool's sheet opens and closes, a pinch zooms.
//   node apps/web/scripts/mobile/touch-walk.mjs <site url, e.g. http://127.0.0.1:4015/> [debug port=10151]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [SITE = "http://127.0.0.1:4015/", DEBUG = "10151"] = process.argv.slice(2);
const BROWSER = process.env.GZ_CHROMIUM ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
	results.push({ name, ok: !!ok });
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gz-touch-"));
const child = spawn(BROWSER, ["--headless=new", `--user-data-dir=${profile}`, "--no-first-run", "--window-size=390,844", `--remote-debugging-port=${DEBUG}`, "about:blank"], { stdio: "ignore" });
const stop = () => {
	try {
		child.kill("SIGTERM");
	} catch {}
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
const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (m) => {
	const msg = JSON.parse(m.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		if (msg.error) reject(new Error(msg.error.message));
		else resolve(msg.result);
	} else if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "exception");
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
	const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
	return r.result.value;
};
const waitFor = async (expression, timeout = 30000) => {
	const t0 = Date.now();
	while (Date.now() - t0 < timeout) {
		if (await evaluate(expression).catch(() => false)) return true;
		await sleep(250);
	}
	return false;
};

// ---- a phone
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setEmitTouchEventsForMouse", { enabled: false });
const touch = (type, points) => send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 8, radiusY: 8, force: 1 })) });
const tap = async (x, y) => {
	await touch("touchStart", [{ x, y }]);
	await sleep(60);
	await touch("touchEnd", []);
	await sleep(350);
};
const swipe = async (from, to, steps = 12, hold = 0) => {
	await touch("touchStart", [from]);
	if (hold) await sleep(hold);
	for (let i = 1; i <= steps; i++) {
		await touch("touchMove", [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
		await sleep(16);
	}
	await touch("touchEnd", []);
	await sleep(450);
};
const ED = "window.__studioBridge.editor()";
const box = (selector, text) =>
	evaluate(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(selector)})]; const e = ${text ? `all.find((x) => ${text}.test(x.innerText || x.getAttribute('aria-label') || ''))` : "all.find((x) => x.getBoundingClientRect().width > 0)"}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, w: r.width, h: r.height }; })()`);
const clips = () => evaluate(`(() => { const t = ${ED}.scenes.getActiveScene().tracks; return t.main.elements.map((e) => ({ id: e.id, start: e.startTime, duration: e.duration })); })()`);
const selected = () => evaluate(`${ED}.selection.getSelectedElements().length`);

try {
	await send("Page.navigate", { url: new URL("editor/", SITE).href });
	const ready = await waitFor(`document.documentElement.dataset.demoReady === "1" && !!window.__studioBridge && !!document.querySelector(".gz-mobile")`, 60000);
	check("[T1] a phone gets the phone layout by itself (coarse pointer, short side 390)", ready && (await evaluate(`document.querySelector(".gz-mobile")?.getAttribute("data-device")`)) === "phone", await evaluate(`JSON.stringify({ coarse: matchMedia("(pointer: coarse)").matches, w: innerWidth, device: document.querySelector(".gz-mobile")?.getAttribute("data-device") ?? null, text: document.body.innerText.slice(0, 80) })`));
	await sleep(2500);
	check("[T1] the desktop bars are not there (toolbar, track buttons, meters, the player's bar)", await evaluate(`["[data-timeline-toolbar]", "[data-timeline-headers]", "[data-level-meter]", "[data-player-bar]"].every((s) => { const e = document.querySelector(s); return !e || e.getBoundingClientRect().height === 0; })`));
	check("[T1] every tool of the bar is on screen (none cut off)", await evaluate(`[...document.querySelectorAll(".gz-mobile nav .gz-tool")].every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5 && r.width >= 44; })`));

	// ---- a tap selects a clip
	const before = await clips();
	const first = await box("[data-element-id], .tl-clip, [data-timeline-element]");
	const clip = await evaluate(`(() => { const id = ${JSON.stringify(before[0]?.id)}; const e = document.querySelector('[data-element-id="' + id + '"]') || [...document.querySelectorAll('.gz-timeline *')].find((x) => x.getAttribute && [...x.attributes].some((a) => a.value === id)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, w: r.width, h: r.height, attrs: [...e.attributes].map((a) => a.name).join(",") }; })()`);
	check("[T2] the first clip is found on the timeline", !!clip, JSON.stringify(clip ?? first));
	if (clip) {
		await tap(clip.x, clip.y);
		check("[T2] a tap selects the clip", (await selected()) === 1, `selected ${await selected()}`);
		check("[T2] the clip's quick actions are over the bar", !!(await box("[data-phone-quick] [data-phone-action=split]")));

		// ---- a tap on the ruler seeks; Split cuts there; undo brings it back
		const ruler = await evaluate(`(() => { const s = document.querySelector('[data-timeline-tracks-scroll]'); const r = s.getBoundingClientRect(); return { top: r.top, left: r.left, w: r.width }; })()`);
		await tap(clip.left + clip.w * 0.5, ruler.top - 20);
		const time = await evaluate(`${ED}.playback.getCurrentTime()`);
		check("[T3] a tap on the ruler moves the playhead into the clip", time > before[0].start && time < before[0].start + before[0].duration, `time ${time}`);
		await tap(clip.x - clip.w * 0.25, clip.y); // select again (the ruler tap may have emptied the selection)
		const split = await box("[data-phone-quick] [data-phone-action=split]");
		if (split) await tap(split.x, split.y);
		const afterSplit = await clips();
		check("[T3] Split from the quick actions cuts the clip at the playhead", afterSplit.length === before.length + 1, `${before.length} → ${afterSplit.length}`);
		const undo = await box("[data-phone-transport] [data-phone-action=undo]");
		if (undo) await tap(undo.x, undo.y);
		check("[T3] the undo button takes the cut back", (await clips()).length === before.length);
	}

	// ---- a swipe scrolls the timeline and edits nothing
	const scroll = async () => evaluate(`document.querySelector('[data-timeline-tracks-scroll]').scrollLeft`);
	const area = await evaluate(`(() => { const r = document.querySelector('[data-timeline-tracks-scroll]').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; })()`);
	// what reaches the page while a finger moves: the wheels the bridge makes and the pointer events it gets
	await evaluate(`(() => { window.__gzSeen = { wheel: [], pointer: {} }; document.addEventListener('wheel', (e) => window.__gzSeen.wheel.push([Math.round(e.deltaX), Math.round(e.deltaY), e.ctrlKey ? 1 : 0, (e.target.tagName || '') + '.' + String(e.target.className || '').slice(0, 24)]), true); for (const k of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) document.addEventListener(k, () => { window.__gzSeen.pointer[k] = (window.__gzSeen.pointer[k] || 0) + 1; }, true); })()`);
	const seen = async () => evaluate(`JSON.stringify({ wheels: window.__gzSeen.wheel.length, first: window.__gzSeen.wheel.slice(0, 3), events: window.__gzSeen.pointer })`);
	const s0 = await scroll();
	const c0 = JSON.stringify(await clips());
	await swipe({ x: area.left + area.w * 0.8, y: area.top + area.h * 0.45 }, { x: area.left + area.w * 0.2, y: area.top + area.h * 0.45 });
	const s1 = await scroll();
	check("[T4] a swipe scrolls the timeline", s1 > s0 + 40, `${s0} → ${s1} · ${await seen()}`);
	check("[T4] and moves no clip", JSON.stringify(await clips()) === c0);
	await swipe({ x: area.left + area.w * 0.2, y: area.top + area.h * 0.45 }, { x: area.left + area.w * 0.9, y: area.top + area.h * 0.45 });

	// ---- the fat edge of a selected clip trims it
	const again = await evaluate(`(() => { const id = ${JSON.stringify(before[0]?.id)}; const e = document.querySelector('[data-element-id="' + id + '"]') || [...document.querySelectorAll('.gz-timeline *')].find((x) => x.getAttribute && [...x.attributes].some((a) => a.value === id)); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, w: r.width }; })()`);
	if (again) {
		await tap(again.x, again.y);
		const d0 = (await clips())[0].duration;
		await swipe({ x: again.right - 3, y: again.y }, { x: again.right - 63, y: again.y }, 14, 120);
		const d1 = (await clips())[0].duration;
		check("[T5] dragging the selected clip's right edge trims it", d1 < d0, `${d0} → ${d1}`);
		const undo = await box("[data-phone-transport] [data-phone-action=undo]");
		if (undo) await tap(undo.x, undo.y);
	}

	// ---- play / pause
	const play = await box('[data-phone-transport] [data-phone-action="toggle-play"]');
	if (play) await tap(play.x, play.y);
	await sleep(700);
	const playing = await evaluate(`${ED}.playback.getIsPlaying()`);
	if (play) await tap(play.x, play.y);
	await sleep(300);
	check("[T6] the play button plays and pauses", playing === true && (await evaluate(`${ED}.playback.getIsPlaying()`)) === false, `playing ${playing}`);

	// ---- a tool's sheet opens and closes
	const text = await box(".gz-mobile nav .gz-tool", "/^(Text|Текст)$/");
	if (text) await tap(text.x, text.y);
	await sleep(500);
	const sheet = await box(".gz-sheet");
	check("[T7] a tool opens its sheet over the timeline, the player stays", !!sheet && sheet.h > 150, JSON.stringify(sheet));
	if (text) await tap(text.x, text.y);
	await sleep(400);
	check("[T7] the same tool closes it", !(await box(".gz-sheet")));

	// ---- a pinch zooms the timeline
	const zoom = async () => evaluate(`(() => { const s = document.querySelector('[data-timeline-tracks-scroll]'); return s.scrollWidth; })()`);
	const z0 = await zoom();
	const cy = area.top + area.h * 0.45;
	await touch("touchStart", [{ x: 150, y: cy, id: 0 }, { x: 240, y: cy, id: 1 }]);
	for (let i = 1; i <= 10; i++) {
		await touch("touchMove", [{ x: 150 - i * 8, y: cy, id: 0 }, { x: 240 + i * 8, y: cy, id: 1 }]);
		await sleep(16);
	}
	await touch("touchEnd", []);
	await sleep(600);
	const z1 = await zoom();
	check("[T8] a pinch out zooms the timeline in", z1 > z0 * 1.15, `${z0} → ${z1} · ${await seen()}`);
	check("[page] no page error", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (error) {
	check("[run] the walk ran to its end", false, String(error?.stack || error).slice(0, 400));
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\ntouch-walk: ${results.length - failed}/${results.length} pass`);
stop();
fs.rmSync(profile, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
