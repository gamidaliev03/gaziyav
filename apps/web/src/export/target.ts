/**
 * What CapCut's Export window can ask for (docs/capcut-study.md §d) and how each choice is made here.
 * The page draws and encodes the frames itself for H.264 in MP4/MOV and VP9 in WebM. Every other codec (HEVC,
 * AV1, Apple ProRes), GIF and HDR / 10-bit are made from an H.264 master at a much higher bit rate by the ffmpeg
 * inside the app (export/server/transcode.ts), so the second encode starts from near-lossless frames.
 */
import type { ExportFormat } from "./index";

export type ExportCodec =
	| "h264"
	| "hevc"
	| "av1"
	| "vp9"
	| "prores_422"
	| "prores_422hq"
	| "prores_422lt"
	| "prores_4444"
	| "prores_proxy"
	| "prores_4444xq"
	/** QuickTime Animation (CapCut's RLE): lossless frames, large files. */
	| "rle";
export type ExportContainer = "mp4" | "mov" | "webm" | "gif";
export type ExportColor = "sdr" | "hlg" | "pq";
export type AudioFileFormat = "wav" | "mp3" | "aac" | "flac";

/**
 * CapCut 9.5's Codec list, in its order (docs/capcut/compare/export-*-capcut.png), with its notes under H.264, HEVC and
 * RLE. AV1 and VP9 are not in CapCut's window (`hidden`); they stay for files other parts of the app make.
 */
export const EXPORT_CODECS: Array<{ value: ExportCodec; label: string; containers: ExportContainer[]; hdr: boolean; note?: string; hidden?: true }> = [
	{ value: "h264", label: "H.264", containers: ["mov", "mp4"], hdr: false, note: "The most common compression method" },
	{ value: "hevc", label: "HEVC", containers: ["mov", "mp4"], hdr: true, note: "Efficient compression, saving space" },
	{ value: "prores_422", label: "Apple ProRes 422", containers: ["mov"], hdr: true },
	{ value: "prores_422lt", label: "Apple ProRes 422 LT", containers: ["mov"], hdr: true },
	{ value: "prores_422hq", label: "Apple ProRes 422 HQ", containers: ["mov"], hdr: true },
	{ value: "prores_4444", label: "Apple ProRes 4444", containers: ["mov"], hdr: true },
	{ value: "prores_proxy", label: "Apple ProRes Proxy", containers: ["mov"], hdr: true },
	{ value: "prores_4444xq", label: "Apple ProRes 4444XQ", containers: ["mov"], hdr: true },
	{ value: "rle", label: "RLE", containers: ["mov"], hdr: false, note: "Lossless frames. Large export file." },
	{ value: "av1", label: "AV1", containers: ["mp4", "webm"], hdr: true, hidden: true },
	{ value: "vp9", label: "VP9", containers: ["webm"], hdr: false, hidden: true },
];

export const isProRes = (codec: ExportCodec) => codec.startsWith("prores");

/**
 * Bits per channel of the frames the page draws (the compositor's canvas and its textures are 8-bit, measured: a
 * 10-bit ramp of 600 levels leaves as 328). A 10-bit, ProRes or HDR export is a 10-bit FILE whose picture has 8-bit
 * steps — the Export window and the manifest say so wherever such a file is chosen (render, 11.11). A real 10-bit
 * path needs frames uploaded as ≥ 10-bit textures, a float chain in the compositor and raw 10-bit frames carried to
 */
export const PICTURE_BITS = 8;
/** Bits per channel of the picture inside a file of `target`: never more than the frames carry. */
export const contentBits = (target: Pick<ExportTarget, "bitDepth">): number => Math.min(target.bitDepth, PICTURE_BITS);

/** CapCut: 480P … 4K by the short side; 8K is ProRes only. */
export const EXPORT_RESOLUTIONS = [480, 720, 1080, 1440, 2160, 4320] as const;
export type ExportResolution = (typeof EXPORT_RESOLUTIONS)[number];
export const resolutionLabel = (value: number) =>
	value === 1440 ? "2K" : value === 2160 ? "4K" : value === 4320 ? "8K" : `${value}P`;

