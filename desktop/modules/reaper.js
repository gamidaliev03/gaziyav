// Nothing of Gaziyav stays behind (IDEAL, reliable §1). The programs the app starts (Remotion's Chrome, ffmpeg, the
// Python and Swift helpers, whisper, yt-dlp…) run in process groups of their own, and Chrome even detaches from the
// script that opened it: a cancelled render, a killed server or a killed app left them running for hours (the owner's
// Mac, 10.11: eight chrome-headless-shell 6.5 h after a render). Electron's crash reporter (chrome_crashpad_handler)
// outlives a kill -9 of the app for ever.
//
// The rule: a process whose command line runs from THIS bundle (or names this profile's folder) and whose parent is
// gone (ppid 1) is a leftover — nothing the app starts on purpose lives like that, except the app itself, the crash
// reporter of a live app and the backup helper that finishes a backup after quit. Leftovers are swept
//   • at start (what a crash or kill -9 of the last run left, its crash reporter too),
//   • every 15 s while the app runs (a job's tool whose parent ended),
//   • at quit,
//   • by a tiny guard (/bin/sh) that outlives a kill -9 of the app and sweeps 1–4 s after it.
// Never anything outside this bundle and this profile: another app, another copy of Gaziyav at another path, nor the
// crash reporter while another copy of this very bundle runs.
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

let roots = [];
let mainExes = [];
let log = () => {};
let timer = null;

/** A path as ps may print it: /private/tmp/… and /tmp/… are the same folder. */
function forms(p) {
	if (!p) return [];
	const out = new Set([p]);
	if (/^\/private\/(tmp|var|etc)\//.test(p)) out.add(p.slice("/private".length));
	if (/^\/(tmp|var|etc)\//.test(p)) out.add(`/private${p}`);
	return [...out];
}
const PAD = /chrome_crashpad_handler/;
const BACKUP = /workspace-backup\.js/;
const isMain = (args) => mainExes.some((exe) => args === exe || args.startsWith(`${exe} `));

function table() {
	const r = spawnSync("/bin/ps", ["-axww", "-o", "pid=,ppid=,etime=,args="], { encoding: "utf8", timeout: 10_000 });
	return (r.stdout || "")
		.split("\n")
		.map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l))
		.filter(Boolean)
		.map((m) => ({ pid: +m[1], ppid: +m[2], age: seconds(m[3]), args: m[4] }));
}
/** ps's elapsed time ([[dd-]hh:]mm:ss) in seconds. */
function seconds(etime) {
	const [d, rest] = etime.includes("-") ? etime.split("-") : ["0", etime];
	const parts = rest.split(":").map(Number);
	while (parts.length < 3) parts.unshift(0);
	return Number(d) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
}
const ours = (args) => roots.some((r) => args.includes(r));

/** Leftovers now: orphans of this bundle/profile and everything under them. */
function leftovers(all = table()) {
	const myAge = process.uptime();
	// another copy of this very bundle runs (a second profile): its crash reporter is not ours to end
	const otherMain = all.some((x) => x.pid !== process.pid && isMain(x.args));
	const orphans = all.filter((x) => {
		if (x.ppid !== 1 || x.pid === process.pid || !ours(x.args) || isMain(x.args) || BACKUP.test(x.args)) return false;
		// the crash reporter: ours started with us; an older one belongs to a run that is gone
		if (PAD.test(x.args)) return !otherMain && x.age > myAge + 5;
		return true;
	});
	const set = new Set(orphans.map((x) => x.pid));
	for (let grew = true; grew; ) {
		grew = false;
		for (const x of all) if (!set.has(x.pid) && set.has(x.ppid)) (set.add(x.pid), (grew = true));
	}
	return all.filter((x) => set.has(x.pid));
}

/** Kills the leftovers; returns how many went. */
function sweep(reason) {
	let list;
	try {
		list = leftovers();
	} catch {
		return 0;
	}
	for (const x of list) {
		try {
			process.kill(x.pid, "SIGKILL");
		} catch {}
	}
	if (list.length) {
		const kinds = {};
		for (const x of list) {
			const k = /chrome-headless-shell/.test(x.args) ? "chrome-headless-shell" : path.basename(x.args.split(" --")[0]).slice(0, 40);
			kinds[k] = (kinds[k] ?? 0) + 1;
		}
		log(`[reaper] ${reason}: ended ${list.length} leftover process(es) ${Object.entries(kinds).map(([k, n]) => `${k}×${n}`).join(", ")}`);
	}
	return list.length;
}

/** The guard: when the app dies without quitting (kill -9, a crash), it sweeps the same leftovers. */
function guard() {
	const AWK = [
		'BEGIN { nr = split(R, rs, "\\t"); ne = split(E, es, "\\t") }',
		'{ a = $0; sub(/^ *[0-9]+ +[0-9]+ +/, "", a); m = 0; for (i = 1; i <= ne; i++) if (a == es[i] || index(a, es[i] " ") == 1) m = 1;',
		"  if (m) { mains++; next } if ($2 != 1) next; o = 0; for (i = 1; i <= nr; i++) if (index(a, rs[i])) o = 1; if (!o) next;",
		"  if (a ~ /workspace-backup\\.js/) next; if (a ~ /chrome_crashpad_handler/) { pads[$1] = 1; next } print $1 }",
		"END { if (!mains) for (p in pads) print p }",
	].join("\n");
	const script = [
		'while kill -0 "$GZ_APP" 2>/dev/null; do sleep 1; done',
		"for i in 1 2 3 4; do",
		'  /bin/ps -axww -o pid=,ppid=,args= | /usr/bin/awk -v R="$GZ_ROOTS" -v E="$GZ_EXES" "$GZ_AWK" | while read p; do kill -9 "$p" 2>/dev/null; done',
		"  sleep 1",
		"done",
	].join("\n");
	try {
		spawn("/bin/sh", ["-c", script], {
			detached: true,
			stdio: "ignore",
			env: { PATH: "/usr/bin:/bin", GZ_APP: String(process.pid), GZ_ROOTS: roots.join("\t"), GZ_EXES: mainExes.join("\t"), GZ_AWK: AWK },
		}).unref();
	} catch {}
}

/**
 * `bundle`: the .app folder; `profile`: the user-data folder (models, components). Sweeps once now, then every 15 s.
 */
function start({ bundle, profile, log: logger }) {
	if (process.platform !== "darwin") return;
	log = logger || log;
	roots = [...forms(`${bundle}/Contents/`), ...forms(profile && `${profile}/`)];
	mainExes = forms(process.execPath);
	sweep("at start");
	guard();
	timer = setInterval(() => sweep("while running"), Number(process.env.STUDIO_TEST_REAPER_MS) || 15_000);
	timer.unref?.();
}
function stop() {
	clearInterval(timer);
	sweep("at quit");
}

module.exports = { start, stop, sweep, leftovers };
