// Share → Post through Late (getlate.dev, now Zernio): one REST API over YouTube, Instagram and TikTok, the accounts
// connected through each platform's own sign-in (Late's audited apps). Pure: the request a post becomes, and what
// Late's answer means for the post's row. Fields and values are the ones in Late's API reference
// (https://zernio.com/openapi.json: POST /v1/posts, Post, PlatformTarget, YouTubePlatformData, TikTokPlatformData).
import type { Platform } from "./caption";

export const LATE_API = "https://zernio.com/api/v1";
/** Where the person gets the key (Late's dashboard → API keys). */
export const LATE_KEYS_URL = "https://zernio.com/dashboard/api-keys";
/** Late refused the saved key (401): the sheet and Settings ask for a new one right there, next to the field. */
export const KEY_REFUSED = "Late doesn't accept the saved key any more. Paste a new one.";
/** A key pasted in the field that Late refused: it is not saved (the field says so, under it). */
export const KEY_WRONG = "Late didn't accept this key. Copy the whole key from zernio.com → API keys and paste it again.";
export const LATE_PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok"];

/** A connected account as the sheet and Settings show it. */
export interface LateAccount {
	id: string;
	platform: Platform;
	name: string;
	username?: string;
	avatar?: string;
	/** Late says the platform's sign-in has to be renewed. */
	reconnect?: boolean;
}

/** TikTok's own choices for a post (its rules: the person picks them; nothing is assumed). */
export interface TikTokChoice {
	privacyLevel: string;
	allowComment: boolean;
	allowDuet: boolean;
	allowStitch: boolean;
}

export interface LateTarget {
	platform: Platform;
	accountId: string;
	/** YouTube's title (youtubeTitle). */
	title: string;
	/** The description and the hashtags (captionFor). */
	caption: string;
	/** YouTube's tags (youtubeTags). */
	tags: string[];
	privacy: "public" | "unlisted" | "private";
	tiktok?: TikTokChoice;
}

/** The body of POST /v1/posts for one account: the uploaded video, its text, and Post now or a time (ms). */
export function lateBody(t: LateTarget, mediaUrl: string, at: number | null): Record<string, unknown> {
	const target: Record<string, unknown> = {
		platform: t.platform,
		accountId: t.accountId,
	};
	if (t.platform === "youtube")
		target.platformSpecificData = {
			title: t.title,
			visibility: t.privacy,
			madeForKids: false,
		};
	if (t.platform === "tiktok") {
		if (!t.tiktok?.privacyLevel) throw new Error("TikTok: choose who can watch.");
		target.platformSpecificData = {
			privacyLevel: t.tiktok.privacyLevel,
			allowComment: t.tiktok.allowComment,
			allowDuet: t.tiktok.allowDuet,
			allowStitch: t.tiktok.allowStitch,
			// The person saw the video and pressed Post next to TikTok's own consent line (TikTok requires both).
			contentPreviewConfirmed: true,
			expressConsentGiven: true,
		};
	}
	// A single video on Instagram is a Reel (shareToFeed defaults to true): nothing to add.
	const body: Record<string, unknown> = {
		content: t.caption,
		mediaItems: [{ type: "video", url: mediaUrl }],
		platforms: [target],
	};
	if (t.platform === "youtube" && t.tags.length) body.tags = t.tags;
	if (at) {
		body.scheduledFor = new Date(at).toISOString();
		body.timezone = "UTC";
	} else body.publishNow = true;
	return body;
}

/** Late's account (SocialAccount) → the row Settings and the sheet show; other platforms and ads-only ones → null. */
export function accountView(a: Record<string, unknown>): LateAccount | null {
	const platform = String(a.platform ?? "") as Platform;
	if (!LATE_PLATFORMS.includes(platform) || !a._id || a.enabled === false) return null;
	const username = typeof a.username === "string" && a.username ? a.username : undefined;
	const name = (typeof a.displayName === "string" && a.displayName) || username || platform;
	return {
		id: String(a._id),
		platform,
		name,
		username,
		avatar: typeof a.profilePicture === "string" && /^https:\/\//.test(a.profilePicture) ? a.profilePicture : undefined,
		reconnect: a.needsReconnection === true || a.isActive === false ? true : undefined,
	};
}

export type LateState = "scheduled" | "uploading" | "done" | "failed" | "cancelled";

