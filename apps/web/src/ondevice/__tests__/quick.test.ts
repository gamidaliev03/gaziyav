import { afterAll, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { CONNECTION_LOST, downloadFile, UNREACHABLE } from "../download";

// craft B: a download a feature waits for (quick) says a dead or silent host within ~5 s, in one calm sentence; a
// resumed download fetches only what is missing; the bar never goes back. A local stand-in server, a few MB.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dl-quick-"));
const DATA = crypto.randomBytes(3_000_000);
const SHA = crypto.createHash("sha256").update(DATA).digest("hex");
let mode: "ok" | "hang" | "silent" | "drop" = "ok";
const served: Array<{ from: number; bytes: number }> = [];
const server = http.createServer((req, res) => {
	if (mode === "hang") return; // never answers
	const from = Number(/bytes=(\d+)-/.exec(req.headers.range ?? "")?.[1] ?? 0);
	res.writeHead(from ? 206 : 200, {
		"Content-Length": DATA.length - from,
		...(from ? { "Content-Range": `bytes ${from}-${DATA.length - 1}/${DATA.length}` } : {}),
	});
	if (mode === "silent") return; // headers, then nothing
	const entry = { from, bytes: 0 };
	served.push(entry);
	let at = from;
	const step = () => {
		if (res.destroyed) return;
		if (at >= DATA.length) return void res.end();
		if (mode === "hang") return; // the bytes stop, the connection stays open
		
		const piece = DATA.subarray(at, at + 64_000);
		at += piece.length;
		entry.bytes += piece.length;
		res.write(piece);
		setTimeout(step, 5);
	};
	step();
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const URL1 = `http://127.0.0.1:${(server.address() as AddressInfo).port}/m/model.bin`;
const DEAD = "http://127.0.0.1:9/m/model.bin"; // refused at once
afterAll(() => {
	server.close();
	fs.rmSync(dir, { recursive: true, force: true });
});
const quick = { quick: () => true };

test("a host that never answers is said within 5 s, both sources tried, one calm sentence", async () => {
	mode = "hang";
	const t0 = Date.now();
	const err = await downloadFile([URL1, `${URL1}?mirror`], path.join(dir, "a.bin"), DATA.length, SHA, new AbortController().signal, () => {}, quick).catch((e) => e);
	const took = Date.now() - t0;
	expect(err?.message).toBe(UNREACHABLE);
	expect(took).toBeLessThan(5200);
	expect(fs.existsSync(path.join(dir, "a.bin"))).toBe(false);
});

test("a refused host is said at once", async () => {
	const t0 = Date.now();
	const err = await downloadFile([DEAD], path.join(dir, "b.bin"), DATA.length, SHA, new AbortController().signal, () => {}, quick).catch((e) => e);
	expect(err?.message).toBe(UNREACHABLE);
	expect(Date.now() - t0).toBeLessThan(1500);
});

test("headers but no bytes: said within 5 s", async () => {
	mode = "silent";
	const t0 = Date.now();
	const err = await downloadFile([URL1], path.join(dir, "c.bin"), DATA.length, SHA, new AbortController().signal, () => {}, quick).catch((e) => e);
	expect(err?.message).toBe(UNREACHABLE);
	expect(Date.now() - t0).toBeLessThan(5200);
});

test("cut mid-way (a kill), then again: only the missing bytes come, progress never goes back, the file is whole", async () => {
	mode = "ok";
	served.length = 0;
	const dest = path.join(dir, "d.bin");
	const ac = new AbortController();
	const seen: number[] = [];
	const first = downloadFile([URL1], dest, DATA.length, SHA, ac.signal, (b) => {
		seen.push(b);
		if (b > 1_000_000) ac.abort();
	}, quick).catch((e) => e);
	await first;
	const kept = fs.statSync(`${dest}.part`).size;
	expect(kept).toBeGreaterThan(1_000_000);
	expect(fs.existsSync(dest)).toBe(false); // never a broken file in place
	const second: number[] = [];
	await downloadFile([URL1], dest, DATA.length, SHA, new AbortController().signal, (b) => second.push(b), quick);
	expect(fs.readFileSync(dest).equals(DATA)).toBe(true);
	const again = served.at(-1);
	expect(again?.from).toBe(kept);
	expect(served.reduce((s, e) => s + e.bytes, 0) - DATA.length).toBeLessThanOrEqual(64_000 * 4); // re-fetched ≈ 0
	for (const xs of [seen, second]) expect(xs.every((x, i) => i === 0 || x >= xs[i - 1])).toBe(true);
});

test("the bytes stop for good after some came: said as a lost connection, the bytes kept for Retry", async () => {
	mode = "drop";
	const dest = path.join(dir, "e.bin");
	const t0 = Date.now();
	const err = await downloadFile([URL1], dest, DATA.length, SHA, new AbortController().signal, () => {
		if (mode === "drop" && fs.existsSync(`${dest}.part`) && fs.statSync(`${dest}.part`).size > 300_000) mode = "hang";
	}, quick).catch((e) => e);
	expect(err?.message).toBe(CONNECTION_LOST);
	expect(Date.now() - t0).toBeLessThan(25_000);
	expect(fs.statSync(`${dest}.part`).size).toBeGreaterThan(300_000);
	mode = "ok";
}, 30_000);
