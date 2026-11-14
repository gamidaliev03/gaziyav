// post: Claude publishes through Gaziyav's own Share → Post (Late's API, the accounts the user connected once in
// Settings → Share): the same export, the same rows in the header chip, the same Retry. First a dry run that says what
// would go out (the user says yes once in the chat), then confirm:true renders, posts, waits and reports each link.
import { EditorCore } from "@/core";
import { renderStillFrame } from "@/export/still-frame";
import { captionFor, isVertical, PLATFORM_LABEL, parseHashtags, type Platform, type PostText, textIssues, youtubeTitle } from "@/share/caption";
import { mainVideoIds, needsLateKey, startPost, tiktokOptions, timelineSeconds, useShare } from "@/share/client";
import type { LateAccount, TikTokChoice } from "@/share/late";
import type { Post } from "@/share/types";
import { TICKS_PER_SECOND } from "@/wasm";

type Args = Record<string, unknown>;
const ed = () => EditorCore.getInstance();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];
/** How long the cover shows at the start of the posted file (the Export window's own lead). */
const COVER_SECONDS = 0.1;

/** A cover from seconds of the timeline or a Media picture id; null when none was asked for. */
export async function coverImage(arg: unknown): Promise<{ image: ImageBitmap; seconds: number } | null> {
	if (arg === undefined || arg === null || arg === "") return null;
	const editor = ed();
	const project = editor.project.getActive();
	const fps = project.settings.fps.numerator / project.settings.fps.denominator;
	const seconds = Math.max(1, Math.round(COVER_SECONDS * fps)) / fps;
	const text = String(arg).trim();
	if (/^\d+(\.\d+)?$/.test(text)) {
		const { blob } = await renderStillFrame(editor, project.settings.canvasSize, Math.round(Number(text) * TICKS_PER_SECOND));
		return { image: await createImageBitmap(blob), seconds };
	}
	const asset = editor.media.getAssets().find((a) => a.id === text || (text.length >= 6 && a.id.startsWith(text)));
	if (!asset?.file || asset.type !== "image") throw new Error(`cover: give seconds of the timeline (e.g. 1.5) or the id of a picture in Media; "${text}" is neither.`);
	return { image: await createImageBitmap(asset.file), seconds };
}

const at = (v: unknown): number | null => {
	if (v === undefined || v === null || v === "") return null;
	const t = Date.parse(String(v));
	if (!Number.isFinite(t)) throw new Error(`at: an ISO time like 2026-11-10T18:00:00+07:00; "${String(v)}" isn't one.`);
	return t > Date.now() + 60_000 ? t : null;
};

const TIKTOK_LEVEL: Record<string, string> = { public: "PUBLIC_TO_EVERYONE", unlisted: "MUTUAL_FOLLOW_FRIENDS", private: "SELF_ONLY" };

async function tiktokChoice(account: LateAccount, privacy: string): Promise<TikTokChoice> {
	const o = await tiktokOptions(account.id);
	const levels = o.privacyLevels.map((l) => l.value);
	const want = TIKTOK_LEVEL[privacy] ?? "PUBLIC_TO_EVERYONE";
	return { privacyLevel: levels.includes(want) ? want : (levels[0] ?? want), allowComment: o.allow.comment, allowDuet: false, allowStitch: false };
}

function row(p: Post): string {
	const who = `${PLATFORM_LABEL[p.platform]}${p.accountName ? ` (${p.accountName})` : ""}`;
	if (p.state === "done") return `${who}: posted${p.url ? ` ${p.url}` : ` — ${p.stage ?? "the link comes later"}`}`;
	if (p.state === "scheduled") return `${who}: scheduled for ${p.at ? new Date(p.at).toISOString() : "later"}`;
	if (p.state === "failed") return `${who}: failed — ${p.error ?? "the post failed"}${p.errorDetail ? ` (${p.errorDetail})` : ""}`;
	if (p.state === "cancelled") return `${who}: cancelled`;
	return `${who}: ${p.stage ?? p.state} ${Math.round(p.progress * 100)} %`;
}

