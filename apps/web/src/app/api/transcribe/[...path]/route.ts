// Local speech recognition API (whisper.cpp on this Mac; nothing leaves the computer).
//   GET    /api/transcribe/status     → { available, model?, reason? }
//   POST   /api/transcribe/upload     → raw audio/video body → { fileId, duration }
//   POST   /api/transcribe/jobs       → { fileId, language } → JobState (result: words, speech, language, duration)
//   GET    /api/transcribe/jobs/:id   → JobState
//   DELETE /api/transcribe/jobs/:id   → cancels (kills whisper-cli)
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { explain, StudioError } from "@/studio/server/errors";
import { newFile, removeFile } from "@/studio/server/files";
import { cancelJob, getJob } from "@/studio/server/jobs";
import { startTranscribe } from "@/transcribe/server/job";
import { engineStatus, warmUp } from "@/transcribe/server/whisper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

function fail(error: unknown) {
	if (error instanceof TypeError) {
		return json({ error: "Invalid request. Reload the window (⌘⇧P) and try again." }, 400);
	}
	return json({ error: error instanceof StudioError ? error.message : explain(error) }, 400);
}

// Same guard as /api/studio: only the app's own window, never other sites or DNS-rebinding hosts;
// writes must carry X-Studio (a cross-site page can't send it without a CORS preflight).
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

const JOB_GONE = "Job not found (the app may have restarted). Start the transcription again.";

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id] = (await ctx.params).path;
	try {
		if (head === "status") {
			const status = engineStatus();
			if (status.available) warmUp();
			return json(status);
		}
		if (head === "jobs") {
			const job = getJob(id ?? "");
			return job && job.kind === "transcribe" ? json(job) : json({ error: JOB_GONE }, 404);
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}

export async function DELETE(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id] = (await ctx.params).path;
	if (head === "jobs") {
		const job = getJob(id ?? "");
		if (!job || job.kind !== "transcribe") return json({ cancelled: false });
		return json({ cancelled: cancelJob(job.id) });
	}
	if (head === "file") {
		removeFile(id ?? "");
		return json({ ok: true });
	}
	return json({ error: "Unknown request" }, 404);
}

export async function POST(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const route = (await ctx.params).path.join("/");
	try {
		if (route === "upload") {
			const name = new URL(req.url).searchParams.get("name") || "audio.wav";
			if (!req.body) throw new StudioError("Empty file");
			const slot = newFile(name);
			try {
				await pipeline(Readable.fromWeb(req.body as any), fs.createWriteStream(slot.path));
				if (fs.statSync(slot.path).size === 0) throw new StudioError("Empty file");
				return json({ fileId: slot.id });
			} catch (error) {
				removeFile(slot.id);
				throw error;
			}
		}
		const body = await req.json().catch(() => ({}));
		if (route === "jobs") return json(await startTranscribe(body ?? {}));
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}
