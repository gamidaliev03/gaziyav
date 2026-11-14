// Motion jobs: tracking (Apple Vision on the Neural Engine), reverse and optical-flow slow motion (VideoToolbox
// frame interpolation) — all by the native `motion` helper in Resources/bin. Without the helper's frame
// interpolation (macOS < 15.4, Intel) slow motion falls back to ffmpeg's minterpolate; reverse falls back to
// ffmpeg's reverse filter. Every job has progress and Cancel; the source file is only read, never changed.
import fs from "node:fs";
import path from "node:path";
import { StudioError } from "./errors";
import { getFile, newFile, removeFile, workDir } from "./files";
import { startJob, type JobState } from "./jobs";
import { probe } from "./media";
import { findTool, reason, run } from "./tools";
import { IS_WINDOWS } from "@/platform/os";

export type TrackKind = "face" | "object" | "subject";

export interface TrackRequest {
	fileId: string;
	kind: TrackKind;
	/** Seconds of the file. */
	start: number;
	end: number;
	/** Where the box was drawn / the subject was clicked (seconds of the file). */
	at: number;
	/** Normalized, top-left origin, in the displayed frame. */
	rect?: [number, number, number, number];
	point?: [number, number];
}

export interface TrackResult {
	frame: [number, number];
	fps: number;
	/** [t, x, y, w, h, angle, confidence] — raw (unsmoothed), t in seconds of the file. */
	samples: number[][];
}

export interface MotionRenderRequest {
	fileId: string;
	op: "reverse" | "smooth" | "stabilize";
	start: number;
	/** stabilize: Recommended / Minimum crop / Most stable (CapCut's levels). */
	level?: "recommended" | "mincrop" | "most";
	end: number;
	/** smooth: frames per source frame (slow-motion factor). */
	factor?: number;
	/** smooth: frame rate the result is written at (the project's). */
	fps?: number;
	/** Name of the result file (no extension). */
	name?: string;
}

export interface MotionRenderResult {
	fileId: string;
	name: string;
	/** smooth: true = Apple frame interpolation, false = ffmpeg fallback. */
	neural?: boolean;
}

function helper(): string | null {
	const dir = process.env.STUDIO_BIN_DIR || process.env.STUDIO_MOTION_DIR;
	if (!dir) return null;
	const p = path.join(dir, "motion");
	return fs.existsSync(p) ? p : null;
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function cleanName(name: unknown, fallback: string): string {
	const s = typeof name === "string" ? name.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 100) : "";
	return s || fallback;
}

/** Runs the helper; "P x" lines on its error output are progress. */
async function runHelper(args: string[], signal: AbortSignal, timeout: number, onProgress: (v: number) => void) {
	const bin = helper();
	if (!bin) throw new StudioError(IS_WINDOWS ? "Tracking isn't available on Windows yet." : "This build has no motion helper. Reinstall Gaziyav.");
	return run(bin, args, {
		heavy: true,
		timeout,
		signal,
		onLine: (line) => {
			const m = /^P ([\d.]+)/.exec(line);
			if (m) onProgress(clamp01(Number(m[1])));
		},
	});
}

async function ffmpegProgress(args: string[], seconds: number, signal: AbortSignal, onProgress: (v: number) => void) {
	return run(findTool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", ...args], {
		timeout: Math.max(900, seconds * 30),
		signal,
		onLine: (line) => {
			const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
			if (m && seconds > 0) onProgress(clamp01(Number(m[1]) / 1e6 / seconds));
		},
	});
}

