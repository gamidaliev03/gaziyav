// The posts: one per site for each Post press, kept in Share/posts.json so a schedule outlives a quit. This server only
// keeps the list; the Mac app's main process posts them through the sites' own pages in its Share window
// Gaziyav's own queue: it goes out at that time while Gaziyav is open, or as soon as it opens if it was closed.
// With a Late API key (Settings → Share) the posts go through Late's API instead (late-posts.ts): the rows are marked
// via "late", the Share window never takes them.
import crypto from "node:crypto";
import { StudioError } from "@/studio/server/errors";
import { captionFor, type Platform, type PostText, youtubeTitle } from "../caption";
import type { Post, PostState } from "../types";
import { cancelLate, lateLive, retryLate, syncLate } from "./late-posts";
import { pruneVideos, readPosts, videoPath, writePosts } from "./store";

type Stored = Post & { video: string };

/** Live progress (written to disk only on a change of state, not on every step). */
const live = new Map<string, { progress: number; stage?: string }>();

function update(id: string, patch: Partial<Stored>) {
	const posts = readPosts();
	const i = posts.findIndex((p) => p.id === id);
	if (i < 0) return;
	posts[i] = { ...posts[i], ...patch };
	writePosts(posts);
	if (patch.state && patch.state !== "uploading") {
		live.delete(id);
		pruneVideos(posts);
	}
}

export function list(): Post[] {
	syncLate();
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	return readPosts().map(({ video, mediaUrl, mediaAt, lateAttempt, ...p }: Stored & { mediaUrl?: string; mediaAt?: number; lateAttempt?: number }) => ({
		...p,
		...(p.state === "uploading" ? ((p.via === "late" ? lateLive : live).get(p.id) ?? {}) : {}),
	}));
}

export interface PostRequest {
	video: string;
	project: string;
	platforms: Platform[];
	text: PostText;
	privacy?: "public" | "unlisted" | "private";
	/** ms; omitted or past = now. */
	at?: number | null;
}

/** One post per site: due now → queued for the app's Share window; later → scheduled. */
export function create(req: PostRequest): Post[] {
	videoPath(req.video);
	const platforms = [...new Set(req.platforms)].filter((p): p is Platform => p === "youtube" || p === "instagram" || p === "tiktok");
	if (!platforms.length) throw new StudioError("Choose where to post.");
	const at = req.at && req.at > Date.now() + 60_000 ? Math.round(req.at) : null;
	if (at && at > Date.now() + 180 * 86400_000) throw new StudioError("Pick a time within the next 6 months.");
	const caption = captionFor(req.text);
	const made: Stored[] = platforms.map((platform) => ({
		id: crypto.randomUUID(),
		platform,
		video: req.video,
		project: req.project.slice(0, 200),
		title: platform === "youtube" ? youtubeTitle(req.text, req.project) : "",
		caption,
		tags: [],
		privacy: req.privacy ?? "public",
		at,
		native: false,
		state: at ? "scheduled" : "queued",
		progress: 0,
		createdAt: Date.now(),
	}));
	writePosts([...made, ...readPosts()]);
	return made;
}

/** What the app's Share window should post now (queued, or scheduled and due), with the file. */
export function due() {
	const now = Date.now();
	return readPosts()
		.filter((p) => p.via !== "late" && (p.state === "queued" || (p.state === "scheduled" && p.at && p.at <= now)))
		.map((p) => {
			let file: string | null = null;
			try {
				file = videoPath(p.video);
			} catch {}
			return { id: p.id, platform: p.platform, title: p.title, caption: p.caption, privacy: p.privacy, file };
		});
}

/** The window takes a post (once: a second claim is refused). */
export function claim(id: string): boolean {
	const p = readPosts().find((x) => x.id === id);
	if (!p || p.via === "late" || !(p.state === "queued" || (p.state === "scheduled" && p.at && p.at <= Date.now()))) return false;
	update(id, { state: "uploading", progress: 0, error: undefined, stage: undefined });
	return true;
}

const REPORTED: PostState[] = ["uploading", "manual", "done", "failed"];

/** The window's steps: progress and stage while posting; done (with the link), manual (the window waits for the person), failed. */
export function report(id: string, r: { state: PostState; progress?: number; stage?: string; url?: string; error?: string }) {
	if (!REPORTED.includes(r.state)) throw new StudioError("Unknown state.");
	const p = readPosts().find((x) => x.id === id);
	if (!p || p.via === "late" || p.state === "cancelled" || p.state === "done") return;
	if (r.state === "uploading") {
		live.set(id, { progress: Math.max(0, Math.min(1, Number(r.progress) || 0)), stage: r.stage?.slice(0, 300) });
		return;
	}
	update(id, {
		state: r.state,
		progress: r.state === "done" ? 1 : p.progress,
		stage: r.stage?.slice(0, 400),
		url: r.url && /^https?:\/\//.test(r.url) ? r.url.slice(0, 600) : p.url,
		error: r.error?.slice(0, 600),
		finishedAt: r.state === "manual" ? undefined : Date.now(),
	});
}

export async function retry(id: string) {
	const post = readPosts().find((p) => p.id === id);
	if (post?.via === "late") return retryLate(id);
	if (!post || post.state !== "failed") throw new StudioError("Only a failed post can be tried again.");
	videoPath(post.video);
	update(id, { state: post.at && post.at > Date.now() ? "scheduled" : "queued", error: undefined, stage: undefined });
}

export async function cancel(id: string) {
	const post = readPosts().find((p) => p.id === id);
	if (post?.via === "late") return cancelLate(id);
	if (!post || (post.state !== "scheduled" && post.state !== "queued")) throw new StudioError("Only a post that hasn't started can be cancelled.");
	update(id, { state: "cancelled", stage: undefined });
}

/** Takes a finished post off the list. */
export function remove(id: string) {
	const posts = readPosts();
	const post = posts.find((p) => p.id === id);
	if (!post) return;
	if (post.state === "uploading" || post.state === "manual" || post.state === "scheduled" || post.state === "queued") throw new StudioError("Cancel it first.");
	const rest = posts.filter((p) => p.id !== id);
	writePosts(rest);
	pruneVideos(rest);
}

let started = false;

/** Once per server start: a post cut by a quit is marked failed (Retry). */
export function startScheduler() {
	if (started) return;
	started = true;
	const posts = readPosts();
	let changed = false;
	for (const p of posts) {
		// A Late post Late already has keeps going there: its row follows it (syncLate).
		if ((p.state === "uploading" || p.state === "manual") && !(p.via === "late" && p.remoteId)) {
			p.state = "failed";
			p.error = "Gaziyav was closed before the post was published. Press Retry.";
			changed = true;
		}
	}
	if (changed) writePosts(posts);
	pruneVideos(posts);
}
