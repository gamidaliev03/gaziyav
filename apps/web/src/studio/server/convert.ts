// Import proxies: files the editor can't decode itself (iPhone HEVC, ProRes, HEIC photos,
// MKV/AVI/MTS, Opus…) are converted locally with ffmpeg / macOS sips into formats every
// part of the editor handles: H.264 + AAC MP4 at a constant frame rate, JPEG, AAC M4A.
import fs from "node:fs";
import path from "node:path";
import { StudioError } from "./errors";
import { newFile, removeFile, type StoredFile } from "./files";
import { startJob, type JobState } from "./jobs";
import { findTool, reason, run } from "./tools";
import { IS_MAC } from "@/platform/os";

/**
 * "repair": a video cut off midway, kept up to where its data ends. "editing": a copy for the preview only (the
 * export renders from the original), lighter than "video", which the export renders from.
 */
export type ConvertKind = "video" | "image" | "audio" | "repair" | "still" | "editing";

/** AI avatar → Photo to avatar: a photo becomes a still clip this long, so the lipsync has a face to move (and room
 * for a long speech: the clip on the timeline keeps the photo's length, "Use more video" takes the rest). */
export const STILL_SECONDS = 15;

export interface ConvertResult {
	fileId: string;
	name: string;
	mime: string;
}

interface SourceInfo {
	duration: number;
	hasVideo: boolean;
	hasAudio: boolean;
	videoCodec: string | null;
	/** The first sound stream's codec (pcm_s24le …), null without sound. */
	audioCodec: string | null;
	frameRate: number | null;
	isVariableFrameRate: boolean;
}

const IMAGE_EXT = new Set([".heic", ".heif", ".avif", ".tif", ".tiff", ".bmp", ".dng", ".cr2", ".nef", ".arw"]);

function parseRate(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const [num, den] = value.split("/").map(Number);
	const rate = den ? num / den : num;
	return Number.isFinite(rate) && rate > 0 ? rate : null;
}

async function inspect(file: string, signal: AbortSignal): Promise<SourceInfo> {
	const r = await run(
		findTool("ffprobe"),
		["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,r_frame_rate,avg_frame_rate,nb_frames:stream_disposition=attached_pic", "-of", "json", file],
		{ timeout: 120, signal },
	);
	if (r.status !== 0) {
		throw new StudioError(`This file can't be read (${reason(r)}). It may be damaged or in a format that isn't supported.`);
	}
	const j = JSON.parse(r.stdout || "{}");
	const streams: Array<Record<string, unknown>> = j.streams ?? [];
	const video = streams.find((s) => s.codec_type === "video" && !isCoverArt(s));
	const audio = streams.find((s) => s.codec_type === "audio");
	const real = parseRate(video?.r_frame_rate);
	const avg = parseRate(video?.avg_frame_rate);
	return {
		duration: Number(j.format?.duration ?? 0) || 0,
		hasVideo: !!video,
		hasAudio: streams.some((s) => s.codec_type === "audio"),
		videoCodec: video ? String(video.codec_name ?? "") : null,
		audioCodec: audio ? String(audio.codec_name ?? "") : null,
		frameRate: avg ?? real,
		isVariableFrameRate: !!(real && avg && Math.abs(real - avg) / real > 0.01),
	};
}

/**
 * Cover art inside audio files shows up as a picture "video" stream: marked as an attached picture, or a single
 * JPEG/PNG frame. A camera's Motion-JPEG recording is a real video (it was imported as sound only).
 */
export function isCoverArt(stream: Record<string, unknown>): boolean {
	const disposition = stream.disposition as Record<string, unknown> | undefined;
	if (Number(disposition?.attached_pic) === 1) return true;
	const frames = Number(stream.nb_frames);
	return ["mjpeg", "png", "bmp"].includes(String(stream.codec_name)) && Number.isFinite(frames) && frames <= 1;
}

function targetFps(info: SourceInfo): number {
	const rate = info.frameRate ?? 30;
	const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
	const nearest = common.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best), 30);
	return Math.abs(nearest - rate) < 1 ? nearest : Math.min(120, Math.max(1, Math.round(rate)));
}

