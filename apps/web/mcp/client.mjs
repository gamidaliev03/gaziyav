// A minimal MCP client over stdio (what Claude Desktop does), for tests: start a server, call its tools, read the
// answers. No model involved, so a scripted edit costs no Claude tokens.
import { spawn } from "node:child_process";

export class McpClient {
	constructor(command, args = [], env = {}) {
		this.proc = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
		this.next = 1;
		this.pending = new Map();
		this.stderr = "";
		let buf = "";
		this.proc.stdout.setEncoding("utf8");
		this.proc.stdout.on("data", (chunk) => {
			buf += chunk;
			for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (!line) continue;
				const msg = JSON.parse(line);
				const p = this.pending.get(msg.id);
				if (!p) continue;
				this.pending.delete(msg.id);
				if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
				else p.resolve(msg.result);
			}
		});
		this.proc.stderr.on("data", (d) => {
			this.stderr += d;
		});
	}

	request(method, params = {}, timeoutMs = 60 * 60_000) {
		const id = this.next++;
		this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method}: no answer in ${timeoutMs / 1000} s`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
		});
	}

	notify(method, params = {}) {
		this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}

	async initialize() {
		const r = await this.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gaziyav-test", version: "1" } });
		this.notify("notifications/initialized");
		return r;
	}

	/** A tool call → { ok, text, images, raw }. */
	async call(name, args = {}, timeoutMs) {
		const r = await this.request("tools/call", { name, arguments: args }, timeoutMs);
		const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
		const images = (r.content ?? []).filter((c) => c.type === "image");
		return { ok: !r.isError, text, images, raw: r };
	}

	close() {
		this.proc.stdin.end();
		setTimeout(() => this.proc.kill(), 500).unref();
	}
}
