// Command-line tools (ffmpeg, ffprobe, yt-dlp) with timeouts, cancellation and live output.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CancelledError, StudioError } from "./errors";
import { IS_WINDOWS } from "@/platform/os";
import { pausableTimeout, trackProcess, waitCool } from "@/ondevice/thermal";

const IS_WIN = IS_WINDOWS;

// Bundled tools first (Resources/bin of the app). The packaged app never looks anywhere else: no Homebrew,
// no ~/.local. A development server (no STUDIO_BIN_DIR) falls back to the usual install places.
function searchDirs(): string[] {
	const bin = process.env.STUDIO_BIN_DIR;
	if (bin) return [bin];
	if (IS_WIN) return (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
	return [path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
}

/** The tool's file name: Windows tools are .exe files (helper scripts such as local-tts.py keep their name). */
export function toolFile(name: string): string {
	return IS_WIN && !path.extname(name) ? `${name}.exe` : name;
}

/** PATH for the tools: the app's own folder, then only the system's folders (the packaged app ignores user installs). */
function toolPath(): string {
	if (IS_WIN) {
		const root = process.env.SystemRoot || "C:\\Windows";
		const system = [path.join(root, "System32"), root, path.join(root, "System32", "Wbem")];
		return [...searchDirs(), ...(process.env.STUDIO_BIN_DIR ? system : [])].join(path.delimiter);
	}
	return `${searchDirs().join(":")}:${process.env.STUDIO_BIN_DIR ? "/usr/bin:/bin:/usr/sbin:/sbin" : (process.env.PATH ?? "")}`;
}

export function findTool(name: string): string {
	for (const dir of searchDirs()) {
		const p = path.join(dir, toolFile(name));
		try {
			fs.accessSync(p, fs.constants.X_OK);
			return p;
		} catch {}
	}
	throw new StudioError(
		process.env.STUDIO_BIN_DIR
			? `The app's built-in ${name} is missing. Reinstall the app.`
			: IS_WIN
				? `${toolFile(name)} not found on PATH (development build).`
				: `${name} not found. Install it with \`brew install ${name === "ffprobe" ? "ffmpeg" : name}\` (development build).`,
	);
}

/**
 * Windows has no /usr/bin/env or /usr/bin/nice, which the callers use as launchers: `env KEY=V… cmd args` becomes
 * `cmd args` with KEY=V in its environment, and `nice -n N cmd args` becomes `cmd args` at below-normal priority.
 */
export function windowsCommand(tool: string, args: string[]): { bin: string; argv: string[]; env: Record<string, string>; low: boolean } {
	const env: Record<string, string> = {};
	let low = false;
	let rest = [tool, ...args];
	for (;;) {
		if (rest[0] === "/usr/bin/env") {
			rest = rest.slice(1);
			while (rest.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0])) {
				const at = rest[0].indexOf("=");
				env[rest[0].slice(0, at)] = rest[0].slice(at + 1);
				rest = rest.slice(1);
			}
		} else if (rest[0] === "/usr/bin/nice") {
			low = true;
			rest = rest[1] === "-n" ? rest.slice(3) : rest.slice(1);
		} else break;
	}
	return { bin: rest[0], argv: rest.slice(1), env, low };
}

/** Ends a tool and everything it started (Windows has no process groups: taskkill walks the tree). */
function killProcessTree(pid: number, sync = false) {
	if (IS_WIN) {
		const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
		const argv = ["/pid", String(pid), "/T", "/F"];
		if (sync) spawnSync(taskkill, argv, { stdio: "ignore", windowsHide: true, timeout: 5000 });
		else spawn(taskkill, argv, { stdio: "ignore", windowsHide: true }).unref();
		return;
	}
	// Everything under the tool goes, not only its group: Remotion's Chrome (puppeteer) starts in a group of its own,
	// and a cancelled render left it running for hours (IDEAL reliable §1). The tree is read before anything is killed.
	const groups = new Set<number>([pid]);
	const pids = new Set<number>();
	try {
		const ps = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid="], { encoding: "utf8", timeout: 5000 }).stdout || "";
		const rows = ps.split("\n").map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length === 3 && r[0] > 1);
		const under = new Set<number>([pid]);
		for (const [p, , g] of rows) if (g === pid) under.add(p);
		for (let grew = true; grew; ) {
			grew = false;
			for (const [p, pp] of rows) if (!under.has(p) && under.has(pp)) (under.add(p), (grew = true));
		}
		// never the server's own group (nor the app's)
		const own = rows.find((r) => r[0] === process.pid)?.[2];
		for (const [p, , g] of rows) {
			if (!under.has(p) || p === process.pid) continue;
			pids.add(p);
			if (g > 1 && g !== own && g !== process.pid) groups.add(g);
		}
	} catch {}
	for (const g of groups) {
		try {
			process.kill(-g, "SIGKILL");
		} catch {}
	}
	for (const p of pids) {
		try {
			process.kill(p, "SIGKILL");
		} catch {}
	}
}

export interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

