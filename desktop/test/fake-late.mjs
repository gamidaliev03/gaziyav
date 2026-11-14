// A stand-in for Late (getlate.dev, now Zernio) with the wire format of its API reference (https://zernio.com/openapi.json),
// for the app's self-tests: the app is started with STUDIO_FAKE_NET=<this server>, so every request to the internet
// arrives here as /<host>/<path>. Nothing is posted, nothing leaves the Mac.
//   zernio.com/api/v1: profiles, connect/{platform}, accounts (+ DELETE, tiktok/creator-info), media/presign, posts
//   (publishNow | scheduledFor, Idempotency-Key replay), posts/{id} (GET, DELETE, /retry).
//   The platforms' sign-in pages (accounts.google.com, www.instagram.com, www.tiktok.com): «Allow» is pressed by the
//   page itself after a moment (mode.deny → the person refuses), then Late's callback sends the window to redirect_url.
//   Uploads: PUT to <bucket>.r2.cloudflarestorage.com (no Authorization), served back from media.zernio.com.
//   const late = await startFakeLate(); … late.log, late.mode.fail = 1 (next post fails), late.mode.processing = 2
//   (the post stays «publishing» for 2 GETs), late.mode.uploadDelay = 3000 (storage takes the PUT 3 s later: time to
//   press Cancel), late.expire(accountId) (its sign-in ran out: needsReconnection), late.accounts, late.posts,
//   late.uploads, late.close()
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

export const FAKE_LATE_KEY = "sk_fake_late_0123456789abcdef9f3c";
const API = "/api/v1";
const BUCKET = "fake-bucket.r2.cloudflarestorage.com";
const MEDIA = "media.zernio.com";
const SIGN_IN = { youtube: "accounts.google.com", instagram: "www.instagram.com", tiktok: "www.tiktok.com" };
const SIGN_IN_PATH = { youtube: "/o/oauth2/v2/auth", instagram: "/oauth/authorize", tiktok: "/v2/auth/authorize/" };
const MEDIA_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "video/mp4", "video/mpeg", "video/quicktime", "video/avi", "video/x-msvideo", "video/webm", "video/x-m4v", "application/pdf"];
const PRIVACY = [
	{ value: "PUBLIC_TO_EVERYONE", label: "Public To Everyone" },
	{ value: "MUTUAL_FOLLOW_FRIENDS", label: "Mutual Follow Friends" },
	{ value: "SELF_ONLY", label: "Self Only" },
];

