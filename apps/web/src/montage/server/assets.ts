// Assets the AI Composition agent can find: the user's local Kadr library (Lottie graphics without template text,
// fonts), sound effects (bundled pack + Kadr) and web images (Wikimedia Commons).
// What the agent picks is copied into a content-addressed store and served read-only by /api/montage/asset/<name>;
// a layer only ever references assets found for its own request (no shared "recent" lists, no global picks).
import { BUNDLED_FONTS } from "@/fonts/bundled";
import { REMOTE_FONTS } from "@/fonts/remote-catalog";
import { ensureCached } from "@/library/server/remote";
import crypto from "node:crypto";
import fs from "node:fs";
import { userKadrLibrary } from "@/platform/library";
import path from "node:path";
import { getLibraryIndex } from "@/library/server/index-store";
import { downloadWebImage, searchWebImages } from "@/media/web-images/server";
import type { WebImage } from "@/media/web-images/types";
import { dataDir } from "@/studio/server/files";
import { findTool, run } from "@/studio/server/tools";

export type AssetType = "lottie" | "image" | "font" | "sfx";

/** What the model sees when it picks. `ref` is what it answers with. */
export interface Candidate {
	ref: string;
	type: AssetType;
	title: string;
	detail: string;
}

/** An asset stored for a layer (goes into the layer's props as JSON). */
export interface StoredAsset {
	type: "lottie" | "image" | "font" | "video";
	/** File name in the asset store (content hash + extension). */
	name: string;
	title: string;
	w?: number;
	h?: number;
	/** Seconds (Lottie). */
	duration?: number;
	fps?: number;
	credit?: string;
	author?: string;
	license?: string;
	sourceUrl?: string;
	/** The project's Media item holding this picture (set by the editor when it saves it there). */
	mediaId?: string;
}

export interface PickedSfx {
	id: string;
	name: string;
	dur: number;
}

// Graphics and fonts from the user's own library folder only (nothing outside the app is read otherwise).
const kadrLibrary = () => userKadrLibrary() ?? path.join(dataDir(), "no-user-library");

