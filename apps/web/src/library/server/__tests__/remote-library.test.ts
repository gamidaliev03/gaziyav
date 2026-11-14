// The music and sound library without its files: the app has only the catalog; a file downloads on first use,
// is checked, cached, and never downloaded twice. A local HTTP server stands in for the file's source.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-medialib-"));
const sound = Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7) % 251));
const other = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 13) % 241));
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
let hits: Record<string, number> = {};
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			const p = new URL(req.url).pathname;
			hits[p] = (hits[p] ?? 0) + 1;
			if (p === "/whoosh.mp3") return new Response(sound, { headers: { "Content-Type": "audio/mpeg" } });
			if (p === "/pop.mp3") return new Response(other, { headers: { "Content-Type": "audio/mpeg" } });
			if (p === "/bad.mp3") return new Response(Buffer.from("not the file"));
			return new Response("no", { status: 404 });
		},
	});
	const base = `http://127.0.0.1:${server.port}`;
	// The app's catalog: library.json rows, no audio files next to them.
	const lib = path.join(tmp, "app", "library", "Sound Effects");
	fs.mkdirSync(path.join(tmp, "app", "bin"), { recursive: true });
	fs.mkdirSync(lib, { recursive: true });
	const rows = [
		{ id: "1", title: "Air whoosh", group: "Transitions", tag: "whoosh", file: "Transitions/Air whoosh [1].mp3", dur: 1.2, bytes: sound.length, sha256: sha(sound), url: `${base}/whoosh.mp3` },
		{ id: "2", title: "Bubble pop", group: "Pops & UI", tag: "pop", file: "Pops & UI/Bubble pop [2].mp3", dur: 0.4, bytes: other.length, sha256: sha(other), url: `${base}/pop.mp3`, top: 1 },
		{ id: "3", title: "Broken", group: "Pops & UI", tag: "pop", file: "Pops & UI/Broken [3].mp3", dur: 1, bytes: 999, sha256: sha(sound), url: `${base}/bad.mp3` },
	];
	fs.writeFileSync(path.join(lib, "library.json"), JSON.stringify(rows));
	process.env.STUDIO_BIN_DIR = path.join(tmp, "app", "bin");
	process.env.STUDIO_SUPPORT_DIR = path.join(tmp, "support");
	process.env.LIPSYNC_HOME = path.join(tmp, "support");
	process.env.STUDIO_MEDIA_HOSTS = "";
	delete process.env.STUDIO_KADR_DIR;
});

afterAll(() => {
	server.stop(true);
	fs.rmSync(tmp, { recursive: true, force: true });
});

const req = (url: string, init?: RequestInit) => new Request(`http://localhost:47821${url}`, { ...init, headers: { host: "localhost:47821", "x-studio": "1", ...(init?.headers ?? {}) } });
const ctx = (...p: string[]) => ({ params: Promise.resolve({ path: p }) });

describe("media library from the network", () => {
	test("the catalog is there without the network: every item, marked as not downloaded", async () => {
		const { getLibraryIndex } = await import("@/library/server/index-store");
		const items = getLibraryIndex().items.filter((i) => i.src === "kadr");
		expect(items.map((i) => i.id).sort()).toEqual(["ks-1", "ks-2", "ks-3"]);
		expect(items.every((i) => i.remote)).toBe(true);
		expect(Object.values(hits).reduce((a, b) => a + b, 0)).toBe(0);
	});

	test("a clip's address (placed at once with the catalog length) serves the real file once downloaded", async () => {
		const { libraryFileUrl } = await import("@/library/types");
		expect(libraryFileUrl("ks-1")).toBe("/api/library/file/ks-1");
		const { GET } = await import("@/app/api/library/[...path]/route");
		const res = await GET(req("/api/library/file/ks-1"), ctx("file", "ks-1"));
		expect(res.status).toBe(200);
		expect(Buffer.from(await res.arrayBuffer()).equals(sound)).toBe(true);
		expect(hits["/whoosh.mp3"]).toBe(1);
		expect(fs.existsSync(path.join(tmp, "support", "MediaLibrary", "Sound Effects", "Transitions", "Air whoosh [1].mp3"))).toBe(true);
	});

	test("a downloaded file is never downloaded again, and the index says it is here", async () => {
		const { GET } = await import("@/app/api/library/[...path]/route");
		for (let i = 0; i < 3; i++) {
			const res = await GET(req("/api/library/file/ks-1"), ctx("file", "ks-1"));
			expect(res.status).toBe(200);
		}
		expect(hits["/whoosh.mp3"]).toBe(1);
		const { getLibraryIndex } = await import("@/library/server/index-store");
		expect(getLibraryIndex().items.find((i) => i.id === "ks-1")?.remote).toBeUndefined();
	});

	test("adding a clip starts the download in the background; many requests at once make one download", async () => {
		const { POST } = await import("@/app/api/library/[...path]/route");
		const { ensureCached } = await import("@/library/server/remote");
		const { libraryRemote } = await import("@/library/server/index-store");
		const found = libraryRemote("ks-2");
		expect(found).not.toBeNull();
		const remote = found as NonNullable<typeof found>;
		const res = await POST(req("/api/library/fetch", { method: "POST", body: JSON.stringify({ id: "ks-2" }) }), ctx("fetch"));
		expect(await res.json()).toEqual({ downloading: true });
		const files = await Promise.all([1, 2, 3].map(() => ensureCached(remote.part, remote.row)));
		expect(new Set(files).size).toBe(1);
		expect(hits["/pop.mp3"]).toBe(1);
	});

	test("a wrong file (size or checksum) is refused and not cached", async () => {
		const { GET } = await import("@/app/api/library/[...path]/route");
		const res = await GET(req("/api/library/file/ks-3"), ctx("file", "ks-3"));
		expect(res.status).toBe(503);
		expect((await res.json()).error).toContain("Couldn't download");
		expect(fs.existsSync(path.join(tmp, "support", "MediaLibrary", "Sound Effects", "Pops & UI", "Broken [3].mp3"))).toBe(false);
	});

	test("opening the Audio tab fetches the top files in the background", async () => {
		fs.rmSync(path.join(tmp, "support", "MediaLibrary", "Sound Effects", "Pops & UI"), { recursive: true, force: true });
		hits = {};
		const { prefetchTop, resetPrefetch } = await import("@/library/server/remote");
		const { remoteRows } = await import("@/library/server/index-store");
		resetPrefetch();
		expect(await prefetchTop(remoteRows())).toBe(1);
		expect(hits["/pop.mp3"]).toBe(1);
		expect(hits["/whoosh.mp3"]).toBeUndefined();
	});
});
