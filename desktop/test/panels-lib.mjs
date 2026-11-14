// Helpers of the panels walk tests (gaziyav-panels-*.mjs): a page-side «is anything on the screen but unreachable» probe,
// real-mouse helpers (p.mouse by screen coordinates only), a fake Gaziyav AI server for the «+ Create with AI» tile.
import fs from "node:fs";
import path from "node:path";
import * as L from "./editor4-lib.mjs";

export const { ED, sleep } = L;
export const T = `window.__studioBridge.ticksPerSecond()`;

/**
 * Installed in the page: problems(scopeSelector, { maxTiles }) walks every control inside the scope and reports what a
 * person would hit: a control that cannot be brought into the window (off-screen), one with something else on top of
 * it (covered), a label cut off without an ellipsis (cut), the scope scrolling sideways (hscroll). Scrolling a control
 * into view inside its own scroll area is fine — it is reachable. Text that says «AI Composition» is reported too.
 */
const PROBE = `(() => {
	window.__walk = {
		problems(scopeSel, opts = {}) {
			const out = [];
			const vw = innerWidth, vh = innerHeight;
			const root = scopeSel ? (scopeSel[0] === '^' ? document.querySelector(scopeSel.slice(1))?.closest('.panel') : document.querySelector(scopeSel)) : document.body;
			if (!root) return [{ kind: 'missing-scope', name: scopeSel }];
			const vis = (e) => {
				const r = e.getBoundingClientRect();
				if (r.width < 2 || r.height < 2) return false;
				const s = getComputedStyle(e);
				return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && !e.closest('[aria-hidden=true]') && !e.closest('[inert]') && !e.closest('[data-sonner-toaster]');
			};
			const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.getAttribute('data-inspector-row') || e.getAttribute('role') || e.tagName).trim().replace(/\\s+/g, ' ').slice(0, 48);
			let ctrls = [...root.querySelectorAll('button, input:not([type=file]), select, textarea, [role=slider], [role=switch], [role=checkbox], [role=combobox], [role=tab], [role=radio], a[href]')].filter(vis);
			if (opts.maxTiles != null) {
				let n = 0;
				ctrls = ctrls.filter((e) => { const tile = e.closest('[data-asset-tile], [data-material-grid] > *, [data-timeline-element-id]') || e.hasAttribute('data-asset-tile'); if (!tile) return true; return ++n <= opts.maxTiles; });
			}
			for (const c of ctrls) {
				if (c.disabled || c.getAttribute('aria-disabled') === 'true') continue;
				c.scrollIntoView({ block: 'center', inline: 'nearest' });
				const r = c.getBoundingClientRect();
				const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
				const outW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)), outH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
				const shown = (outW * outH) / (r.width * r.height);
				if (shown < 0.6) { out.push({ kind: 'off-screen', name: name(c), shown: Math.round(shown * 100) }); continue; }
				const px = Math.min(Math.max(cx, 1), vw - 1), py = Math.min(Math.max(cy, 1), vh - 1);
				const top = document.elementFromPoint(px, py);
				const same = top && (c === top || c.contains(top) || top.contains(c) || (c.closest('label') && c.closest('label') === top.closest('label')));
				if (!same) {
					const by = top ? (top.closest('[data-sonner-toast]') ? 'toast' : (top.getAttribute('aria-label') || top.className?.toString().slice(0, 50) || top.tagName)) : 'nothing';
					out.push({ kind: 'covered', name: name(c), by: String(by).slice(0, 60) });
				}
			}
			// a label cut off without an ellipsis (leaf text only)
			for (const e of root.querySelectorAll('button, label, span, p, h1, h2, h3, h4, div')) {
				if (e.children.length || !e.childNodes.length || !(e.textContent || '').trim() || !vis(e)) continue;
				const s = getComputedStyle(e);
				if (!/(hidden|clip)/.test(s.overflowX) || s.textOverflow === 'ellipsis') continue;
				if (e.scrollWidth > e.clientWidth + 2) out.push({ kind: 'cut', name: (e.textContent || '').trim().slice(0, 48), by: e.scrollWidth + ' > ' + e.clientWidth });
			}
			// a slider whose track is squeezed to nothing between a long label and its value cannot be dragged (B5)
			for (const th of root.querySelectorAll('[role=slider]')) {
				if (!vis(th)) continue;
				const track = th.parentElement?.parentElement ?? th.parentElement; // thumb → its wrapper → the slider (the track's own width)
				const w = track.getBoundingClientRect().width;
				if (w < 48) out.push({ kind: 'tiny-slider', name: (th.closest('[data-inspector-row]')?.getAttribute('data-inspector-row') ?? th.getAttribute('aria-label') ?? 'slider'), by: Math.round(w) + 'px' });
			}
			// a slider hidden by the narrow layout must leave a field to type into, or the setting cannot be changed at all (B8)
			for (const th of root.querySelectorAll('[role=slider]')) {
				if (vis(th)) continue;
				const row = th.closest('[data-inspector-row]');
				if (!row || !vis(row)) continue;
				const field = [...row.querySelectorAll('input')].find(vis);
				if (!field) out.push({ kind: 'slider-without-field', name: row.getAttribute('data-inspector-row') ?? th.getAttribute('aria-label') ?? 'slider', by: 'slider hidden, no input' });
			}
			// text that runs out of its own box (nowrap text in a narrow chip spills over its border and the neighbour)
			for (const e of root.querySelectorAll('button, label, span, p, h1, h2, h3, h4, div, a')) {
				if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || !vis(e)) continue;
				const st = getComputedStyle(e);
				if (/(hidden|clip|auto|scroll)/.test(st.overflowX) || st.display === 'inline') continue;
				const range = document.createRange(); range.selectNodeContents(e);
				const tr = range.getBoundingClientRect(), er = e.getBoundingClientRect();
				if (tr.width > er.width + 2 && !/pre/.test(st.whiteSpace)) out.push({ kind: 'spill', name: (e.textContent || '').trim().slice(0, 40), by: Math.round(tr.width) + ' > ' + Math.round(er.width) });
			}
			// text that runs into other text (a header whose left cluster reaches the centred title)
			if (opts.overlap) {
				const leaves = [...root.querySelectorAll('span, button, a, p, h1, h2, h3')].filter((e) => e.children.length === 0 && (e.textContent || '').trim() && vis(e));
				// the rectangle a person can see: the text's box cut by every clipping ancestor (a scrolled-away row is not there)
				const seenRect = (e) => {
					const range = document.createRange(); range.selectNodeContents(e);
					const r = range.getBoundingClientRect(); const c = e.getBoundingClientRect();
					let box = { left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: r.top, bottom: r.bottom };
					for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) {
						const st = getComputedStyle(a);
						if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
						const q = a.getBoundingClientRect();
						box = { left: Math.max(box.left, q.left), right: Math.min(box.right, q.right), top: Math.max(box.top, q.top), bottom: Math.min(box.bottom, q.bottom) };
					}
					return box.right > box.left && box.bottom > box.top ? box : null;
				};
				// a sticky or fixed footer/header is meant to sit over what scrolls under it: not an overlap
				const pinned = (e) => { for (let a = e; a && a !== root.parentElement; a = a.parentElement) { const pos = getComputedStyle(a).position; if (pos === 'sticky' || pos === 'fixed') return true; } return false; };
				const boxes = leaves.map((e) => ({ e, r: seenRect(e) })).filter((b) => b.r && !pinned(b.e));
				for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
					const a = boxes[i].r, b = boxes[j].r;
					const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
					if (w > 3 && h > 3 && !boxes[i].e.contains(boxes[j].e) && !boxes[j].e.contains(boxes[i].e)) out.push({ kind: 'overlap', name: boxes[i].e.textContent.trim().slice(0, 24) + ' × ' + boxes[j].e.textContent.trim().slice(0, 24), by: Math.round(w) + 'px' });
				}
			}
			// scrolling a control into view must not leave a clipped panel shifted sideways
			for (const e of document.querySelectorAll('[data-inspector], [data-inspector] *, [data-assets-panel], [data-assets-panel] *')) if (e.scrollLeft > 0 && /(hidden|clip)/.test(getComputedStyle(e).overflowX)) e.scrollLeft = 0;
			const body = root.matches('[data-inspector-body]') ? root : root.querySelector('[data-inspector-body]');
			if (body && body.scrollWidth > body.clientWidth + 2) out.push({ kind: 'hscroll', name: 'inspector', by: body.scrollWidth + ' > ' + body.clientWidth });
			return out;
		},
		aiComposition() {
			const text = [document.body.innerText, ...[...document.querySelectorAll('[aria-label], [title]')].map((e) => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || ''))].join('\\n');
			return (text.match(/AI Composition|AI-композиц|ИИ-композиц|Nest into|Вложить в AI|Open composition|Открыть композицию/gi) || []).slice(0, 3);
		},
	};
})()`;
export const installProbe = async (p) => {
	if (!p.__probeScript) p.__probeScript = await p.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
	return p.eval(PROBE);
};

