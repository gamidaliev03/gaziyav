// Share → Post through Late's API: no window, no buttons to press on a site. Post now: the exported video is uploaded
// to Late once for every ticked account, then one Late post per account (its own title / caption / privacy) is
// published in the request; a row follows Late's answer (GET /v1/posts/{id}) until the platform gives the post's link.
// Schedule: the same, with Late's own scheduledFor (it goes out even while Gaziyav is closed).
import crypto from "node:crypto";
import { StudioError } from "@/studio/server/errors";
import { captionFor, type Platform, type PostText, youtubeTags, youtubeTitle } from "../caption";
import { lateBody, type LateOutcome, lateOutcome, type TikTokChoice } from "../late";
import type { Post } from "../types";
import { createPost, deletePost, forgetAccounts, getPost, LateError, lateKey, retryPost, uploadVideo } from "./late";
import { pruneVideos, readPosts, videoPath, writePosts } from "./store";

type Stored = Post & {
	video: string;
	mediaUrl?: string;
	mediaAt?: number;
	lateAttempt?: number;
};

export interface LateTargetRequest {
	platform: Platform;
	accountId: string;
	accountName?: string;
}

export interface LatePostRequest {
	video: string;
	project: string;
	targets: LateTargetRequest[];
	text: PostText;
	privacy?: "public" | "unlisted" | "private";
	tiktok?: TikTokChoice;
	at?: number | null;
}

/** Live progress of the rows being uploaded / published (on disk only on a change of state); `cancellable` while
 *  the video is still going up to Late (nothing posted yet: Cancel stops it whole). */
export const lateLive = new Map<string, { progress: number; stage?: string; cancellable?: boolean }>();
const running = new Set<string>();
/** The upload each row waits on (one for every account of a Post press): Cancel on the last of them stops it. */
const uploads = new Map<string, { ids: string[]; abort: AbortController }>();
const synced = new Map<string, number>();
/** Late keeps an upload 7 days; a retry within 6 reuses it. */
const MEDIA_DAYS = 6;

const find = (id: string) => readPosts().find((p) => p.id === id) as Stored | undefined;

function patch(id: string, change: Partial<Stored>) {
	const posts = readPosts() as Stored[];
	const i = posts.findIndex((p) => p.id === id);
	if (i < 0) return;
	posts[i] = { ...posts[i], ...change };
	writePosts(posts);
	if (change.state && change.state !== "uploading") {
		lateLive.delete(id);
		pruneVideos(posts);
	}
}

const isPlatform = (p: unknown): p is Platform => p === "youtube" || p === "instagram" || p === "tiktok";

/** One row per ticked account; the upload and the posts run in the background (the sheet watches the rows). */
export function createLate(req: LatePostRequest): Post[] {
	if (!lateKey()) throw new StudioError("Add your Late API key first: Settings → Share.");
	videoPath(req.video);
	const seen = new Set<string>();
	const targets = req.targets.filter((t) => isPlatform(t.platform) && t.accountId && !seen.has(t.accountId) && seen.add(t.accountId));
	if (!targets.length) throw new StudioError("Choose where to post.");
	const tiktok = req.tiktok;
	if (targets.some((t) => t.platform === "tiktok") && !tiktok?.privacyLevel) throw new StudioError("TikTok: choose who can watch.");
	const at = req.at && req.at > Date.now() + 60_000 ? Math.round(req.at) : null;
	if (at && at > Date.now() + 180 * 86400_000) throw new StudioError("Pick a time within the next 6 months.");
	const caption = captionFor(req.text);
	const made: Stored[] = targets.map((t) => ({
		id: crypto.randomUUID(),
		platform: t.platform,
		video: req.video,
		project: req.project.slice(0, 200),
		title: t.platform === "youtube" ? youtubeTitle(req.text, req.project) : "",
		caption,
		tags: t.platform === "youtube" ? youtubeTags(req.text) : [],
		privacy: req.privacy ?? "public",
		at,
		native: false,
		state: "uploading",
		progress: 0,
		stage: "Uploading the video to Late",
		via: "late",
		accountId: t.accountId,
		accountName: (t.accountName ?? "").slice(0, 120) || undefined,
		tiktok:
			t.platform === "tiktok" && tiktok
				? {
						privacyLevel: String(tiktok.privacyLevel),
						allowComment: !!tiktok.allowComment,
						allowDuet: !!tiktok.allowDuet,
						allowStitch: !!tiktok.allowStitch,
					}
				: undefined,
		createdAt: Date.now(),
	}));
	writePosts([...made, ...readPosts()]);
	void runGroup(made.map((m) => m.id));
	return made;
}

