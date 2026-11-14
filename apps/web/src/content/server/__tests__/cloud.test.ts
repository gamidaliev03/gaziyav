// The content cloud: the upload folder comes first, background downloads go two at a time and wait while something
// heavier runs, the user's own request jumps the queue, the cache keeps under its limit (least recently used go first)
// and clears on request. A local HTTP server stands in for Hugging Face.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-cloud-"));
const blob = (n: number, k: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * k) % 251));
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const files: Record<string, Buffer> = {};
for (let i = 0; i < 8; i++) files[`s${i}.m4a`] = blob(200_000, i + 3);
let active = 0;
let most = 0;
let served = 0;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(req) {
			const name = decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? "");
			const body = files[name];
			if (!body) return new Response("no", { status: 404 });
			active++;
			most = Math.max(most, active);
			served++;
			// A slow network: the body in four parts.
			const stream = new ReadableStream({
				async start(c) {
					for (let i = 0; i < 4; i++) {
						await Bun.sleep(40);
						c.enqueue(body.subarray((i * body.length) / 4, ((i + 1) * body.length) / 4));
					}
					active--;
					c.close();
				},
			});
			return new Response(stream, { headers: { "Content-Length": String(body.length) } });
		},
	});
	process.env.STUDIO_SUPPORT_DIR = path.join(tmp, "support");
	process.env.STUDIO_CONTENT_STAGING = path.join(tmp, "upload");
	process.env.STUDIO_MEDIA_HOSTS = `http://127.0.0.1:${server.port}`;
	process.env.STUDIO_MEDIA_DATASET = "owner/media";
	process.env.STUDIO_CONTENT_CACHE_MB = "1";
});

afterAll(() => {
	server.stop(true);
	fs.rmSync(tmp, { recursive: true, force: true });
});

const row = (name: string, extra: Record<string, unknown> = {}) => ({ part: "Sound Effects", file: `Pops/${name}`, bytes: files[name].length, sha256: sha(files[name]), hf: true, ...extra });

describe("content cloud", () => {
	test("the upload folder is the first source: no network needed before the upload", async () => {
		const cloud = await import("../cloud");
		fs.mkdirSync(path.join(tmp, "upload", "Sound Effects", "Pops"), { recursive: true });
		fs.writeFileSync(path.join(tmp, "upload", "Sound Effects", "Pops", "s0.m4a"), files["s0.m4a"]);
		const before = served;
		const file = await cloud.ensureCached(row("s0.m4a"));
		expect(fs.readFileSync(file).equals(files["s0.m4a"])).toBe(true);
		expect(served).toBe(before);
	});

	test("background downloads: two at a time; the user's own request jumps the queue", async () => {
		const cloud = await import("../cloud");
		most = 0;
		const bg = ["s1.m4a", "s2.m4a", "s3.m4a", "s4.m4a"].map((n) => cloud.ensureCached(row(n), { background: true }));
		await Bun.sleep(20);
		const t0 = Date.now();
		await cloud.ensureCached(row("s4.m4a"));
		const waited = Date.now() - t0;
		await Promise.all(bg);
		expect(most).toBeLessThanOrEqual(3);
		// s4 was last in the queue: asked for by the user it didn't wait for s1–s3 (≈ 3 × 160 ms).
		expect(waited).toBeLessThan(400);
	});

	test("background downloads wait while the timeline plays (or an export or AI job runs)", async () => {
		const cloud = await import("../cloud");
		cloud.setPaused("playback", true);
		const job = cloud.ensureCached(row("s5.m4a"), { background: true });
		await Bun.sleep(300);
		expect(cloud.isCached(row("s5.m4a"))).toBe(false);
		cloud.setPaused("playback", false);
		await job;
		expect(cloud.isCached(row("s5.m4a"))).toBe(true);
	});

	test("progress while it downloads", async () => {
		const cloud = await import("../cloud");
		const r = row("s6.m4a");
		const job = cloud.ensureCached(r);
		const seen: number[] = [];
		for (let i = 0; i < 6; i++) {
			await Bun.sleep(35);
			const p = cloud.progressOf([cloud.keyOf(r)])[cloud.keyOf(r)];
			if (p !== undefined) seen.push(p);
		}
		await job;
		expect(seen.length).toBeGreaterThan(1);
		expect(seen.at(-1)).toBeGreaterThan(seen[0]);
	});

	test("the cache keeps under its limit: the least recently used go first; Clear empties it", async () => {
		const cloud = await import("../cloud");
		// 1 MB limit, 200 kB files: after s7 the cache holds at most 5; s0 (used again just now) stays.
		await cloud.ensureCached(row("s0.m4a"));
		await cloud.ensureCached(row("s7.m4a"));
		const info = cloud.cacheInfo();
		expect(info.bytes).toBeLessThanOrEqual(info.limit);
		expect(cloud.isCached(row("s0.m4a"))).toBe(true);
		expect(cloud.isCached(row("s7.m4a"))).toBe(true);
		expect(cloud.clearCache()).toBeGreaterThan(0);
		expect(cloud.cacheInfo().files).toBe(0);
	});
});
