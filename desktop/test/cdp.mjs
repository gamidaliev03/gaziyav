// Drives a hidden copy of the built app over the Chrome DevTools protocol.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HERE = import.meta.dirname;
// STUDIO_APP_BUNDLE / STUDIO_DEBUG_PORT / STUDIO_TEST_DIR let several testers run their own copies side by side
// (also set STUDIO_PORT for the app's internal server).
export const APP = path.join(process.env.STUDIO_APP_BUNDLE || path.join(HERE, "..", "dist", "Gaziyav.app"), "Contents", "MacOS", "Gaziyav");
const DEBUG_PORT = Number(process.env.STUDIO_DEBUG_PORT || 9590);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ fresh = true } = {}) {
	// Absolute: the app is started with its user-data folder in here, and with a relative one it silently never opens.
	const base = path.resolve(process.env.STUDIO_TEST_DIR || path.join(os.tmpdir(), "gaziyav-test"));
	if (fresh) fs.rmSync(base, { recursive: true, force: true });
	const downloads = path.join(base, "downloads");
	fs.mkdirSync(downloads, { recursive: true });
	// STUDIO_TEST_MODELS=Models,LocalTTS…: copy-on-write clones of this Mac's installed models in the test profile
	// (cp -c: no disk used, the user's own folders only read), so a test runs the real model, not its download offer.
	for (const dir of (process.env.STUDIO_TEST_MODELS || "").split(",").filter(Boolean)) {
		const from = ["Gaziyav"].map((app) => path.join(os.homedir(), "Library", "Application Support", app, dir)).find((d) => fs.existsSync(d)) ?? "";
		const to = path.join(base, "userdata", dir);
		if (!fs.existsSync(from) || fs.existsSync(to)) continue;
		fs.mkdirSync(path.dirname(to), { recursive: true });
		spawnSync("/bin/cp", ["-cR", from, to]);
	}
	// STUDIO_EXTRA_ARGS: extra Chromium switches, e.g. --force-color-profile=srgb for pixel comparisons.
	const extra = (process.env.STUDIO_EXTRA_ARGS || "").split(" ").filter(Boolean);
	const child = spawn(APP, [`--remote-debugging-port=${DEBUG_PORT}`, ...extra], {
		env: {
			...process.env,
			// The PATH of an app opened from the Dock, not this terminal's: Homebrew's ffmpeg hid «ffmpeg not found» in
			// every AI voice-over from the tests while the user's app failed.
			PATH: process.env.STUDIO_TEST_PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
			STUDIO_TEST: "1",
			// STUDIO_REAL_USERDATA=1: the app's own folder logic (HOME/Library/Application Support/Gaziyav), for clean-HOME runs.
			...(process.env.STUDIO_REAL_USERDATA ? {} : { STUDIO_USER_DATA: path.join(base, "userdata") }),
			STUDIO_DOWNLOADS: downloads,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	const log = [];
	child.stdout.on("data", (d) => log.push(d.toString()));
	child.stderr.on("data", (d) => log.push(d.toString()));

	let target = null;
	// STUDIO_LAUNCH_WAIT_S: the first launch of a big downloaded bundle waits for macOS to check it (minutes).
	const tries = Math.round((Number(process.env.STUDIO_LAUNCH_WAIT_S) || 30) * 1000 / 150);
	for (let i = 0; i < tries && !target; i++) {
		await sleep(150);
		try {
			const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
			target = list.find((t) => t.type === "page" && t.url.includes("/projects"));
		} catch {}
	}
	if (!target) {
		// Hard, and the pipes closed: a half-started app ignored SIGTERM and its open stdio kept node alive for ever
		// (a runner then held a test slot with nothing running).
		child.kill("SIGKILL");
		child.stdout.destroy();
		child.stderr.destroy();
		throw new Error(`app did not open a page\n${log.join("").slice(-3000)}`);
	}
	const page = new Page(target.webSocketDebuggerUrl, child, log, downloads);
	await page.open();
	return page;
}

export class Page {
	constructor(ws, child, log, downloads) {
		this.url = ws;
		this.child = child;
		this.log = log;
		this.downloads = downloads;
		this.id = 0;
		this.pending = new Map();
		this.events = [];
		this.console = [];
	}

	open() {
		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(this.url);
			this.ws.onopen = async () => {
				await this.send("Runtime.enable");
				await this.send("Page.enable");
				await this.send("DOM.enable");
				await this.send("Log.enable");
				resolve();
			};
			this.ws.onerror = reject;
			this.ws.onmessage = (m) => {
				const msg = JSON.parse(m.data);
				if (msg.id && this.pending.has(msg.id)) {
					const { resolve, reject } = this.pending.get(msg.id);
					this.pending.delete(msg.id);
					msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
				} else if (msg.method) {
					this.events.push(msg);
					if (msg.method === "Runtime.consoleAPICalled") {
						this.console.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
					} else if (msg.method === "Runtime.exceptionThrown") {
						const d = msg.params.exceptionDetails;
						this.console.push(`EXCEPTION: ${d.exception?.description ?? d.text}`);
					} else if (msg.method === "Log.entryAdded") {
						this.console.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
					}
				}
			};
		});
	}

	send(method, params = {}) {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}

	async eval(expression) {
		const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
		return r.result.value;
	}

	async waitFor(expression, { timeout = 15000, label = expression } = {}) {
		const started = Date.now();
		while (Date.now() - started < timeout) {
			try {
				const v = await this.eval(expression);
				if (v) return v;
			} catch {}
			await sleep(150);
		}
		throw new Error(`timed out waiting for: ${label}`);
	}

	async screenshot(file) {
		const r = await this.send("Page.captureScreenshot", { format: "png" });
		fs.writeFileSync(file, Buffer.from(r.data, "base64"));
		return file;
	}

	async goto(url) {
		await this.send("Page.navigate", { url });
		await sleep(500);
	}

	// Click the centre of the first element matching a CSS selector, or the first button/link whose text matches.
	async click(target) {
		// The materials panel's tabs: one per key up to 1.0.78; from 1.0.79 seven, with Transitions / Filters / Captions as
		// sub-tabs of their group (the segment at the top) and Adjustment inside Filters. Either way a name opens its place.
		const keys = { Media: ["media"], Audio: ["sounds"], Text: ["text"], Stickers: ["stickers"], Effects: ["effects"], Transitions: ["transitions"], Captions: ["captions"], Filters: ["filters"], Color: ["color", "filters"], Adjustment: ["color", "filters"], Templates: ["templates"], Motion: ["motion"], AI: ["avatar"], "AI avatar": ["avatar"] }[target];
		const at = (sel) => this.eval(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`).catch(() => null);
		for (const key of keys ?? []) {
			const direct = await at(`[data-tab-group="${key}"]`);
			if (direct) {
				await this.mouse(direct.x, direct.y);
				await sleep(250);
				const own = await at(`[data-sub-tab="${key}"]`);
				if (own) {
					await this.mouse(own.x, own.y);
					await sleep(250);
				}
				return direct;
			}
			const group = { transitions: "effects", filters: "effects", captions: "text", motion: "templates" }[key];
			const g = group ? await at(`[data-tab-group="${group}"]`) : null;
			if (g) {
				await this.mouse(g.x, g.y);
				await sleep(250);
				const sub = await at(`[data-sub-tab="${key}"]`);
				if (sub) {
					await this.mouse(sub.x, sub.y);
					await sleep(250);
				}
				return g;
			}
		}
		const box = await this.eval(`(() => {
			const t = ${JSON.stringify(target)};
			let el = null;
			try { el = document.querySelector(t); } catch {}
			const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
			const label = (e) => (e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || '').trim();
			for (const sel of ['button, a, [role=button], [role=menuitem], [role=menuitemradio], [role=tab], [role=option], [role=checkbox], [role=switch]', 'label, span, p, div']) {
				if (el) break;
				const all = [...document.querySelectorAll(sel)].filter(visible);
				el = all.find(e => label(e) === t) || all.find(e => (e.getAttribute('aria-label') || e.getAttribute('title') || '') === t)
					// The start page's button: «New project 9:16» (ui9 377ec0c), then CapCut's «Create project» card (its testid stays
					// new-project); old scenarios still ask for «New project» / «Новый ролик».
					|| (/^(new project|новый ролик|create project)$/i.test(t) ? (document.querySelector('[data-testid=new-project]') ?? all.find(e => /^new project[^0-9]*9:16$/i.test(label(e)))) : null);
			}
			if (!el) return null;
			el.scrollIntoView({ block: 'center' });
			const r = el.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		})()`);
		if (!box) throw new Error(`nothing to click: ${target}`);
		await this.mouse(box.x, box.y);
		return box;
	}

	/** Clicks the first visible button whose label starts with `prefix`; returns the full label. */
	async clickStarts(prefix) {
		const label = await this.eval(`[...document.querySelectorAll('button')].find(b => b.getBoundingClientRect().width > 0 && b.innerText.trim().startsWith(${JSON.stringify(prefix)}))?.innerText.trim()`);
		if (!label) throw new Error(`no button starting with: ${prefix}`);
		await this.click(label);
		return label;
	}

	async mouse(x, y, { button = "left", clickCount = 1 } = {}) {
		await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
		await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount });
		await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount });
		await sleep(120);
	}

	async drag(from, to, steps = 12) {
		await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
		await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1 });
		for (let i = 1; i <= steps; i++) {
			const x = from.x + ((to.x - from.x) * i) / steps;
			const y = from.y + ((to.y - from.y) * i) / steps;
			await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
			await sleep(16);
		}
		await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1 });
		await sleep(150);
	}

	async key(key, { code = key, modifiers = 0, text } = {}) {
		await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, text, windowsVirtualKeyCode: keyCode(key) });
		await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: keyCode(key) });
		await sleep(100);
	}

	async type(text) {
		await this.send("Input.insertText", { text });
		await sleep(100);
	}

	// Put files into a file <input> (what the system file picker would do).
	async setFiles(selector, files) {
		const doc = await this.send("DOM.getDocument", { depth: -1, pierce: true });
		const { nodeId } = await this.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
		if (!nodeId) throw new Error(`no file input: ${selector}`);
		await this.send("DOM.setFileInputFiles", { nodeId, files });
	}

	async close() {
		try {
			this.ws.close();
		} catch {}
		// Already gone (a crash test killed it): "exit" was emitted before anyone listened, waiting would never end.
		if (this.child.exitCode !== null || this.child.signalCode !== null) {
			this.child.stdout.destroy();
			this.child.stderr.destroy();
			return;
		}
		const exited = new Promise((r) => this.child.once("exit", r));
		this.child.kill("SIGTERM");
		const t = setTimeout(() => this.child.kill("SIGKILL"), 4000);
		await exited;
		clearTimeout(t);
		this.child.stdout.destroy();
		this.child.stderr.destroy();
	}
}

function keyCode(key) {
	// Punctuation gets its own Windows virtual key: «.» as charCode 46 is VK_DELETE, so a typed «.» deleted forward and the
	// dot never reached the field («2» «.» «5» read «25», check-flow A6 and final-B D2 — the harness, not the app).
	const map = { Enter: 13, Escape: 27, Backspace: 8, Delete: 46, " ": 32, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Tab: 9, ";": 186, "=": 187, ",": 188, "-": 189, ".": 190, "/": 191, "`": 192, "[": 219, "\\": 220, "]": 221, "'": 222, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
	if (map[key]) return map[key];
	if (key.length === 1) return key.toUpperCase().charCodeAt(0);
	return 0;
}

export { sleep };
