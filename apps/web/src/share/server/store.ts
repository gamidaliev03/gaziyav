// Share's own folder in the app's userdata (…/Gaziyav/Share): the posts and the videos waiting for them. Files are
// 0600 and written whole (tmp + rename). The site sign-ins live in the Mac app's own browser session, not here.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StudioError } from "@/studio/server/errors";
import { studioHome } from "@/studio/server/settings";
import type { Post } from "../types";

export const shareDir = () => path.join(studioHome(), "Share");
const videosDir = () => path.join(shareDir(), "videos");
const handoffDir = () => path.join(shareDir(), "TikTok");

function readJson<T>(file: string, fallback: T): T {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return fallback;
	}
}

function writeJson(file: string, data: unknown) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
	fs.renameSync(tmp, file);
	fs.chmodSync(file, 0o600);
}

const postsFile = () => path.join(shareDir(), "posts.json");

/** The posts, newest first (kept between launches: a scheduled post outlives a quit). */
export const readPosts = () => readJson<Array<Post & { video: string }>>(postsFile(), []);
export function writePosts(posts: Array<Post & { video: string }>) {
	writeJson(postsFile(), posts.slice(0, 60));
}

const VIDEO_ID = /^[a-f0-9-]{36}$/;

/** A video the sheet exported, stored for its posts (until the last of them is done or cancelled). */
export async function saveVideo(body: ReadableStream<Uint8Array> | null, handoff = false): Promise<{ id: string; path: string; bytes: number }> {
	if (!body) throw new StudioError("No video came with the request. Post again.");
	const dir = handoff ? handoffDir() : videosDir();
	fs.mkdirSync(dir, { recursive: true });
	const id = crypto.randomUUID();
	const file = path.join(dir, `${id}.mp4`);
	const part = `${file}.part`;
	try {
		await pipeline(Readable.fromWeb(body as never), fs.createWriteStream(part, { mode: 0o600 }));
		const bytes = fs.statSync(part).size;
		if (!bytes) throw new StudioError("The exported video is empty. Post again.");
		fs.renameSync(part, file);
		return { id, path: file, bytes };
	} catch (error) {
		fs.rmSync(part, { force: true });
		throw error;
	}
}

export function videoPath(id: string): string {
	if (!VIDEO_ID.test(id)) throw new StudioError("Unknown video.");
	const file = path.join(videosDir(), `${id}.mp4`);
	if (!fs.existsSync(file)) throw new StudioError("The exported video for this post is gone. Post it again from the project.");
	return file;
}

/** Videos no waiting post needs any more; TikTok hand-offs older than 3 days. */
export function pruneVideos(posts: Array<Post & { video: string }>) {
	const needed = new Set(posts.filter((p) => p.state !== "done" && p.state !== "cancelled").map((p) => p.video));
	for (const [dir, keep] of [
		[videosDir(), (name: string) => needed.has(name.replace(/\.mp4$/, ""))],
		[handoffDir(), (_name: string, at: number) => Date.now() - at < 3 * 86400_000],
	] as const) {
		let names: string[] = [];
		try {
			names = fs.readdirSync(dir);
		} catch {
			continue;
		}
		for (const name of names) {
			const file = path.join(dir, name);
			try {
				if (!keep(name, fs.statSync(file).mtimeMs)) fs.rmSync(file, { force: true });
			} catch {}
		}
	}
}
