// Share → Post on the page: Late's key and accounts (connected once through each platform's own sign-in), the posts
// (the server keeps them and sends them through Late's API: no window, nothing to press on a site), the export that
// goes to them (made 9:16 for the posted file only), and the posts mirrored in the job center (header chip, Retry,
// Open, Cancel). Posts queued through the sites by older versions still finish in the Mac app's Share window.
import { type DiskExport, openDiskExport } from "@/export/disk";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Command } from "@/commands";
import type { EditorCore } from "@/core";
import { t, useLang } from "@/i18n";
import { trackClip } from "@/motion/client";
import { applyReframe, locate } from "@/motion/commands";
import { useMotionStore } from "@/motion/store";
import type { Tracker } from "@/motion/types";
import { captionCues } from "@/subtitles/export-file";
import { type Job, jobCenter } from "@/jobs/store";
import { appPrefs } from "@/settings/app-prefs";
import type { VideoElement } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { PLATFORM_LABEL, type Platform, type PostText } from "./caption";
import { KEY_REFUSED, type LateAccount, type TikTokChoice } from "./late";
import { postJob, scheduledTime } from "./post-job";
import type { Accounts, LateView, Post } from "./types";

interface ShareState {
	accounts: Accounts | null;
	posts: Post[];
	/** Late's key (saved or not) and its connected accounts. */
	late: LateView | null;
}

type ShareApp = {
	shareAccounts?: () => Promise<Accounts | null>;
	shareShow?: (postId: string) => Promise<boolean>;
	lateKey?: { set: (key: string) => Promise<{ ok: boolean; error?: string; detail?: string }>; clear: () => Promise<{ ok: boolean }> };
	lateConnect?: (authUrl: string) => Promise<{ ok: boolean; platform?: string; username?: string; error?: string; message?: string; closed?: boolean }>;
};
const shareApp = () => (typeof window === "undefined" ? undefined : (window as unknown as { studioApp?: ShareApp }).studioApp);
/** Late's connect window and key need the Mac app; the web build only shows the list. */
export const canUseLate = () => !!shareApp()?.lateConnect;
/** Posting goes through Late only: without a key that Late takes, the sheet's one step is pasting it (no site window). */
export const needsLateKey = (state: ShareState | null | undefined) => !state?.late?.key || state.late.error === KEY_REFUSED;

const HEADERS = { "X-Studio": "1" };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`/api/share/${path}`, { ...init, headers: { ...HEADERS, ...(init.headers as Record<string, string>) } });
	} catch {
		throw new Error(t("Gaziyav's local server is not responding. Restart Gaziyav."));
	}
	const data = (await res.json().catch(() => ({}))) as T & { error?: string; detail?: string };
	if (!res.ok || data.error) throw Object.assign(new Error(data.error ? t(data.error) : `Request failed (HTTP ${res.status})`), { detail: data.detail });
	return data;
}
const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

interface Store {
	state: ShareState | null;
	error: string | null;
	refresh: (fresh?: boolean) => Promise<ShareState | null>;
	set: (state: ShareState) => void;
}

