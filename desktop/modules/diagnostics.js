// text, project names, keys or prompts (redact() below); nothing is ever sent anywhere (this module opens no socket).
//   <userData>/Diagnostics/<yyyy-mm-dd>.jsonl — one JSON line per event, appended at most once a second; 14 days kept;
//   past 5 MB in a day only counters (one «capped» line at the end of the session)
//   <userData>/Diagnostics/session.json — this session's start, version and last 50 action names; `clean` set on a
//   normal quit, so the next start tells a crash (kill, power loss) from a quit
// The page's side: src/notes/diag.ts (page errors, rejections, long tasks, failed jobs, the action ring).
const fs = require("node:fs");
const path = require("node:path");

const KEEP_DAYS = 14;
const DAY_CAP = 5 * 1024 * 1024;
const RING = 50;

const two = (n) => String(n).padStart(2, "0");
const dayOf = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

const MEDIA_EXT = "mp4|mov|m4v|mkv|webm|avi|mxf|mts|m2ts|3gp|mp3|wav|aac|m4a|flac|ogg|opus|aif|aiff|png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg|psd|pdf|txt|srt|vtt|ass|json|csv|docx?|xlsx?|pptx?|zip|dmg|gaziyav|lut|cube|ttf|otf|woff2?";

/**
 * Takes the content out of a message or a stack: absolute paths and URLs (a stack frame keeps only its script's
 * name), file names, e-mails, long tokens (keys, hashes, ids), quoted text that is not a code name, and any
 * non-Latin words (what he types is Russian). Code names, error kinds and numbers stay.
 */
