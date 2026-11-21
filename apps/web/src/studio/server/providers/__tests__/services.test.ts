import { afterAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "gz-services-test-"));
process.env.LIPSYNC_HOME = home;
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

test("every row has Gaziyav's own way first and OpenFilm's services after", async () => {
	const { ROWS, optionsOf } = await import("../registry");
	expect(ROWS.length).toBe(11);
	for (const r of ROWS) expect(optionsOf(r.id)[0].id).toBe("gaziyav");
	expect(optionsOf("image-search").map((o) => o.id)).toContain("pexels:photos");
	expect(optionsOf("tts").some((o) => o.provider === "elevenlabs")).toBe(true);
});

test("no choice = Gaziyav's own way (1.0.58); a chosen service without its key falls back to it", async () => {
	const { chosen, choose, setServiceKeysForTests } = await import("../services");
	setServiceKeysForTests({});
	expect(chosen("image-search").id).toBe("gaziyav");
	choose("image-search", "pexels:photos");
	expect(chosen("image-search").id).toBe("gaziyav");
	setServiceKeysForTests({ pexels: "k".repeat(20) });
	expect(chosen("image-search").id).toBe("pexels:photos");
	choose("image-search", "gaziyav");
	setServiceKeysForTests(null);
});

test("the brain answers through the app, and says one line when it isn't connected", async () => {
	const { brainChat, setBrainForTests, BRAIN_OFF } = await import("../../brain");
	await expect(brainChat("t", [{ role: "user", content: "hi" }])).rejects.toThrow(BRAIN_OFF);
	setBrainForTests(async (r) => (r.json ? 'ok {"a":1} end' : `echo ${r.prompt.includes("hi")}`));
	expect(await brainChat("t", [{ role: "system", content: "s" }, { role: "user", content: "hi" }])).toBe("echo true");
	expect(await brainChat("t", [{ role: "user", content: "x" }], { json: true })).toBe('{"a":1}');
	setBrainForTests(null);
});

test("the extra library rows are CC0 music and sounds in Gaziyav's own categories", async () => {
	const rows = (await import("@/library/extra-audio.json")).default as Array<{ k: string; c: string }>;
	expect(rows.length).toBeGreaterThan(6000);
	expect(rows.some((r) => r.k === "music" && r.c === "Ambient & Calm")).toBe(true);
});

test("image search goes to the chosen service (Pexels) and only its answer's files may be fetched", async () => {
	const { choose, setServiceKeysForTests } = await import("../services");
	const { searchPicturesByChoice, foundUrl } = await import("../search");
	setServiceKeysForTests({ pexels: "p".repeat(20) });
	const real = globalThis.fetch;
	let asked = "";
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		asked = String(url);
		expect((init?.headers as Record<string, string>).authorization).toBe("p".repeat(20));
		return Response.json({ photos: [{ id: 7, url: "https://www.pexels.com/photo/7", alt: "Sun", photographer: "Ann", width: 10, height: 10, src: { large2x: "https://images.pexels.com/7-big.jpg", medium: "https://images.pexels.com/7-s.jpg" } }] });
	}) as typeof fetch;
	try {
		expect(await searchPicturesByChoice("sun", 1)).toBeNull();
		choose("image-search", "pexels:photos");
		const r = await searchPicturesByChoice("sun", 1);
		expect(asked).toContain("api.pexels.com/v1/search");
		expect(r?.items[0].fullUrl).toBe("https://images.pexels.com/7-big.jpg");
		expect(foundUrl("https://images.pexels.com/7-big.jpg")).toBe(true);
	} finally {
		globalThis.fetch = real;
		choose("image-search", "gaziyav");
		setServiceKeysForTests(null);
	}
});

test("the services' voices: the catalog's and the listed ones, ready only with their key", async () => {
	const { setServiceKeysForTests } = await import("../services");
	const { serviceVoices, isServiceVoice } = await import("../voices");
	setServiceKeysForTests({ elevenlabs: "e".repeat(20) });
	const all = await serviceVoices();
	expect(all.length).toBeGreaterThanOrEqual(2219 + 50);
	expect(all.filter((v) => v.service === "elevenlabs").every((v) => v.ready)).toBe(true);
	expect(all.filter((v) => v.service === "cartesia").some((v) => v.ready)).toBe(false);
	expect(isServiceVoice(all[0].id)).toBe(true);
	expect(isServiceVoice("ryan")).toBe(false);
	setServiceKeysForTests(null);
});

