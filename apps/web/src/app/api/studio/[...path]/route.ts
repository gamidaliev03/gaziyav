// Local API of the lipsync pipeline (the app's own server; nothing here is reachable from outside the Mac).
import { agentStep } from "@/studio/server/agent-chat";
import { startGenerateVoice } from "@/studio/server/generate";
import { startFaceSwap } from "@/studio/server/faceswap";
import { startCleanup, startCleanupPreview } from "@/studio/server/cleanup";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeepSeek, type ScriptAction, writeScript } from "@/studio/server/deepseek";
import { explain, StudioError } from "@/studio/server/errors";
import { cloneOrCopy } from "@/studio/server/clone-file";
import { originalFor } from "@/production/server/originals";
import { getFile, mimeFor, newFile, removeFile, withExtension } from "@/studio/server/files";
import { cancelJob, getJob } from "@/studio/server/jobs";
import { parseConvertKind, startConvert } from "@/studio/server/convert";
import { readJournal, removeJournal, writeJournal } from "@/studio/server/journal";
import { probe } from "@/studio/server/media";
import { writeDragCopy } from "@/studio/server/drag-copy";
import { photoMatte } from "@/studio/server/photo-matte";
import { LENGTH_FITS, preflight, startFragment, startLipsync, startVoiceover } from "@/studio/server/pipeline";
import { loadSettings, publicSettings, saveSettings } from "@/studio/server/settings";
import { publicVoices, removeVoice, renameVoice, startVoiceClone } from "@/studio/server/my-voices";
import { type ComponentId, componentStatus, ensureComponent, installedComponent } from "@/studio/server/components";
import { findTool } from "@/studio/server/tools";
import { isPackaged } from "@/platform/paths";
import { installedBrowsers, youtubeInfo, youtubeSearch } from "@/studio/server/youtube";
import { allowedFile, searchLocalFiles } from "@/studio/server/local-files";
import { webSearch } from "@/studio/server/web-search";
import { cached as neuralCached, cachedPath as neuralPath, caps as neuralCaps, parseOp, startNeural, validKey } from "@/studio/server/neural";
import { motionCapabilities, startMotionRender, startTrack } from "@/studio/server/motion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });

function fail(error: unknown) {
	if (error instanceof TypeError) {
		return json({ error: "Invalid request to the app. Reload the window and retry." }, 400);
	}
	// explain() also adds the likely fix to raw tool/provider text (e.g. a link that can't be reached).
	return json({ error: explain(error) }, 400);
}

function tools() {
	const has = (name: string) => {
		try {
			findTool(name);
			return true;
		} catch {
			return false;
		}
	};
	// yt-dlp is fetched on the first import by link (studio/server/components.ts): the packaged app always has it.
	const ytdlp = has("yt-dlp") || installedComponent("yt-dlp") !== null || isPackaged();
	return { ffmpeg: has("ffmpeg") && has("ffprobe"), ytdlp, browsers: installedBrowsers() };
}

// Only the app's own window may call this API: other sites and DNS-rebinding hosts are refused,
// and every write must carry the X-Studio header (a cross-site page can't send it without a CORS preflight).
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request rejected" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request rejected" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request rejected" }, 403);
	return null;
}

async function state() {
	return {
		settings: publicSettings(loadSettings()),
		voices: publicVoices(),
		tools: { ...tools(), localLipsync: { ready: true, secondsPer10s: 40 } },
	};
}

