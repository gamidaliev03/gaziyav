// Principle 1 for search: a pasted Pixabay / Pexels key is asked FIRST at once, the free web stays behind it as the
// fallback, every result says where it came from, the source switch is followed by panels and connector alike, and
// music / sounds never come «from Pixabay». Every site is a local stand-in (STUDIO_FAKE_NET).
import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "gz-media-search-"));
const asked: string[] = [];
let pixabayDown = false;
let server: ReturnType<typeof Bun.serve>;

const hit = (url: URL) => {
	const p = `${url.pathname}`;
	asked.push(`${p}?${url.searchParams.toString()}`);
	const base = `http://127.0.0.1:${server.port}`;
	if (p === "/pixabay.com/api/") {
		if (pixabayDown) return new Response("down", { status: 500 });
		return Response.json({ hits: [{ id: 1, pageURL: "https://pixabay.com/p-1", tags: "cat, pet", user: "pb", webformatURL: "https://cdn.pixabay.com/1_640.jpg", largeImageURL: "https://cdn.pixabay.com/1_1280.jpg", imageWidth: 1280, imageHeight: 853 }] });
	}
	if (p === "/pixabay.com/api/videos/") return Response.json({ hits: [{ id: 7, duration: 9, tags: "cat", user: "pb", videos: { large: { url: "https://cdn.pixabay.com/v7.mp4", width: 1920, height: 1080, size: 3e6, thumbnail: "https://cdn.pixabay.com/v7.jpg" } } }] });
	if (p === "/api.pexels.com/v1/search") return Response.json({ photos: [{ id: 2, url: "https://pexels.com/p2", alt: "cat", photographer: "px", width: 1000, height: 800, src: { large2x: "https://images.pexels.com/2.jpg", medium: "https://images.pexels.com/2m.jpg" } }] });
	if (p === "/api.pexels.com/videos/search") return Response.json({ videos: [{ id: 8, duration: 6, image: "https://images.pexels.com/v8.jpg", user: { name: "px" }, video_files: [{ link: "https://videos.pexels.com/8.mp4", width: 1080, height: 1920, file_type: "video/mp4" }] }] });
	if (p === "/commons.wikimedia.org/w/api.php") {
		const s = url.searchParams.get("gsrsearch") ?? "";
		if (/filemime:video$/.test(s)) return Response.json({ query: { pages: { 5: { title: "File:Cat.webm", imageinfo: [{ url: "https://upload.wikimedia.org/cat.webm", thumburl: "https://upload.wikimedia.org/cat.jpg", size: 2e6, width: 1280, height: 720, mime: "video/webm", metadata: [{ name: "length", value: 12 }], extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } } }] } } } });
		if (/filemime:video\/webm\|/.test(s)) return Response.json({ batchcomplete: "" });
		return Response.json({ query: { pages: { 3: { pageid: 3, index: 1, title: "File:Cat.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/c.jpg", thumburl: "https://upload.wikimedia.org/c-360.jpg", width: 800, height: 600, mime: "image/jpeg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Cat.jpg", extmetadata: { Artist: { value: "a" }, LicenseShortName: { value: "CC0" } } }] } } } });
	}
	if (p === "/api.openverse.org/v1/images/") return Response.json({ results: [{ id: "ov1", title: "Cat", url: "https://live.staticflickr.com/1.jpg", thumbnail: "https://api.openverse.org/t/1", foreign_landing_url: "https://flickr.com/1", creator: "f", license: "by", license_version: "2.0" }] });
	if (p === "/images-api.nasa.gov/search") return Response.json({ collection: { items: [{ data: [{ nasa_id: "n1", title: "Cat nebula", center: "JPL" }], links: [{ href: "https://images-assets.nasa.gov/n1~thumb.jpg" }] }] } });
	if (p === "/archive.org/advancedsearch.php") return Response.json({ response: { docs: [{ identifier: "catfilm", title: "Cat film", licenseurl: "http://creativecommons.org/licenses/by/3.0/" }] } });
	if (p === "/archive.org/metadata/catfilm") return Response.json({ files: [{ name: "cat.mp4", size: "5000000", length: "30", width: "640", height: "480" }] });
	if (p === "/api.openverse.org/v1/audio/") {
		const music = url.searchParams.get("category") === "music";
		return Response.json({ results: [music ? { id: "a1", title: "Lofi cat", url: "https://prod-1.storage.jamendo.com/?trackid=1&format=mp32", creator: "j", license: "by-sa", license_version: "3.0", foreign_landing_url: "https://jamendo.com/1", source: "jamendo", duration: 123000 } : { id: "a2", title: "Whoosh", url: "https://cdn.freesound.org/previews/1/1-hq.mp3", creator: "fs", license: "cc0", foreign_landing_url: "https://freesound.org/1", source: "freesound", duration: 1500 }, { id: "a3", title: "NC one", url: "https://x.org/nc.mp3", license: "by-nc", source: "jamendo", duration: 5000 }] });
	}
	if (p === "/cdn.freesound.org/previews/1/1-hq.mp3") return new Response(new Uint8Array(4096), { headers: { "content-type": "audio/mpeg" } });
	return new Response(`no stand-in for ${p} (${base})`, { status: 404 });
};

beforeAll(() => {
	server = Bun.serve({ port: 0, fetch: (req) => hit(new URL(req.url)) });
	Object.assign(process.env, { STUDIO_TEST: "1", STUDIO_FAKE_NET: `http://127.0.0.1:${server.port}`, LIPSYNC_HOME: home, STUDIO_FAKE_TIMEOUT: "5" });
});
afterAll(() => {
	server.stop(true);
	fs.rmSync(home, { recursive: true, force: true });
});