export async function postTool(args: Args): Promise<string> {
	const share = useShare.getState();
	if (args.check) {
		const s = await share.refresh(true);
		const list = (s?.posts ?? []).slice(0, 10);
		return list.length ? `Recent posts:\n${list.map((p) => `- ${row(p)} · «${p.project}»`).join("\n")}` : "No posts yet.";
	}
	const editor = ed();
	const project = editor.project.getActiveOrNull() ?? (() => { throw new Error("No project is open."); })();
	const state = await share.refresh(true);
	if (!state || needsLateKey(state)) {
		throw new Error("Posting isn't set up yet: the user pastes the Late key and connects the accounts once in Gaziyav → Settings → Share (their own sign-in; Claude can't do it). Tell them, then call post again.");
	}
	const wanted = (Array.isArray(args.platforms) && args.platforms.length ? args.platforms.map(String) : PLATFORMS).filter((p): p is Platform => PLATFORMS.includes(p as Platform));
	const accounts = (state.late?.accounts ?? []).filter((a) => wanted.includes(a.platform));
	const stale = accounts.filter((a) => a.reconnect);
	const targets = accounts.filter((a) => !a.reconnect);
	if (!targets.length) {
		const have = (state.late?.accounts ?? []).map((a) => `${PLATFORM_LABEL[a.platform]} (${a.name})`).join(", ") || "none";
		throw new Error(`No connected account for ${wanted.map((p) => PLATFORM_LABEL[p]).join(", ")} (connected: ${have}${stale.length ? `; ${stale.map((a) => a.name).join(", ")} must be reconnected` : ""}). The user connects them in Gaziyav → Settings → Share.`);
	}
	const platforms = [...new Set(targets.map((a) => a.platform))];
	const text: PostText = { title: String(args.title ?? "").trim(), description: String(args.description ?? "").trim(), hashtags: String(args.hashtags ?? "").trim() };
	if (!text.description && !text.title) throw new Error("Give at least a description (and a title for YouTube) and hashtags: the post goes out with exactly this text.");
	const seconds = timelineSeconds(editor);
	if (seconds <= 0) throw new Error("The timeline is empty: there is nothing to post.");
	const issues = textIssues(platforms, text, seconds);
	const blocking = issues.filter((i) => i.blocking);
	const say = (i: (typeof issues)[number]) => i.message.replace(/\{(\w+)\}/g, (all, k: string) => String(i.vars[k] ?? all));
	if (blocking.length) throw new Error(`Fix first (nothing was posted): ${blocking.map(say).join(" ")}`);
	const size = project.settings.canvasSize;
	const vertical = !isVertical(size);
	if (vertical && args.vertical !== true) throw new Error(`The project is ${size.width}×${size.height}, not 9:16: Shorts, Reels and TikTok take vertical video. Call again with vertical:true (a 9:16 copy is posted, the project stays as it is), or make it vertical first (edit make_vertical).`);
	if (vertical && !mainVideoIds(editor).length) throw new Error("vertical:true needs video clips on the main track (the reframe follows the person in them).");
	const privacy = args.privacy === "private" || args.privacy === "unlisted" ? args.privacy : "public";
	const when = at(args.at);
	const tiktok = targets.find((a) => a.platform === "tiktok");
	const tiktokPick = tiktok ? await tiktokChoice(tiktok, privacy) : undefined;
	const tags = parseHashtags(text.hashtags);
	const caption = captionFor(text);
	const summary = [
		`${Math.round(seconds * 10) / 10} s ${vertical ? "9:16 copy" : `${size.width}×${size.height}`} of «${project.metadata.name}»`,
		...targets.map((a) => `→ ${PLATFORM_LABEL[a.platform]} (${a.name})${a.platform === "youtube" ? ` title «${youtubeTitle(text, project.metadata.name)}»` : ""}${a.platform === "tiktok" && tiktokPick ? ` who can watch: ${tiktokPick.privacyLevel}` : ""}`),
		`text (${caption.length} chars): «${caption.slice(0, 160)}${caption.length > 160 ? "…" : ""}»${tags.length ? ` · ${tags.length} hashtags` : ""}`,
		`privacy ${privacy} · ${when ? `scheduled ${new Date(when).toISOString()}` : "now"}${args.cover !== undefined ? ` · cover from ${String(args.cover)}` : ""}`,
		...issues.filter((i) => !i.blocking).map((i) => `note: ${say(i)}`),
		...(stale.length ? [`skipped (reconnect in Settings → Share): ${stale.map((a) => a.name).join(", ")}`] : []),
	];
	if (args.confirm !== true) {
		return `Ready to post — nothing is posted yet:\n${summary.join("\n")}\nShow this to the user and ask once («Post it?»). After their yes call post again with the same arguments and confirm:true.`;
	}
	const cover = await coverImage(args.cover);
	const made = await startPost(editor, { platforms, targets, tiktok: tiktokPick, text, privacy, at: when, vertical, ...(cover ? { cover } : {}) });
	const ids = new Set(made.map((p) => p.id));
	// The rows are followed until each one is out (or failed), at most a few minutes: what is still processing then is
	// said, and post {check:true} reads it later (the posts go on in Gaziyav either way).
	const until = Date.now() + 4 * 60_000;
	let rows: Post[] = made;
	let open: Post[] = made;
	for (;;) {
		const s = await fetch("/api/share/state?fresh=1", { headers: { "X-Studio": "1" }, signal: AbortSignal.timeout(20_000) })
			.then((r) => (r.ok ? (r.json() as Promise<{ posts?: Post[] }>) : null))
			.catch(() => null);
		if (s?.posts) rows = s.posts.filter((p) => ids.has(p.id));
		open = rows.filter((p) => p.state === "uploading" || p.state === "queued" || p.state === "manual" || (p.state === "done" && !p.url && p.platform !== "tiktok"));
		if (!open.length || Date.now() > until) break;
		await sleep(2000);
	}
	void useShare.getState().refresh(true);
	const failed = rows.filter((p) => p.state === "failed");
	const head = failed.length ? `${rows.length - failed.length} of ${rows.length} went out` : open.length ? "Handed over; the platforms are still processing" : when ? "Scheduled" : "Posted";
	return `${head}:\n${rows.map((p) => `- ${row(p)}`).join("\n")}${failed.length ? "\nFix what the failure says, then post again (only the failed platforms), or the user presses Retry in Gaziyav's header." : ""}${open.length ? "\npost {check:true} in a few minutes gives the links." : ""}`;
}
