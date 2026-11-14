// The project's brief and the user's memory as the window uses them (the server keeps both: mcp/server/notes.ts and
// mcp/server/memory.ts): the brief at the top of the digest, the cast library's pictures brought into this project's
// Media once when a generation names a character, and the `memory` tool.
import { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";

export interface CastMember {
	name: string;
	description?: string;
	/** Media ids of its pictures in the open project. */
	images: string[];
	voice?: string;
}
interface Character {
	name: string;
	description?: string;
	voice?: string;
	files: string[];
}
export interface ProjectNotes {
	name?: string;
	notes: string;
	castMedia: Record<string, string[]>;
}

const HEADERS = { "X-Studio": "1", "Content-Type": "application/json" };
const ed = () => EditorCore.getInstance();
const pid = () => ed().project.getActiveOrNull()?.metadata.id ?? "";

async function call<T>(path: string, body?: unknown): Promise<T> {
	const r = await fetch(`/api/mcp/${path}`, body === undefined ? { headers: HEADERS } : { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
	const j = (await r.json().catch(() => ({}))) as T & { error?: string };
	if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
	return j;
}

export const readNotes = () => call<ProjectNotes>(`notes?project=${encodeURIComponent(pid())}`).catch(() => ({ notes: "", castMedia: {} }) as ProjectNotes);
export const writeNotes = (notes: string) => call<ProjectNotes>("notes", { project: pid(), notes, name: ed().project.getActiveOrNull()?.metadata.name });
export const readMemory = () => call<{ text: string; cast: Character[]; brands: Array<{ name: string }>; voices: Array<{ name: string; speaker: string }> }>("memory");

async function base64(blob: Blob): Promise<string> {
	const buf = new Uint8Array(await blob.arrayBuffer());
	let bin = "";
	for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
	return btoa(bin);
}

/** A picture of the open project's Media, kept in the library under `owner`. */
async function keep(owner: string, mediaId: string): Promise<string> {
	const key = String(mediaId);
	const asset = ed().media.getAssets().find((a) => a.id === key || (key.length >= 6 && a.id.startsWith(key)));
	if (!asset?.file || asset.type !== "image") throw new Error(`"${key}" is not a picture in Media (get_project lists the media).`);
	const ext = /\.(png|jpe?g|webp)$/i.exec(asset.file.name)?.[1] ?? "png";
	return (await call<{ file: string }>("memory/picture", { owner, ext, data: await base64(asset.file) })).file;
}

/** The characters named in a call, their pictures in this project's Media (imported from the library once). */
export async function castOf(names: unknown): Promise<CastMember[]> {
	const list = (Array.isArray(names) ? names : String(names ?? "").split(/,\s*/)).map((n) => String(n).trim()).filter(Boolean);
	if (!list.length) return [];
	const [{ cast }, notes] = await Promise.all([readMemory(), readNotes()]);
	const out: CastMember[] = [];
	for (const name of list) {
		const c = cast.find((m) => m.name.toLowerCase() === name.toLowerCase());
		if (!c) throw new Error(`No character "${name}" in the cast (${cast.map((m) => m.name).join(", ") || "empty"}): memory {action:"cast", name, images:[picture ids]} saves one.`);
		const have = (notes.castMedia[c.name.toLowerCase()] ?? []).filter((id) => ed().media.getAssets().some((a) => a.id === id));
		let ids = have;
		if (ids.length < c.files.length) {
			ids = [];
			for (const [i, rel] of c.files.entries()) {
				const res = await fetch(`/api/mcp/memory/file?path=${encodeURIComponent(rel)}`, { headers: HEADERS });
				if (!res.ok) continue;
				const blob = await res.blob();
				const [processed] = await processMediaAssets({ files: [new File([blob], `${c.name} ${i + 1}.${blob.type.includes("png") ? "png" : "jpg"}`, { type: blob.type })] });
				if (!processed) continue;
				const asset = await ed().media.addMediaAsset({ projectId: pid(), asset: { ...processed, origin: "source" } });
				if (asset) ids.push(asset.id);
			}
			await call("notes", { project: pid(), castMedia: { name: c.name, ids } });
		}
		out.push({ name: c.name, description: c.description, voice: c.voice, images: ids });
	}
	return out;
}

/** The `memory` tool: read it, or keep a character / brand kit / voice for every project (remove:true forgets one). */
export async function memoryTool(args: Record<string, unknown>): Promise<string> {
	const action = String(args.action ?? "read");
	const name = String(args.name ?? "").trim();
	if (action === "read") return (await readMemory()).text;
	if (!name) throw new Error("Give the name.");
	const pictures = (v: unknown) => (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,\s]+/)).filter(Boolean);
	if (action === "cast") {
		const files = args.remove ? [] : await Promise.all(pictures(args.images).map((id) => keep(name, id)));
		if (!args.remove && !files.length) {
			const known = (await readMemory()).cast.some((c) => c.name.toLowerCase() === name.toLowerCase());
			if (!known) throw new Error("A new character needs pictures: images:[Media picture ids] (1–8, the face clearly).");
		}
		await call("memory", { character: { name, description: args.description, voice: args.voice, files, remove: !!args.remove } });
		return args.remove ? `${name} is no longer in the cast.` : `${name} is in the cast (${files.length ? `${files.length} picture(s)` : "pictures kept"}): generate {cast:["${name}"]} uses them in any project.`;
	}
	if (action === "brand") throw new Error("The brand kit lives in the taste profile: taste_profile {set:{brand:{name, display, text, ink, accent, plate, logo, handle, cta}}}.");
	if (action === "voice") {
		await call("memory", { voice: { name, speaker: args.speaker ?? args.voice, remove: !!args.remove } });
		return args.remove ? `Voice ${name} forgotten.` : `Voice ${name} kept.`;
	}
	throw new Error("action: read | cast | voice.");
}

/** Choices the user's work keeps or undoes (captions style, look, music, transitions…), for the taste profile. */
export function noteTaste(kind: "kept" | "undone", items: Array<{ cat: string; value: string }>) {
	if (!items.length) return;
	void call("memory", { taste: { kind, items } }).catch(() => {});
}
