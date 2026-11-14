import { describe, expect, test } from "bun:test";
import { captionFor, youtubeTags, youtubeTitle } from "../caption";
import { accountView, lateBody, lateHttpError, lateOutcome, type LateTarget, plainError } from "../late";

const text = { title: "My Short", description: "Hello there", hashtags: "travel, #Summer summer" };
const base = (platform: LateTarget["platform"], extra: Partial<LateTarget> = {}): LateTarget => ({
	platform,
	accountId: `acc-${platform}`,
	title: platform === "youtube" ? youtubeTitle(text, "Project") : "",
	caption: captionFor(text),
	tags: platform === "youtube" ? youtubeTags(text) : [],
	privacy: "unlisted",
	...extra,
});
const MEDIA = "https://media.zernio.com/temp/1_abc_gaziyav.mp4";

describe("Late: the request a post becomes (POST /v1/posts)", () => {
	test("YouTube: title, visibility and madeForKids in platformSpecificData; tags at the top; Post now", () => {
		expect(lateBody(base("youtube"), MEDIA, null)).toEqual({
			content: "Hello there\n\n#travel #Summer",
			mediaItems: [{ type: "video", url: MEDIA }],
			platforms: [{ platform: "youtube", accountId: "acc-youtube", platformSpecificData: { title: "My Short", visibility: "unlisted", madeForKids: false } }],
			tags: ["travel", "Summer"],
			publishNow: true,
		});
	});
	test("Instagram: a single video is a Reel by default — nothing platform-specific, no tags", () => {
		const body = lateBody(base("instagram"), MEDIA, null);
		expect(body.platforms).toEqual([{ platform: "instagram", accountId: "acc-instagram" }]);
		expect(body.tags).toBeUndefined();
		expect(body.content).toBe("Hello there\n\n#travel #Summer");
	});
	test("TikTok: the person's privacy and interactions, plus TikTok's two consent flags", () => {
		const body = lateBody(base("tiktok", { tiktok: { privacyLevel: "SELF_ONLY", allowComment: true, allowDuet: false, allowStitch: false } }), MEDIA, null);
		expect(body.platforms).toEqual([
			{ platform: "tiktok", accountId: "acc-tiktok", platformSpecificData: { privacyLevel: "SELF_ONLY", allowComment: true, allowDuet: false, allowStitch: false, contentPreviewConfirmed: true, expressConsentGiven: true } },
		]);
		expect(() => lateBody(base("tiktok"), MEDIA, null)).toThrow(/who can watch/);
	});
	test("Schedule: scheduledFor (ISO) + timezone instead of publishNow", () => {
		const at = Date.UTC(2026, 11, 1, 9, 30);
		const body = lateBody(base("instagram"), MEDIA, at);
		expect(body.scheduledFor).toBe("2026-12-01T09:30:00.000Z");
		expect(body.timezone).toBe("UTC");
		expect(body.publishNow).toBeUndefined();
	});
});

describe("Late: accounts (GET /v1/accounts)", () => {
	test("our three platforms only, display name first, https avatars only, ads-only ones dropped", () => {
		expect(accountView({ _id: "a1", platform: "youtube", username: "chan", displayName: "My Channel", profilePicture: "https://yt3.ggpht.com/x.jpg", isActive: true })).toEqual({ id: "a1", platform: "youtube", name: "My Channel", username: "chan", avatar: "https://yt3.ggpht.com/x.jpg", reconnect: undefined });
		expect(accountView({ _id: "a2", platform: "tiktok", username: "me", profilePicture: "http://insecure", isActive: true })?.name).toBe("me");
		expect(accountView({ _id: "a2", platform: "tiktok", username: "me", profilePicture: "http://insecure", isActive: true })?.avatar).toBeUndefined();
		expect(accountView({ _id: "a3", platform: "linkedin", username: "x", isActive: true })).toBeNull();
		expect(accountView({ _id: "a4", platform: "instagram", username: "x", isActive: true, enabled: false })).toBeNull();
		expect(accountView({ _id: "a5", platform: "instagram", username: "x", isActive: true, needsReconnection: true })?.reconnect).toBe(true);
	});
});

describe("Late: what its answer means for the row", () => {
	const post = (status: string, entry: Record<string, unknown>) => ({ _id: "p1", status, platforms: [{ platform: "youtube", accountId: { _id: "acc" }, ...entry }] });
	test("published with a link → done with the link", () => {
		expect(lateOutcome(post("published", { status: "published", platformPostUrl: "https://youtube.com/shorts/abc" }), "youtube", false)).toEqual({ state: "done", remoteId: "p1", url: "https://youtube.com/shorts/abc", stage: undefined });
	});
	test("TikTok published without a link yet → done, says the link comes later", () => {
		const o = lateOutcome({ _id: "p2", status: "published", platforms: [{ platform: "tiktok", status: "published", platformPostUrl: null }] }, "tiktok", false);
		expect(o.state).toBe("done");
		expect(o.url).toBeUndefined();
		expect(o.stage).toMatch(/few minutes/);
	});
	test("failed → plain words from the category, the platform's own text as details", () => {
		const o = lateOutcome(post("failed", { status: "failed", errorCategory: "auth_expired", errorMessage: "Token revoked" }), "youtube", false);
		expect(o).toEqual({ state: "failed", remoteId: "p1", error: plainError("auth_expired"), detail: "Token revoked" });
		expect(o.error).toMatch(/Connect it again/);
	});
	test("still processing → uploading; a 207 «scheduled» after Post now is Late retrying, not a failure", () => {
		expect(lateOutcome(post("publishing", { status: "processing" }), "youtube", false).state).toBe("uploading");
		const hiccup = lateOutcome(post("scheduled", { status: "pending", errorMessage: "temporary" }), "youtube", false);
		expect(hiccup.state).toBe("uploading");
		expect(hiccup.stage).toMatch(/tries again/);
	});
	test("a scheduled post stays scheduled until it goes out", () => {
		expect(lateOutcome(post("scheduled", { status: "pending" }), "youtube", true).state).toBe("scheduled");
	});
	test("HTTP refusals in plain words", () => {
		// (no «Paste it again in Settings → Share»: it is read in Settings → Share, or next to the sheet's key field)
		expect(lateHttpError(401, {})).toMatch(/doesn't accept the saved key/);
		expect(lateHttpError(403, { code: "ACCOUNT_DISCONNECTED" })).toMatch(/Connect it again/);
		expect(lateHttpError(409, {})).toMatch(/within the last day/);
		expect(lateHttpError(429, {})).toMatch(/25 an hour/);
		expect(lateHttpError(502, {})).toMatch(/isn't answering/);
	});
});