/** The canvas scaled so its short side is `resolution` (even numbers, as every encoder wants). */
export function outputSize(canvas: { width: number; height: number }, resolution: number): { width: number; height: number } {
	const scale = resolution / Math.min(canvas.width, canvas.height);
	const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
	return { width: even(canvas.width * scale), height: even(canvas.height * scale) };
}

/** The resolution class of a size: its short side, rounded to CapCut's steps. */
export function resolutionOf(size: { width: number; height: number }): ExportResolution {
	const short = Math.min(size.width, size.height);
	return EXPORT_RESOLUTIONS.find((r) => short <= r + 8) ?? 4320;
}

export interface ExportTarget {
	container: ExportContainer;
	/** Not used for GIF. */
	codec: ExportCodec;
	width: number;
	height: number;
	/** Frames per second (29.97 = 30000/1001). */
	fps: number;
	/** Video bits per second for H.264 / HEVC / AV1 / VP9 (ProRes and GIF have their own). */
	bitrate: number;
	color: ExportColor;
	bitDepth: 8 | 10;
	/** Settings → Performance → Speed up hardware encoding (VideoToolbox for HEVC and ProRes). */
	hardware: boolean;
}

/** A combination the window allows: codec fits the container, HDR / 10-bit only where the codec carries it. */
export function normalizeTarget(target: ExportTarget): ExportTarget {
	const next = { ...target };
	if (next.container === "gif") return { ...next, color: "sdr", bitDepth: 8 };
	// The codec is what the user picked: a container that can't carry it becomes one that can (ProRes → MOV).
	const codec = EXPORT_CODECS.find((c) => c.value === next.codec) ?? EXPORT_CODECS[0];
	next.codec = codec.value;
	if (!codec.containers.includes(next.container)) next.container = codec.containers[0];
	const hdrCodec = EXPORT_CODECS.find((c) => c.value === next.codec)?.hdr ?? false;
	// HDR and 10-bit need a codec that carries them: H.264 becomes HEVC (as in CapCut), VP9 stays SDR 8-bit.
	if ((next.color !== "sdr" || next.bitDepth === 10) && !hdrCodec) {
		if (next.container === "webm" || next.codec === "rle") return { ...next, color: "sdr", bitDepth: 8 };
		next.codec = "hevc";
	}
	if (next.color !== "sdr") next.bitDepth = 10;
	// ProRes is 10-bit by nature.
	if (isProRes(next.codec)) next.bitDepth = 10;
	return next;
}

/** The page encodes the file itself (no ffmpeg pass). */
export function encodedInPage(target: ExportTarget): boolean {
	if (target.container === "gif" || target.color !== "sdr" || target.bitDepth === 10) return false;
	if (target.codec === "h264") return target.container === "mp4" || target.container === "mov";
	return target.codec === "vp9" && target.container === "webm";
}

/** The page's own encode: the file itself, or the H.264 master the ffmpeg pass starts from. */
export function pageEncode(target: ExportTarget): { format: ExportFormat; bitrate: number } {
	if (encodedInPage(target)) return { format: target.container as ExportFormat, bitrate: target.bitrate };
	return { format: "mp4", bitrate: masterBitrate(target) };
}

/** A master the second encode barely degrades: 2.5× the target, at least 40 Mbps for 1080p (scaled by area). */
export function masterBitrate(target: Pick<ExportTarget, "width" | "height" | "bitrate">): number {
	const area = (target.width * target.height) / (1920 * 1080);
	return Math.round(Math.max(target.bitrate * 2.5, 40_000_000 * Math.max(0.25, area)));
}

export function fileExtension(container: ExportContainer): string {
	return `.${container}`;
}

