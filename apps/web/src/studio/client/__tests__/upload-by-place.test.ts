import { afterEach, expect, test } from "bun:test";

// perf, 13.11: a clip whose file is on this Mac went to the local server as every byte of it, read into the page and
// streamed over HTTP, only to be written to disk again (each AI step on a long talk: transcribe, clean voice, lipsync,
// assist, hear). Now it is handed over by its place; the server clones it (app/api/studio/[...path] «upload-path»).

const g = globalThis as unknown as { studioApp?: unknown; fetch: typeof fetch; XMLHttpRequest?: unknown };
const realFetch = g.fetch;
afterEach(() => {
	g.fetch = realFetch;
	delete g.studioApp;
	delete g.XMLHttpRequest;
});

const bigFile = () => new File([new Uint8Array(8 << 20)], "talk.mp4", { type: "video/mp4" });

test("a file on disk is sent by its place: a request of under 1 KB, not its 8 MB", async () => {
	const { uploadOnce } = await import("@/studio/client/api");
	const sent: Array<{ url: string; bytes: number }> = [];
	g.studioApp = { pathForFile: () => "/Users/someone/Movies/talk.mp4" };
	g.fetch = (async (url: string, init?: RequestInit) => {
		sent.push({ url: String(url), bytes: typeof init?.body === "string" ? init.body.length : init?.body ? Number.POSITIVE_INFINITY : 0 });
		return new Response(JSON.stringify({ fileId: "0123456789abcdef", duration: 1200, hasAudio: true, hasVideo: true }), { status: 200 });
	}) as typeof fetch;
	g.XMLHttpRequest = class {
		constructor() {
			throw new Error("the bytes were sent");
		}
	};
	const r = await uploadOnce("by-place", bigFile());
	expect(r.fileId).toBe("0123456789abcdef");
	expect(sent.length).toBe(1);
	expect(sent[0].url).toBe("/api/studio/upload-path");
	expect(sent[0].bytes).toBeLessThan(1024);
});

test("a server that can't take it from there (outside its folders, changed, older): the bytes, as before", async () => {
	const { uploadOnce } = await import("@/studio/client/api");
	g.studioApp = { pathForFile: () => "/Volumes/Elsewhere/talk.mp4" };
	g.fetch = (async () => new Response(JSON.stringify({ error: "Gaziyav AI may only open media from …" }), { status: 400 })) as unknown as typeof fetch;
	let bodyBytes = 0;
	g.XMLHttpRequest = class {
		upload = {};
		status = 200;
		responseText = JSON.stringify({ fileId: "fedcba9876543210", duration: 1, hasAudio: true, hasVideo: false });
		onload: (() => void) | null = null;
		open() {}
		setRequestHeader() {}
		send(body: File) {
			bodyBytes = body.size;
			queueMicrotask(() => this.onload?.());
		}
	};
	const r = await uploadOnce("fallback", bigFile());
	expect(r.fileId).toBe("fedcba9876543210");
	expect(bodyBytes).toBe(8 << 20);
});

test("a file made in the page (no place on disk) is sent as bytes without asking the server first", async () => {
	const { uploadOnce } = await import("@/studio/client/api");
	let asked = 0;
	g.studioApp = { pathForFile: () => "" };
	g.fetch = (async () => {
		asked++;
		return new Response("{}", { status: 500 });
	}) as unknown as typeof fetch;
	g.XMLHttpRequest = class {
		upload = {};
		status = 200;
		responseText = JSON.stringify({ fileId: "00000000000000aa", duration: 1, hasAudio: false, hasVideo: true });
		onload: (() => void) | null = null;
		open() {}
		setRequestHeader() {}
		send() {
			queueMicrotask(() => this.onload?.());
		}
	};
	const r = await uploadOnce("made-here", bigFile());
	expect(r.fileId).toBe("00000000000000aa");
	expect(asked).toBe(0);
});