test("a run lands its files and says a refused key in one plain line", async () => {
	const { PORTED, runService, setServiceKeysForTests } = await import("../services");
	setServiceKeysForTests({ fake: "k".repeat(20) });
	PORTED.fake = { id: "fake", name: "Fake", verbs: ["image"], run: async (_v, args, ctx) => {
		if (args.prompt === "bad") throw new Error("Fake did not accept your key (401). Check it in Studio");
		expect(ctx.key).toBe("k".repeat(20));
		return { files: [{ path: "assets/image/gen.png", bytes: new Uint8Array([1, 2, 3]) }], index: [], receipt: {} };
	} };
	const into = fs.mkdtempSync(path.join(os.tmpdir(), "gz-run-"));
	try {
		const r = await runService("fake", "image", { prompt: "a cat", out: "gen" }, { into });
		expect(fs.readFileSync(r.files[0]).length).toBe(3);
		await expect(runService("fake", "image", { prompt: "bad", out: "gen" }, { into })).rejects.toThrow("The service didn't accept the key: paste it again in Settings → Services.");
	} finally {
		delete PORTED.fake;
		fs.rmSync(into, { recursive: true, force: true });
		setServiceKeysForTests(null);
	}
});

test("the brain: system text goes apart, JSON is found in any wrapping, a bad answer is asked again once", async () => {
	const { brainChat, jsonIn, setBrainForTests, BRAIN_MISS } = await import("../../brain");
	expect(jsonIn('Вот:\n```json\n{"a":[1,2]}\n```\nГотово')).toBe('{"a":[1,2]}');
	expect(jsonIn('Sure! {"x": {"y": 1}} hope it helps')).toBe('{"x": {"y": 1}}');
	expect(jsonIn("no json here")).toBeNull();
	const asks: Array<{ system?: string; prompt: string }> = [];
	setBrainForTests(async (r) => {
		asks.push(r);
		return asks.length === 1 ? "Here is a tree with text, hope you like it" : '```json\n{"layers":[]}\n```';
	});
	expect(await brainChat("plan", [{ role: "system", content: "SCHEMA" }, { role: "user", content: "дерево с текстом" }], { json: true })).toBe('{"layers":[]}');
	expect(asks[0].system).toBe("SCHEMA");
	expect(asks[0].prompt).toContain("дерево с текстом");
	expect(asks[1].prompt).toContain("not valid JSON");
	setBrainForTests(async () => "still prose");
	await expect(brainChat("plan", [{ role: "user", content: "x" }], { json: true })).rejects.toThrow(BRAIN_MISS);
	setBrainForTests(null);
});

test("Create with Gaziyav AI: the kit for what it draws as it is, its own animation otherwise (the boilerplate doesn't decide)", async () => {
	const { classify } = await import("@/montage/server/agent");
	const base = { request: "Design one reusable on-screen element… no full-frame scene…", width: 1080, height: 1920, fps: 30, duration: 5, playhead: 0, alpha: true, clips: [], words: [], layers: [], preset: true };
	expect(classify({ ...base, brief: "неоновая плашка с именем" } as never).mode).toBe("quick");
	expect(classify({ ...base, brief: "lower third for a podcast host" } as never).mode).toBe("quick");
	expect(classify({ ...base, brief: "дерево с текстом" } as never).mode).toBe("full");
	expect(classify({ ...base, brief: "карта маршрута" } as never).mode).toBe("full");
});

test("the Post sheet's writer carries its language to Claude, whatever the material's language", async () => {
	const { setBrainForTests } = await import("../../brain");
	const { writeCaption } = await import("@/share/server/caption-writer");
	let seen: { lang?: string; system?: string } = {};
	setBrainForTests(async (r) => {
		seen = r;
		return '{"title":"Как экспортировать за 30 секунд","description":"Коротко.","hashtags":["#рилс"]}';
	});
	const w = await writeCaption({ material: "Clips: Chat clip, short text-based video", platforms: ["instagram"] as never, lang: "ru" });
	expect(seen.lang).toBe("ru");
	expect(seen.system).toContain("in Russian, whatever language the material is in");
	expect(w.title).toContain("Как");
	setBrainForTests(null);
});