export interface RunOptions {
	timeout?: number;
	signal?: AbortSignal;
	onLine?: (line: string) => void;
	cwd?: string;
	env?: Record<string, string>;
	/**
	 * A model (Python helper, neuralfx, whisper…): it runs below the editor's own work (nice 5, the Windows below-normal
	 * class), waits while the Mac is hot and stands still (SIGSTOP) when it gets hot midway (ondevice/thermal.ts); its
	 * time limit counts only the time it ran.
	 */
	heavy?: boolean;
}

/** The lowered CPU priority of a model: enough to keep the interface smooth, measured at ≤ 5 % on the model's speed. */
export const MODEL_NICE = "5";

export async function run(tool: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
	if (options.heavy) {
		await waitCool(options.signal);
		if (!IS_WIN && tool !== "/usr/bin/nice") return spawnRun("/usr/bin/nice", ["-n", MODEL_NICE, tool, ...args], options);
	}
	return spawnRun(tool, args, options);
}

function spawnRun(tool: string, args: string[], { timeout = 120, signal, onLine, cwd, env, heavy }: RunOptions): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new CancelledError());
		const win = IS_WIN ? windowsCommand(tool, args) : null;
		if (win && heavy) win.low = true;
		const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, ...win?.env };
		// Windows keeps the variable as "Path": one PATH only.
		if (win) for (const key of Object.keys(childEnv)) if (key.toUpperCase() === "PATH") delete childEnv[key];
		childEnv.PATH = toolPath();
		const child = spawn(win?.bin ?? tool, win?.argv ?? args, {
			cwd,
			env: childEnv,
			stdio: ["ignore", "pipe", "pipe"],
			// Own process group, so cancel also stops grandchildren (yt-dlp's launcher spawns the real downloader).
			// Not on Windows: a detached child gets a console window of its own there, and taskkill /T stops the tree.
			detached: !IS_WIN,
			windowsHide: true,
		});
		if (win?.low && child.pid) {
			try {
				os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
			} catch {}
		}
		const group = child.pid;
		if (group) liveGroups.add(group);
		// A model stands still while the Mac is hot (its whole group: the helper and what it started).
		const untrack = heavy && child.pid ? trackProcess(child.pid, { group: !IS_WIN }) : null;
		// "close" waits for every process holding the pipes (grandchildren too).
		child.once("close", () => {
			if (group) liveGroups.delete(group);
			untrack?.();
		});
		const killTree = () => {
			try {
				if (child.pid) killProcessTree(child.pid);
			} catch {
				child.kill("SIGKILL");
			}
		};
		let stdout = "";
		let stderr = "";
		let partial = "";
		let finished = false;
		const lines = (chunk: string) => {
			if (!onLine) return;
			partial += chunk;
			const parts = partial.split(/\r?\n|\r/);
			partial = parts.pop() ?? "";
			for (const l of parts) if (l.trim()) onLine(l);
		};
		child.stdout.on("data", (d) => {
			const s = d.toString();
			stdout += s;
			lines(s);
		});
		child.stderr.on("data", (d) => {
			const s = d.toString();
			stderr += s;
			if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
			lines(s);
		});
		// A model's limit counts only the time it ran (not the pause while the Mac was hot).
		const timer = pausableTimeout(timeout * 1000, () => {
			if (finished) return;
			finished = true;
			killTree();
			reject(new StudioError(`${path.basename(heavy && tool === "/usr/bin/nice" ? (args[2] ?? tool) : tool)} didn't finish within ${Math.round(timeout)} s`));
		});
		const onAbort = () => {
			if (finished) return;
			finished = true;
			timer.clear();
			killTree();
			reject(new CancelledError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.on("error", (err) => {
			if (finished) return;
			finished = true;
			timer.clear();
			signal?.removeEventListener("abort", onAbort);
			reject(new StudioError(`Couldn't start ${path.basename(tool)}: ${err.message}`));
		});
		child.on("close", (code) => {
			if (finished) return;
			finished = true;
			timer.clear();
			signal?.removeEventListener("abort", onAbort);
			resolve({ status: code ?? -1, stdout, stderr });
		});
	});
}

// Tools run detached (own process group), so they would outlive the server: when the app quits
// (SIGTERM from the shell) every running tool group is killed with it, and quitting stays instant.
const liveGroups: Set<number> =
	((globalThis as any).__studioToolGroups as Set<number>) ?? ((globalThis as any).__studioToolGroups = new Set());

function killLiveGroups() {
	for (const pid of liveGroups) {
		try {
			killProcessTree(pid, true);
		} catch {}
	}
	liveGroups.clear();
}

if (!(globalThis as any).__studioToolExitHooks) {
	(globalThis as any).__studioToolExitHooks = true;
	process.on("exit", killLiveGroups);
	for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
		process.on(sig, () => {
			killLiveGroups();
			// Exit unless Next's own shutdown listens too (the Whisper hook defers to whoever exits).
			const others = process.listenerCount(sig) - 1 - ((globalThis as any).__whisperExitHooks ? 1 : 0);
			if (others <= 0) process.exit(0);
		});
	}
}

/** The meaningful last lines of a tool's error output. */
export function reason(r: RunResult): string {
	const lines = (r.stderr || r.stdout)
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("WARNING"));
	const errors = lines.filter((l) => /error/i.test(l));
	return (errors.length ? errors : lines).slice(-3).join(" ").replace(/^ERROR:\s*/i, "").slice(0, 600) || `exit code ${r.status}`;
}
