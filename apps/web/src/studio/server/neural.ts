// On-device AI video effects, ported from Kadr: Remove Background (Apple Vision person segmentation),
// Enhance / Denoise (Core Image) and Upscale (MetalFX spatial scaler, Lanczos fallback). The bundled
// `neuralfx` helper does the work on the GPU and Neural Engine with VideoToolbox decode/encode, at a
// lowered priority. Results are cached by a key the editor computes from the clip and the settings, so
// applying the same effect again (or redoing it) is instant. The clip's own media is never modified.
// The same cache and jobs serve the AI tools on a clip's sound and the face retouch (audio-ai.ts).
import fs from "node:fs";
import path from "node:path";
import { CancelledError, StudioError } from "./errors";
import { dataDir, type StoredFile } from "./files";
import { type AudioOp, isAudioOp, runAudioOp, runRetouch } from "./audio-ai";
import { type Job, startJob, type JobState } from "./jobs";
import { isVideoOp, runVideoOp, type VideoOp } from "./video-ai";
import { probe } from "./media";
import { findTool, reason, run } from "./tools";
import { IS_WINDOWS } from "@/platform/os";

export type NeuralOp = "matte" | "enhance" | "upscale" | "retouch" | AudioOp | VideoOp;

export interface NeuralRequest {
	op: NeuralOp;
	key: string;
	/** Helper options without the leading "--": mode, color, blur, feather, edge, quality, preset, level, sharpness, scale, engine. */
	params: Record<string, string | number>;
	/** The piece of the source to process (seconds); whole file when absent. */
	start?: number;
	duration?: number;
	/** Seconds of video, for the timeout and the job title. */
	length?: number;
	title?: string;
}

export interface NeuralResult {
	key: string;
	cached: boolean;
	width: number;
	height: number;
	frames: number;
	seconds: number;
	fps: number;
	codec: string;
	engine: string;
	alpha: boolean;
	msPerFrame?: Record<string, number>;
}

const OPTION_KEYS = new Set(["mode", "color", "blur", "feather", "edge", "quality", "preset", "level", "sharpness", "scale", "engine", "maskfps", "strength"]);
const KEEP_DAYS = 14;
const KEEP_BYTES = 20 * 1024 ** 3;

export function parseOp(value: string | null): NeuralOp {
	if (value === "matte" || value === "enhance" || value === "upscale" || value === "retouch") return value;
	if (value && (isAudioOp(value) || isVideoOp(value))) return value;
	throw new StudioError("Unknown AI effect");
}

export function validKey(key: string | null | undefined): string {
	if (!key || !/^[0-9a-f]{16,64}$/.test(key)) throw new StudioError("Invalid AI effect key");
	return key;
}

let cleaned = false;
function cacheDir(): string {
	const dir = path.join(dataDir(), "ai-effects");
	fs.mkdirSync(dir, { recursive: true });
	if (!cleaned) {
		cleaned = true;
		prune(dir);
	}
	return dir;
}

/** Old results go after two weeks, and the oldest first when the folder grows past 20 GB. */
function prune(dir: string) {
	try {
		const now = Date.now();
		const files = fs
			.readdirSync(dir)
			.map((name) => {
				const p = path.join(dir, name);
				const st = fs.statSync(p);
				return { p, size: st.size, mtime: st.mtimeMs };
			})
			.sort((a, b) => b.mtime - a.mtime);
		let total = 0;
		for (const f of files) {
			total += f.size;
			if (now - f.mtime > KEEP_DAYS * 86400_000 || total > KEEP_BYTES || path.basename(f.p).startsWith(".")) {
				fs.rmSync(f.p, { force: true });
			}
		}
	} catch {}
}

export function cachedPath(key: string): string {
	return path.join(cacheDir(), `${validKey(key)}.mov`);
}

function infoPath(key: string): string {
	return path.join(cacheDir(), `${validKey(key)}.json`);
}

/** The cached result for `key`, or null. A hit is touched so it stays the longest. */
export function cached(key: string): NeuralResult | null {
	const file = cachedPath(key);
	try {
		if (!fs.existsSync(file) || fs.statSync(file).size === 0) return null;
		const info = JSON.parse(fs.readFileSync(infoPath(key), "utf8")) as NeuralResult;
		const now = new Date();
		fs.utimesSync(file, now, now);
		return { ...info, cached: true };
	} catch {
		return null;
	}
}

function helper(): string {
	try {
		return findTool("neuralfx");
	} catch {
		throw new StudioError(IS_WINDOWS ? "AI effects aren't available on Windows yet." : "On-device AI effects aren't part of this build. Reinstall Gaziyav.");
	}
}

