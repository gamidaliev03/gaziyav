// The server side of Share → Post through Late, against the stand-in (GaziyavShell/test/fake-late.mjs, Late's wire
// format): connect (Late's connect URL → the platform's page → back to Gaziyav), the accounts, TikTok's options, one
// upload for every ticked account, a post per account, a failure in plain words + Retry, Schedule + Cancel, a wrong key.
// Fixed cases: Reconnect renews the same account (it made a duplicate); an expired sign-in shows at once, not after the
// minute's cache; Cancel while the video goes up posts nothing; a scheduled post's job ends once Late has it (it spun
// at 2 % for an hour); a key Late refuses is never kept (it was saved and shown as «Key saved …0000»).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FAKE_LATE_KEY, startFakeLate } from "../../../../../../GaziyavShell/test/fake-late.mjs";
import { KEY_REFUSED, KEY_WRONG } from "../late";
import { postJob, scheduledTime } from "../post-job";

type Fake = Awaited<ReturnType<typeof startFakeLate>>;
let fake: Fake;
let late: typeof import("../server/late");
let runner: typeof import("../server/late-posts");
let posts: typeof import("../server/posts");
let store: typeof import("../server/store");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "gz-late-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = { title: "Late test", description: "Hello from Gaziyav", hashtags: "#test travel" };

beforeAll(async () => {
	fake = await startFakeLate();
	Object.assign(process.env, { STUDIO_TEST: "1", STUDIO_FAKE_NET: fake.url, STUDIO_TEST_LATE_KEY: FAKE_LATE_KEY, LIPSYNC_HOME: home, STUDIO_FAKE_TIMEOUT: "20" });
	late = await import("../server/late");
	runner = await import("../server/late-posts");
	posts = await import("../server/posts");
	store = await import("../server/store");
});
afterAll(async () => {
	await fake?.close();
	fs.rmSync(home, { recursive: true, force: true });
});

/** What the app's connect window does: open Late's authUrl (the platform's page), follow it back to Gaziyav. */
async function connect(platform: "youtube" | "instagram" | "tiktok", reconnect?: string) {
	const back = "http://127.0.0.1:1/api/share/late/done";
	const authUrl = await late.connectUrl(platform, back, reconnect);
	const u = new URL(authUrl);
	const page = await (await fetch(`${fake.url}/${u.host}${u.pathname}${u.search}`)).text();
	const next = /href="([^"]+)"/.exec(page)?.[1] ?? "";
	const res = await fetch(`${fake.url}${next.replace(/&amp;/g, "&")}`, { redirect: "manual" });
	return { authUrl, location: res.headers.get("location") ?? "" };
}

function video(bytes = 300_000) {
	const id = crypto.randomUUID();
	const dir = path.join(store.shareDir(), "videos");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `${id}.mp4`), crypto.randomBytes(bytes));
	return { id, bytes };
}

async function settled(ids: string[], timeout = 10_000) {
	const end = Date.now() + timeout;
	for (;;) {
		const rows = posts.list().filter((p) => ids.includes(p.id));
		if (rows.every((p) => p.state !== "uploading") || Date.now() > end) return rows;
		await sleep(100);
	}
}