export async function startFakeLate({ dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-late-")) } = {}) {
	const log = [];
	const mode = { fail: 0, processing: 0, deny: false, tiktokUrlAfter: 1, allowStitch: false, uploadDelay: 0 };
	const profiles = [];
	const accounts = [];
	const posts = new Map();
	const uploads = new Map(); // key → { file, type, bytes, auth }
	const presigned = new Map(); // key → contentType
	const states = new Map(); // OAuth state → { platform, profileId, redirect, reconnect }
	const idem = new Map(); // Idempotency-Key → { body, status, response }
	let n = 0;
	const id = () => crypto.randomBytes(12).toString("hex");

	const json = (res, status, body, headers = {}) => {
		res.writeHead(status, { "Content-Type": "application/json", ...headers });
		res.end(JSON.stringify(body));
	};
	const error = (res, status, message, extra = {}) => json(res, status, { error: message, ...extra });
	const read = (req) =>
		new Promise((resolve) => {
			const chunks = [];
			req.on("data", (c) => chunks.push(c));
			req.on("end", () => resolve(Buffer.concat(chunks)));
			// (the client went away mid-body — Cancel during an upload: req.complete stays false)
			req.on("close", () => resolve(Buffer.concat(chunks)));
		});
	const accountOf = (accountId) => accounts.find((a) => a._id === accountId);
	const postUrl = (platform, postId) => (platform === "youtube" ? `https://youtube.com/shorts/${postId.slice(0, 11)}` : platform === "instagram" ? `https://www.instagram.com/reel/${postId.slice(0, 11)}/` : null);

	function publishEntry(entry, post, fail) {
		if (fail) return Object.assign(entry, { status: "failed", errorMessage: "Stand-in: the platform refused the video (too short).", errorCategory: "user_content", errorSource: "user" });
		if (mode.processing > 0) {
			post.processingLeft = mode.processing;
			return Object.assign(entry, { status: "processing" });
		}
		const platformPostId = `${entry.platform}-${id().slice(0, 11)}`;
		return Object.assign(entry, { status: "published", platformPostId, platformPostUrl: postUrl(entry.platform, platformPostId), publishedAt: new Date().toISOString() });
	}
	const settle = (post) => {
		const s = post.platforms.map((e) => e.status);
		post.status = s.every((x) => x === "published") ? "published" : s.every((x) => x === "failed") ? "failed" : s.some((x) => x === "published") && s.some((x) => x === "failed") ? "partial" : s.every((x) => x === "pending") && post.scheduledFor ? "scheduled" : "publishing";
		post.updatedAt = new Date().toISOString();
	};
	const view = (post) => ({ ...post, processingLeft: undefined, polls: undefined, platforms: post.platforms.map((e) => ({ ...e, accountId: accountOf(e.accountId) ?? e.accountId })) });

	/** POST /v1/posts — checks what Late's reference requires, then publishes now or keeps it for its time. */
	function createPost(body) {
		if (!Array.isArray(body.platforms) || !body.platforms.length) return [400, { error: "platforms is required for non-draft posts", code: "INVALID_FIELD_VALUE" }];
		for (const t of body.platforms) {
			if (!t.platform || !t.accountId) return [400, { error: "Each platform needs platform and accountId", code: "INVALID_FIELD_VALUE" }];
			const a = accountOf(t.accountId);
			if (!a || a.platform !== t.platform) return [403, { error: "Account not found or not yours" }];
			if (a.isActive === false) return [403, { error: "The account is disconnected", code: "ACCOUNT_DISCONNECTED" }];
			if (t.platform === "tiktok") {
				const d = { ...(body.tiktokSettings ?? {}), ...(t.platformSpecificData ?? {}) };
				const level = d.privacyLevel ?? d.privacy_level;
				if (!PRIVACY.some((p) => p.value === level)) return [400, { error: "privacyLevel must be one of the creator's privacy levels", code: "INVALID_FIELD_VALUE", param: "privacyLevel" }];
				if ((d.contentPreviewConfirmed ?? d.content_preview_confirmed) !== true || (d.expressConsentGiven ?? d.express_consent_given) !== true) return [400, { error: "TikTok requires contentPreviewConfirmed and expressConsentGiven", code: "INVALID_FIELD_VALUE" }];
				if (typeof (d.allowDuet ?? d.allow_duet) !== "boolean" || typeof (d.allowStitch ?? d.allow_stitch) !== "boolean") return [400, { error: "allowDuet and allowStitch are required for video posts", code: "INVALID_FIELD_VALUE" }];
			}
			if (t.platform === "youtube" && t.platformSpecificData?.title && t.platformSpecificData.title.length > 100) return [400, { error: "YouTube title must be 100 characters or fewer", code: "INVALID_FIELD_VALUE" }];
		}
		for (const m of body.mediaItems ?? []) {
			const key = String(m.url ?? "").replace(`https://${MEDIA}/`, "");
			if (!/^https:\/\//.test(String(m.url ?? "")) || !uploads.has(key)) return [400, { error: `Media URL is not reachable: ${m.url}`, code: "INVALID_FIELD_VALUE" }];
		}
		const fail = mode.fail > 0 ? mode.fail-- > 0 : false;
		const post = {
			_id: id(),
			title: body.title,
			content: body.content ?? "",
			mediaItems: body.mediaItems ?? [],
			tags: body.tags ?? [],
			timezone: body.timezone ?? "UTC",
			scheduledFor: body.publishNow ? undefined : body.scheduledFor,
			platforms: body.platforms.map((t) => ({ platform: t.platform, accountId: t.accountId, ...(t.platformSpecificData ? { platformSpecificData: t.platformSpecificData } : {}), status: "pending" })),
			createdAt: new Date().toISOString(),
			polls: 0,
		};
		posts.set(post._id, post);
		if (body.publishNow) {
			for (const e of post.platforms) publishEntry(e, post, fail);
			settle(post);
			if (post.status === "failed" || post.status === "partial") return [207, { post: view(post), message: "Post failed to publish", ...(post.status === "failed" ? { error: "No platform published" } : {}), platformResults: post.platforms.map((e) => ({ platform: e.platform, status: e.status, error: e.errorMessage ?? null })) }];
			return [201, { post: view(post), message: post.status === "published" ? "Post published successfully" : "Post is publishing" }];
		}
		if (!body.scheduledFor) return [400, { error: "scheduledFor or publishNow is required", code: "INVALID_FIELD_VALUE" }];
		settle(post);
		return [201, { post: view(post), message: "Post scheduled successfully" }];
	}

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, "http://x");
		const [, host, ...rest] = url.pathname.split("/");
		const p = `/${rest.join("/")}`;
		const auth = req.headers.authorization ?? "";
		if (mode.uploadDelay && host === BUCKET && req.method === "PUT") await new Promise((r) => setTimeout(r, mode.uploadDelay));
		const body = await read(req);
		const entry = { method: req.method, host, path: p, query: Object.fromEntries(url.searchParams), auth: auth.startsWith("Bearer ") ? (auth === `Bearer ${FAKE_LATE_KEY}` ? "key-ok" : "key-wrong") : auth ? "other" : "none", idem: req.headers["idempotency-key"], at: Date.now() };
		log.push(entry);
		try {
			// ── storage: the presigned PUT (no Authorization), and the public file
			if (host === BUCKET && req.method === "PUT") {
				const key = p.slice(1);
				if (!req.complete) return res.destroy();
				if (!presigned.has(key)) return error(res, 403, "SignatureDoesNotMatch");
				if (req.headers["content-type"] !== presigned.get(key)) return error(res, 403, "Content-Type differs from the presigned one");
				const file = path.join(dir, key.replace(/\//g, "_"));
				fs.writeFileSync(file, body);
				uploads.set(key, { file, type: req.headers["content-type"], bytes: body.length, auth: entry.auth, length: Number(req.headers["content-length"] ?? -1) });
				entry.bytes = body.length;
				res.writeHead(200, { ETag: `"${crypto.createHash("md5").update(body).digest("hex")}"` });
				return res.end();
			}
			if (host === MEDIA && req.method === "GET") {
				const u = uploads.get(p.slice(1));
				if (!u) return error(res, 404, "Not found");
				res.writeHead(200, { "Content-Type": u.type, "Content-Length": u.bytes });
				return fs.createReadStream(u.file).pipe(res);
			}
			// ── the platforms' own sign-in pages (what Late's authUrl opens): «Allow» presses itself
			const platform = Object.keys(SIGN_IN).find((k) => SIGN_IN[k] === host);
			if (platform && req.method === "GET") {
				const state = url.searchParams.get("state") ?? "";
				const next = `/zernio.com/api/v1/connect/${platform}/callback?state=${encodeURIComponent(state)}&${mode.deny ? "error=access_denied" : "code=fake-code"}`;
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				return res.end(`<!doctype html><meta charset="utf-8"><title>Sign in</title><h1>Sign in to ${platform}</h1><p>Late wants to post videos for you.</p><a id="allow" href="${next}">Allow</a><script>setTimeout(() => document.getElementById('allow').click(), 400)</script>`);
			}
			if (host === "zernio.com" && /^\/api\/v1\/connect\/(youtube|instagram|tiktok)\/callback$/.test(p)) {
				const st = states.get(url.searchParams.get("state") ?? "");
				if (!st) return error(res, 400, "Unknown state");
				const q = new URLSearchParams();
				if (url.searchParams.get("error")) {
					q.set("error", "oauth_denied");
					q.set("platform", st.platform);
					q.set("error_message", "The user refused the permissions");
				} else {
					let a = st.reconnect ? accountOf(st.reconnect) : null;
					if (a) Object.assign(a, { isActive: true, needsReconnection: false });
					else {
						const k = ++n;
						a = { _id: id(), platform: st.platform, profileId: st.profileId, username: `${st.platform}_tester${k}`, displayName: `${st.platform === "youtube" ? "Test Channel" : st.platform === "instagram" ? "Test Insta" : "Test Tok"} ${k}`, profilePicture: `https://cdn.example.com/avatar-${st.platform}.jpg`, profileUrl: `https://example.com/${st.platform}`, isActive: true, enabled: true, needsReconnection: false };
						accounts.push(a);
					}
					q.set("connected", st.platform);
					q.set("profileId", st.profileId);
					q.set("accountId", a._id);
					q.set("username", a.username);
				}
				q.set("request_id", id());
				q.set("stage", "complete");
				const to = new URL(st.redirect);
				for (const [k, v] of q) to.searchParams.set(k, v);
				res.writeHead(302, { Location: to.toString() });
				return res.end();
			}
			// ── the API: every call needs the key
			if (host !== "zernio.com" || !p.startsWith(API)) return error(res, 404, `the stand-in doesn't know ${host}${p}`);
			if (entry.auth !== "key-ok") return json(res, 401, { error: auth ? "Invalid API key" : "Missing API key. Send it as Authorization: Bearer <your API key>.", type: "authentication_error", code: auth ? "invalid_credentials" : "missing_credentials", docUrl: "https://docs.zernio.com" });
			const r = p.slice(API.length);
			const ask = body.length ? JSON.parse(body.toString()) : {};
			if (req.method !== "GET") entry.body = ask;
			let m;
			if (r === "/profiles" && req.method === "GET") return json(res, 200, { profiles });
			if (r === "/profiles" && req.method === "POST") {
				if (!ask.name) return error(res, 400, "name is required");
				const profile = { _id: id(), name: ask.name, isDefault: profiles.length === 0, createdAt: new Date().toISOString() };
				profiles.push(profile);
				return json(res, 201, { message: "Profile created", profile });
			}
			if ((m = /^\/connect\/([a-z]+)$/.exec(r)) && req.method === "GET") {
				const pf = m[1];
				const profileId = url.searchParams.get("profileId") ?? "";
				const redirect = url.searchParams.get("redirect_url") ?? "";
				if (!SIGN_IN[pf]) return error(res, 400, "Unsupported platform");
				if (!profiles.some((x) => x._id === profileId)) return error(res, 404, "Profile not found");
				if (redirect && !/^(https?:\/\/|[a-z][\w+.-]*:\/\/)/.test(redirect)) return error(res, 400, "redirect_url must be absolute", { code: "INVALID_REDIRECT_URL" });
				const state = id();
				states.set(state, { platform: pf, profileId, redirect, reconnect: url.searchParams.get("reconnectAccountId") || null });
				return json(res, 200, { authUrl: `https://${SIGN_IN[pf]}${SIGN_IN_PATH[pf]}?client_id=late-fake&response_type=code&state=${state}`, state });
			}
			if (r === "/accounts" && req.method === "GET") return json(res, 200, { accounts, hasAnalyticsAccess: false });
			if ((m = /^\/accounts\/([\w-]+)\/tiktok\/creator-info$/.exec(r)) && req.method === "GET") {
				const a = accountOf(m[1]);
				if (!a || a.platform !== "tiktok") return error(res, 404, "Account not found");
				return json(res, 200, { creator: { nickname: a.displayName, avatarUrl: a.profilePicture, isVerified: false, canPostMore: true }, privacyLevels: PRIVACY, postingLimits: { maxVideoDurationSec: 600, interactionSettings: { allow_comment: { enabled: true }, allow_duet: { enabled: true }, allow_stitch: { enabled: mode.allowStitch } } } });
			}
			if ((m = /^\/accounts\/([\w-]+)$/.exec(r)) && req.method === "DELETE") {
				const i = accounts.findIndex((a) => a._id === m[1]);
				if (i < 0) return error(res, 404, "Account not found");
				accounts.splice(i, 1);
				return json(res, 200, { message: "Account disconnected successfully" });
			}
			if (r === "/media/presign" && req.method === "POST") {
				if (!ask.filename || !MEDIA_TYPES.includes(ask.contentType)) return error(res, 400, "contentType is not supported", { code: "INVALID_FIELD_VALUE", param: "contentType" });
				if (ask.size > 5 * 1024 ** 3) return error(res, 400, "File too large (5GB max)");
				const key = `temp/${Date.now()}_${id().slice(0, 6)}_${String(ask.filename).replace(/[^\w.-]/g, "_")}`;
				presigned.set(key, ask.contentType);
				return json(res, 200, { uploadUrl: `https://${BUCKET}/${key}?X-Amz-Signature=fake`, publicUrl: `https://${MEDIA}/${key}`, key, expiresIn: 3600 });
			}
			if (r === "/posts" && req.method === "POST") {
				const key = entry.idem;
				const raw = JSON.stringify(ask);
				if (key && idem.has(key)) {
					const was = idem.get(key);
					if (was.body !== raw) return error(res, 422, "Idempotency-Key reused with a different body", { code: "idempotency_key_reused" });
					entry.replayed = true;
					return json(res, 200, { ...was.response, message: "Post already exists (idempotent retry)" });
				}
				const [status, response] = createPost(ask);
				entry.status = status;
				if (key && status < 300) idem.set(key, { body: raw, status, response });
				return json(res, status, response);
			}
			if ((m = /^\/posts\/([\w-]+)(\/retry)?$/.exec(r))) {
				const post = posts.get(m[1]);
				if (!post) return error(res, 404, "Post not found");
				if (m[2] && req.method === "POST") {
					if (post.status !== "failed" && post.status !== "partial") return error(res, 400, "Only failed posts can be retried");
					for (const e of post.platforms) if (e.status === "failed") publishEntry(Object.assign(e, { errorMessage: undefined, errorCategory: undefined, errorSource: undefined }), post, false);
					settle(post);
					return json(res, 200, { message: "Post published successfully", post: view(post) });
				}
				if (req.method === "GET") {
					post.polls++;
					if (post.processingLeft > 0 && --post.processingLeft === 0) for (const e of post.platforms) if (e.status === "processing") publishEntry(e, post, false);
					for (const e of post.platforms) if (e.platform === "tiktok" && e.status === "published" && !e.platformPostUrl && post.polls >= mode.tiktokUrlAfter) e.platformPostUrl = `https://www.tiktok.com/@${accountOf(e.accountId)?.username ?? "user"}/video/7${String(Date.now()).slice(-12)}`;
					settle(post);
					return json(res, 200, { post: view(post) });
				}
				if (req.method === "DELETE") {
					if (post.status === "published") return error(res, 400, "Cannot delete published posts");
					posts.delete(post._id);
					return json(res, 200, { message: "Post deleted successfully" });
				}
			}
			return error(res, 404, `the stand-in doesn't know ${req.method} ${r}`);
		} catch (err) {
			return error(res, 500, String(err?.message ?? err));
		}
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const port = server.address().port;
	return {
		url: `http://127.0.0.1:${port}`,
		dir,
		log,
		mode,
		profiles,
		accounts,
		posts,
		uploads,
		/** The account's sign-in ran out (Late: needsReconnection; a post to it is refused ACCOUNT_DISCONNECTED). */
		expire: (accountId) => Object.assign(accountOf(accountId) ?? {}, { needsReconnection: true, isActive: false }),
		/** The API calls (zernio.com) matching a method and a path pattern. */
		calls: (method, re) => log.filter((e) => e.host === "zernio.com" && e.method === method && re.test(e.path)),
		close: () => new Promise((r) => server.close(() => r())),
	};
}
