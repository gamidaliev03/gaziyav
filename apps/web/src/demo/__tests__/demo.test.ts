import { describe, expect, test } from "bun:test";
import { allowedHost, answer, apiPath, NOT_IN_DEMO } from "../api-shim";
import { isAiPath } from "../ai-adapter";
import { pickLanguage, verdict } from "../support";
import { decode, encode, MAGIC } from "../project-format";

describe("the page's own /api/ answers", () => {
	test("facts the editor asks at start are answered", async () => {
		expect((await answer("/api/version").json()).demo).toBe(true);
		expect(await answer("/api/hardware").json()).toEqual({ tier: "standard" });
		expect((await answer("/api/transcribe/status").json()).available).toBe(false);
		expect(await answer("/api/library/index").json()).toEqual({ items: [], sources: [] });
	});
	test("the voice-over's word-timing check passes: the browser's voice job skips word timings", async () => {
		const st = await answer("/api/ondevice/status").json();
		expect(st.models.find((m: { id: string }) => m.id === "whisper")?.installed).toBe(true);
	});
	test("the export cache is absent, so exports render from scratch", () => {
		expect(answer("/api/export/cache").status).toBe(404);
	});
	test("everything else is a quiet «not here», never a network request", async () => {
		const r = answer("/api/studio/lipsync", "POST");
		expect(r.status).toBe(501);
		expect((await r.json()).error).toBe(NOT_IN_DEMO);
		expect(answer("/api/youtube/info").status).toBe(404);
	});
	test("an /api/ path is found under any sub-path, and only on the page's own origin", () => {
		const o = "https://someone.github.io";
		expect(apiPath(new URL(`${o}/repo/editor/api/version`), o)).toBe("/api/version");
		expect(apiPath(new URL(`${o}/api/fonts/x.ttf`), o)).toBe("/api/fonts/x.ttf");
		expect(apiPath(new URL("https://elsewhere.example/api/version"), o)).toBeNull();
		expect(apiPath(new URL(`${o}/repo/editor/_next/static/chunks/a.js`), o)).toBeNull();
	});
	test("other hosts: only the listed ones, https, «*.x» = sub-hosts", () => {
		const list = ["queue.fal.run", "*.fal.media"];
		expect(allowedHost("https://queue.fal.run", list)).toBe(true);
		expect(allowedHost("https://v3b.fal.media", list)).toBe(true);
		expect(allowedHost("https://fal.media.evil.example", list)).toBe(false);
		expect(allowedHost("http://queue.fal.run", list)).toBe(false);
		expect(allowedHost("https://example.com", list)).toBe(false);
		expect(allowedHost("https://v3.fal.media", [])).toBe(false);
	});
	test("AI areas go to the one adapter", () => {
		expect(isAiPath("/api/studio/lipsync")).toBe(true);
		expect(isAiPath("/api/fal/run")).toBe(true);
		expect(isAiPath("/api/version")).toBe(false);
	});
});

describe("browser support and language", () => {
	const all = { indexedDB: true, opfs: true, opfsWrite: true, wasm: true, videoEncoder: true, audioEncoder: true };
	test("Chrome / Edge: nothing to say", () => expect(verdict(all)).toEqual({ fatal: false, en: "", ru: "" }));
	test("no video encoder: editing works, export needs Chrome or Edge", () => {
		const v = verdict({ ...all, videoEncoder: false });
		expect(v.fatal).toBe(false);
		expect(v.en).toContain("export needs Chrome or Edge");
	});
	// Safari up to 18: the video encoder is there, the audio one is not — the export writes its sound uncompressed
	test("no audio encoder alone: nothing to say", () => expect(verdict({ ...all, audioEncoder: false })).toEqual({ fatal: false, en: "", ru: "" }));
	test("no writable OPFS: one sentence instead of the editor", () => expect(verdict({ ...all, opfsWrite: false }).fatal).toBe(true));
	test("the language: the stored choice, else the browser's, else English", () => {
		expect(pickLanguage("ru", ["en-US"])).toBe("ru");
		expect(pickLanguage(null, ["de-DE", "ru-RU", "en"])).toBe("ru");
		expect(pickLanguage(null, ["en-GB", "ru"])).toBe("en");
		expect(pickLanguage(null, ["de"])).toBe("en");
		expect(pickLanguage("system", ["ru"])).toBe("ru");
	});
});

describe("the project file", () => {
	test("header and media come back byte for byte", async () => {
		const header = { project: { metadata: { id: "p1", name: "X" } } as never, media: [{ meta: { id: "m1" } as never, name: "a.mp4", type: "video/mp4", size: 3 }, { meta: { id: "m2" } as never, name: "b.m4a", type: "audio/mp4", size: 2 }] };
		const blob = encode(header, [new Blob([new Uint8Array([1, 2, 3])]), new Blob([new Uint8Array([4, 5])])]);
		expect(await blob.slice(0, MAGIC.length).text()).toBe(MAGIC);
		const back = await decode(blob);
		expect(back.header.project.metadata.name).toBe("X");
		expect([...new Uint8Array(await back.files[0].arrayBuffer())]).toEqual([1, 2, 3]);
		expect([...new Uint8Array(await back.files[1].arrayBuffer())]).toEqual([4, 5]);
	});
	test("another file is refused in words", async () => {
		await expect(decode(new Blob(["hello world, not a project"]))).rejects.toThrow("not a Gaziyav project file");
	});
});
