import { afterAll, beforeAll, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadFile } from "../download";

// Model downloads where the main host is blocked (it never answers, like huggingface.co in some countries): the
// first file moves to the mirror after two short tries, and the next files start on the mirror at once.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-test-"));
const realFetch = globalThis.fetch;
const saved = [process.env.STUDIO_TEST, process.env.STUDIO_FAKE_TIMEOUT];
beforeAll(() => Object.assign(process.env, { STUDIO_TEST: "1", STUDIO_FAKE_TIMEOUT: "0.2" }));
afterAll(() => {
	globalThis.fetch = realFetch;
	for (const [k, v] of [["STUDIO_TEST", saved[0]], ["STUDIO_FAKE_TIMEOUT", saved[1]]] as const) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a host that never answers is skipped for the next files; every file arrives verified", async () => {
	const files = ["a.bin", "b.bin", "c.bin"].map((name, i) => ({ name, data: Buffer.alloc(5000 + i, i + 1) }));
	const asked: string[] = [];
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		const u = new URL(String(url));
		asked.push(u.host);
		if (u.host === "blocked.example.com") {
			// Hangs until the downloader gives up on it.
			return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
		}
		const f = files.find((x) => u.pathname.endsWith(x.name));
		return new Response(new Uint8Array(f?.data ?? Buffer.alloc(0)), { headers: { "content-length": String(f?.data.length ?? 0) } });
	}) as typeof fetch;
	const t0 = Date.now();
	for (const f of files) {
		const sha = crypto.createHash("sha256").update(f.data).digest("hex");
		await downloadFile([`https://blocked.example.com/m/${f.name}`, `https://mirror.example.com/m/${f.name}`], path.join(dir, f.name), f.data.length, sha, new AbortController().signal, () => {});
		expect(fs.readFileSync(path.join(dir, f.name)).equals(f.data)).toBe(true);
	}
	expect(asked.filter((h) => h === "blocked.example.com").length).toBe(2);
	expect(Date.now() - t0).toBeLessThan(3000);
});