export async function ffmpegWithProgress(
	args: string[],
	duration: number,
	signal: AbortSignal,
	onProgress: (value: number) => void,
): Promise<{ ok: boolean; why: string }> {
	const r = await run(
		findTool("ffmpeg"),
		["-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", ...args],
		{
			// No length limits: allow ~10× real time, never less than 10 minutes.
			timeout: Math.max(600, duration * 10),
			signal,
			onLine: (line) => {
				const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
				if (m && duration > 0) onProgress(Number(m[1]) / 1e6 / duration);
			},
		},
	);
	return { ok: r.status === 0, why: reason(r) };
}

/**
 * A recorder's uncompressed sound (ProRes and camera files carry 16/24-bit PCM) stays uncompressed in the copy: a .mov
 * with 24-bit PCM, which the editor reads as it is. It was AAC 192k, so a ProRes clip's sound was mixed and exported
 * from a lossy copy — WAV exports included (pro-heavy, 09.11).
 */
export function keepsPcmSound(info: Pick<SourceInfo, "audioCodec">): boolean {
	return !!info.audioCodec && info.audioCodec.startsWith("pcm_");
}

/** VideoToolbox's constant quality (0–100) and x264's CRF: a copy the export renders from is kept closer to the source. */
const VIDEO_QUALITY = { final: { vt: "80", crf: "16" }, editing: { vt: "65", crf: "18" } } as const;