let capsPromise: Promise<Record<string, unknown>> | null = null;
/** What this Mac can do: MetalFX, HEVC with alpha, the GPU name. */
export function caps(): Promise<Record<string, unknown>> {
	capsPromise ??= (async () => {
		try {
			const r = await run(helper(), ["caps"], { timeout: 20 });
			return { available: r.status === 0, ...(JSON.parse(r.stdout.trim().split("\n").pop() || "{}") as object) };
		} catch {
			return { available: false };
		}
	})();
	return capsPromise;
}

// One AI effect at a time per lane, so queued effects never heat the Mac up together: the effects the user is
// waiting for, and the background lane (Remove Background's accurate copy for export), which never holds them up.
type Lane = "interactive" | "background";
const lanes: Record<Lane, Promise<unknown>> = { interactive: Promise.resolve(), background: Promise.resolve() };
function exclusive<T>(lane: Lane, op: () => Promise<T>): Promise<T> {
	const next = lanes[lane].then(op, op);
	lanes[lane] = next.catch(() => {});
	return next;
}

/**
 * A path Apple's media framework can read. It picks the reader by file extension, and the editor's stored files
 * may have none: MP4/QuickTime data gets a ".mov" link; anything else (WebM, MKV…) becomes an intermediate
 * H.264 movie first (VideoToolbox, high quality), kept next to the upload.
 */
async function readableSource(file: string, signal: AbortSignal): Promise<string> {
	const ext = path.extname(file).toLowerCase();
	const head = Buffer.alloc(12);
	const fd = fs.openSync(file, "r");
	try {
		fs.readSync(fd, head, 0, 12, 0);
	} finally {
		fs.closeSync(fd);
	}
	const box = head.toString("latin1", 4, 8);
	const isoMedia = ["ftyp", "moov", "wide", "mdat", "free", "skip"].includes(box);
	if (isoMedia && [".mov", ".mp4", ".m4v", ".qt"].includes(ext)) return file;
	if (isoMedia) {
		const link = `${file}.mov`;
		if (!fs.existsSync(link)) fs.symlinkSync(path.basename(file), link);
		return link;
	}
	const mezz = `${file}.mezz.mov`;
	if (fs.existsSync(mezz) && fs.statSync(mezz).size > 0) return mezz;
	const r = await run(
		findTool("ffmpeg"),
		["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "h264_videotoolbox", "-q:v", "80", "-allow_sw", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", `${mezz}.part.mov`],
		{ timeout: 3600, signal },
	);
	if (r.status !== 0) throw new StudioError(`This clip's format can't be read for the AI effect: ${reason(r)}`);
	fs.renameSync(`${mezz}.part.mov`, mezz);
	return mezz;
}

/** Retouch and the sound tools: the same cache (the result under `key`; Separate's music under `params.musicKey`). */
async function runTool(source: StoredFile, req: NeuralRequest, key: string, job: Job, signal: AbortSignal): Promise<NeuralResult> {
	const out = cachedPath(key);
	const musicKey = req.params.musicKey ? validKey(String(req.params.musicKey)) : undefined;
	const extraOut = musicKey ? cachedPath(musicKey) : undefined;
	try {
		const work = { source: source.path, out, params: req.params, extraOut, start: req.start, duration: req.duration, job, signal };
		const done =
			req.op === "retouch"
				? await runRetouch({ ...work, source: await readableSource(source.path, signal) })
				: isVideoOp(req.op)
					? await runVideoOp(req.op, work)
					: await runAudioOp(req.op as AudioOp, work);
		const result: NeuralResult = { key, cached: false, width: done.width, height: done.height, frames: 0, seconds: done.seconds, fps: 0, codec: done.width ? "h264" : "aac", engine: done.engine, alpha: false };
		if (musicKey) fs.writeFileSync(infoPath(musicKey), JSON.stringify({ ...result, key: musicKey, width: 0, height: 0, codec: "aac" }));
		fs.writeFileSync(infoPath(key), JSON.stringify(result));
		return result;
	} catch (error) {
		fs.rmSync(out, { force: true });
		if (extraOut) fs.rmSync(extraOut, { force: true });
		throw error;
	}
}

/**
 * Self-tests only (STUDIO_TEST=1 STUDIO_TEST_NEURAL=stub): every AI effect is a 3-second stand-in with progress, Cancel
 * and a real result file (ffmpeg: the clip in grey, or its sound at half volume; Separate's music too), so the AI panels
 * can be driven end to end without a model heating the Mac.
 */
const STUB = process.env.STUDIO_TEST === "1" && process.env.STUDIO_TEST_NEURAL === "stub";