function redact(value, max = 400) {
	let s = String(value ?? "");
	// a stack frame's script: the URL or path → its last name, keeping line:col
	s = s.replace(/\b(?:https?|file|app|webpack(?:-internal)?):\/\/[^\s)'"]*?([\w.-]+\.(?:m?js|tsx?|jsx))(?=[:)\s]|$)/g, "$1");
	s = s.replace(/\b(?:https?|file|wss?|ftp|blob|data):[^\s)'"]*/g, "<url>");
	s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>");
	// absolute and home paths (unix, Windows), with spaces inside quotes handled by the quote rule below
	s = s.replace(/(?:~|\/(?:Users|Volumes|private|var|tmp|Applications|Library|System|home|opt|mnt|media|etc))(?:\/[^\s'"`)\]]*)+/g, "<path>");
	s = s.replace(/\b[A-Za-z]:\\[^\s'"`)]*/g, "<path>");
	s = s.replace(/(?:^|[\s(])(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.\w{1,6}\b/g, (m) => m.replace(/\S+$/, "<path>"));
	s = s.replace(new RegExp(`[^\\s'"\`/\\\\()<>]*\\.(?:${MEDIA_EXT})\\b`, "gi"), "<file>");
	// quoted text: a code name (reading 'foo', 'Array') stays, anything else is what someone wrote
	s = s.replace(/(['"`«“])([^'"`»”\n]*)(['"`»”])/g, (m, a, body, b) => (/^[A-Za-z_$][\w$.-]{0,40}$/.test(body) ? m : `${a}<text>${b}`));
	s = s.replace(/[^\x00-\x7F]+(?:[\s,.!?:;-]+[^\x00-\x7F]+)*/g, "<text>");
	s = s.replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<id>");
	s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>");
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** A route without its ids: /editor/<uuid> → /editor/:id. */
function redactRoute(route) {
	return String(route ?? "")
		.split("?")[0]
		.split("/")
		.map((seg, i) => (i === 0 || /^[a-z-]{1,24}$/.test(seg) ? seg : seg ? ":id" : seg))
		.join("/")
		.slice(0, 80);
}

/** A stack: its first 8 frames, redacted. */
const redactStack = (stack) => redact(String(stack ?? "").split("\n").slice(0, 9).map((l) => l.trim()).join(" | "), 1200);

const actionName = (a) => (typeof a === "string" && /^[A-Za-z0-9][\w:.-]{0,47}$/.test(a) ? a : "?");
const kindName = (k) => (typeof k === "string" && /^[a-z][\w-]{0,23}$/i.test(k) ? k : "?");
const short = (s, n = 40) => String(s ?? "").replace(/[^\w.:-]/g, "").slice(0, n);

/**
 * The journal itself, without Electron (a bun test drives it): `record(event)` queues one line, a flush at most once a
 * second appends them; `actions(list)` feeds the ring; `quit()` marks the session clean and writes what is queued.
 */
function createRecorder({ dir, version, now = () => new Date(), setTimer = setTimeout, onWrite = () => {} }) {
	fs.mkdirSync(dir, { recursive: true });
	const sessionFile = path.join(dir, "session.json");
	const ring = [];
	let queue = [];
	let timer = null;
	let capped = null; // { day, counts }
	let ringDirty = false;
	const started = now().toISOString();
	const stats = { appends: 0, lines: 0, sessionWrites: 0 };

	const writeSession = (clean) => {
		const tmp = `${sessionFile}.tmp`;
		try {
			stats.sessionWrites++;
			fs.writeFileSync(tmp, JSON.stringify({ start: started, version, pid: process.pid, clean, actions: ring, stats }));
			fs.renameSync(tmp, sessionFile);
		} catch {}
	};
	const fileFor = (d) => path.join(dir, `${dayOf(d)}.jsonl`);

	function flush() {
		timer = null;
		if (ringDirty) {
			ringDirty = false;
			writeSession(false);
		}
		if (!queue.length) return;
		const lines = queue;
		queue = [];
		const d = now();
		const file = fileFor(d);
		let size = 0;
		try {
			size = fs.statSync(file).size;
		} catch {}
		if (size >= DAY_CAP) {
			if (!capped || capped.day !== dayOf(d)) capped = { day: dayOf(d), counts: {} };
			for (const l of lines) capped.counts[l.k] = (capped.counts[l.k] ?? 0) + 1;
			return;
		}
		try {
			fs.appendFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
			stats.appends++;
			stats.lines += lines.length;
			onWrite(lines.length);
		} catch {}
	}
	const schedule = () => {
		if (timer) return;
		timer = setTimer(flush, 1000);
		timer?.unref?.();
	};

	function record(event) {
		queue.push({ t: now().toISOString(), v: version, ...event });
		schedule();
	}
	function actions(list) {
		for (const a of Array.isArray(list) ? list : []) {
			const mark = { a: actionName(a?.a), t: Number(a?.t) || 0 };
			if (Array.isArray(a?.k) && a.k.length) mark.k = a.k.slice(0, 6).map(kindName);
			ring.push(mark);
		}
		while (ring.length > RING) ring.shift();
		ringDirty = true;
		schedule();
	}
	const lastActions = (n = RING) => ring.slice(-n).map((m) => (m.k ? `${m.a}(${m.k.join(",")})` : m.a));

	function begin() {
		// the last session: no clean mark = it ended by a crash, a kill or power loss
		let prev = null;
		try {
			prev = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
		} catch {}
		if (prev && prev.clean !== true) {
			record({ k: "crash", prevStart: String(prev.start ?? ""), prevVersion: short(prev.version, 24), actions: (Array.isArray(prev.actions) ? prev.actions : []).slice(-RING).map((m) => (Array.isArray(m?.k) ? `${actionName(m.a)}(${m.k.map(kindName).join(",")})` : actionName(m?.a))) });
		}
		record({ k: "start", after: !prev ? "first" : prev.clean === true ? "quit" : "crash" });
		writeSession(false);
		// 14 days kept
		const oldest = dayOf(new Date(now().getTime() - KEEP_DAYS * 86400000));
		try {
			for (const name of fs.readdirSync(dir)) {
				const m = /^(\d{4}-\d\d-\d\d)\.jsonl$/.exec(name);
				if (m && m[1] < oldest) fs.rmSync(path.join(dir, name), { force: true });
			}
		} catch {}
	}
	function quit() {
		if (capped) {
			try {
				fs.appendFileSync(fileFor(now()), `${JSON.stringify({ t: now().toISOString(), v: version, k: "capped", counts: capped.counts })}\n`);
			} catch {}
			capped = null;
		}
		record({ k: "quit" });
		if (timer) clearTimeout(timer);
		flush();
		writeSession(true);
	}
	return { record, actions, lastActions, begin, quit, flush, stats };
}

/** Turns what the page sent into journal lines: only the known kinds, every text redacted. */
function fromPage(rec, batch) {
	for (const e of Array.isArray(batch) ? batch.slice(0, 200) : []) {
		if (!e || typeof e !== "object") continue;
		if (e.k === "actions") rec.actions(e.list);
		else if (e.k === "page-error" || e.k === "rejection") rec.record({ k: e.k, msg: redact(e.msg), stack: redactStack(e.stack), route: redactRoute(e.route), n: Math.max(1, Number(e.n) || 1), actions: rec.lastActions(10) });
		else if (e.k === "stalls") rec.record({ k: "stalls", minute: short(e.minute, 30), n: Number(e.n) || 0, longest: Number(e.longest) || 0 });
		else if (e.k === "job-failed") rec.record({ k: "job-failed", job: kindName(e.job), code: errorCode(e.reason), reason: redact(e.reason, 160) });
	}
}

/** A failed job's reason as a code the reader can count. */
function errorCode(reason) {
	const s = String(reason ?? "").toLowerCase();
	const http = /\b([45]\d\d)\b/.exec(s);
	if (/time(d)? ?out|timeout/.test(s)) return "timeout";
	if (/network|offline|fetch failed|econn|enotfound|socket/.test(s)) return "network";
	if (/no (free )?space|enospc|disk full/.test(s)) return "no-space";
	if (/enoent|not found|missing/.test(s)) return "not-found";
	if (/balance|credit|payment|402/.test(s)) return "balance";
	if (/cancel/.test(s)) return "cancelled";
	if (/memory|oom/.test(s)) return "memory";
	if (http) return `http-${http[1]}`;
	return s ? "other" : "none";
}

function register({ fromApp }) {
	const { app, ipcMain } = require("electron");
	const rec = createRecorder({ dir: path.join(app.getPath("userData"), "Diagnostics"), version: app.getVersion() });
	rec.begin();
	// console.error of the pages: counted per script, written once a minute
	let consoleCounts = {};
	const consoleTimer = setInterval(() => {
		if (!Object.keys(consoleCounts).length) return;
		rec.record({ k: "console-errors", counts: consoleCounts });
		consoleCounts = {};
	}, 60000);
	consoleTimer.unref?.();
	const flushConsole = () => {
		if (Object.keys(consoleCounts).length) rec.record({ k: "console-errors", counts: consoleCounts });
		consoleCounts = {};
	};

	ipcMain.on("studio:diag", (event, batch) => {
		if (!fromApp(event)) return;
		fromPage(rec, batch);
	});
	process.on("uncaughtException", (error) => {
		if (error?.code === "EPIPE") return;
		rec.record({ k: "main-exception", msg: redact(error?.message ?? error), stack: redactStack(error?.stack) });
		rec.flush();
	});
	app.on("web-contents-created", (_e, wc) => {
		if (wc.getType() !== "window") return;
		wc.on("console-message", (...args) => {
			const e = args[0];
			const level = typeof args[1] === "number" ? ["verbose", "info", "warning", "error"][args[1]] : e?.level;
			if (level !== "error") return;
			const source = String((typeof args[4] === "string" ? args[4] : e?.sourceId) ?? "").split(/[/?#]/).filter(Boolean).pop() || "page";
			const key = /^[\w.-]{1,60}$/.test(source) ? source : "page";
			consoleCounts[key] = (consoleCounts[key] ?? 0) + 1;
		});
		wc.on("render-process-gone", (_ev, d) => {
			rec.record({ k: "render-gone", reason: short(d?.reason, 24), exitCode: Number(d?.exitCode) || 0, route: redactRoute(safeRoute(wc)), actions: rec.lastActions() });
			rec.flush();
		});
		wc.on("unresponsive", () => rec.record({ k: "unresponsive", route: redactRoute(safeRoute(wc)), actions: rec.lastActions(10) }));
		wc.on("responsive", () => rec.record({ k: "responsive" }));
	});
	app.on("child-process-gone", (_e, d) => rec.record({ k: "child-gone", type: short(d?.type, 24), reason: short(d?.reason, 24), exitCode: Number(d?.exitCode) || 0, name: short(d?.name, 40) }));
	app.on("will-quit", () => {
		flushConsole();
		rec.quit();
	});
	return rec;
}

function safeRoute(wc) {
	try {
		return new URL(wc.getURL()).pathname;
	} catch {
		return "";
	}
}

module.exports = { register, createRecorder, redact, redactRoute, redactStack, errorCode, fromPage };
