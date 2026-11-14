import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// yt-dlp's self-update: only a checksum list signed by yt-dlp's own key is trusted, the built-in copy is never
// touched, and an update that can't run falls back to it. Network mocked; the signature fixtures are yt-dlp's real
// 2026.10.21 release files.
const fixtures = path.join(import.meta.dir, "fixtures", "ytdlp-2026.10.21");
const sums = fs.readFileSync(path.join(fixtures, "SHA2-256SUMS"));
const sig = fs.readFileSync(path.join(fixtures, "SHA2-256SUMS.sig"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-update-"));
const bin = path.join(root, "bin");
fs.mkdirSync(bin);
/** A fake program for the test's own runtime (a packaged app runs yt-dlp through it). */
const script = (file: string, body: string) => fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
script(path.join(bin, "yt-dlp"), `const a = process.argv.slice(2); if (a.includes("--version")) console.log("2026.08.19"); else console.log("built-in");`);
const saved = { ...process.env };
Object.assign(process.env, { STUDIO_BIN_DIR: bin, STUDIO_SUPPORT_DIR: root });
const { installLatest, runYtdlp, ytdlpBinary } = await import("../ytdlp-update");
const { verifyDetached } = await import("../openpgp");
const { YTDLP_KEY } = await import("../ytdlp-update");
const realFetch = globalThis.fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
	for (const k of ["STUDIO_BIN_DIR", "STUDIO_SUPPORT_DIR"]) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	fs.rmSync(root, { recursive: true, force: true });
});
const home = path.join(root, "Tools", "yt-dlp");
beforeEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("signature", () => {
	test("yt-dlp's real signed checksum list passes; one changed byte or another key fails", () => {
		expect(verifyDetached(sums, sig, YTDLP_KEY)).toBe(true);
		const tampered = Buffer.from(sums);
		tampered[0] ^= 1;
		expect(verifyDetached(tampered, sig, YTDLP_KEY)).toBe(false);
		const brokenSig = Buffer.from(sig);
		brokenSig[brokenSig.length - 5] ^= 1;
		expect(verifyDetached(sums, brokenSig, YTDLP_KEY)).toBe(false);
		const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
		expect(verifyDetached(sums, sig, `not a key ${other.n}`)).toBe(false);
	});
});

describe("update", () => {
	function fakeGitHub(list: Buffer) {
		const asked: string[] = [];
		globalThis.fetch = (async (url: string) => {
			asked.push(String(url));
			if (String(url).includes("api.github.com")) return Response.json({ tag_name: "2026.10.21", assets: [{ name: "yt-dlp_macos.zip", size: 9 }] });
			if (String(url).endsWith("SHA2-256SUMS")) return new Response(new Uint8Array(list));
			if (String(url).endsWith("SHA2-256SUMS.sig")) return new Response(new Uint8Array(sig));
			return new Response("zip bytes", { status: 200 });
		}) as unknown as typeof fetch;
		return asked;
	}

	test("a checksum list that isn't signed by yt-dlp is refused: nothing downloaded, the built-in yt-dlp stays", async () => {
		const forged = Buffer.from(sums.toString().replace(/^[0-9a-f]{64}/m, "0".repeat(64)));
		const asked = fakeGitHub(forged);
		expect(await installLatest()).toBeNull();
		expect(asked.some((u) => u.endsWith(".zip"))).toBe(false);
		expect(ytdlpBinary()).toBe(path.join(bin, "yt-dlp"));
		expect(JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8")).note).toContain("isn't signed by yt-dlp's key");
	});

	test("a download that doesn't match the signed checksum is deleted and nothing changes", async () => {
		fakeGitHub(sums);
		expect(await installLatest()).toBeNull();
		expect(ytdlpBinary()).toBe(path.join(bin, "yt-dlp"));
		expect(fs.readdirSync(home).sort()).toEqual(["state.json"]);
	});

	test("an installed update that can't start is dropped and the built-in yt-dlp does the job", async () => {
		const dir = path.join(home, "2026.10.21");
		fs.mkdirSync(dir, { recursive: true });
		const exe = path.join(dir, "yt-dlp_macos");
		script(exe, `console.error("[PYI-12345:ERROR] Failed to load Python shared library"); process.exit(1);`);
		fs.writeFileSync(path.join(home, "state.json"), JSON.stringify({ version: "2026.10.21", exe }));
		expect(ytdlpBinary()).toBe(exe);
		const r = await runYtdlp(["-J", "--", "https://www.youtube.com/watch?v=abcdefghijk"], { timeout: 30 });
		expect(r.stdout.trim()).toBe("built-in");
		expect(ytdlpBinary()).toBe(path.join(bin, "yt-dlp"));
		expect(fs.existsSync(dir)).toBe(false);
	});
});
