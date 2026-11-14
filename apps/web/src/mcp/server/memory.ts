// Claude's memory of this user, across projects and chats: the cast library (characters with their pictures, kept as
// files here so any project can use them), brand kits, saved voices, the taste the user's work shows (what they keep,
// what they undo), and — read with it — the budget, the accounts posts go to and the last projects' briefs. Compiled
// into one short text (memory.txt, ~1.5k tokens at most) that the MCP server hands Claude on connect and that the project
// digest starts with. Files in the app's folder (mcp/memory.json, mcp/cast/…).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describeTaste } from "@/production/taste";
import { readTaste } from "@/production/server/store";
import { budgetView } from "./budget";
import { mcpDir } from "./hub";

export interface Character {
	name: string;
	description?: string;
	voice?: string;
	/** Picture files in mcp/cast/<slug>/. */
	files: string[];
}

export interface BrandKit {
	name: string;
	colors?: string[];
	fonts?: string[];
	/** The logo file in mcp/cast/brand-<slug>/. */
	logo?: string;
	note?: string;
}

interface Taste {
	kept: Record<string, Record<string, number>>;
	undone: Record<string, Record<string, number>>;
}

interface MemoryFile {
	cast: Character[];
	brands: BrandKit[];
	voices: Array<{ name: string; speaker: string }>;
	taste: Taste;
	/** Accounts posts go to (the window tells: names and platforms only). */
	targets?: string[];
}

const file = () => path.join(mcpDir(), "memory.json");
const textFile = () => path.join(mcpDir(), "memory.txt");
export const castDir = () => path.join(mcpDir(), "cast");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || crypto.randomBytes(3).toString("hex");
const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function read(): MemoryFile {
	try {
		const j = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<MemoryFile>;
		return { cast: j.cast ?? [], brands: j.brands ?? [], voices: j.voices ?? [], taste: { kept: j.taste?.kept ?? {}, undone: j.taste?.undone ?? {} }, targets: j.targets };
	} catch {
		return { cast: [], brands: [], voices: [], taste: { kept: {}, undone: {} } };
	}
}

function write(m: MemoryFile) {
	fs.writeFileSync(`${file()}.tmp`, JSON.stringify(m), { mode: 0o600 });
	fs.renameSync(`${file()}.tmp`, file());
	try {
		fs.writeFileSync(textFile(), memoryText(m), { mode: 0o600 });
	} catch {}
}

/** A picture for a character or a logo, kept here (so it outlives the project it came from). */
export function keepPicture(owner: string, bytes: Buffer, ext: string): string {
	const dir = path.join(castDir(), slug(owner));
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	const name = `${crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 12)}.${/^(png|jpe?g|webp)$/i.test(ext) ? ext.toLowerCase() : "png"}`;
	const out = path.join(dir, name);
	if (!fs.existsSync(out)) fs.writeFileSync(out, bytes, { mode: 0o600 });
	return path.relative(castDir(), out);
}

/** A kept picture's bytes (only files under mcp/cast). */
export function pictureFile(rel: string): string {
	const full = path.resolve(castDir(), rel);
	if (!full.startsWith(`${castDir()}${path.sep}`) || !fs.existsSync(full)) throw new Error("No such picture in the cast library.");
	return full;
}

export function saveCharacter(c: { name: unknown; description?: unknown; voice?: unknown; files?: string[]; remove?: boolean }) {
	const m = read();
	const name = clean(c.name, 40);
	if (!name) throw new Error("Give the character's name.");
	const i = m.cast.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
	if (c.remove) {
		if (i >= 0) m.cast.splice(i, 1);
	} else {
		const old = i >= 0 ? m.cast[i] : { name, files: [] };
		const next: Character = { name, files: c.files?.length ? [...new Set([...c.files])].slice(0, 8) : old.files, ...(c.description !== undefined ? { description: clean(c.description, 300) } : old.description ? { description: old.description } : {}), ...(c.voice !== undefined ? { voice: clean(c.voice, 40) } : old.voice ? { voice: old.voice } : {}) };
		if (i >= 0) m.cast[i] = next;
		else m.cast.push(next);
	}
	write(m);
	return m.cast;
}

export function saveBrand(b: { name: unknown; colors?: unknown; fonts?: unknown; logo?: string; note?: unknown; remove?: boolean }) {
	const m = read();
	const name = clean(b.name, 40);
	if (!name) throw new Error("Give the brand kit's name.");
	const i = m.brands.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
	if (b.remove) {
		if (i >= 0) m.brands.splice(i, 1);
	} else {
		const old = i >= 0 ? m.brands[i] : { name };
		const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => clean(x, 40)).filter(Boolean).slice(0, 6) : undefined);
		const next: BrandKit = { ...old, name, ...(list(b.colors) ? { colors: list(b.colors) } : {}), ...(list(b.fonts) ? { fonts: list(b.fonts) } : {}), ...(b.logo ? { logo: b.logo } : {}), ...(b.note !== undefined ? { note: clean(b.note, 200) } : {}) };
		if (i >= 0) m.brands[i] = next;
		else m.brands.push(next);
	}
	write(m);
	return m.brands;
}