export function shot(p, name) {
	return p.screenshot(path.join(L.OUT, `panels-${name}.png`));
}

export async function box(p, sel, { text = null } = {}) {
	return p.eval(`(() => {
		const re = ${text ? `new RegExp(${JSON.stringify(text.source)}, ${JSON.stringify(text.flags)})` : "null"};
		const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!re || re.test((x.innerText || x.getAttribute('aria-label') || '').trim())); });
		if (!e) return null;
		e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		const r = e.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.x, top: r.y, right: r.right, bottom: r.bottom };
	})()`);
}

/** A real click (p.mouse at the control's screen position). */
export async function click(p, sel, opts = {}) {
	const b = await box(p, sel, opts);
	if (!b) return false;
	await p.mouse(b.x, b.y, opts.mouse ?? {});
	await sleep(opts.wait ?? 350);
	return true;
}

/** Real mouse drag along a straight line, in steps, from the control's centre. */
export async function dragBy(p, from, dx, dy = 0, steps = 14) {
	await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
	await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
	for (let i = 1; i <= steps; i++) {
		await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps, button: "left", buttons: 1 });
		await sleep(30);
	}
	await sleep(150);
	await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: from.x + dx, y: from.y + dy, button: "left", clickCount: 1 });
	await sleep(250);
}