const keys = async (k: Record<string, string>) => (await import("../services")).setServiceKeysForTests(k);
const KEY = "k".repeat(34);

test("no key: pictures come from the free web (Commons, Openverse, NASA), each marked", async () => {
	await keys({});
	const { searchWebImages } = await import("@/media/web-images/server");
	const r = await searchWebImages("cat", 1);
	expect(r.items.map((i) => i.provider)).toEqual(["commons", "openverse", "nasa"]);
	expect(r.searched).toEqual(["Wikimedia Commons", "Openverse", "NASA"]);
	expect(asked.some((a) => a.startsWith("/pixabay.com"))).toBe(false);
});

test("a pasted Pixabay key is asked FIRST at once; the free web stays behind it", async () => {
	await keys({ pixabay: KEY });
	const { searchWebImages } = await import("@/media/web-images/server");
	const r = await searchWebImages("kitten", 1);
	expect(r.items[0].provider).toBe("pixabay");
	expect(r.items.map((i) => i.provider)).toEqual(["pixabay", "commons", "openverse", "nasa"]);
	expect(r.searched?.[0]).toBe("Pixabay");
	// both keys: both keyed ones before the free web
	await keys({ pixabay: KEY, pexels: KEY });
	const both = await searchWebImages("tabby", 1);
	expect(both.items.slice(0, 2).map((i) => i.provider).sort()).toEqual(["pexels", "pixabay"]);
});

test("the switch: one service alone, the free web alone, the library (nothing from the web)", async () => {
	await keys({ pixabay: KEY, pexels: KEY });
	const { searchWebImages } = await import("@/media/web-images/server");
	expect((await searchWebImages("lion", 1, "pixabay")).items.map((i) => i.provider)).toEqual(["pixabay"]);
	expect((await searchWebImages("lion", 1, "web")).items.map((i) => i.provider)).toEqual(["commons", "openverse", "nasa"]);
	expect((await searchWebImages("lion", 1, "library")).items).toEqual([]);
	// a picked service without its key: the free web, said in one line
	await keys({});
	const r = await searchWebImages("tiger", 1, "pexels");
	expect(r.items[0].provider).toBe("commons");
	expect(r.note).toContain("Pexels has no key");
});

test("the kept choice is what every caller (panel, chat, connector) gets", async () => {
	await keys({ pixabay: KEY });
	const { setPick, readPick, sourcesView } = await import("../media-search");
	setPick("picture", "web");
	expect(readPick("picture")).toBe("web");
	const { searchWebImages } = await import("@/media/web-images/server");
	expect((await searchWebImages("puma", 1)).items.some((i) => i.provider === "pixabay")).toBe(false);
	setPick("picture", "all");
	expect((await searchWebImages("puma", 1)).items[0].provider).toBe("pixabay");
	const v = await sourcesView("picture");
	expect(v.keyed.map((k) => k.id)).toEqual(["pixabay"]);
	expect(() => setPick("music", "pixabay")).toThrow();
});

test("Pixabay failing: one line, the free web answers", async () => {
	await keys({ pixabay: KEY });
	pixabayDown = true;
	const { searchWebImages } = await import("@/media/web-images/server");
	const r = await searchWebImages("ocelot", 1);
	pixabayDown = false;
	expect(r.items[0].provider).toBe("commons");
	expect(r.note).toContain("Pixabay didn't answer");
});

test("clips: keyed first, then Commons (fixed query) and the Internet Archive, each with its source and still", async () => {
	await keys({ pixabay: KEY, pexels: KEY });
	const { searchStock } = await import("@/mcp/server/stock");
	const r = await searchStock("cat", true);
	expect(r.items.map((c) => c.source)).toEqual(["pixabay", "pexels", "commons", "archive"]);
	expect(r.items.filter((c) => !c.thumb).map((c) => c.source)).toEqual([]);
	expect(asked.some((a) => a.includes("gsrsearch=cat+filemime%3Avideo"))).toBe(true);
	await keys({});
	const free = await searchStock("cat", true);
	expect(free.items.map((c) => c.source)).toEqual(["commons", "archive"]);
	expect((await searchStock("cat", true, "library")).items).toEqual([]);
});

test("music and sounds: the free web (Jamendo, Freesound), never Pixabay; NC refused; files only from a found address", async () => {
	await keys({ pixabay: KEY });
	const { searchWebAudio, sourcesView, downloadWebAudio } = await import("../media-search");
	const m = await searchWebAudio("lofi", "music");
	expect(m.items.map((i) => i.source)).toEqual(["jamendo"]);
	expect(m.searched).not.toContain("Pixabay");
	const s = await searchWebAudio("whoosh", "sound");
	expect(s.items[0].source).toBe("freesound");
	const v = await sourcesView("music");
	expect(v.keyed).toEqual([]);
	expect(v.noAudio).toEqual(["Pixabay"]);
	expect(asked.some((a) => a.startsWith("/pixabay.com") && /music|audio/.test(a))).toBe(false);
	await expect(downloadWebAudio("https://evil.example/x.mp3")).rejects.toThrow();
	expect((await downloadWebAudio(s.items[0].url)).type).toBe("audio/mpeg");
	expect((await searchWebAudio("lofi", "music", 1, "library")).items).toEqual([]);
});
