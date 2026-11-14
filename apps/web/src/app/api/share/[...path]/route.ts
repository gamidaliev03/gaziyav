// Share → Post: the videos the sheet exports, the posts and their queue. The posting itself happens in the Mac app's
//   GET  /api/share/state                  → { posts }
//   GET  /api/share/sites                  → the site recipes (share/sites/*.ts)
//   GET  /api/share/due                    → posts to publish now, with their file   (the Share window)
//   POST /api/share/claim   { id }         → { ok }                                   (the Share window)
//   POST /api/share/report  { id, state, progress, stage, url, error }                 (the Share window)
//   POST /api/share/video                  raw MP4 → { id }          (kept for its posts)
//   POST /api/share/post                   { video, project, platforms, text, privacy, at } → { posts }
//   POST /api/share/write   { material, platforms, lang } → { title, description, hashtags } | { error, setup }
//   POST /api/share/retry | cancel | remove  { id }
// Late (getlate.dev, now Zernio) — the main path when its API key is saved (Settings → Share; the key itself stays in
// the app and reaches this server as a message, see share/server/late.ts):
//   GET  /api/share/state?fresh=1          → { posts, late: { key, hint, accounts, error } }
//   POST /api/share/late/connect  { platform, reconnect? } → { authUrl }  (the app opens it in a Gaziyav window)
//   GET  /api/share/late/done              ← where Late sends that window back (the app closes it)
//   POST /api/share/late/disconnect { accountId }
//   GET  /api/share/late/tiktok?account=   → TikTok's own options for that account (who can watch, interactions)
//   POST /api/share/post { …, targets: [{ platform, accountId, accountName }], tiktok } → { posts } (through Late)
import { StudioError, explain } from "@/studio/server/errors";
import * as posts from "@/share/server/posts";
import { writeCaption } from "@/share/server/caption-writer";
import { isRenderedFile, renderedStream } from "@/export/server/rendered-file";
import { saveVideo } from "@/share/server/store";
import { NOT_SET_UP } from "@/studio/server/agent-keys";
import { SITES } from "@/share/sites";
import * as late from "@/share/server/late";
import { createLate } from "@/share/server/late-posts";
import type { LateView } from "@/share/types";

const LATE_PLATFORMS = new Set(["youtube", "instagram", "tiktok"]);

async function lateView(fresh: boolean): Promise<LateView> {
	const key = !!late.lateKey();
	const { accounts, error } = key ? await late.lateAccounts(fresh) : { accounts: [], error: undefined };
	return { key, hint: late.lateKeyHint(), accounts, ...(error ? { error } : {}) };
}

/** The page Late sends the connect window back to (the app closes the window as soon as it gets here). */
const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Gaziyav</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;margin:0;color:#888"><p>Done — you can close this window. · Готово — окно можно закрыть.</p></body>`;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (error: unknown) => json({ error: error instanceof StudioError ? error.message : explain(error), ...(error instanceof late.LateError && error.detail ? { detail: error.detail } : {}) }, 400);

// Only the app itself (its window, or its main process from 127.0.0.1); writes carry X-Studio.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	posts.startScheduler();
	const route = (await ctx.params).path.join("/");
	if (route === "state") return json({ posts: posts.list(), late: await lateView(new URL(req.url).searchParams.get("fresh") === "1") });
	if (route === "late/done") return new Response(DONE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
	if (route === "late/tiktok") {
		try {
			return json(await late.tiktokInfo(String(new URL(req.url).searchParams.get("account") ?? "")));
		} catch (error) {
			return fail(error);
		}
	}
	if (route === "sites") return json(SITES);
	if (route === "due") return json({ posts: posts.due() });
	return json({ error: "Unknown request" }, 404);
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	posts.startScheduler();
	const route = (await ctx.params).path.join("/");
	try {
		if (route === "video") {
			// a long render is already on disk: read from there, not through the page's memory
			const from = new URL(req.url).searchParams.get("from");
			if (from && !isRenderedFile(from)) return json({ error: "The rendered file is gone. Post again." }, 400);
			return json({ id: (await saveVideo(from ? renderedStream(from) : req.body)).id });
		}
		const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
		const id = String(body.id ?? "");
		switch (route) {
			case "post": {
				const text = (body.text ?? {}) as Record<string, unknown>;
				if (Array.isArray(body.targets)) {
					const tk = (body.tiktok ?? null) as Record<string, unknown> | null;
					const made = createLate({
						video: String(body.video ?? ""),
						project: String(body.project ?? "Video"),
						targets: (body.targets as Array<Record<string, unknown>>).map((t) => ({ platform: String(t?.platform ?? "") as never, accountId: String(t?.accountId ?? ""), accountName: String(t?.accountName ?? "") })),
						text: { title: String(text.title ?? ""), description: String(text.description ?? ""), hashtags: String(text.hashtags ?? "") },
						privacy: body.privacy === "private" || body.privacy === "unlisted" ? body.privacy : "public",
						tiktok: tk ? { privacyLevel: String(tk.privacyLevel ?? ""), allowComment: tk.allowComment === true, allowDuet: tk.allowDuet === true, allowStitch: tk.allowStitch === true } : undefined,
						at: typeof body.at === "number" ? body.at : null,
					});
					return json({ posts: made });
				}
				const made = posts.create({
					video: String(body.video ?? ""),
					project: String(body.project ?? "Video"),
					platforms: Array.isArray(body.platforms) ? (body.platforms as never[]) : [],
					text: { title: String(text.title ?? ""), description: String(text.description ?? ""), hashtags: String(text.hashtags ?? "") },
					privacy: body.privacy === "private" || body.privacy === "unlisted" ? body.privacy : "public",
					at: typeof body.at === "number" ? body.at : null,
				});
				return json({ posts: made });
			}
			case "write": {
				// A person's problem (no AI set up, nothing to write from) answers 200 + error, not a failed request.
				try {
					return json(await writeCaption({ material: String(body.material ?? ""), platforms: Array.isArray(body.platforms) ? (body.platforms as never[]) : [], lang: body.lang === "ru" ? "ru" : "en", signal: req.signal }));
				} catch (error) {
					const message = error instanceof Error ? error.message : "Gaziyav AI couldn't write it. Try again.";
					return json({ error: message, setup: message === NOT_SET_UP });
				}
			}
			case "claim":
				return json({ ok: posts.claim(id) });
			case "report":
				posts.report(id, body as never);
				return json({ ok: true });
			case "late/connect": {
				const platform = String(body.platform ?? "");
				if (!LATE_PLATFORMS.has(platform)) throw new StudioError("Unknown service.");
				const host = req.headers.get("host") ?? "127.0.0.1";
				const authUrl = await late.connectUrl(platform as never, `http://${host}/api/share/late/done`, typeof body.reconnect === "string" && body.reconnect ? body.reconnect : undefined);
				return json({ authUrl });
			}
			case "late/disconnect":
				await late.disconnect(String(body.accountId ?? ""));
				return json({ late: await lateView(true) });
			case "retry":
				await posts.retry(id);
				return json({ posts: posts.list() });
			case "cancel":
				await posts.cancel(id);
				return json({ posts: posts.list() });
			case "remove":
				posts.remove(id);
				return json({ posts: posts.list() });
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}