export function storeDir(): string {
	const dir = path.join(dataDir(), "montage-assets");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** Only names the store itself produced resolve (no paths, no traversal). */
export function assetFile(name: string): string | null {
	if (!/^[0-9a-f]{24}\.(json|ttf|otf|woff2?|jpg|png|webp|gif|svg|mp4|mov|webm)$/.test(name)) return null;
	const file = path.join(storeDir(), name);
	return fs.existsSync(file) ? file : null;
}

/** The user's own media inside a composition, as the agent sees it. */
export interface MediaInput {
	name: string;
	kind: "image" | "video";
	w: number;
	h: number;
	alpha: boolean;
	colors: string[];
	duration?: number;
	/** SVG only: the drawing's path data (so it can be stroke-drawn) and its viewBox. */
	svg?: { viewBox: string; paths: string[] };
}

function kindOf(bytes: Buffer): { ext: string; kind: "image" | "video" } | null {
	const head = bytes.subarray(0, 512).toString("latin1");
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return { ext: "jpg", kind: "image" };
	if (head.slice(1, 4) === "PNG") return { ext: "png", kind: "image" };
	if (head.slice(8, 12) === "WEBP") return { ext: "webp", kind: "image" };
	if (head.slice(0, 3) === "GIF") return { ext: "gif", kind: "image" };
	if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return { ext: "svg", kind: "image" };
	if (head.slice(4, 8) === "ftyp") return { ext: head.slice(8, 10) === "qt" ? "mov" : "mp4", kind: "video" };
	if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { ext: "webm", kind: "video" };
	return null;
}

/** Stores the user's photo, logo or short clip and describes it: size, aspect, alpha, dominant colours. */
export async function putMedia(bytes: Buffer): Promise<MediaInput> {
	const k = kindOf(bytes);
	if (!k) throw new Error("not an image (JPEG, PNG, WebP, GIF, SVG) or a video (MP4, MOV, WebM)");
	if (bytes.length > 300 * 1024 * 1024) throw new Error("the file is larger than 300 MB");
	const name = put(bytes, k.ext);
	const file = path.join(storeDir(), name);
	if (k.ext === "svg") return { name, kind: "image", ...svgInfo(bytes.toString("utf8")) };
	const info: MediaInput = { name, kind: k.kind, w: 0, h: 0, alpha: false, colors: [] };
	try {
		const probe = await run(findTool("ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt:format=duration", "-of", "json", file], { timeout: 20 });
		const j = JSON.parse(probe.stdout || "{}");
		const st = j.streams?.[0] ?? {};
		info.w = Number(st.width) || 0;
		info.h = Number(st.height) || 0;
		info.alpha = /a|rgba|bgra|argb|abgr|ya/.test(String(st.pix_fmt ?? "")) && !/^(yuv|nv|gray$)/.test(String(st.pix_fmt ?? ""));
		if (k.kind === "video") info.duration = Number(j.format?.duration) || undefined;
		info.colors = await dominantColors(file);
	} catch {}
	return info;
}

/** Up to 3 dominant opaque colours (8×8 average grid, quantized). */
async function dominantColors(file: string): Promise<string[]> {
	const out = `${file}.${process.pid}.rgba`;
	let raw: Buffer;
	try {
		await run(findTool("ffmpeg"), ["-nostdin", "-y", "-v", "error", "-i", file, "-frames:v", "1", "-vf", "scale=8:8:flags=area,format=rgba", "-f", "rawvideo", out], { timeout: 20 });
		raw = fs.readFileSync(out);
	} finally {
		fs.rmSync(out, { force: true });
	}
	const counts = new Map<string, number>();
	for (let i = 0; i + 3 < raw.length; i += 4) {
		if (raw[i + 3] < 128) continue;
		const q = (v: number) => Math.min(255, Math.round(v / 32) * 32);
		const hex = `#${[raw[i], raw[i + 1], raw[i + 2]].map((v) => q(v).toString(16).padStart(2, "0")).join("")}`;
		counts.set(hex, (counts.get(hex) ?? 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hex]) => hex);
}

function svgInfo(src: string): Omit<MediaInput, "name" | "kind"> {
	const tag = /<svg[^>]*>/i.exec(src)?.[0] ?? "";
	const attr = (n: string) => new RegExp(`\\b${n}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1] ?? "";
	const viewBox = attr("viewBox") || `0 0 ${parseFloat(attr("width")) || 100} ${parseFloat(attr("height")) || 100}`;
	const [, , vw, vh] = viewBox.split(/[\s,]+/).map(Number);
	const paths = [...src.matchAll(/<path[^>]*\sd\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]).filter((d) => d.length < 4000).slice(0, 12);
	const colors = [...new Set([...src.matchAll(/(?:fill|stroke)\s*[=:]\s*["']?(#[0-9a-f]{3,8})/gi)].map((m) => m[1].toLowerCase()))].slice(0, 3);
	return { w: Math.round(vw || 100), h: Math.round(vh || 100), alpha: true, colors, svg: { viewBox, paths } };
}

function put(bytes: Buffer, ext: string): string {
	const name = `${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${ext}`;
	const file = path.join(storeDir(), name);
	if (!fs.existsSync(file)) {
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, bytes);
		fs.renameSync(tmp, file);
	}
	return name;
}

// ───────────────────────── matching ─────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/** A few English ↔ Russian synonyms so "карта"/"map pin"/"location" meet the library's English names. */
const SYNONYMS: Record<string, string[]> = {
	map: ["location", "pin", "marker", "route", "карта"],
	pin: ["location", "marker", "map"],
	arrow: ["pointer", "swipe", "стрелка"],
	check: ["checkmark", "success", "validation", "галочка"],
	warning: ["error", "alert", "attention"],
	like: ["heart", "thumbs", "love"],
	fire: ["flame", "hot", "огонь"],
	star: ["sparkle", "sparkles", "звезда"],
	celebrate: ["confetti", "firework", "party"],
	click: ["tap", "cursor", "hand"],
	chat: ["message", "bubble", "comment"],
	timer: ["countdown", "clock"],
	circle: ["scribble", "highlight", "oval"],
	underline: ["line", "highlighter", "squiggle"],
	people: ["connecting", "team"],
	chart: ["analytics", "trading", "graph"],
	notification: ["bell"],
	subscribe: ["follow", "youtube"],
};

function expand(query: string): string[] {
	const out = new Set<string>();
	for (const w of words(query)) {
		out.add(w);
		for (const [k, list] of Object.entries(SYNONYMS)) if (k === w || list.includes(w)) for (const x of [k, ...list]) out.add(x);
	}
	return [...out];
}

function score(query: string[], text: string): number {
	const hay = words(text);
	let s = 0;
	for (const q of query) {
		if (hay.includes(q)) s += 2;
		else if (q.length >= 4 && hay.some((h) => h.startsWith(q.slice(0, 4)) || q.startsWith(h.slice(0, 4)))) s += 1;
	}
	return s;
}

// ───────────────────────── Lottie graphics (Kadr) ─────────────────────────

interface GraphicRow {
	file: string;
	name: string;
	category: string;
	w: number;
	h: number;
	fps: number;
	duration: number;
	texts: number;
}

function graphics(): GraphicRow[] {
	const dir = path.join(kadrLibrary(), "Graphics");
	try {
		const rows = JSON.parse(fs.readFileSync(path.join(dir, "library.json"), "utf8")) as GraphicRow[];
		let verified: Set<string> | null = null;
		try {
			verified = new Set(fs.readFileSync(path.join(dir, "verified.txt"), "utf8").split("\n").map((l) => l.trim()).filter(Boolean));
		} catch {}
		// Graphics with template text ("LIVE", "add text!") would put words on screen nobody said: never offered.
		return rows.filter((r) => r && r.texts === 0 && (!verified || verified.has(r.file)));
	} catch {
		return [];
	}
}

export function searchGraphics(query: string, limit = 4): Candidate[] {
	const q = expand(query);
	return graphics()
		.map((g) => ({ g, s: score(q, `${g.name} ${g.category}`) }))
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s)
		.slice(0, limit)
		.map(({ g }) => ({
			ref: `lottie:${g.file}`,
			type: "lottie" as const,
			title: g.name,
			detail: `${g.category}, ${g.w}×${g.h}, ${g.duration.toFixed(1)} s`,
		}));
}

function storeGraphic(file: string): StoredAsset | null {
	const g = graphics().find((x) => x.file === file);
	if (!g || file.includes("..")) return null;
	try {
		const bytes = fs.readFileSync(path.join(kadrLibrary(), "Graphics", file));
		JSON.parse(bytes.toString("utf8"));
		return { type: "lottie", name: put(bytes, "json"), title: g.name, w: g.w, h: g.h, duration: g.duration, fps: g.fps };
	} catch {
		return null;
	}
}

// ───────────────────────── fonts (the app's own) ─────────────────────────
// The fonts a montage may use are the app's (fonts/bundled.ts): the base set inside the app, the others downloaded on
// first use through the same cache as the Text tab (/api/fonts, library/server/remote.ts) — no copy of the Kadr
// library's fonts inside the app any more.

interface FontRow {
	family: string;
	group: string;
}

function fonts(): FontRow[] {
	return BUNDLED_FONTS.map((font) => ({ family: font.family.toLowerCase(), group: font.group }));
}

/** All local fonts, one line per group (short enough to show the model in full). */
export function fontCatalog(): string {
	const groups = new Map<string, Set<string>>();
	for (const f of fonts()) {
		if (!groups.has(f.group)) groups.set(f.group, new Set());
		groups.get(f.group)!.add(f.family);
	}
	return [...groups].map(([g, set]) => `${g}: ${[...set].join(", ")}`).join("\n");
}

export function searchFonts(query: string, limit = 4): Candidate[] {
	const q = words(query);
	const all = fonts();
	const seen = new Set<string>();
	const rows = all
		.map((f) => ({ f, s: score(q, `${f.family} ${f.group}`) + (q.includes(f.family) ? 5 : 0) }))
		.sort((a, b) => b.s - a.s)
		.filter(({ f }) => (seen.has(f.family) ? false : (seen.add(f.family), true)));
	return rows.slice(0, limit).map(({ f }) => ({ ref: `font:${f.family}`, type: "font" as const, title: f.family, detail: f.group }));
}

async function storeFont(family: string): Promise<StoredAsset | null> {
	const font = BUNDLED_FONTS.find((x) => x.family.toLowerCase() === family.toLowerCase());
	if (!font) return null;
	try {
		const remote = REMOTE_FONTS[font.family];
		// the regular face (the first): from the app, or from the cache / the internet
		const file = remote ? await ensureCached("Fonts", remote.faces[0]) : path.join(process.cwd(), "public", "fonts", "bundled", font.faces[0].file);
		const bytes = fs.readFileSync(file);
		const ext = path.extname(file).slice(1).toLowerCase();
		return { type: "font", name: put(bytes, ext), title: font.family };
	} catch {
		return null;
	}
}

// ───────────────────────── sound effects ─────────────────────────

export function searchSfx(query: string, limit = 5): Candidate[] {
	const q = expand(query);
	let items: ReturnType<typeof getLibraryIndex>["items"] = [];
	try {
		items = getLibraryIndex().items.filter((i) => i.kind === "sfx" && i.dur > 0 && i.dur <= 6);
	} catch {
		return [];
	}
	return items
		.map((i) => ({ i, s: score(q, `${i.name} ${i.cat} ${i.tags.join(" ")}`) + (i.src === "bundled" ? 0.5 : 0) }))
		.filter((x) => x.s > 0.5)
		.sort((a, b) => b.s - a.s || a.i.dur - b.i.dur)
		.slice(0, limit)
		.map(({ i }) => ({ ref: `sfx:${i.id}`, type: "sfx" as const, title: i.name, detail: `${i.dur.toFixed(1)} s` }));
}

export function pickSfx(ref: string): PickedSfx | null {
	const id = ref.replace(/^sfx:/, "");
	try {
		const item = getLibraryIndex().items.find((i) => i.id === id && i.kind === "sfx");
		return item ? { id: item.id, name: item.name, dur: Math.max(0.05, item.dur) } : null;
	} catch {
		return null;
	}
}

// ───────────────────────── web images ─────────────────────────

type Found = WebImage;

/** "Elon Musk" → the subject's own words count most; real photos of a usable size first. */
function rank(img: Found, query: string): number {
	const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
	const title = img.title.toLowerCase();
	const side = Math.min(img.width, img.height);
	const aspect = img.width / Math.max(1, img.height);
	let s = words.filter((w) => title.includes(w)).length * 3;
	if (side >= 600) s += 2;
	if (side >= 1000) s += 1;
	if (aspect > 0.5 && aspect < 2) s += 1;
	if (/logo|icon|signature|map|diagram|chart|coat of arms|flag/.test(title) && !words.some((w) => /logo|icon|map|flag/.test(w))) s -= 3;
	return s;
}

/** One agent run's image results (refs "image:N" are only valid inside that run). */
export class ImageFinds {
	private list: Found[] = [];
	private provided: NonNullable<import("./plan").PlanRequest["provided"]> = [];

	/** Pictures the user added for this request: offered first, already stored. */
	offer(provided: NonNullable<import("./plan").PlanRequest["provided"]>): Candidate[] {
		this.provided = provided.filter((p) => p && typeof p.name === "string" && assetFile(p.name));
		return this.provided.map((p, i) => ({ ref: `provided:${i}`, type: "image" as const, title: p.title, detail: `the user's picture${p.w && p.h ? `, ${p.w}×${p.h}` : ""}` }));
	}

	/**
	 * The app's own web image search (Media → Search images on the web: Wikimedia Commons),
	 * with 2–3 query variants; the best results (subject in the title, ≥ 600 px) come first.
	 */
	async search(query: string, limit = 3, signal?: AbortSignal, log?: (line: string) => void): Promise<Candidate[]> {
		const variants = [...new Set([query, `${query} photo`, query.split(/\s+/).slice(0, 3).join(" ")])].slice(0, 3);
		const pool = new Map<string, Found>();
		let failure = "";
		for (const q of variants) {
			if (signal?.aborted) return [];
			try {
				const res = await searchWebImages(q, 1);
				for (const img of res.items) if (!pool.has(img.id)) pool.set(img.id, img);
				if (res.error && !failure) failure = res.error;
			} catch (error) {
				failure = (error as Error).message || "image search failed";
			}
			if ([...pool.values()].filter((i) => Math.min(i.width, i.height) >= 600).length >= 6) break;
		}
		const all = [...pool.values()];
		const good = all.filter((i) => Math.min(i.width, i.height) >= 600).sort((a, b) => rank(b, query) - rank(a, query));
		if (!all.length && failure) throw new Error(failure);
		log?.(`  found ${all.length}${good.length ? `, using "${good[0].title.slice(0, 60)}" (${good[0].width}×${good[0].height}, ${good[0].provider})` : " — none at least 600 px"}`);
		return good.slice(0, limit).map((img) => {
			this.list.push(img);
			return {
				ref: `image:${this.list.length - 1}`,
				type: "image" as const,
				title: img.title.slice(0, 80),
				detail: `${img.width}×${img.height}, ${img.provider}${img.license ? `, ${img.license}` : ""}`,
			};
		});
	}

	async store(ref: string): Promise<StoredAsset | null> {
		if (ref.startsWith("provided:")) {
			const p = this.provided[Number(ref.slice(9))];
			return p ? { type: "image", name: p.name, title: p.title, credit: p.credit, mediaId: p.mediaId, w: p.w, h: p.h } : null;
		}
		const img = this.list[Number(ref.replace(/^image:/, ""))];
		if (!img) return null;
		try {
			const { bytes, type } = await downloadWebImage(img.fullUrl).catch(() => downloadWebImage(img.thumbUrl));
			const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("gif") ? "gif" : "jpg";
			return {
				type: "image",
				name: put(Buffer.from(bytes), ext),
				title: img.title.slice(0, 80),
				w: img.width,
				h: img.height,
				credit: [img.title, img.author, img.license].filter(Boolean).join(" · ").slice(0, 200),
				author: img.author.slice(0, 120),
				license: img.license.slice(0, 60),
				sourceUrl: img.sourceUrl.slice(0, 400),
			};
		} catch {
			return null;
		}
	}
}

/** Materializes a picked ref ("lottie:…", "font:…", "image:N") into the store. */
export async function storeRef(ref: string, images: ImageFinds): Promise<StoredAsset | null> {
	if (ref.startsWith("lottie:")) return storeGraphic(ref.slice(7));
	if (ref.startsWith("font:")) return storeFont(ref.slice(5));
	if (ref.startsWith("image:") || ref.startsWith("provided:")) return images.store(ref);
	return null;
}