async function convertVideo(
	input: string,
	info: SourceInfo,
	dest: string,
	signal: AbortSignal,
	onProgress: (v: number) => void,
	use: keyof typeof VIDEO_QUALITY = "final",
	/** The sound as 24-bit PCM (the destination is a .mov): see keepsPcmSound. */
	pcm = false,
) {
	const quality = VIDEO_QUALITY[use];
	const fps = targetFps(info);
	const common = [
		"-i", input,
		"-map", "0:v:0", "-map", "0:a:0?",
		// Constant frame rate: VFR phone footage otherwise drifts against audio on the timeline.
		"-fps_mode", "cfr", "-r", String(fps),
		// A key frame every half second: a seek decodes at most 15 frames (sources with one every 8 s lagged when
		// scrubbed; with one a second, a 4K HEVC copy sought in 75 ms (p50), with two 46 ms, for 2 % more file).
		"-g", String(Math.max(1, Math.round(fps / 2))),
		"-pix_fmt", "yuv420p",
		...(pcm ? ["-c:a", "pcm_s24le"] : ["-c:a", "aac", "-b:a", "192k"]), "-ac", "2",
		"-movflags", "+faststart",
	];
	// Hardware encoder first (fast on Apple Silicon), software encoder as the fallback (and the only one on Windows).
	if (IS_MAC) {
		const hardware = await ffmpegWithProgress(
			[...common, "-c:v", "h264_videotoolbox", "-q:v", quality.vt, "-allow_sw", "1", dest],
			info.duration,
			signal,
			onProgress,
		);
		if (hardware.ok && fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
	}
	const software = await ffmpegWithProgress(
		[...common, "-c:v", "libx264", "-preset", "veryfast", "-crf", quality.crf, dest],
		info.duration,
		signal,
		onProgress,
	);
	if (!software.ok) throw new StudioError(`Couldn't convert the video: ${software.why}`);
}

/** Video packets ffmpeg can read from the file (a cut-off file: up to and including the partial last one). */
async function readableVideoPackets(file: string, signal: AbortSignal): Promise<number> {
	const r = await run(
		findTool("ffprobe"),
		["-v", "quiet", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file],
		{ timeout: 120, signal },
	);
	return Number.parseInt(r.stdout.trim(), 10) || 0;
}

/**
 * A download or copy cut off midway: the picture is copied as it is (no re-encode, no quality loss) up to where the
 * data ends, minus the last packet, which the cut leaves partial (the Apple decoder fails on it and the frames before
 * it in display order came out black). Earlier packets never reference later ones, so dropping it is safe. Codecs MP4
 * can't hold are converted instead.
 */
async function repairVideo(input: string, info: SourceInfo, dest: string, signal: AbortSignal, onProgress: (v: number) => void) {
	const packets = await readableVideoPackets(input, signal);
	if (packets > 1 && info.videoCodec && ["h264", "hevc", "av1"].includes(info.videoCodec)) {
		const copied = await ffmpegWithProgress(
			[
				"-i", input,
				"-map", "0:v:0", "-map", "0:a:0?",
				"-c:v", "copy", "-frames:v", String(packets - 1), ...(info.videoCodec === "hevc" ? ["-tag:v", "hvc1"] : []),
				"-c:a", "aac", "-b:a", "192k",
				"-movflags", "+faststart", dest,
			],
			info.duration,
			signal,
			onProgress,
		);
		if (copied.ok && fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
	}
	await convertVideo(input, info, dest, signal, onProgress);
}

async function convertImage(input: string, dest: string, signal: AbortSignal) {
	// macOS sips reads HEIC/HEIF/RAW natively, ffmpeg is the fallback (e.g. AVIF on older systems).
	if (fs.existsSync("/usr/bin/sips")) {
		const r = await run("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "92", input, "--out", dest], { timeout: 120, signal });
		if (r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
	}
	const r = await run(findTool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-frames:v", "1", "-q:v", "2", dest], {
		timeout: 120,
		signal,
	});
	if (r.status !== 0) throw new StudioError(`Couldn't convert the photo: ${reason(r)}`);
}

async function convertAudio(input: string, info: SourceInfo, dest: string, signal: AbortSignal, onProgress: (v: number) => void) {
	const r = await ffmpegWithProgress(["-i", input, "-vn", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dest], info.duration, signal, onProgress);
	if (!r.ok) throw new StudioError(`Couldn't convert the audio: ${r.why}`);
}

function baseName(name: string): string {
	const ext = path.extname(name);
	return (ext ? name.slice(0, -ext.length) : name) || "media";
}

/** Converts an uploaded file in a background job; the source slot is removed when the job ends. */
export function startConvert(source: StoredFile, requested: ConvertKind | null): JobState {
	return startJob(
		"convert",
		[{ id: "convert", title: "Preparing the file for editing", timeout: 6 * 3600 }],
		async (job) => {
			try {
				return await job.step("convert", async (signal): Promise<ConvertResult> => {
					const ext = path.extname(source.name).toLowerCase();
					const stem = baseName(source.name);
					if (requested === "still") {
						const out = newFile(`${stem}.mp4`);
						// Even sides (H.264), at most 1080 px wide, 30 fps; no sound (the voice comes with the lipsync).
						const r = await ffmpegWithProgress(
							["-loop", "1", "-framerate", "30", "-i", source.path, "-t", String(STILL_SECONDS), "-vf", "scale='trunc(min(1080,iw)/2)*2':-2,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-movflags", "+faststart", out.path],
							STILL_SECONDS,
							signal,
							(v) => job.progress("convert", v),
						);
						if (!r.ok) {
							removeFile(out.id);
							throw new StudioError(`That photo can't be made into a clip: ${r.why}`);
						}
						return { fileId: out.id, name: out.name, mime: "video/mp4" };
					}
					if (requested === "image" || IMAGE_EXT.has(ext)) {
						const out = newFile(`${stem}.jpg`);
						try {
							await convertImage(source.path, out.path, signal);
						} catch (error) {
							removeFile(out.id);
							throw error;
						}
						return { fileId: out.id, name: out.name, mime: "image/jpeg" };
					}
					const info = await inspect(source.path, signal);
					const progress = (value: number) => job.progress("convert", value);
					if (info.hasVideo && requested !== "audio") {
						const pcm = requested !== "repair" && keepsPcmSound(info);
						const out = newFile(`${stem}${pcm ? ".mov" : ".mp4"}`);
						try {
							if (requested === "repair") await repairVideo(source.path, info, out.path, signal, progress);
							else await convertVideo(source.path, info, out.path, signal, progress, requested === "editing" ? "editing" : "final", pcm);
						} catch (error) {
							removeFile(out.id);
							throw error;
						}
						return { fileId: out.id, name: out.name, mime: pcm ? "video/quicktime" : "video/mp4" };
					}
					if (info.hasAudio) {
						const out = newFile(`${stem}.m4a`);
						try {
							await convertAudio(source.path, info, out.path, signal, progress);
						} catch (error) {
							removeFile(out.id);
							throw error;
						}
						return { fileId: out.id, name: out.name, mime: "audio/mp4" };
					}
					throw new StudioError("This file has no picture or sound the editor can use.");
				});
			} finally {
				removeFile(source.id);
			}
		},
	);
}

export function parseConvertKind(value: string | null): ConvertKind | null {
	return value === "video" || value === "image" || value === "audio" || value === "repair" || value === "still" || value === "editing" ? value : null;
}