describe("Late on the server, against the stand-in", () => {
	test("connect: Late's connect URL is the platform's own page; it comes back to Gaziyav with the account", async () => {
		const yt = await connect("youtube");
		expect(new URL(yt.authUrl).host).toBe("accounts.google.com");
		expect(yt.location).toStartWith("http://127.0.0.1:1/api/share/late/done?");
		expect(new URL(yt.location).searchParams.get("connected")).toBe("youtube");
		await connect("tiktok");
		await connect("instagram");
		// One profile, made once (Late connects accounts to a profile).
		expect(fake.profiles.length).toBe(1);
		const ask = fake.calls("GET", /\/connect\/youtube$/)[0];
		expect(ask.query.redirect_url).toBe("http://127.0.0.1:1/api/share/late/done");
		expect(ask.query.profileId).toBe(fake.profiles[0]._id);
		const { accounts, error } = await late.lateAccounts(true);
		expect(error).toBeUndefined();
		expect(accounts.map((a) => a.platform).sort()).toEqual(["instagram", "tiktok", "youtube"]);
		expect(accounts.every((a) => a.name && a.avatar?.startsWith("https://"))).toBe(true);
		expect(fake.log.filter((e: { host: string }) => e.host === "zernio.com" && !/callback/.test((e as unknown as { path: string }).path)).every((e: { auth: string }) => e.auth === "key-ok")).toBe(true);
	});

	test("TikTok's options come from its creator info", async () => {
		const tk = (await late.lateAccounts()).accounts.find((a) => a.platform === "tiktok");
		const info = await late.tiktokInfo(tk?.id ?? "");
		expect(info.privacyLevels.map((l) => l.value)).toEqual(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"]);
		expect(info.allow).toEqual({ comment: true, duet: true, stitch: false });
	});

	test("Post now: one upload for all accounts, a post per account, the links", async () => {
		const { accounts } = await late.lateAccounts();
		const yt = accounts.find((a) => a.platform === "youtube");
		const tk = accounts.find((a) => a.platform === "tiktok");
		const v = video();
		const made = runner.createLate({
			video: v.id,
			project: "Project",
			targets: [yt, tk].map((a) => ({ platform: a?.platform as never, accountId: a?.id ?? "", accountName: a?.name })),
			text,
			privacy: "unlisted",
			tiktok: { privacyLevel: "SELF_ONLY", allowComment: true, allowDuet: false, allowStitch: false },
		});
		expect(made.map((p) => p.state)).toEqual(["uploading", "uploading"]);
		const rows = await settled(made.map((p) => p.id));
		const ytRow = rows.find((p) => p.platform === "youtube");
		const tkRow = rows.find((p) => p.platform === "tiktok");
		expect(ytRow?.state).toBe("done");
		expect(ytRow?.url).toStartWith("https://youtube.com/shorts/");
		expect(tkRow?.state).toBe("done");
		expect(tkRow?.stage).toMatch(/few minutes/);
		// The video went up once, whole, to storage — not to the API, no key with it.
		expect(fake.uploads.size).toBe(1);
		const up = [...fake.uploads.values()][0];
		expect(up.bytes).toBe(v.bytes);
		expect(up.length).toBe(v.bytes);
		expect(up.auth).toBe("none");
		expect(up.type).toBe("video/mp4");
		const sent = fake.calls("POST", /\/api\/v1\/posts$/);
		expect(sent.length).toBe(2);
		const ytBody = sent.find((e: { body: { platforms: Array<{ platform: string }> } }) => e.body.platforms[0].platform === "youtube");
		expect(ytBody.idem).toBe(`gaziyav-${ytRow?.id}-0`);
		expect(ytBody.body.platforms[0].platformSpecificData).toEqual({ title: "Late test", visibility: "unlisted", madeForKids: false });
		expect(ytBody.body.publishNow).toBe(true);
		expect(ytBody.body.content).toBe("Hello from Gaziyav\n\n#test #travel");
		// The post's file is no longer kept once every post of it is done.
		expect(fs.existsSync(path.join(store.shareDir(), "videos", `${v.id}.mp4`))).toBe(false);
	});

	test("a refused post: plain words + the platform's text; Retry uses Late's retry and posts it", async () => {
		const ig = (await late.lateAccounts()).accounts.find((a) => a.platform === "instagram");
		fake.mode.fail = 1;
		const [row] = runner.createLate({ video: video().id, project: "Project", targets: [{ platform: "instagram", accountId: ig?.id ?? "" }], text });
		const [failed] = await settled([row.id]);
		expect(failed.state).toBe("failed");
		expect(failed.error).toMatch(/refused this video/);
		expect(failed.errorDetail).toMatch(/Stand-in/);
		await posts.retry(row.id);
		const [again] = await settled([row.id]);
		expect(again.state).toBe("done");
		expect(again.url).toStartWith("https://www.instagram.com/reel/");
		expect(fake.calls("POST", /\/retry$/).length).toBe(1);
	});

	test("Schedule: Late keeps it for its time; Cancel deletes it there", async () => {
		const yt = (await late.lateAccounts()).accounts.find((a) => a.platform === "youtube");
		const at = Date.now() + 3600_000;
		const [row] = runner.createLate({ video: video().id, project: "Project", targets: [{ platform: "youtube", accountId: yt?.id ?? "" }], text, at });
		const [kept] = await settled([row.id]);
		expect(kept.state).toBe("scheduled");
		expect(kept.remoteId).toBeTruthy();
		const sent = fake.calls("POST", /\/api\/v1\/posts$/).at(-1);
		expect(sent.body.scheduledFor).toBe(new Date(at).toISOString());
		expect(sent.body.publishNow).toBeUndefined();
		await posts.cancel(row.id);
		expect(posts.list().find((p) => p.id === row.id)?.state).toBe("cancelled");
		expect(fake.posts.has(kept.remoteId)).toBe(false);
	});

	test("the main process's Share window never takes a Late post", () => {
		expect(posts.due().length).toBe(0);
		const any = posts.list().find((p) => p.via === "late");
		expect(posts.claim(any?.id ?? "")).toBe(false);
	});

	test("Reconnect renews the same account: no duplicate (the sheet's Reconnect dropped the account's id)", async () => {
		const yt = (await late.lateAccounts(true)).accounts.find((a) => a.platform === "youtube");
		fake.expire(yt?.id);
		expect((await late.lateAccounts(true)).accounts.find((a) => a.id === yt?.id)?.reconnect).toBe(true);
		const before = fake.accounts.length;
		await connect("youtube", yt?.id);
		expect(fake.calls("GET", /\/connect\/youtube$/).at(-1).query.reconnectAccountId).toBe(yt?.id);
		expect(fake.accounts.length).toBe(before);
		const after = (await late.lateAccounts()).accounts;
		expect(after.filter((a) => a.platform === "youtube").length).toBe(1);
		expect(after.find((a) => a.id === yt?.id)?.reconnect).toBeUndefined();
	});

	test("an expired sign-in shows at once: fresh asks Late again; a refused post forgets the minute's cache", async () => {
		const ig = (await late.lateAccounts(true)).accounts.find((a) => a.platform === "instagram");
		fake.expire(ig?.id);
		// The cache (60 s) still says connected — what the sheet showed; the sheet now opens with fresh.
		expect((await late.lateAccounts()).accounts.find((a) => a.id === ig?.id)?.reconnect).toBeUndefined();
		expect((await late.lateAccounts(true)).accounts.find((a) => a.id === ig?.id)?.reconnect).toBe(true);
		await connect("instagram", ig?.id);
		expect((await late.lateAccounts()).accounts.find((a) => a.id === ig?.id)?.reconnect).toBeUndefined();
		// A post to an account whose sign-in ran out meanwhile: plain words, and Reconnect shows without the minute.
		fake.expire(ig?.id);
		const [row] = runner.createLate({ video: video().id, project: "Project", targets: [{ platform: "instagram", accountId: ig?.id ?? "" }], text });
		const [failed] = await settled([row.id]);
		expect(failed.state).toBe("failed");
		expect(failed.error).toMatch(/sign-in has expired/);
		expect((await late.lateAccounts()).accounts.find((a) => a.id === ig?.id)?.reconnect).toBe(true);
		await connect("instagram", ig?.id);
	});

	test("Cancel while the video goes up to Late: the upload stops, nothing is posted, the file is let go", async () => {
		const { accounts } = await late.lateAccounts(true);
		const yt = accounts.find((a) => a.platform === "youtube");
		const tk = accounts.find((a) => a.platform === "tiktok");
		const sentBefore = fake.calls("POST", /\/api\/v1\/posts$/).length;
		const uploadsBefore = fake.uploads.size;
		fake.mode.uploadDelay = 1500;
		// (big enough not to fit in the sockets' buffers: Cancel cuts it mid-way, as with a real video)
		const v = video(12_000_000);
		const [row] = runner.createLate({ video: v.id, project: "Project", targets: [{ platform: "youtube", accountId: yt?.id ?? "" }], text });
		expect(posts.list().find((p) => p.id === row.id)?.cancellable).toBe(true);
		expect(postJob(posts.list().find((p) => p.id === row.id) as never, false)).toMatchObject({ status: "running", cancellable: true });
		await sleep(300);
		await posts.cancel(row.id);
		expect(posts.list().find((p) => p.id === row.id)?.state).toBe("cancelled");
		await sleep(1800);
		expect(posts.list().find((p) => p.id === row.id)?.state).toBe("cancelled");
		expect(fake.calls("POST", /\/api\/v1\/posts$/).length).toBe(sentBefore);
		expect(fake.uploads.size).toBe(uploadsBefore);
		expect(fs.existsSync(path.join(store.shareDir(), "videos", `${v.id}.mp4`))).toBe(false);
		// Two accounts in one press, one cancelled: the other still gets the video (one upload) and is posted.
		const two = runner.createLate({ video: video().id, project: "Project", targets: [yt, tk].map((a) => ({ platform: a?.platform as never, accountId: a?.id ?? "", accountName: a?.name })), text, tiktok: { privacyLevel: "SELF_ONLY", allowComment: false, allowDuet: false, allowStitch: false } });
		await posts.cancel(two[1].id);
		fake.mode.uploadDelay = 0;
		const rows = await settled(two.map((p) => p.id));
		expect(rows.find((p) => p.id === two[0].id)?.state).toBe("done");
		expect(rows.find((p) => p.id === two[1].id)?.state).toBe("cancelled");
		expect(fake.uploads.size).toBe(uploadsBefore + 1);
		expect(fake.calls("POST", /\/api\/v1\/posts$/).length).toBe(sentBefore + 1);
		// Once it is being published it can't be stopped: said in plain words, the row goes on.
		await expect(posts.cancel(two[0].id)).rejects.toThrow(/Only a post that hasn't started/);
	});

	test("Schedule: once Late has the post its job line ends («Scheduled for …»), no progress while it waits", async () => {
		const yt = (await late.lateAccounts()).accounts.find((a) => a.platform === "youtube");
		const at = Date.now() + 3600_000;
		const [row] = runner.createLate({ video: video().id, project: "Project", targets: [{ platform: "youtube", accountId: yt?.id ?? "" }], text, at });
		expect(postJob(posts.list().find((p) => p.id === row.id) as never, false)?.status).toBe("running");
		const [kept] = await settled([row.id]);
		expect(kept.state).toBe("scheduled");
		expect(postJob(kept, true)).toEqual({ status: "scheduled", at });
		// (one the page never saw running — an earlier launch — gets no line at all)
		expect(postJob(kept, false)).toBeNull();
		expect(scheduledTime(at)).toMatch(/\d{1,2}[:.]\d{2}/);
		expect(scheduledTime(Date.now() + 3 * 86400_000)).toMatch(/,/);
		await posts.cancel(row.id);
		expect(postJob(posts.list().find((p) => p.id === row.id) as never, true)).toEqual({ status: "gone" });
	});

	test("a wrong key is checked before it is kept: refused in plain words, the key in use untouched", async () => {
		const wrong = await late.checkLateKey("sk_wrong_key_0000000000000000");
		expect(wrong).toMatchObject({ ok: false, error: KEY_WRONG });
		expect(KEY_WRONG).not.toMatch(/Settings → Share/);
		expect(await late.checkLateKey(FAKE_LATE_KEY)).toMatchObject({ ok: true });
		expect(fake.log.filter((e: { auth: string; path: string }) => e.path === "/api/v1/accounts").some((e: { auth: string }) => e.auth === "key-wrong")).toBe(true);
		// The app asks over its message port (main.js keeps the key only on ok).
		const port = process as unknown as { parentPort?: unknown };
		const sent: Array<Record<string, unknown>> = [];
		let onMessage: ((m: unknown) => void) | undefined;
		port.parentPort = { on: (_e: string, f: (m: unknown) => void) => (onMessage = f), postMessage: (m: Record<string, unknown>) => sent.push(m) };
		try {
			late.listenForLateKey();
			onMessage?.({ data: { type: "late-key-check", id: "check-1", key: "sk_wrong_key_0000000000000000" } });
			onMessage?.({ data: { type: "late-key-check", id: "check-2", key: FAKE_LATE_KEY } });
			for (let i = 0; i < 100 && sent.filter((m) => m.type === "late-key-checked").length < 2; i++) await sleep(50);
			expect(sent.find((m) => m.id === "check-1")).toMatchObject({ type: "late-key-checked", ok: false, error: KEY_WRONG });
			expect(sent.find((m) => m.id === "check-2")).toMatchObject({ type: "late-key-checked", ok: true });
			expect(late.lateKeyHint()).toBe(`…${FAKE_LATE_KEY.slice(-4)}`);
		} finally {
			delete port.parentPort;
		}
	});

	test("a saved key Late stops taking: plain words, without «Paste it again in Settings → Share»", async () => {
		process.env.STUDIO_TEST_LATE_KEY = "sk_wrong_key_0000000000000000";
		const r = await late.lateAccounts(true);
		expect(r.error).toBe(KEY_REFUSED);
		expect(r.error).not.toMatch(/Settings → Share/);
		process.env.STUDIO_TEST_LATE_KEY = FAKE_LATE_KEY;
	});
});