export interface LateOutcome {
	state: LateState;
	url?: string;
	remoteId?: string;
	stage?: string;
	/** Plain words (an i18n key); the platform's own text goes to `detail`. */
	error?: string;
	detail?: string;
}

/** Late's error category of a failed platform entry (PlatformTarget.errorCategory) in plain words. */
export function plainError(category: unknown): string {
	switch (category) {
		case "auth_expired":
			return "The account's sign-in has expired. Connect it again in Settings → Share, then press Retry.";
		case "user_content":
			return "The platform refused this video or its text. Change what the details say, then press Retry.";
		case "user_abuse":
		case "platform_rate_limit":
			return "The platform limits how often you can post. Press Retry a bit later.";
		case "account_issue":
			return "The account isn't set up for posting. The details say what to change.";
		case "platform_rejected":
			return "The platform rejected the post under its rules.";
		case "platform_error":
		case "quota_exhausted":
		case "system_error":
			return "The platform or Late is having trouble right now. Press Retry in a few minutes.";
		default:
			return "The post failed.";
	}
}

/** What Late's post (POST /v1/posts, GET /v1/posts/{id}) means for this platform's row. */
export function lateOutcome(post: Record<string, unknown> | undefined, platform: Platform, scheduled: boolean): LateOutcome {
	const remoteId = post?._id ? String(post._id) : undefined;
	const entries = (Array.isArray(post?.platforms) ? post.platforms : []) as Array<Record<string, unknown>>;
	const entry = entries.find((e) => e.platform === platform) ?? entries[0];
	const status = String(entry?.status ?? "");
	const postStatus = String(post?.status ?? "");
	if (status === "published" || (!entry && postStatus === "published")) {
		const url = typeof entry?.platformPostUrl === "string" && /^https:\/\//.test(entry.platformPostUrl) ? entry.platformPostUrl : undefined;
		return {
			state: "done",
			remoteId,
			url,
			stage: url ? undefined : platform === "tiktok" ? "TikTok shows the link a few minutes after posting." : "Posted. The platform hasn't given the link yet.",
		};
	}
	if (status === "failed" || (!entry && postStatus === "failed")) {
		const detail = typeof entry?.errorMessage === "string" ? entry.errorMessage.slice(0, 600) : undefined;
		return {
			state: "failed",
			remoteId,
			error: plainError(entry?.errorCategory),
			detail,
		};
	}
	if (status === "cancelled" || postStatus === "cancelled") return { state: "cancelled", remoteId };
	if (scheduled && postStatus === "scheduled") return { state: "scheduled", remoteId };
	// pending / processing / uploading, or the inline publish hit a passing error (207 «scheduled»: Late retries it).
	const note = typeof entry?.errorMessage === "string" && entry.errorMessage ? entry.errorMessage.slice(0, 300) : undefined;
	return {
		state: "uploading",
		remoteId,
		stage: postStatus === "scheduled" && !scheduled ? "The platform had a hiccup: Late tries again by itself." : "The platform is processing the video.",
		detail: note,
	};
}

/** Late's HTTP refusal in plain words (an i18n key); Late's own message goes to the details. */
export function lateHttpError(status: number, body: Record<string, unknown>): string {
	const code = String(body.code ?? "");
	// (not «Paste it again in Settings → Share»: the person reads it in Settings → Share, or in the sheet's own key field)
	if (status === 401) return KEY_REFUSED;
	if (status === 402) return "Your Late plan has no posts or accounts left. Upgrade it in Late's dashboard, or wait for next month.";
	if (status === 403 && code === "ACCOUNT_DISCONNECTED") return "The account's sign-in has expired. Connect it again in Settings → Share, then press Retry.";
	if (status === 403 && code === "PROFILE_OVER_LIMIT") return "Your Late plan doesn't cover this many accounts. Disconnect one, or upgrade the plan.";
	if (status === 403) return "Late refused this. The details say why.";
	if (status === 404) return "Late doesn't know this account or post any more. Connect the account again in Settings → Share.";
	if (status === 409) return "The same video and text went to this account within the last day. Change the text to post it again.";
	if (status === 429) return "Too many posts for now (Late allows 25 an hour per account). Press Retry later.";
	if (status >= 500) return "Late isn't answering right now. Press Retry in a few minutes.";
	return "Late refused the post. The details say why.";
}
