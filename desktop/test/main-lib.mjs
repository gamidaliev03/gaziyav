// The app's main process in a test: launch with STUDIO_EXTRA_ARGS="--inspect=<port>" (STUDIO_MAIN_PORT), then
// main(port).eval("expression") runs it there (globalThis.__studioTest in test mode: state, window, Menu, clickMenu).
import { execFileSync } from "node:child_process";

export const MAIN_PORT = Number(process.env.STUDIO_MAIN_PORT || 9797);

export async function mainProcess(port = MAIN_PORT, timeoutMs = 15000) {
	const started = Date.now();
	let url = null;
	while (!url && Date.now() - started < timeoutMs) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			url = list[0]?.webSocketDebuggerUrl ?? null;
		} catch {}
		if (!url) await new Promise((r) => setTimeout(r, 150));
	}
	if (!url) throw new Error(`no main-process inspector on ${port}`);
	const ws = new WebSocket(url);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	let next = 1;
	const waiting = new Map();
	ws.onmessage = (event) => {
		const msg = JSON.parse(String(event.data));
		const done = waiting.get(msg.id);
		if (done) {
			waiting.delete(msg.id);
			done(msg);
		}
	};
	const send = (method, params = {}) =>
		new Promise((resolve) => {
			const id = next++;
			waiting.set(id, resolve);
			ws.send(JSON.stringify({ id, method, params }));
		});
	return {
		/** Evaluates in the main process (awaits promises); JSON-able results only. */
		async eval(expression) {
			const r = await send("Runtime.evaluate", { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
			if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "main eval failed");
			return r.result?.result?.value;
		},
		close() {
			try {
				ws.close();
			} catch {}
		},
	};
}

/** PIDs and kinds of this bundle's processes (main, GPU, renderer, utility/server…). */
export function bundleProcesses(bundle) {
	const out = execFileSync("/bin/ps", ["-A", "-o", "pid=,%cpu=,rss=,command="], { encoding: "utf8" });
	return out
		.split("\n")
		.filter((l) => l.includes(`${bundle}/Contents/`))
		.map((l) => {
			const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(l);
			if (!m) return null;
			const command = m[4];
			const kind = /--type=gpu-process/.test(command)
				? "gpu"
				: /--type=renderer/.test(command)
					? "renderer"
					: /utility-sub-type=node\.mojom\.NodeService/.test(command)
						? "server"
						: /--type=utility/.test(command)
							? "utility"
						: /\/Contents\/MacOS\//.test(command)
							? "main"
							: /\/Contents\/Resources\//.test(command)
								? "tool"
								: "helper";
			return { pid: Number(m[1]), cpu: Number(m[2]), rssMb: Math.round(Number(m[3]) / 1024), kind, command };
		})
		.filter(Boolean);
}

/**
 * Every process of a running copy: the main process and all its descendants — Electron's helpers, the editor server
 * (it renames itself «next-server», so the bundle's path is not in its command line) and the tools it runs.
 */
export function appTree(rootPid) {
	const out = execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid=,%cpu=,rss=,command="], { encoding: "utf8" });
	const rows = out
		.split("\n")
		.map((l) => /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(l))
		.filter(Boolean)
		.map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), rssMb: Math.round(Number(m[4]) / 1024), command: m[5] }));
	const keep = new Set([rootPid]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const r of rows) if (!keep.has(r.pid) && keep.has(r.ppid)) (keep.add(r.pid), (grew = true));
	}
	return rows
		.filter((r) => keep.has(r.pid))
		.map((r) => ({
			...r,
			kind: r.pid === rootPid
				? "main"
				: /^next-server/.test(r.command)
					? "server"
					: /--type=gpu-process/.test(r.command)
						? "gpu"
						: /--type=renderer/.test(r.command)
							? "renderer"
							: /--type=utility/.test(r.command)
								? "utility"
								: "tool",
		}));
}
