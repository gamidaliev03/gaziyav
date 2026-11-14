import { afterAll, beforeAll, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { queueOrder } from "../background";
import { downloadFile } from "../download";
import { MODELS, modelClass } from "../manifest";

// The download policy (docs/AI-DOWNLOAD.md): small models (≤ 1 GB) come by themselves, captions first; large ones only
// when Settings says so; a removed model never comes back by itself. A background download stands still while the
// user works and continues from its bytes on disk.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-test-"));
const realFetch = globalThis.fetch;
const saved = [process.env.STUDIO_TEST, process.env.STUDIO_FAKE_TIMEOUT];
beforeAll(() => Object.assign(process.env, { STUDIO_TEST: "1", STUDIO_FAKE_TIMEOUT: "0.5" }));
afterAll(() => {
	globalThis.fetch = realFetch;
	for (const [k, v] of [["STUDIO_TEST", saved[0]], ["STUDIO_FAKE_TIMEOUT", saved[1]]] as const) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

test("the classes: speech, Claude's hearing, Enhance voice, Separate, Voice changer, CleanUp and Retouch are small (voice, lipsync and face swap run on fal)", () => {
	const cls = Object.fromEntries(MODELS.map((m) => [m.id, modelClass(m)]));
	expect(cls).toEqual({ whisper: "small", hear: "small", denoise: "small", separate: "small", voicechange: "small", cleanup: "small", retouch: "small" });
});

const all = MODELS.map((m) => ({ id: m.id, cls: modelClass(m), installed: false }));
const none = new Set<never>();

test("the queue: small ones only, speech recognition first; large ones after them when the switch is on", () => {
	expect(queueOrder(all, { large: false, declined: none, skip: none })).toEqual(["whisper", "hear", "denoise", "separate", "voicechange", "cleanup", "retouch"]);
	// No large model on this Mac in Gaziyav: the switch adds nothing.
	expect(queueOrder(all, { large: true, declined: none, skip: none })).toEqual(["whisper", "hear", "denoise", "separate", "voicechange", "cleanup", "retouch"]);
});

test("the queue leaves out what is here, can't run here, comes with the app, was removed by the user or failed this session", () => {
	const models = all.map((m) => ({ ...m, installed: m.id === "whisper", unsupported: m.id === "separate", bundled: m.id === "cleanup" }));
	expect(queueOrder(models, { large: false, declined: new Set(["voicechange"] as const), skip: new Set(["retouch", "hear"] as const) })).toEqual(["denoise"]);
});

test("an installed model that lacks an add-on file is topped up in its own place in the queue — unless the user removed the model or it failed", () => {
	// the speech model is here, its add-on (the speech detector) is not: it goes first, like the model itself would
	const models = all.map((m) => ({ ...m, installed: m.id === "whisper" || m.id === "hear", addons: m.id === "whisper" }));
	expect(queueOrder(models, { large: false, declined: none, skip: none })).toEqual(["whisper", "denoise", "separate", "voicechange", "cleanup", "retouch"]);
	// a model that came with the app still gets the add-on the app does not carry
	expect(queueOrder(models.map((m) => ({ ...m, bundled: true })), { large: false, declined: none, skip: none })).toEqual(["whisper"]);
	expect(queueOrder(models, { large: false, declined: new Set(["whisper"] as const), skip: none })).toEqual(["denoise", "separate", "voicechange", "cleanup", "retouch"]);
	expect(queueOrder(models, { large: false, declined: none, skip: new Set(["whisper"] as const) })).toEqual(["denoise", "separate", "voicechange", "cleanup", "retouch"]);
	// nothing missing: nothing to do
	expect(queueOrder(models.map((m) => ({ ...m, installed: true, addons: false })), { large: false, declined: none, skip: none })).toEqual([]);
});

test("a background download stands still while the user works (the connection let go) and continues from the bytes on disk", async () => {
	const data = crypto.randomBytes(400_000);
	const sha = crypto.createHash("sha256").update(data).digest("hex");
	const ranges: number[] = [];
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		const from = Number(/bytes=(\d+)-/.exec(String((init.headers as Record<string, string>)?.Range ?? ""))?.[1] ?? 0);
		ranges.push(from);
		let sent = 0;
		const body = new ReadableStream<Uint8Array>({
			async pull(c) {
				await new Promise((r) => setTimeout(r, 5));
				const at = from + sent;
				if (at >= data.length) return c.close();
				const piece = data.subarray(at, Math.min(data.length, at + 20_000));
				sent += piece.length;
				c.enqueue(piece);
			},
		});
		const headers: Record<string, string> = from ? { "content-range": `bytes ${from}-${data.length - 1}/${data.length}` } : { "content-length": String(data.length) };
		return new Response(body, { status: from ? 206 : 200, headers });
	}) as typeof fetch;
	let busy = false;
	let seen = 0;
	const dest = path.join(dir, "model.bin");
	const done = downloadFile("https://example.com/model.bin", dest, data.length, sha, new AbortController().signal, (b) => (seen = b), {
		pause: () => (busy ? "export" : null),
	});
	await new Promise((r) => setTimeout(r, 30));
	busy = true;
	await new Promise((r) => setTimeout(r, 300));
	const atPause = fs.statSync(`${dest}.part`).size;
	await new Promise((r) => setTimeout(r, 400));
	// Nothing more arrived while the user worked.
	expect(fs.statSync(`${dest}.part`).size).toBe(atPause);
	expect(atPause).toBeGreaterThan(0);
	expect(atPause).toBeLessThan(data.length);
	busy = false;
	await done;
	expect(fs.readFileSync(dest).equals(data)).toBe(true);
	expect(seen).toBe(data.length);
	// The second request asked for the rest only.
	expect(ranges.length).toBe(2);
	expect(ranges[1]).toBe(atPause);
});

test("the speed cap: 300 KB at 1 MB/s take about 0.3 s", async () => {
	const data = crypto.randomBytes(300_000);
	const sha = crypto.createHash("sha256").update(data).digest("hex");
	globalThis.fetch = (async () => {
		const chunks = Array.from({ length: 30 }, (_, i) => data.subarray(i * 10_000, (i + 1) * 10_000));
		return new Response(new ReadableStream({ pull: (c) => {
			const next = chunks.shift();
			return next ? c.enqueue(next) : c.close();
		} }), { headers: { "content-length": String(data.length) } });
	}) as unknown as typeof fetch;
	const t0 = Date.now();
	await downloadFile("https://example.com/capped.bin", path.join(dir, "capped.bin"), data.length, sha, new AbortController().signal, () => {}, { rate: 1_000_000 });
	const ms = Date.now() - t0;
	expect(ms).toBeGreaterThan(220);
	expect(ms).toBeLessThan(2000);
});