export const useShare = create<Store>()((set, get) => ({
	state: null,
	error: null,
	refresh: async (fresh = false) => {
		try {
			// (the site accounts of the old Share window: a main process that doesn't answer must not hold the state up)
			const accountsNow = Promise.race([shareApp()?.shareAccounts?.().catch(() => null) ?? Promise.resolve(null), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
			const [{ posts, late }, accounts] = await Promise.all([call<{ posts: Post[]; late?: LateView }>(fresh ? "state?fresh=1" : "state", { signal: AbortSignal.timeout(30_000) }), accountsNow]);
			const state = { posts, accounts: accounts ?? get().state?.accounts ?? null, late: late ?? null };
			set({ state, error: null });
			mirror(posts);
			return state;
		} catch (error) {
			set({ error: (error as Error).message });
			return null;
		}
	},
	set: (state) => {
		set({ state, error: null });
		mirror(state.posts);
	},
}));

/** What the sheet remembers: the platforms ticked last time and each project's text. */
export const usePostDraft = create<{
	platforms: Platform[];
	texts: Record<string, PostText>;
	/** Late's accounts ticked last time (null: never chosen — every connected one). */
	accounts: string[] | null;
	/** TikTok's choices last time (who can watch, interactions): the person picks them once. */
	tiktok: TikTokChoice | null;
	setPlatforms: (p: Platform[]) => void;
	setText: (projectId: string, text: PostText) => void;
	setAccounts: (ids: string[]) => void;
	setTiktok: (choice: TikTokChoice) => void;
}>()(
	persist(
		(set) => ({
			platforms: ["youtube", "instagram"],
			texts: {},
			accounts: null,
			tiktok: null,
			setPlatforms: (platforms) => set({ platforms }),
			setText: (projectId, text) => set((s) => ({ texts: { ...s.texts, [projectId]: text } })),
			setAccounts: (accounts) => set({ accounts }),
			setTiktok: (tiktok) => set({ tiktok }),
		}),
		{ name: "gaziyav-post-draft" },
	),
);

const withPosts = async (path: string, id: string) => {
	const { posts } = await post<{ posts: Post[] }>(path, { id });
	const state = { posts, accounts: useShare.getState().state?.accounts ?? null, late: useShare.getState().state?.late ?? null };
	useShare.getState().set(state);
	return state;
};

export const shareApi = {
	retry: (id: string) => withPosts("retry", id),
	cancel: (id: string) => withPosts("cancel", id),
	remove: (id: string) => withPosts("remove", id),
	/** The post's Share window to the front (it waits there for the person). */
	show: (id: string) => shareApp()?.shareShow?.(id) ?? Promise.resolve(false),
};

// ───────────────────────── Late ─────────────────────────

/** Waits until the server has the key the app just saved / removed (it arrives as a message a moment later). */
async function awaitLateKey(present: boolean): Promise<ShareState | null> {
	let s: ShareState | null = null;
	for (let i = 0; i < 25; i++) {
		s = await useShare.getState().refresh(true);
		if (!!s?.late?.key === present) break;
		await new Promise((r) => setTimeout(r, 150));
	}
	return s;
}

/** The app asks Late whether it takes the key, and keeps it (Keychain) only then: a refused key is not saved. */
export async function saveLateKey(key: string): Promise<LateView | null> {
	const bridge = shareApp()?.lateKey;
	if (!bridge) throw new Error(t("The key can only be saved in the Mac app."));
	// (the server checks the key for the app: it has to be listening — any state request starts it)
	await useShare.getState().refresh();
	const r = await bridge.set(key);
	if (!r.ok) throw Object.assign(new Error(t(r.error || "The key couldn't be saved.")), { detail: r.detail });
	return (await awaitLateKey(true))?.late ?? null;
}

export async function clearLateKey(): Promise<void> {
	await shareApp()?.lateKey?.clear();
	await awaitLateKey(false);
}

/** The platform's own sign-in (Late's connect URL) in a Gaziyav window; resolves once it's connected (or closed). */
export async function connectLate(platform: Platform, reconnect?: string): Promise<boolean> {
	const app = shareApp();
	if (!app?.lateConnect) throw new Error(t("Posting works in the Gaziyav app."));
	const { authUrl } = await post<{ authUrl: string }>("late/connect", { platform, reconnect });
	const r = await app.lateConnect(authUrl);
	await useShare.getState().refresh(true);
	if (r?.closed) return false;
	if (!r?.ok) {
		const why = r?.error === "oauth_denied" ? t("The sign-in was cancelled, or the permissions weren't given.") : t("The platform didn't connect the account. Try again.");
		throw Object.assign(new Error(why), { detail: [r?.error, r?.message].filter(Boolean).join(" — ") });
	}
	return true;
}

export async function disconnectLate(accountId: string): Promise<void> {
	// (the server answers with Late's accounts asked again, not the minute's cache)
	const { late } = await post<{ late: LateView }>("late/disconnect", { accountId });
	const s = useShare.getState().state;
	if (s) useShare.getState().set({ ...s, late });
	else await useShare.getState().refresh(true);
}

export interface TikTokOptions {
	privacyLevels: Array<{ value: string; label: string }>;
	allow: { comment: boolean; duet: boolean; stitch: boolean };
	maxSeconds: number | null;
	canPostMore: boolean;
}

/** TikTok's own options for an account (asked when the account is ticked). */
export const tiktokOptions = (accountId: string) => call<TikTokOptions>(`late/tiktok?account=${encodeURIComponent(accountId)}`);

// ───────────────────────── the video ─────────────────────────

export const timelineSeconds = (editor: EditorCore) => editor.timeline.getTotalDuration() / TICKS_PER_SECOND;

/** The main track's video clips (what Make vertical reframes). */
export function mainVideoIds(editor: EditorCore): string[] {
	return editor.scenes.getActiveScene().tracks.main.elements.filter((e) => e.type === "video").map((e) => e.id);
}

/** Cancel in the sheet (or the header chip): the export or the hand-over stopped, nothing was posted. */
export class PostCancelled extends Error {
	constructor() {
		super(t("Cancelled: nothing was posted."));
	}
}

/**
 * Make it vertical for the posted file only: the reframe (its trackers found the way Make vertical finds them) is
 * done outside ⌘Z, and the returned `restore` takes it back exactly once the export is made. (Posting left the
 * project at 1080×1920 with the clips at 316 % and their keyframes, and one more step in the history.)
 */
async function verticalForExport(editor: EditorCore, stopped: () => boolean): Promise<() => void> {
	const plan: Array<{ elementId: string; tracker: Tracker | null; isNew?: boolean }> = [];
	for (const elementId of mainVideoIds(editor)) {
		const clip = locate(editor, elementId)?.element as VideoElement | undefined;
		if (!clip) continue;
		const picked = useMotionStore.getState().selected[elementId];
		const kept = clip.trackers?.find((x) => x.id === picked) ?? clip.trackers?.find((x) => x.kind === "face") ?? clip.trackers?.find((x) => x.kind === "subject") ?? clip.trackers?.[0] ?? null;
		let tracker = kept;
		if (!tracker) tracker = await trackClip({ elementId, kind: "face", quiet: true, add: false }).catch(() => null);
		if (!tracker && !stopped()) tracker = await trackClip({ elementId, kind: "subject", quiet: true, add: false }).catch(() => null);
		if (stopped()) throw new PostCancelled();
		plan.push({ elementId, tracker, isNew: !kept && !!tracker });
	}
	if (!plan.length) throw new Error(t("Put a video clip on the main track first."));
	// applyReframe hands its step to editor.command: here the step is done on the spot and kept, never in the history.
	const steps: Command[] = [];
	const offRecord = new Proxy(editor, {
		get: (target, key) =>
			key === "command"
				? {
						execute: ({ command }: { command: Command }) => {
							command.execute();
							steps.push(command);
							return command;
						},
					}
				: Reflect.get(target, key),
	});
	if (!applyReframe(offRecord, plan, "9:16")) throw new Error(t("The video couldn't be made vertical. Untick «Make it vertical» to post it as it is."));
	return () => {
		for (const step of steps.reverse()) step.undo();
	};
}

/** The whole timeline as an MP4 at the project's size, −14 LUFS (the platforms' loudness); `onProgress` 0..1. */
async function renderVideo(editor: EditorCore, onProgress: (p: number) => void, signal: AbortSignal, cover?: PostInput["cover"]): Promise<ArrayBuffer | DiskExport> {
	if (editor.project.getExportState().isExporting) throw new Error(t("An export is running. Wait for it to finish, then post."));
	if (editor.timeline.getTotalDuration() <= 0) throw new Error(t("The timeline is empty."));
	// (export() clears an earlier cancel request when it starts: a Cancel pressed before it is checked here)
	if (signal.aborted) throw new PostCancelled();
	const prefs = appPrefs();
	const stop = editor.project.subscribe(() => {
		const s = editor.project.getExportState();
		if (s.isExporting) onProgress(s.progress);
	});
	const cancel = () => editor.project.cancelExport();
	signal.addEventListener("abort", cancel, { once: true });
	const disk = await openDiskExport();
	let kept = false;
	try {
		const result = await editor.project.export({ options: { toFile: disk?.writer, format: "mp4", quality: "high", includeAudio: true, normalizeLoudness: true, targetLufs: prefs.targetLufs, hardwareEncoding: prefs.hardwareEncoding, ...(cover ? { cover } : {}) } });
		editor.project.clearExportState();
		if (result.cancelled || signal.aborted) throw new PostCancelled();
		if (!result.success || !(result.buffer || result.bytes)) throw new Error(result.error || t("The video couldn't be exported."));
		if (result.buffer) return result.buffer;
		kept = true;
		return disk as DiskExport;
	} finally {
		if (!kept) disk?.discard();
		stop();
		signal.removeEventListener("abort", cancel);
	}
}

const POST_JOB = "post-export";

export interface PostInput {
	/** Where the sheet shows the export's progress (0..1) and stage. */
	onProgress?: (progress: number, stage: string) => void;
	platforms: Platform[];
	/** The ticked Late accounts (`platforms` is only what they are). */
	targets: LateAccount[];
	tiktok?: TikTokChoice;
	text: PostText;
	privacy: "public" | "unlisted" | "private";
	at: number | null;
	/** Not 9:16 and «Make it vertical» ticked: the posted file is vertical, the project stays as it is. */
	vertical?: boolean;
	/** Cancel in the sheet. */
	signal?: AbortSignal;
	/** The cover the posted file opens with (the Export window's «Add video cover at the beginning»; Claude's post tool). */
	cover?: { image: CanvasImageSource & { width: number; height: number }; seconds: number };
}

/**
 * (Made vertical →) export → store the file → one post per account. The job center shows the export with Cancel;
 * each post then has its own line. Cancel stops the export or the hand-over; rows already made are cancelled too
 * (their upload to Late stops): nothing is left half-posted.
 */
export async function startPost(editor: EditorCore, input: PostInput): Promise<Post[]> {
	const project = editor.project.getActive();
	// (before the faces are looked for: that work would be thrown away)
	if (editor.project.getExportState().isExporting) throw new Error(t("An export is running. Wait for it to finish, then post."));
	const abort = new AbortController();
	const cancel = () => abort.abort();
	if (input.signal?.aborted) cancel();
	input.signal?.addEventListener("abort", cancel, { once: true });
	const stopped = () => abort.signal.aborted;
	// Cancel while the faces are being found: the tracking stops too.
	const ids = input.vertical ? mainVideoIds(editor) : [];
	abort.signal.addEventListener("abort", () => {
		for (const id of ids) useMotionStore.getState().jobs[`track:${id}`]?.cancel?.();
	});
	const first = input.vertical ? t("Making it vertical…") : t("Exporting the video");
	jobCenter.remove(POST_JOB);
	jobCenter.start({ id: POST_JOB, kind: "export", title: t("Post"), stage: first, progress: 0, cancel });
	try {
		let rendered: ArrayBuffer | DiskExport;
		let restore: (() => void) | null = null;
		try {
			if (input.vertical) {
				input.onProgress?.(0, first);
				restore = await verticalForExport(editor, stopped);
			}
			jobCenter.update(POST_JOB, { stage: t("Exporting the video") });
			input.onProgress?.(0, t("Exporting the video"));
			rendered = await renderVideo(
				editor,
				(p) => {
					jobCenter.update(POST_JOB, { progress: p * 0.9 });
					input.onProgress?.(p * 0.9, t("Exporting the video"));
				},
				abort.signal,
				input.cover,
			);
		} finally {
			// The project exactly as it was before Post: its size, the clips, their keyframes; the history never had it.
			restore?.();
		}
		jobCenter.update(POST_JOB, { stage: t("Handing the video over"), progress: 0.92 });
		input.onProgress?.(0.95, t("Handing the video over"));
		const disk = rendered instanceof ArrayBuffer ? null : rendered;
		const { id } = await (disk
			? call<{ id: string }>(`video?from=${encodeURIComponent(await disk.path())}`, { method: "POST", signal: abort.signal })
			: call<{ id: string }>("video", { method: "POST", headers: { "Content-Type": "video/mp4" }, body: rendered as ArrayBuffer, signal: abort.signal })
		).finally(() => disk?.discard());
		if (stopped()) throw new PostCancelled();
		const targets = input.targets.map((a) => ({ platform: a.platform, accountId: a.id, accountName: a.name }));
		// Not aborted halfway: the server would have the rows without the page knowing. A Cancel meanwhile cancels them.
		const { posts } = await post<{ posts: Post[] }>("post", { video: id, project: project.metadata.name, platforms: input.platforms, text: input.text, privacy: input.privacy, at: input.at, targets, tiktok: input.tiktok });
		if (stopped()) {
			await Promise.all(posts.map((p) => shareApi.cancel(p.id).catch(() => {})));
			throw new PostCancelled();
		}
		input.onProgress?.(1, t("Handed over"));
		jobCenter.remove(POST_JOB);
		await useShare.getState().refresh();
		return posts;
	} catch (error) {
		if (stopped() || error instanceof PostCancelled) {
			jobCenter.remove(POST_JOB);
			throw error instanceof PostCancelled ? error : new PostCancelled();
		}
		jobCenter.fail(POST_JOB, (error as Error).message);
		jobCenter.update(POST_JOB, { retry: () => void startPost(editor, { ...input, signal: undefined }).catch(() => {}) });
		throw error;
	}
}

// ───────────────────────── Gaziyav AI writes the post ─────────────────────────

/** What the project says, for "Gaziyav AI": its captions / speech, the text on screen, the clips' names. */
export function projectMaterial(editor: EditorCore): string {
	const tracks = editor.scenes.getActiveScene().tracks;
	const all: Array<{ type: string; name: string; params?: { content?: unknown } }> = [tracks.main, ...(tracks.overlay ?? []), ...(tracks.audio ?? [])].flatMap((tr) => tr.elements as unknown as Array<{ type: string; name: string }>);
	const speech = captionCues(tracks).map((c) => c.text).join(" ");
	const onScreen = all.filter((e) => e.type === "text").map((e) => String(e.params?.content ?? e.name ?? "")).filter(Boolean);
	const clips = all.filter((e) => e.type === "video" || e.type === "audio" || e.type === "image").map((e) => e.name.replace(/\.[a-z0-9]{2,4}$/i, ""));
	return [
		`Project: ${editor.project.getActive().metadata.name}`,
		speech && `Speech / captions: ${speech}`,
		onScreen.length ? `Text on screen: ${[...new Set(onScreen)].join(" | ")}` : "",
		clips.length ? `Clips: ${[...new Set(clips)].slice(0, 30).join(", ")}` : "",
		`Length: ${Math.round(timelineSeconds(editor))} s`,
	]
		.filter(Boolean)
		.join("\n");
}

/** The post's language: the one the person already wrote the title / description in, else the interface's. */
export function postLanguage(existing: Partial<PostText> | undefined, ui: string): "ru" | "en" {
	// the title is prefilled with the project's name (often Latin): only a description the person wrote speaks for them
	const own = existing?.description ?? "";
	const cyr = (own.match(/[а-яё]/gi) ?? []).length;
	const lat = (own.match(/[a-z]/gi) ?? []).length;
	if (cyr + lat >= 12) return cyr >= lat ? "ru" : "en";
	return ui === "en" ? "en" : "ru";
}

/** Title, description and hashtags from Gaziyav AI; `setup` when no AI is set up (the sheet offers Settings → Services). */
export async function writeWithAgent(editor: EditorCore, platforms: Platform[], existing?: Partial<PostText>): Promise<PostText> {
	try {
		const r = await post<PostText>("write", { material: projectMaterial(editor), platforms, lang: postLanguage(existing, useLang.getState().lang) });
		return { title: r.title ?? "", description: r.description ?? "", hashtags: r.hashtags ?? "" };
	} catch (error) {
		// Gaziyav AI's own «has no AI yet» line: the sheet offers Settings → Services instead of Retry.
		const message = (error as Error).message;
		throw Object.assign(new Error(message), { setup: /has no AI yet/i.test(message) });
	}
}

// ───────────────────────── the job center ─────────────────────────

const mirrored = new Map<string, string>();

/** Each upload in the header chip: progress (Cancel while it is still going up), then «Open» or the reason with Retry.
 *  A scheduled post's line ends once Late has it («Scheduled for 14:30»): waiting is not progress. */
function mirror(posts: Post[]) {
	for (const p of posts) {
		const id = `post-${p.id}`;
		const key = `${p.state}:${Math.round(p.progress * 100)}:${p.stage ?? ""}:${p.error ?? ""}:${p.cancellable ? 1 : 0}`;
		if (mirrored.get(id) === key) continue;
		const known = mirrored.has(id);
		mirrored.set(id, key);
		const title = `${t("Post")} · ${PLATFORM_LABEL[p.platform]}${p.accountName ? ` · ${p.accountName}` : ""}`;
		const job = postJob(p, known);
		if (job?.status === "running") {
			jobCenter.upsert(id, {
				id,
				kind: "export",
				title,
				stage: t(job.stage),
				progress: job.progress,
				status: "running",
				cancel: job.cancellable ? () => void shareApi.cancel(p.id).catch((e) => console.warn("[share] cancel", e)) : undefined,
				...(job.manual ? { reveal: () => void shareApi.show(p.id), revealLabel: "Show the window" } : {}),
			});
		} else if (job?.status === "scheduled") {
			jobCenter.update(id, { status: "done", progress: 1, cancel: undefined, message: t("Scheduled for {time}", { time: scheduledTime(job.at) }), messageDetail: undefined, endedAt: Date.now() });
		} else if (job?.status === "done") {
			// (a post that finished before this page saw it run — an earlier launch — is not news any more)
			const patch: Partial<Job> = { status: "done", progress: 1, cancel: undefined, message: t("Posted"), messageDetail: p.stage ? t(p.stage) : undefined, endedAt: Date.now() };
			if (p.url) Object.assign(patch, { reveal: () => window.open(p.url, "_blank"), revealLabel: "Open the post" });
			jobCenter.update(id, patch);
		} else if (job?.status === "failed") {
			jobCenter.update(id, { status: "error", cancel: undefined, message: p.error ? t(p.error) : t("The post failed."), messageDetail: p.errorDetail, endedAt: Date.now(), retry: () => void shareApi.retry(p.id).catch(() => {}) });
		} else if (job?.status === "gone") {
			jobCenter.remove(id);
		}
	}
}

let timer: ReturnType<typeof setInterval> | null = null;
let watchers = 0;

/** Keeps the state fresh while something is uploading or the sheet is open (the sheet passes `fast`). */
export function watchShare(fast = false): () => void {
	watchers += fast ? 1 : 0;
	void useShare.getState().refresh();
	if (!timer) {
		timer = setInterval(() => {
			const s = useShare.getState().state;
			const busy = s?.posts.some((p) => p.state === "uploading" || p.state === "queued" || p.state === "manual" || (p.state === "scheduled" && p.at && p.at <= Date.now() + 30_000));
			if (busy || watchers > 0 || !s) void useShare.getState().refresh();
		}, 1500);
	}
	return () => {
		watchers -= fast ? 1 : 0;
	};
}