export async function GET(req: Request, ctx: Ctx) {
	const denied = forbidden(req);
	if (denied) return denied;
	const [head, id, arg] = (await ctx.params).path;
	try {
		switch (head) {
			case "components":
				// The helpers fetched on first use (Chrome for motion graphics, yt-dlp): where each one stands.
				return json({ chrome: componentStatus("chrome"), "yt-dlp": componentStatus("yt-dlp") });
			case "neural": {
				// AI effects: what this Mac supports, whether a result is cached, and the cached result itself.
				if (id === "caps") return json(await neuralCaps());
				if (id === "cache") return json({ hit: neuralCached(validKey(arg)) });
				if (id === "file") {
					const p = neuralPath(validKey(arg));
					if (!fs.existsSync(p)) return json({ error: "The AI effect's result is no longer cached. Apply the effect again." }, 404);
					return new Response(Readable.toWeb(fs.createReadStream(p)) as unknown as ReadableStream, {
						headers: { "Content-Type": "video/quicktime", "Content-Length": String(fs.statSync(p).size), "Cache-Control": "no-store" },
					});
				}
				return json({ error: "Unknown request" }, 404);
			}
			case "local-file-info": {
				// the same file, by its place (the window then takes it where it is, through the Mac app: no copy)
				const file = allowedFile(new URL(req.url).searchParams.get("path") ?? "");
				const st = fs.statSync(file);
				return json({ path: file, size: st.size, lastModified: Math.floor(st.mtimeMs) });
			}
			case "local-file": {
				// Gaziyav AI imports the user's own media (a file it found with local-files/search).
				const file = allowedFile(new URL(req.url).searchParams.get("path") ?? "");
				return new Response(Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream, {
					headers: { "Content-Type": "application/octet-stream", "Content-Length": String(fs.statSync(file).size), "Cache-Control": "no-store" },
				});
			}
			case "settings":
				return json(await state());
			case "journal": {
				// "null" (not 404) when there is none: a 404 would log a console error on every open.
				const raw = readJournal(id ?? "") ?? "null";
				return new Response(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
			}
			case "motion":
				return json(await motionCapabilities());
			case "jobs": {
				const job = getJob(id ?? "");
				return job ? json(job) : json({ error: "Job not found — the app may have restarted. Run the step again." }, 404);
			}
			case "file": {
				const f = getFile(id ?? "");
				const size = fs.statSync(f.path).size;
				return new Response(Readable.toWeb(fs.createReadStream(f.path)) as unknown as ReadableStream, {
					headers: {
						"Content-Type": mimeFor(f.path),
						"Content-Length": String(size),
						"Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
						"Cache-Control": "no-store",
					},
				});
			}
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
	if (head === "jobs") return json({ cancelled: cancelJob(id ?? "") });
	if (head === "journal") {
		try {
			removeJournal(id ?? "");
			return json({ ok: true });
		} catch (error) {
			return fail(error);
		}
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
	const parts = (await ctx.params).path;
	const route = parts.join("/");
	try {
		if (route === "upload-path") {
			// perf, 13.11: a clip whose file is on this Mac (an original used where it is — rel3), by its place
			// (studio/client/api.ts uploadFile): every AI step on a clip streamed the whole file through the page and this
			// request, only to have it written again. The same rule as the analysis reading an original where it is
			// (production/server/originals.ts originalFor): a media file at that path with the very size and date the page
			// has — never written to; cloned into the server's files (cp -c: no byte copied on APFS, a copy elsewhere).
			const body = (await req.json().catch(() => null)) as { path?: unknown; name?: unknown; size?: unknown; lastModified?: unknown } | null;
			const from = originalFor({ path: body?.path, size: body?.size, lastModified: body?.lastModified });
			if (!from) throw new StudioError("Not the file the editor has: send its bytes");
			const slot = newFile(typeof body?.name === "string" && body.name ? body.name : path.basename(from));
			try {
				cloneOrCopy(from, slot.path);
				const info = await probe(slot.path);
				const named = withExtension(slot, info);
				return json({ fileId: named.id, name: named.name, duration: info.duration, hasAudio: info.hasAudio, hasVideo: info.hasVideo });
			} catch (error) {
				removeFile(slot.id);
				throw error;
			}
		}

		if (route === "upload") {
			// The clip's file from the editor, streamed as the raw body.
			const name = new URL(req.url).searchParams.get("name") || "clip.mp4";
			if (!req.body) throw new StudioError("Empty file");
			const slot = newFile(name);
			try {
				await pipeline(Readable.fromWeb(req.body as any), fs.createWriteStream(slot.path));
				const info = await probe(slot.path);
				// Editor files are stored under ids with no extension; Apple's frameworks (tracker, AI effects) need one.
				const named = withExtension(slot, info);
				return json({ fileId: named.id, name: named.name, duration: info.duration, hasAudio: info.hasAudio, hasVideo: info.hasVideo });
			} catch (error) {
				removeFile(slot.id);
				throw error;
			}
		}

		if (route === "neural/photo") {
			// A photo's Remove background: the photo as the raw body, the PNG with alpha back.
			const q = new URL(req.url).searchParams;
			let params: Record<string, string | number> = {};
			try {
				params = JSON.parse(q.get("params") || "{}");
			} catch {}
			const file = await photoMatte({ body: req.body as ReadableStream | null, key: q.get("key") || "", params });
			return new Response(fs.readFileSync(file), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
		}

		if (route === "drag-copy") {
			// A Media item dragged out to Finder: its file as the raw body, kept as a copy the Mac app can drag.
			const q = new URL(req.url).searchParams;
			return json(await writeDragCopy({ body: req.body as ReadableStream | null, key: q.get("key") || "", name: q.get("name") || "media", size: Number(q.get("size") || 0), mime: q.get("type") || "" }));
		}

		if (parts[0] === "journal" && parts[1]) {
			// Raw JSON body: the serialized project can be large, keep it as text.
			writeJournal(parts[1], await req.text());
			return json({ ok: true });
		}

		if (route === "convert") {
			// Import proxy: a file the editor can't decode (HEVC, ProRes, HEIC, MKV, Opus…),
			// streamed as the raw body; converted in a job the client polls (jobs/<id>).
			const params = new URL(req.url).searchParams;
			const name = params.get("name") || "media";
			if (!req.body) throw new StudioError("Empty file");
			const slot = newFile(name);
			try {
				await pipeline(Readable.fromWeb(req.body as any), fs.createWriteStream(slot.path));
			} catch (error) {
				removeFile(slot.id);
				throw error;
			}
			return json(startConvert(slot, parseConvertKind(params.get("kind"))));
		}

		if (route === "neural") {
			// AI effect on a clip: the clip's file as the raw body (or `source`, a file sent before for the same clip;
			// or nothing when the result is cached). Runs as a job the editor polls; answers { job, source }.
			const q = new URL(req.url).searchParams;
			const key = validKey(q.get("key"));
			let slot: ReturnType<typeof newFile> | null = null;
			const sourceId = q.get("source");
			if (sourceId) {
				slot = getFile(sourceId);
			} else if (req.body && !neuralCached(key)) {
				slot = newFile(q.get("name") || "clip.mp4");
				try {
					await pipeline(Readable.fromWeb(req.body as any), fs.createWriteStream(slot.path));
				} catch (error) {
					removeFile(slot.id);
					throw error;
				}
			}
			const num = (k: string) => (q.get(k) != null && q.get(k) !== "" && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
			let params: Record<string, string | number> = {};
			try {
				params = JSON.parse(q.get("params") || "{}");
			} catch {}
			const job = startNeural(slot ?? { id: "", name: "", path: "" }, {
				op: parseOp(q.get("op")),
				key,
				params,
				start: num("start"),
				duration: num("duration"),
				length: num("length"),
				title: q.get("title") || undefined,
			});
			return json({ job, source: slot?.id ?? null });
		}

		// components/<id>: start fetching a helper in the background (motion graphics added: Chrome), answer at once.
		if (route === "components/chrome" || route === "components/yt-dlp") {
			const component = route.slice("components/".length) as ComponentId;
			ensureComponent(component).catch(() => {});
			return json(componentStatus(component));
		}

		const body = await req.json().catch(() => ({}));
		switch (route) {
			case "settings":
				saveSettings(body ?? {});
				return json(await state());
			case "voices/rename":
				renameVoice(String(body.id), String(body.name ?? "").trim() || "Voice");
				return json(await state());
			case "voices/delete":
				removeVoice(String(body.id));
				return json(await state());
			case "youtube/info":
				return json(await youtubeInfo(String(body.url ?? ""), req.signal));
			case "youtube/search":
				return json(await youtubeSearch(String(body.query ?? ""), Number(body.count ?? 6), req.signal));
			case "jobs/fragment":
				return json(startFragment(body));
			case "jobs/voice-clone":
				return json(startVoiceClone(body));
			case "jobs/voiceover":
				return json(startVoiceover(body));
			case "agent/chat":
				return json(await agentStep(body, req.signal));
			case "local-files/search":
				return json({ files: searchLocalFiles(String(body.query ?? ""), body.kind ? String(body.kind) : undefined) });
			case "web/search":
				return json({ results: await webSearch(String(body.query ?? ""), body.lang ? String(body.lang) : undefined, req.signal) });
			case "jobs/faceswap":
				return json(startFaceSwap(body));
			case "jobs/cleanup-preview":
				return json(startCleanupPreview(body));
			case "jobs/cleanup":
				return json(startCleanup(body));
			case "jobs/generate-voice":
				return json(startGenerateVoice(body));
			case "prewarm/voice":
				return json({ started: false });
			case "jobs/track":
				return json(startTrack(body ?? {}));
			case "jobs/motion":
				return json(startMotionRender(body ?? {}));
			case "jobs/lipsync":
				return json(startLipsync({ ...body, fit: LENGTH_FITS.includes(body.fit) ? body.fit : "loop", fresh: body.fresh === true }));
			case "preflight":
				return json(await preflight({ ...body, fit: LENGTH_FITS.includes(body.fit) ? body.fit : "loop", signal: req.signal }));
			case "ai/script": {
				const s = loadSettings();
				const ds = new DeepSeek(s.deepseekKey, s.deepseekModel);
				const text = await writeScript(ds, {
					action: body.action as ScriptAction,
					current: String(body.current ?? ""),
					seconds: Number(body.seconds) || 10,
					context: String(body.context ?? ""),
					signal: req.signal,
				});
				return json({ text });
			}
		}
		return json({ error: "Unknown request" }, 404);
	} catch (error) {
		return fail(error);
	}
}
