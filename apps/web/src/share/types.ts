// What the server tells the Post sheet, and the site accounts as the Mac app's Share window sees them.
import type { Platform } from "./caption";
import type { LateAccount, TikTokChoice } from "./late";

/** queued: waits for the Share window now; manual: the window waits for the person to finish on the site. */
export type PostState = "queued" | "scheduled" | "uploading" | "manual" | "done" | "failed" | "cancelled";

export interface Post {
	id: string;
	platform: Platform;
	/** The project's name (the list shows it). */
	project: string;
	title: string;
	caption: string;
	tags: string[];
	privacy: "public" | "unlisted" | "private";
	/** When it goes out (ms). null: now. */
	at: number | null;
	/** Always false now (every schedule is Gaziyav's own queue); kept so older posts.json files still read. */
	native: boolean;
	state: PostState;
	/** 0..1 while uploading. */
	progress: number;
	/** Through Late, while the video is still going up (nothing posted yet): Cancel stops it. */
	cancellable?: boolean;
	stage?: string;
	/** The post (or the video in YouTube Studio) once it is up. */
	url?: string;
	/** The platform's id of the post / video. */
	remoteId?: string;
	error?: string;
	/** The platform's own words about a failure (Late's errorMessage), under the plain `error`. */
	errorDetail?: string;
	/** "late": posted through Late's API (no window); absent: through the site in the Share window (the fallback). */
	via?: "late";
	/** Late's account id and its name (the list shows which account). */
	accountId?: string;
	accountName?: string;
	tiktok?: TikTokChoice;
	createdAt: number;
	finishedAt?: number;
}

/** Late as the page sees it: whether a key is saved (its last 4 only) and the connected accounts. */
export interface LateView {
	key: boolean;
	hint: string | null;
	accounts: LateAccount[];
	error?: string;
}

/** A site account as the Mac app sees it (its Share window's sign-in). */
export interface AccountView {
	connected: boolean;
	name?: string;
	avatar?: string;
}

export type Accounts = Record<Platform, AccountView>;
