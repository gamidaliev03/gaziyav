import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeEntry, decodeHead, type EntryHead, encodeEntry, fromBase64, toBase64 } from "../entry";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "export-cache-"));
const key = (n: number) => n.toString(16).padStart(64, "0");
const entry = (k: string, bytes: number, frames = 3) => {
	const head: EntryHead = { v: 1, kind: "video", key: k, codec: "avc1.640028", description: toBase64(new Uint8Array([1, 100, 0, 40])), width: 1280, height: 720, frames, made: 1 };
	const packets = Array.from({ length: frames }, (_, i) => ({ key: i === 0, data: new Uint8Array(Math.floor(bytes / frames)).fill(i + 1), timestamp: 0, duration: 0 }));
	return encodeEntry(head, packets);
};
let cache: typeof import("../../server/build-cache");

beforeAll(async () => {
	process.env.STUDIO_DATA_DIR = dir;
	process.env.STUDIO_EXPORT_CACHE_LIMIT = String(100_000);
	cache = await import("../../server/build-cache");
});
afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
	delete process.env.STUDIO_EXPORT_CACHE_LIMIT;
});

describe("a kept stretch as bytes", () => {
	test("goes round: head, packets, their order and sizes", () => {
		const bytes = entry(key(1), 3000);
		const back = decodeEntry(bytes);
		expect(back?.head.key).toBe(key(1));
		expect(back?.packets.map((p) => [p.key, p.data.length, p.data[0]])).toEqual([
			[true, 1000, 1],
			[false, 1000, 2],
			[false, 1000, 3],
		]);
		expect(decodeHead(bytes.subarray(0, 400))?.head.frames).toBe(3);
		expect([...fromBase64(toBase64(new Uint8Array([0, 255, 7, 128])))]).toEqual([0, 255, 7, 128]);
	});
	test("bytes that are not a whole entry are not an entry", () => {
		const bytes = entry(key(1), 3000);
		expect(decodeEntry(bytes.subarray(0, bytes.length - 1))).toBe(null);
		expect(decodeEntry(new Uint8Array(40))).toBe(null);
		const more = new Uint8Array(bytes.length + 1);
		more.set(bytes);
		expect(decodeEntry(more)).toBe(null);
	});
});

describe("the kept stretches on disk", () => {
	test("kept and read back; what is not there is not there", () => {
		const bytes = entry(key(2), 9000);
		expect(cache.cachePut(key(2), bytes)).toBe(true);
		const back = cache.cacheGet(key(2));
		expect(back && Buffer.compare(back, Buffer.from(bytes))).toBe(0);
		expect(cache.cacheGet(key(3))).toBe(null);
		expect(cache.cacheGet("../../etc/passwd")).toBe(null);
		const have = cache.cacheHave([key(2), key(3), "nonsense"]);
		expect(Object.keys(have)).toEqual([key(2)]);
		expect(have[key(2)].head.frames).toBe(3);
		expect(have[key(2)].bytes).toBe(bytes.length);
	});
	test("a damaged entry is never handed out: it is removed and counts as not there", () => {
		cache.cachePut(key(4), entry(key(4), 6000));
		const file = path.join(dir, "export-cache", cache.cacheSalt(), key(4).slice(0, 2), `${key(4)}.gzx`);
		const data = fs.readFileSync(file);
		data[data.length - 50] ^= 0xff;
		fs.writeFileSync(file, data);
		expect(cache.cacheGet(key(4))).toBe(null);
		expect(fs.existsSync(file)).toBe(false);
		// cut short (a kill in the middle of a write never leaves this under the entry's name, but a disk can)
		cache.cachePut(key(4), entry(key(4), 6000));
		fs.writeFileSync(file, fs.readFileSync(file).subarray(0, 2000));
		expect(cache.cacheGet(key(4))).toBe(null);
		expect(Object.keys(cache.cacheHave([key(4)]))).toEqual([]);
	});
	test("bounded: the stretches used longest ago make room; one too large for the limit is not kept", () => {
		cache.cacheClear();
		for (let i = 10; i < 20; i++) {
			expect(cache.cachePut(key(i), entry(key(i), 15_000))).toBe(true);
			// (file times are the order of use)
			const file = path.join(dir, "export-cache", cache.cacheSalt(), key(i).slice(0, 2), `${key(i)}.gzx`);
			const when = new Date(Date.now() - (30 - i) * 60_000);
			if (fs.existsSync(file)) fs.utimesSync(file, when, when);
		}
		const info = cache.cacheInfo();
		expect(info.bytes).toBeLessThanOrEqual(100_000);
		expect(info.count).toBeLessThan(10);
		// the newest are there, the oldest went
		expect(cache.cacheGet(key(19))).not.toBe(null);
		expect(cache.cacheGet(key(10))).toBe(null);
		expect(cache.cachePut(key(99), entry(key(99), 300_000))).toBe(false);
		expect(cache.cacheInfo().bytes).toBeLessThanOrEqual(100_000);
	});
	test("Clear empties it; another app build's stretches are not this build's", () => {
		cache.cachePut(key(30), entry(key(30), 3000));
		const other = path.join(dir, "export-cache", "0123456789abcdef", "00");
		fs.mkdirSync(other, { recursive: true });
		fs.writeFileSync(path.join(other, `${key(31)}.gzx`), "old build");
		expect(cache.cacheClear().bytes).toBe(0);
		expect(cache.cacheGet(key(30))).toBe(null);
		expect(fs.existsSync(other)).toBe(false);
		expect(cache.cacheInfo().limit).toBe(100_000);
	});
});