export const elements = (p) =>
	p.eval(`(() => { const t = ${ED}.scenes.getActiveScene().tracks; return [...t.overlay, t.main, ...t.audio].flatMap((tr) => tr.elements.map((e) => ({ id: e.id, trackId: tr.id, trackType: tr.type, type: e.type, def: e.definitionId ?? null, name: e.name, start: e.startTime / ${T}, dur: e.duration / ${T}, params: e.params ?? {} }))); })()`);

export async function select(p, el) {
	await p.eval(`${ED}.selection.setSelectedElements({ elements: [{ trackId: ${JSON.stringify(el.trackId)}, elementId: ${JSON.stringify(el.id)} }] })`);
	await sleep(700);
}

export const setLanguage = async (p, lang) => {
	await p.eval(`localStorage.setItem('gaziyav.language', ${JSON.stringify(lang)})`);
	await p.send("Page.reload");
	await p.waitFor(`!!window.__studioBridge && !!${ED}.project.getActiveOrNull?.() && ${ED}.scenes.getActiveScene().tracks.main.id`, { label: "project reopened", timeout: 60000 });
	await sleep(2500);
	await installProbe(p);
};

export const setSize = async (p, w, h) => {
	await p.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
	await sleep(900);
};

/**
 * A fake Gaziyav AI server for Create with AI: the app's /api/montage/agent starts a run, /runs/<id> answers `done` with
 * one lower third (no network, no key). Returns the list of requests the page made.
 */