const PRORES_PROFILE: Record<string, { ks: number; vt: string }> = {
	prores_422lt: { ks: 1, vt: "lt" },
	prores_422: { ks: 2, vt: "standard" },
	prores_422hq: { ks: 3, vt: "hq" },
	prores_4444: { ks: 4, vt: "4444" },
	prores_proxy: { ks: 0, vt: "proxy" },
	prores_4444xq: { ks: 5, vt: "xq" },
};

/** 29.97 → "30000/1001": ffmpeg reads «29.97» as 2997/100, which is not NTSC (the file then says 2997/100). */
export function ffmpegRate(fps: number): string {
	const ntsc = [23.976, 29.97, 59.94].find((rate) => Math.abs(rate - fps) < 0.01);
	return ntsc ? `${Math.round(ntsc * 1.001) * 1000}/1001` : String(fps);
}

/** GIF: at most 640 px on the long side (CapCut: 320P, or 640P) and 15 frames a second, with its own palette. */
export function gifFilter(target: Pick<ExportTarget, "width" | "height" | "fps">): string {
	const fps = Math.min(15, target.fps);
	const width = Math.min(target.width, target.width >= target.height ? 640 : Math.round((640 * target.width) / target.height));
	return `fps=${fps},scale=${Math.max(2, Math.round(width / 2) * 2)}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`;
}

/**
 * SDR frames carried into an HDR file: Rec.709 → linear light (SDR white at 203 nits, BT.2408) → Rec.2020 →
 * HLG or PQ, 10-bit. The picture looks the same, in the container HDR platforms expect.
 */
export function hdrFilter(color: Exclude<ExportColor, "sdr">, pixelFormat: string): string {
	const transfer = color === "hlg" ? "arib-std-b67" : "smpte2084";
	// The master's frames carry no colour tags: zimg finds no path from "unspecified", so they are tagged first.
	return [
		"setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv",
		"zscale=t=linear:npl=203",
		"format=gbrpf32le",
		`zscale=p=2020:t=${transfer}:m=2020_ncl:r=limited:npl=203`,
		`format=${pixelFormat}`,
	].join(",");
}

/** What the server did to the master before the last encode (export/server/files.ts). */
export interface TranscodeExtras {
	/** The sound comes from this file (the picture went through the upscaler or the frame interpolation). */
	audio?: string;
	/** The picture was slowed this many times by frame interpolation: played back faster again at the target rate. */
	slow?: number;
	/** Frame interpolation wasn't available: ffmpeg's motion-compensated interpolation instead. */
	minterpolate?: boolean;
	/** Exactly this many frames (the interpolation must not add one past the timeline's end). */
	frames?: number;
}