export function saveVoice(v: { name: unknown; speaker: unknown; remove?: boolean }) {
	const m = read();
	const name = clean(v.name, 40);
	m.voices = m.voices.filter((x) => x.name.toLowerCase() !== name.toLowerCase());
	if (!v.remove) m.voices.push({ name, speaker: clean(v.speaker, 40) });
	write(m);
	return m.voices;
}

/** What the user's work says about their taste: a choice they kept (exported, posted) or undid right after Claude made it. */
export function noteTaste(kind: "kept" | "undone", items: Array<{ cat: string; value: string }>) {
	const m = read();
	for (const { cat, value } of items.slice(0, 40)) {
		const c = clean(cat, 20);
		const v = clean(value, 60);
		if (!c || !v) continue;
		const bucket = m.taste[kind][c] ?? {};
		bucket[v] = (bucket[v] ?? 0) + 1;
		m.taste[kind][c] = bucket;
	}
	write(m);
}

export function setTargets(targets: string[]) {
	const m = read();
	m.targets = targets.map((t) => clean(t, 60)).filter(Boolean).slice(0, 12);
	write(m);
}

export const memoryData = () => read();

function top(b: Record<string, number> | undefined, n = 3) {
	return Object.entries(b ?? {})
		.sort((a, c) => c[1] - a[1])
		.slice(0, n)
		.map(([v, k]) => `${v}${k > 1 ? ` ×${k}` : ""}`);
}

/** The last projects' briefs (mcp/projects/*.json, newest first). */
function lastBriefs(n = 3): string[] {
	try {
		const dir = path.join(mcpDir(), "projects");
		return fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".json"))
			.map((f) => {
				try {
					const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { notes?: string; updatedAt?: number; name?: string };
					return { at: j.updatedAt ?? 0, text: `${j.name ? `«${j.name}»: ` : ""}${String(j.notes ?? "").slice(0, 220)}` };
				} catch {
					return null;
				}
			})
			.filter((x): x is { at: number; text: string } => !!x && x.text.length > 4)
			.sort((a, b) => b.at - a.at)
			.slice(0, n)
			.map((x) => x.text);
	} catch {
		return [];
	}
}

/** The memory as Claude reads it (≲ 1.5k tokens). */
export function memoryText(m = read()): string {
	const b = budgetView(null);
	const tasteLines = Object.keys({ ...m.taste.kept, ...m.taste.undone })
		.map((cat) => {
			const kept = top(m.taste.kept[cat]);
			const undone = top(m.taste.undone[cat], 2);
			return `${cat}: ${kept.length ? `keeps ${kept.join(", ")}` : ""}${undone.length ? `${kept.length ? "; " : ""}undid ${undone.join(", ")}` : ""}`;
		})
		.slice(0, 8);
	const lines = [
		"## What Gaziyav remembers about this user",
		m.cast.length ? `Cast (reusable characters; generate {cast:[name]} uses their pictures): ${m.cast.map((c) => `${c.name}${c.description ? ` — ${c.description}` : ""}${c.voice ? ` (voice ${c.voice})` : ""}, ${c.files.length} picture(s)`).join("; ")}` : "Cast: none saved yet (memory {action:'cast'} keeps a character for every project).",
		(() => {
			// The taste profile (platform, preset, budget, captions, music, voice, the brand kit): taste_profile keeps it.
			try {
				return `Taste profile (taste_profile {set} changes it; use the brand's fonts and colours unless the user asks otherwise):\n${describeTaste(readTaste())}`;
			} catch {
				return "";
			}
		})(),
		m.voices.length ? `Saved voices: ${m.voices.map((v) => `${v.name} = ${v.speaker}`).join(", ")}` : "",
		tasteLines.length ? `Learned from the user's work (what they kept or undid): ${tasteLines.join(" · ")}` : "",
		b.mode === "balance"
			? "Budget: no per-video cap and no price questions — paid steps run while the provider's balance covers them (price_plan {} shows this video's spend and the balances); the user may name a budget for a video: price_plan {budget}."
			: `Budget: ${b.limit ? `$${b.limit.toFixed(2)} per video by default` : "free sources only"} (the user may name another for a video: price_plan {budget}).`,
		m.targets?.length ? `Posting to: ${m.targets.join(", ")}.` : "Posting: no accounts connected yet (Gaziyav → Settings → Share).",
		...(() => {
			const briefs = lastBriefs();
			return briefs.length ? [`Last projects: ${briefs.join(" | ")}`] : [];
		})(),
	].filter(Boolean);
	const text = lines.join("\n");
	return text.length > 5200 ? `${text.slice(0, 5200)}… (memory {action:"read"} has the rest)` : text;
}

/** The memory text now, written to memory.txt too (read by the MCP server when Gaziyav is closed). */
export function refreshMemoryText(): string {
	const t = memoryText();
	try {
		fs.writeFileSync(textFile(), t, { mode: 0o600 });
	} catch {}
	return t;
}

export function memoryTextFile(): string {
	try {
		return fs.readFileSync(textFile(), "utf8");
	} catch {
		const t = memoryText();
		try {
			fs.writeFileSync(textFile(), t, { mode: 0o600 });
		} catch {}
		return t;
	}
}