async function stubEffect(source: StoredFile, req: NeuralRequest, key: string, job: Job, signal: AbortSignal): Promise<NeuralResult> {
	// A real process stands in for the model (a shell loop, STUDIO_TEST_NEURAL_SECONDS long, 3 s unless set): it goes
	// through run({ heavy }) like a model, so the thermal pause (SIGSTOP) and the priority can be seen on it (test/thermal.mjs).
	const steps = 10;
	const seconds = Number(process.env.STUDIO_TEST_NEURAL_SECONDS) || 3;
	const script = `: gaziyav-stub-model; i=0; while [ $i -lt ${steps} ]; do i=$((i+1)); echo "PROGRESS $i"; sleep ${(seconds / steps).toFixed(2)}; done`;
	const loop = await run("/bin/sh", ["-c", script], {
		heavy: true,
		timeout: 600,
		signal,
		onLine: (line) => {
			const m = /^PROGRESS (\d+)/.exec(line);
			if (!m) return;
			job.progress("process", Number(m[1]) / steps);
			job.detail("process", `Frame ${Number(m[1]) * 9} of 90 · 30 fps`);
		},
	});
	if (signal.aborted) throw new CancelledError();
	if (loop.status !== 0) throw new StudioError(`The stand-in AI effect stopped: ${reason(loop)}`);
	const sound = isAudioOp(req.op);
	const cut = [...(req.start ? ["-ss", String(req.start)] : []), "-i", source.path, ...(req.duration ? ["-t", String(req.duration)] : [])];
	const make = async (out: string, k: string) => {
		const enc = sound ? ["-vn", "-af", "volume=0.5", "-c:a", "aac"] : ["-an", "-vf", "hue=s=0", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
		const r = await run(findTool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", ...cut, ...enc, "-f", "mov", out], { timeout: 120, signal });
		if (r.status !== 0) throw new StudioError(`The AI effect stopped: ${reason(r)}`);
		const p = await probe(out);
		const result: NeuralResult = { key: k, cached: false, width: p.width, height: p.height, frames: 0, seconds: p.duration, fps: 30, codec: sound ? "aac" : "h264", engine: "stub", alpha: false };
		fs.writeFileSync(infoPath(k), JSON.stringify(result));
		return result;
	};
	if (req.params.musicKey) {
		const musicKey = validKey(String(req.params.musicKey));
		await make(cachedPath(musicKey), musicKey);
	}
	return make(cachedPath(key), key);
}

export function startNeural(source: StoredFile, req: NeuralRequest): JobState {
	const key = validKey(req.key);
	const length = Math.max(1, req.duration ?? req.length ?? 60);
	const title = req.title || "AI effect";
	return startJob(
		"neural",
		// No length limits: allow ~40× real time for the slowest setting (4× upscale, accurate matte), never less than 10 minutes.
		[{ id: "process", title, timeout: Math.max(600, length * 40) }],
		(job) =>
			job.step("process", async (signal): Promise<NeuralResult> => {
				const hit = cached(key);
				if (hit) return hit;
				if (!source.path || !fs.existsSync(source.path)) throw new StudioError("The clip didn't reach the AI effect. Apply the effect again.");
				job.detail("process", "Waiting for the previous AI effect to finish");
				return exclusive(req.params.quality === "accurate" ? "background" : "interactive", async () => {
					if (signal.aborted) throw new CancelledError();
					const again = cached(key);
					if (again) return again;
					job.detail("process", "Starting");
					if (STUB) return stubEffect(source, req, key, job, signal);
					if (req.op === "retouch" || isAudioOp(req.op) || isVideoOp(req.op)) return runTool(source, req, key, job, signal);
					const input = await readableSource(source.path, signal);
					const out = cachedPath(key);
					const args = [req.op, input, out];
					for (const [k, v] of Object.entries(req.params)) {
						if (OPTION_KEYS.has(k) && v !== "" && v != null) args.push(`--${k}`, String(v));
					}
					if (req.start != null && req.start > 0) args.push("--start", String(req.start));
					if (req.duration != null) args.push("--duration", String(req.duration));
					let last: Record<string, any> | null = null;
					const r = await run(helper(), args, {
						heavy: true,
						timeout: Math.max(600, length * 40),
						signal,
						onLine: (line) => {
							if (!line.startsWith("{")) return;
							try {
								const msg = JSON.parse(line);
								if (msg.done) {
									last = msg;
									return;
								}
								if (typeof msg.p === "number") job.progress("process", msg.p);
								if (msg.frame) job.detail("process", `Frame ${msg.frame} of ${msg.frames} · ${Math.round(msg.fps)} fps`);
							} catch {}
						},
					});
					if (r.status !== 0 || !last) {
						fs.rmSync(out, { force: true });
						throw new StudioError(`The AI effect stopped: ${reason(r).replace(/^neuralfx:\s*/, "")}`);
					}
					const done = last as Record<string, any>;
					const result: NeuralResult = {
						key,
						cached: false,
						width: done.width,
						height: done.height,
						frames: done.frames,
						seconds: done.seconds,
						fps: done.fps,
						codec: done.codec,
						engine: done.engine,
						alpha: !!done.alpha,
						msPerFrame: done.msPerFrame,
					};
					fs.writeFileSync(infoPath(key), JSON.stringify(result));
					return result;
				});
			}),
	);
}