/** ffmpeg arguments that turn the H.264 master into the target file. */
export function transcodeArgs(target: ExportTarget, input: string, output: string, extras: TranscodeExtras = {}): string[] {
	const t = normalizeTarget(target);
	const args = ["-hide_banner", "-nostdin", "-y", "-i", input, ...(extras.audio ? ["-i", extras.audio] : [])];
	// Back to real time after interpolation, then exactly the target size (the upscaler gives 2× / 4×).
	const pre = [
		extras.slow && extras.slow > 1 ? `setpts=PTS/${extras.slow}` : "",
		extras.minterpolate ? `minterpolate=fps=${ffmpegRate(t.fps)}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1` : "",
		// minterpolate makes nothing after the last pair of frames (3 frames short at 2×): the last frame is held, and
		// `-frames:v` below keeps exactly the count the timeline asks for
		extras.minterpolate && extras.frames ? "tpad=stop_mode=clone:stop_duration=1" : "",
		// exactly the frames the timeline asks for — cut in the filter, not by `-frames:v`, which ends the whole output
		// there and with it the sound's last packets (it ended 20–35 ms before the picture: exp, 14.11)
		extras.frames && extras.frames > 0 ? `trim=end_frame=${Math.round(extras.frames)}` : "",
		t.container === "gif" ? "" : `scale=${t.width}:${t.height}:flags=lanczos`,
	].filter(Boolean);
	const prefix = pre.length ? `${pre.join(",")},` : "";
	if (t.container === "gif") {
		return [...args, "-filter_complex", `[0:v]${prefix}${gifFilter(t)}`, "-loop", "0", "-an", output];
	}
	const ten = t.bitDepth === 10;
	const prores = isProRes(t.codec);
	const pixelFormat = t.codec === "rle"
		? "rgb24"
		: prores
		? t.codec === "prores_4444" || t.codec === "prores_4444xq"
			? "yuv444p10le"
			: "yuv422p10le"
		: ten
			? t.hardware && t.codec === "hevc"
				? "p010le"
				: "yuv420p10le"
			: "yuv420p";
	const video: string[] = [];
	// SDR: the frames are tagged Rec.709 so every encoder writes it into the file (players then show true colours).
	if (t.color !== "sdr") video.push("-vf", prefix + hdrFilter(t.color, pixelFormat));
	else video.push("-vf", `${prefix}setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv,format=${pixelFormat}`);
	video.push("-r", ffmpegRate(t.fps));
	const bitrate = String(Math.round(t.bitrate));
	if (t.codec === "hevc") {
		if (t.hardware) video.push("-c:v", "hevc_videotoolbox", "-b:v", bitrate, "-profile:v", ten ? "main10" : "main");
		else video.push("-c:v", "libx265", "-preset", "fast", "-b:v", bitrate, "-x265-params", "log-level=error");
		video.push("-tag:v", "hvc1");
	} else if (t.codec === "av1") {
		video.push("-c:v", "libsvtav1", "-preset", "8", "-b:v", bitrate);
	} else if (prores) {
		const profile = PRORES_PROFILE[t.codec];
		if (t.hardware) video.push("-c:v", "prores_videotoolbox", "-profile:v", profile.vt);
		else video.push("-c:v", "prores_ks", "-profile:v", String(profile.ks), "-vendor", "apl0");
	} else if (t.codec === "rle") {
		video.push("-c:v", "qtrle");
	} else if (t.codec === "vp9") {
		video.push("-c:v", "libvpx-vp9", "-b:v", bitrate, "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8");
	} else {
		if (t.hardware) video.push("-c:v", "h264_videotoolbox", "-b:v", bitrate);
		else video.push("-c:v", "libx264", "-preset", "medium", "-b:v", bitrate);
	}
	const colorTags =
		t.color === "hlg"
			? ["-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc"]
			: t.color === "pq"
				? ["-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc"]
				: ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"];
	// WebM carries Opus, not the master's AAC; MP4 and MOV keep it as it is.
	const audio = t.container === "webm" ? ["-c:a", "libopus", "-b:a", "192k"] : ["-c:a", "copy"];
	const mux = t.container === "webm" ? [] : ["-movflags", "+faststart"];
	return [...args, "-map", "0:v:0", "-map", extras.audio ? "1:a?" : "0:a?", ...video, ...colorTags, ...audio, ...mux, output];
}

/** ffmpeg arguments for the sound alone from the timeline's WAV mix. */
export function audioArgs(format: Exclude<AudioFileFormat, "wav">, input: string, output: string): string[] {
	const codec =
		format === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "320k"] : format === "aac" ? ["-c:a", "aac", "-b:a", "256k"] : ["-c:a", "flac"];
	return ["-hide_banner", "-nostdin", "-y", "-i", input, "-vn", ...codec, output];
}

export const AUDIO_EXTENSION: Record<AudioFileFormat, string> = { wav: ".wav", mp3: ".mp3", aac: ".m4a", flac: ".flac" };
export const AUDIO_MIME: Record<AudioFileFormat, string> = {
	wav: "audio/wav",
	mp3: "audio/mpeg",
	aac: "audio/mp4",
	flac: "audio/flac",
};
