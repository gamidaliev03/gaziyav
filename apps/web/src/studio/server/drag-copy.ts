// A Media item dragged out of Gaziyav to Finder / the Desktop / a chat: the editor keeps its media inside the page's
// own storage (no path a Mac app could take), so the page sends the file here once and the copy, named as the user
// sees it in Media, is what the Mac app drags (main.js `studio:start-drag` takes files under …/ai-results/). The copies
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StudioError } from "./errors";
import { studioHome } from "./settings";

const MEDIA_EXT = /\.(mp4|mov|webm|png|jpe?g|webp|gif|mp3|wav|m4a|ogg)$/i;
const DAY = 24 * 60 * 60 * 1000;

const dragDir = () => path.join(studioHome(), "ai-results", "drag");

/** A file name Finder will show as the user's (no folders, no control characters), with a media extension. */
export function safeDragName(name: string, mime: string): string {
	let base = path.basename(String(name || "media")).replace(/[\u0000-\u001f/:\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "media";
	if (!MEDIA_EXT.test(base)) {
		const ext = mime.startsWith("image/png") ? ".png" : mime.startsWith("image/") ? ".jpg" : mime.startsWith("audio/") ? ".m4a" : ".mp4";
		base = `${base.replace(/\.[a-z0-9]{1,5}$/i, "")}${ext}`;
	}
	return base;
}

function sweep(now = Date.now()) {
	let entries: fs.Dirent[] = [];
	try {
		entries = fs.readdirSync(dragDir(), { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const dir = path.join(dragDir(), entry.name);
		try {
			if (now - fs.statSync(dir).mtimeMs > DAY) fs.rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
}

/** Writes the streamed file as `<key>/<name>` (kept when the same size is there already) and answers its path. */
export async function writeDragCopy({ body, key, name, size, mime }: { body: ReadableStream | null; key: string; name: string; size: number; mime: string }): Promise<{ path: string }> {
	if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) throw new StudioError("Bad item");
	sweep();
	const dir = path.join(dragDir(), key);
	const file = path.join(dir, safeDragName(name, mime));
	try {
		if (fs.statSync(file).size === size) {
			// the same copy: drain the upload and keep it
			await body?.cancel().catch(() => {});
			return { path: file };
		}
	} catch {}
	if (!body) throw new StudioError("Empty file");
	fs.mkdirSync(dir, { recursive: true });
	const part = `${file}.part`;
	try {
		await pipeline(Readable.fromWeb(body as never), fs.createWriteStream(part));
		fs.renameSync(part, file);
	} catch (error) {
		fs.rmSync(part, { force: true });
		throw error;
	}
	return { path: file };
}