export async function fakeAgent(p) {
	const seen = [];
	await p.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/montage/*" }] });
	p.ws.addEventListener("message", async (m) => {
		const msg = JSON.parse(m.data);
		if (msg.method !== "Fetch.requestPaused") return;
		const { requestId, request } = msg.params;
		const url = new URL(request.url);
		const reply = (body, code = 200) =>
			p.send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(() => {});
		if (url.pathname.endsWith("/api/montage/agent") && request.method === "POST") {
			seen.push({ path: url.pathname, body: JSON.parse(request.postData ?? "{}") });
			return void reply({ id: "fake-run", status: "running", log: [] });
		}
		if (url.pathname.endsWith("/api/montage/runs/fake-run")) {
			if (request.method === "DELETE") return void reply({ ok: true });
			return void reply({
				id: "fake-run",
				status: "done",
				mode: "quick",
				log: [{ at: 0, text: "Designing the plate…" }],
				result: { comment: "", mode: "quick", layers: [{ kind: "LowerThird", from: 0, to: 4, props: { name: "Ivan", role: "Editor", accent: "#FFD23F", style: "clean" } }], sfx: [], calls: 1 },
			});
		}
		p.send("Fetch.continueRequest", { requestId }).catch(() => {});
	});
	return seen;
}

export function report(results) {
	const failed = results.filter((r) => r.startsWith("FAIL"));
	console.log(`\n${results.length - failed.length}/${results.length} passed`);
	return failed.length ? 1 : 0;
}

export { L, fs, path };

export const seek = (p, s) => p.eval(`(() => { const ed = ${ED}; ed.playback.pause(); ed.playback.seek({ time: Math.round(${s} * ${T}) }); })()`);

/** Double-clicks a tile at the playhead `at` (what a user does to add it). */
export async function placeTile(p, selector, at = 0) {
	await seek(p, at);
	await sleep(250);
	const b = await box(p, selector);
	if (!b) return false;
	await p.mouse(b.x, b.y, { clickCount: 2 });
	await sleep(900);
	return true;
}

/**
 * A project with one of each, placed with real double-clicks on their tiles: the person clip (video), photo.png, tone.mp3,
 * a text, a rectangle, an ellipse, a 3D sticker and an adjustment layer. Returns the clips by name.
 */
export async function setupProject(p, { withMedia = true } = {}) {
	await setSize(p, 1440, 900);
	await L.newProject(p);
	await installProbe(p);
	await L.importFiles(p, [L.personClip(), path.join(L.MEDIA, "photo.png"), path.join(L.MEDIA, "tone.mp3")], { keepPlaced: true });
	await L.openTab(p, "Media");
	await placeTile(p, '[data-assets-panel] [aria-label="photo.png"]', 6.2);
	await placeTile(p, '[data-assets-panel] [aria-label="tone.mp3"]', 0);
	await L.openPlace(p, "text", "add");
	await placeTile(p, "[data-assets-panel] [data-asset-tile]", 0.5);
	await L.openPlace(p, "stickers", "shapes");
	await sleep(500);
	await placeTile(p, '[data-shape-preset="rect"] [data-asset-tile]', 1);
	await placeTile(p, '[data-shape-preset="ellipse"] [data-asset-tile]', 1.5);
	await L.openPlace(p, "stickers", "emoji3d");
	await sleep(1500);
	await placeTile(p, "[data-assets-panel] [data-asset-tile]", 2);
	await L.openPlace(p, "filters", "-");
	await sleep(600);
	await placeTile(p, "[data-adjustment-tile]", 1);
	const els = await elements(p);
	return {
		video: els.find((e) => e.type === "video"),
		photo: els.find((e) => e.type === "image" && e.name === "photo.png") ?? els.find((e) => e.type === "image"),
		audio: els.find((e) => e.type === "audio"),
		text: els.find((e) => e.type === "text"),
		rect: els.find((e) => e.def === "rectangle"),
		ellipse: els.find((e) => e.def === "ellipse"),
		sticker: els.find((e) => e.type === "sticker"),
		adjustment: els.find((e) => e.type === "effect"),
	};
}

/** Real-mouse drag of a Radix slider thumb by a fraction of its track (toward the roomier side); returns aria-valuenow before/after. */
export async function dragSlider(p, scopeSel, fraction = 0.35) {
	const info = await p.eval(`(() => {
		const thumb = document.querySelector(${JSON.stringify(`${scopeSel} [role=slider]`)});
		if (!thumb) return null;
		thumb.scrollIntoView({ block: 'center', inline: 'nearest' });
		let track = thumb.parentElement;
		while (track && track.getBoundingClientRect().width < 60) track = track.parentElement;
		const t = thumb.getBoundingClientRect(), r = track.getBoundingClientRect();
		const mid = r.left + r.width / 2;
		return { x: t.x + t.width / 2, y: t.y + t.height / 2, trackW: r.width, dir: t.x + t.width / 2 < mid ? 1 : -1, before: thumb.getAttribute('aria-valuenow') };
	})()`);
	if (!info) return null;
	await dragBy(p, info, info.dir * info.trackW * fraction);
	const after = await p.eval(`document.querySelector(${JSON.stringify(`${scopeSel} [role=slider]`)})?.getAttribute('aria-valuenow')`);
	return { before: info.before, after, moved: info.before !== after };
}

export const toasts = (p) =>
	p.eval(`[...document.querySelectorAll('[data-sonner-toast]')].filter((e) => e.getAttribute('data-removed') !== 'true' && e.getAttribute('data-visible') !== 'false').map((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { text: e.innerText.trim().replace(/\\s+/g, ' '), l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), pe: s.pointerEvents, buttons: e.querySelectorAll('[data-button], [data-close-button]').length, mounted: e.getAttribute('data-mounted') }; })`);