export function startTrack(body: Partial<TrackRequest>): JobState {
	const kind: TrackKind = body.kind === "object" || body.kind === "subject" ? body.kind : "face";
	const title = kind === "face" ? "Tracking the face" : kind === "subject" ? "Tracking the subject" : "Tracking the object";
	const src = getFile(String(body.fileId ?? ""));
	const start = Math.max(0, num(body.start));
	const end = Math.max(start + 0.05, num(body.end, start + 1));
	const at = Math.min(end, Math.max(start, num(body.at, start)));
	return startJob("track", [{ id: "track", title, timeout: Math.max(300, (end - start) * 20) }], async (job) =>
		job.step("track", async (signal): Promise<TrackResult> => {
			const args = ["track", src.path, "--kind", kind, "--start", start.toFixed(4), "--end", end.toFixed(4), "--at", at.toFixed(4)];
			if (Array.isArray(body.rect) && body.rect.length === 4) args.push("--rect", body.rect.map((v) => clamp01(num(v)).toFixed(5)).join(","));
			if (Array.isArray(body.point) && body.point.length === 2) args.push("--point", body.point.map((v) => clamp01(num(v)).toFixed(5)).join(","));
			const r = await runHelper(args, signal, Math.max(300, (end - start) * 20), (v) => job.progress("track", v));
			if (r.status !== 0) {
				const why = /motion: (.+)/.exec(r.stderr)?.[1]?.trim();
				throw new StudioError(why ? `${why}.` : `Tracking failed: ${reason(r)}`);
			}
			const json = JSON.parse(r.stdout.trim().split("\n").pop() || "{}") as TrackResult;
			if (!json.samples?.length) throw new StudioError("Nothing to follow was found in this clip.");
			return json;
		}),
	);
}