/** A failure from Late (it answered) gets a fresh idempotency key for Retry; a lost answer keeps it (a repeat is safe). */
function failed(id: string, error: unknown) {
	const p = find(id);
	if (!p || p.state !== "uploading") return;
	const answered = error instanceof LateError;
	// The account's sign-in expired (or it's gone): the sheet must show Reconnect now, not after the minute's cache.
	if (answered && (error.status === 401 || error.status === 403 || error.status === 404)) forgetAccounts();
	patch(id, {
		state: "failed",
		error: (error as Error)?.message || "The post failed.",
		errorDetail: answered ? error.detail : undefined,
		stage: undefined,
		finishedAt: Date.now(),
		lateAttempt: (p.lateAttempt ?? 0) + (answered ? 1 : 0),
	});
}

function apply(id: string, o: LateOutcome) {
	const p = find(id);
	if (!p) return;
	if (o.state === "failed" && /sign-in has expired/.test(o.error ?? "")) forgetAccounts();
	if (o.state === "uploading") {
		lateLive.set(id, { progress: 0.9, stage: o.stage });
		if (o.remoteId && o.remoteId !== p.remoteId) patch(id, { remoteId: o.remoteId });
		return;
	}
	patch(id, {
		state: o.state,
		remoteId: o.remoteId ?? p.remoteId,
		progress: o.state === "done" ? 1 : p.progress,
		url: o.url ?? p.url,
		stage: o.stage,
		error: o.state === "failed" ? (o.error ?? "The post failed.") : undefined,
		errorDetail: o.state === "failed" ? o.detail : undefined,
		finishedAt: o.state === "scheduled" ? undefined : Date.now(),
		lateAttempt: o.state === "failed" ? (p.lateAttempt ?? 0) + 1 : p.lateAttempt,
	});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runGroup(ids: string[]) {
	const first = find(ids[0]);
	if (!first) return;
	for (const id of ids) running.add(id);
	const group = { ids, abort: new AbortController() };
	try {
		let media = first.mediaUrl && first.mediaAt && Date.now() - first.mediaAt < MEDIA_DAYS * 86400_000 ? first.mediaUrl : undefined;
		if (!media) {
			const file = videoPath(first.video);
			for (const id of ids) uploads.set(id, group);
			const live = (progress: number) => {
				// (a row cancelled meanwhile keeps its own state: no live line for it)
				for (const id of ids) if (uploads.get(id) === group) lateLive.set(id, { progress, stage: "Uploading the video to Late", cancellable: true });
			};
			live(0.02);
			media = await uploadVideo(file, (p) => live(0.02 + p * 0.68), group.abort.signal);
			for (const id of ids) uploads.delete(id);
			// Kept before the post is made: a retry sends the very same body under the same key.
			const at = Date.now();
			for (const id of ids) patch(id, { mediaUrl: media, mediaAt: at });
		}
		const url = media;
		await Promise.all(ids.map((id) => publish(id, url).catch((error) => failed(id, error))));
	} catch (error) {
		for (const id of ids) failed(id, error);
	} finally {
		for (const id of ids) {
			running.delete(id);
			if (uploads.get(id) === group) uploads.delete(id);
		}
	}
}

async function publish(id: string, mediaUrl: string) {
	const p = find(id);
	if (!p || p.state !== "uploading") return;
	const scheduled = !!(p.at && p.at > Date.now() + 60_000);
	lateLive.set(id, {
		progress: 0.75,
		stage: scheduled ? "Scheduling on Late" : "Publishing on the platform",
	});
	const body = lateBody(
		{
			platform: p.platform,
			accountId: p.accountId ?? "",
			title: p.title,
			caption: p.caption,
			tags: p.tags ?? [],
			privacy: p.privacy,
			tiktok: p.tiktok,
		},
		mediaUrl,
		scheduled ? p.at : null,
	);
	const key = `gaziyav-${p.id}-${p.lateAttempt ?? 0}`;
	for (let attempt = 1; ; attempt++) {
		try {
			const r = await createPost(body, key);
			apply(id, r.post ? lateOutcome(r.post, p.platform, scheduled) : { state: "failed", error: "The post failed.", detail: r.error });
			return;
		} catch (error) {
			// The same key is still being processed (409 idempotency_conflict), or the answer was lost: ask again.
			const busy = error instanceof LateError && error.status === 409 && /idempotency/i.test(error.code ?? "");
			const lost = !(error instanceof LateError);
			if (attempt < 4 && (busy || lost)) {
				await sleep(busy ? 8000 : 3000);
				continue;
			}
			throw error;
		}
	}
}

/** Follows Late's posts the rows wait on (called while the sheet / the header watch the list; a few seconds apart). */
export function syncLate() {
	const now = Date.now();
	for (const p of readPosts() as Stored[]) {
		if (p.via !== "late" || !p.remoteId || running.has(p.id)) continue;
		const waiting = p.state === "uploading" || (p.state === "scheduled" && !!p.at && p.at <= now + 30_000) || (p.state === "done" && !p.url && now - (p.finishedAt ?? 0) < 3600_000);
		if (!waiting) continue;
		const gap = p.state === "done" ? 20_000 : 4000;
		if (now - (synced.get(p.id) ?? 0) < gap) continue;
		synced.set(p.id, now);
		const remote = p.remoteId;
		void getPost(remote)
			.then((post) => {
				if (!post) return;
				const o = lateOutcome(post, p.platform, p.state === "scheduled");
				const cur = find(p.id);
				if (!cur) return;
				// A finished row only learns its link (TikTok gives it minutes later).
				if (cur.state === "done") {
					if (o.url) patch(p.id, { url: o.url, stage: undefined });
					return;
				}
				apply(p.id, o);
			})
			.catch(() => {});
	}
}

/** Retry: Late's own retry for a post it has; otherwise the same request again (the kept upload when still there). */
export async function retryLate(id: string) {
	const p = find(id);
	if (!p || p.state !== "failed") throw new StudioError("Only a failed post can be tried again.");
	if (!lateKey()) throw new StudioError("Add your Late API key first: Settings → Share.");
	const mediaOk = p.mediaUrl && p.mediaAt && Date.now() - p.mediaAt < MEDIA_DAYS * 86400_000;
	if (!mediaOk) videoPath(p.video);
	patch(id, {
		state: "uploading",
		error: undefined,
		errorDetail: undefined,
		stage: "Publishing on the platform",
		progress: 0.75,
		finishedAt: undefined,
	});
	lateLive.set(id, { progress: 0.75, stage: "Publishing on the platform" });
	if (p.remoteId) {
		running.add(id);
		void retryPost(p.remoteId)
			.then((post) => apply(id, post ? lateOutcome(post, p.platform, false) : { state: "failed", error: "The post failed." }))
			.catch((error) => {
				// Late can't retry this one (its state, or it's gone): a new post instead.
				if (error instanceof LateError && (error.status === 400 || error.status === 404)) {
					patch(id, { remoteId: undefined });
					running.delete(id);
					return runGroup([id]);
				}
				failed(id, error);
			})
			.finally(() => running.delete(id));
		return;
	}
	void runGroup([id]);
}

/** Cancel a post Late holds for later (DELETE /v1/posts/{id}), or one whose video is still going up to Late: nothing
 *  was posted yet, so nothing is left half-posted (the upload stops once no account of that Post press waits on it). */
export async function cancelLate(id: string) {
	const p = find(id);
	const group = uploads.get(id);
	if (p?.state === "uploading" && group) {
		uploads.delete(id);
		patch(id, { state: "cancelled", stage: undefined, finishedAt: Date.now() });
		if (!group.ids.some((other) => uploads.get(other) === group)) group.abort.abort();
		return;
	}
	if (p?.state === "uploading") throw new StudioError("It is already being published on the platform: it can't be stopped now.");
	if (!p || p.state !== "scheduled") throw new StudioError("Only a post that hasn't started can be cancelled.");
	if (p.remoteId) await deletePost(p.remoteId);
	patch(id, { state: "cancelled", stage: undefined });
}