export function startMotionRender(body: Partial<MotionRenderRequest>): JobState {
	const op = body.op === "smooth" || body.op === "stabilize" ? body.op : "reverse";
	const src = getFile(String(body.fileId ?? ""));
	const start = Math.max(0, num(body.start));
	const end = Math.max(start + 0.05, num(body.end, start + 1));
	const span = end - start;
	const factor = Math.max(1, Math.min(40, num(body.factor, 2)));
	const fps = Math.max(1, Math.min(240, num(body.fps, 30)));
	const name = cleanName(body.name, op === "smooth" ? "Smooth" : op === "stabilize" ? "Stabilized" : "Reversed");

	if (op === "stabilize") {
		// Two passes of ffmpeg's vid.stab: measure the shake, then move every frame against it. The levels are
		// CapCut's: how much camera motion is smoothed away and how the picture is zoomed to hide the moving edges.
		const level = body.level === "mincrop" || body.level === "most" ? body.level : "recommended";
		const smoothing = { recommended: 15, mincrop: 8, most: 40 }[level];
		const zoom = level === "mincrop" ? "optzoom=2:zoomspeed=0.2" : "optzoom=1";
		const at = ["-ss", start.toFixed(4), "-t", span.toFixed(4)];
		// a path inside a filter option: escape what the filter-graph parser reads as syntax
		const esc = (file: string) => file.replace(/[\\:',;[\]]/g, (c) => `\\${c}`);
		return startJob(
			"stabilize",
			[
				{ id: "analyse", title: "Finding the camera shake", timeout: Math.max(600, span * 20) },
				{ id: "steady", title: "Steadying the picture", timeout: Math.max(600, span * 20) },
			],
			async (job) => {
				const work = workDir();
				try {
					const info = await probe(src.path);
					const shake = path.join(work.dir, "shake.trf");
					await job.step("analyse", async (signal) => {
						const r = await ffmpegProgress(
							[...at, "-i", src.path, "-an", "-vf", `vidstabdetect=shakiness=6:accuracy=15:result=${esc(shake)}`, "-f", "null", "-"],
							span,
							signal,
							(v) => job.progress("analyse", v),
						);
						if (r.status !== 0 || !fs.existsSync(shake)) throw new StudioError(`Couldn't measure the camera shake: ${reason(r)}`);
					});
					const out = newFile(`${name}.mp4`);
					try {
						await job.step("steady", async (signal) => {
							const vf = `vidstabtransform=input=${esc(shake)}:smoothing=${smoothing}:${zoom}:interpol=bicubic,unsharp=5:5:0.6:3:3:0.3`;
							const sound = info.hasAudio ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "192k"] : [];
							const r = await ffmpegProgress(
								[...at, "-i", src.path, "-vf", vf, "-map", "0:v:0", ...sound, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out.path],
								span,
								signal,
								(v) => job.progress("steady", v),
							);
							if (r.status !== 0) throw new StudioError(`Couldn't steady the picture: ${reason(r)}`);
						});
					} catch (error) {
						removeFile(out.id);
						throw error;
					}
					return { fileId: out.id, name: out.name } satisfies MotionRenderResult;
				} finally {
					work.dispose();
				}
			},
		);
	}

	if (op === "reverse") {
		return startJob(
			"reverse",
			[
				{ id: "picture", title: "Reversing the picture", timeout: Math.max(600, span * 20) },
				{ id: "sound", title: "Reversing the sound", timeout: Math.max(300, span * 5) },
			],
			async (job) => {
				const work = workDir();
				try {
					const info = await probe(src.path);
					const video = path.join(work.dir, "video.mp4");
					await job.step("picture", async (signal) => {
						const bin = helper();
						if (bin) {
							const r = await runHelper(
								["reverse", src.path, video, "--start", start.toFixed(4), "--end", end.toFixed(4)],
								signal,
								Math.max(600, span * 20),
								(v) => job.progress("picture", v),
							);
							if (r.status === 0 && fs.existsSync(video)) return;
						}
						// Fallback: ffmpeg's reverse filter (keeps the clip in memory — fine for short pieces).
						const r = await ffmpegProgress(
							["-ss", start.toFixed(4), "-t", span.toFixed(4), "-i", src.path, "-an", "-vf", "reverse", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", video],
							span,
							signal,
							(v) => job.progress("picture", v),
						);
						if (r.status !== 0) throw new StudioError(`Couldn't reverse the picture: ${reason(r)}`);
					});
					const out = newFile(`${name}.mp4`);
					try {
						await job.step("sound", async (signal) => {
							const args = info.hasAudio
								? ["-i", video, "-ss", start.toFixed(4), "-t", span.toFixed(4), "-i", src.path, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", "areverse", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out.path]
								: ["-i", video, "-c", "copy", "-movflags", "+faststart", out.path];
							const r = await ffmpegProgress(args, span, signal, (v) => job.progress("sound", v));
							if (r.status !== 0) throw new StudioError(`Couldn't reverse the sound: ${reason(r)}`);
						});
					} catch (error) {
						removeFile(out.id);
						throw error;
					}
					return { fileId: out.id, name: out.name } satisfies MotionRenderResult;
				} finally {
					work.dispose();
				}
			},
		);
	}

	return startJob(
		"smooth",
		[{ id: "smooth", title: "Smooth slow motion (optical flow)", timeout: Math.max(1800, span * factor * 60) }],
		async (job) => {
			const out = newFile(`${name}.mp4`);
			try {
				const neural = await job.step("smooth", async (signal) => {
					const bin = helper();
					if (bin) {
						const r = await runHelper(
							["smooth", src.path, out.path, "--start", start.toFixed(4), "--end", end.toFixed(4), "--factor", factor.toFixed(4), "--fps", fps.toFixed(4)],
							signal,
							Math.max(1800, span * factor * 60),
							(v) => job.progress("smooth", v),
						);
						if (r.status === 0 && fs.existsSync(out.path)) return true;
						if (r.status !== 3) {
							const why = /motion: (.+)/.exec(r.stderr)?.[1]?.trim();
							throw new StudioError(`Smooth slow motion failed: ${why ?? reason(r)}`);
						}
						job.detail("smooth", "Apple frame interpolation isn't available on this Mac — using ffmpeg (slower)");
					}
					// Fallback: motion-compensated interpolation by ffmpeg.
					const r = await ffmpegProgress(
						[
							"-ss", start.toFixed(4), "-t", span.toFixed(4), "-i", src.path, "-an",
							"-vf", `setpts=(PTS-STARTPTS)*${factor.toFixed(4)},minterpolate=fps=${fps.toFixed(4)}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
							"-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out.path,
						],
						span * factor,
						signal,
						(v) => job.progress("smooth", v),
					);
					if (r.status !== 0) throw new StudioError(`Smooth slow motion failed: ${reason(r)}`);
					return false;
				});
				return { fileId: out.id, name: out.name, neural } satisfies MotionRenderResult;
			} catch (error) {
				removeFile(out.id);
				throw error;
			}
		},
	);
}

export async function motionCapabilities(): Promise<{ helper: boolean; neural: boolean }> {
	const bin = helper();
	if (!bin) return { helper: false, neural: false };
	try {
		const r = await run(bin, ["probe"], { timeout: 20 });
		const j = JSON.parse(r.stdout || "{}");
		return { helper: true, neural: !!j.neural };
	} catch {
		return { helper: true, neural: false };
	}
}
