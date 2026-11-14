import {
	EXPORT_FORMAT_VALUES,
	EXPORT_QUALITY_VALUES,
	type ExportFormat,
	type ExportOptions,
	type ExportQuality,
} from "@/export";
import { DEFAULT_EXPORT_OPTIONS, EXPORT_PLATFORMS, type ExportPlatform, type ExportPlatformId } from "@/export/defaults";
import { AUDIO_BITRATE, ENCODER_YIELD, videoBitrateFor } from "@/export/bitrate";
import { currentStillShare } from "@/export/still-share";
import {
	type AudioFileFormat,
	EXPORT_CODECS,
	type ExportCodec,
	type ExportColor,
	type ExportContainer,
} from "@/export/target";
import { useLang } from "@/i18n";
import { formatOf } from "@/preview/canvas-format";
import type { TCanvasSize } from "@/project/types";
import { TICKS_PER_SECOND } from "@/wasm";

export function isExportFormat(value: string): value is ExportFormat {
	return EXPORT_FORMAT_VALUES.some((formatValue) => formatValue === value);
}

export function isExportQuality(value: string): value is ExportQuality {
	return EXPORT_QUALITY_VALUES.some((qualityValue) => qualityValue === value);
}

/** The last choices, so the export popover opens the way it was left (also after a restart). */
export const EXPORT_PREFS_KEY = "gaziyav.export.options";
export type ExportPrefs = Pick<ExportOptions, "format" | "quality" | "includeAudio" | "normalizeLoudness"> & {
	/** Unset until the user picks one: the window then suggests one from the video's shape. */
	platform?: ExportPlatformId | "custom";
	/** Export → WAV: the sound alone. */
	audioOnly?: boolean;
	/** A file name with tokens ({project}_{platform}_{date}); kept only when it has a token. */
	nameTemplate?: string;
	/** Save <name>.json and a row in exports.csv beside each export. */
	manifest?: boolean;
	/** CapCut's Video section: short side (480 … 4320; GIF: long side 320 / 640), codec, container, colour. */
	resolution?: number;
	codec?: ExportCodec;
	container?: ExportContainer;
	color?: ExportColor;
	bitDepth?: 8 | 10;
	/** "project" or frames per second ("29.97" …). */
	fps?: string;
	/** Bit rate → Custom, in Mbit/s. */
	customMbps?: number;
	/** The Audio section's file: MP3, WAV, AAC or FLAC. */
	audioFormat?: AudioFileFormat;
	/** Export GIF → Resolution: 240, 320 or 640 (the long side). */
	gifResolution?: number;
	/** «Export to»: files go straight into this folder (no Save dialog). */
	folder?: string;
	/** Larger than the project: frames enlarged by the AI upscaler (default on). */
	aiUpscale?: boolean;
	/** Higher frame rate than the project: in-between frames by frame interpolation (default on). */
	smoothFps?: boolean;
};

export function isExportPlatform(value: string): value is ExportPlatformId {
	return EXPORT_PLATFORMS.some((platform) => platform.id === value);
}

/** Vertical → TikTok (it takes the longest videos; VK Clips in Russian), wide → YouTube, 4:5 → Feed, any other shape → none. */
export function suggestPlatform(size: TCanvasSize): ExportPlatformId | null {
	const format = formatOf(size);
	const vertical = useLang.getState().lang === "ru" ? "vk" : "tiktok";
	return format === "9:16" ? vertical : format === "16:9" ? "youtube" : format === "4:5" ? "feed" : null;
}

export interface PlatformIssues {
	/** The platform's shape when the video has another one (it would play with bars). */
	aspect: ExportPlatform["aspect"] | null;
	/** The platform's limit in seconds when the video is longer. */
	tooLong: number | null;
	/** The short side is under 1080 px: the platform shows it soft. */
	lowRes: boolean;
}

export function platformIssues(id: ExportPlatformId, size: TCanvasSize, seconds: number): PlatformIssues {
	const platform = EXPORT_PLATFORMS.find((p) => p.id === id) ?? EXPORT_PLATFORMS[0];
	return {
		aspect: formatOf(size) === platform.aspect ? null : platform.aspect,
		tooLong: platform.maxSeconds !== null && seconds > platform.maxSeconds + 0.5 ? platform.maxSeconds : null,
		lowRes: Math.min(size.width, size.height) < 1080,
	};
}

/**
 * The encoder's target for a bit-rate choice: «Recommended» makes the file carry what the platforms ask for
 * (export/bitrate.ts: 8 Mbit/s at 1080p up to 30 fps, 12 above it, 16 at 2K, 35 at 4K; the target is a fifth above, as
 * the encoder lands under it), Lower and Higher are steps from it. `fps` picks the column (30 when not given).
 */
export function videoBitrate({ width, height, fps, format, quality }: { width: number; height: number; fps?: number; format: ExportFormat; quality: ExportQuality }): number {
	return videoBitrateFor({ width, height, fps, format, quality });
}

/**
 * About how big the file gets: what the encoders write — the platforms' rate for the video (the target over the
 * encoder's yield, export/bitrate.ts: footage lands there, simple footage under it), half of it for still pictures
 * (the encoder repeats the frame) by the share of the timeline they cover (`stillShare`, else the open scene's:
 * export/still-share.ts), and about two thirds of the AAC target for speech.
 */
export function estimateExportBytes(input: {
	width: number;
	height: number;
	fps?: number;
	seconds: number;
	format: ExportFormat;
	quality: ExportQuality;
	includeAudio: boolean;
	/** 0…1 of the timeline that is still pictures only (export/still-share.ts timelineStillShare). */
	stillShare?: number;
}): number {
	const still = Math.max(0, Math.min(1, input.stillShare ?? currentStillShare()));
	const video = videoBitrate(input) * ENCODER_YIELD * (1 - still * 0.5);
	const audio = input.includeAudio ? AUDIO_BITRATE[input.quality] * 0.7 : 0;
	return Math.round(((video + audio) * Math.max(0, input.seconds)) / 8);
}

/** "840 KB", "6.2 MB", "1.4 GB". */
export function formatBytes(bytes: number): string {
	if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
	if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
	return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** A name macOS takes for a file: no ":" or "/" (the save dialog would show "09_31"), never empty. */
export function exportFileBase(name: string): string {
	return name.replace(/[:/\\]/g, ".").replace(/\s+/g, " ").trim() || "Video";
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const browserStorage = (): Storage | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

/** Saved choices, each one checked: a value from an older version or a broken entry falls back to the default. */
export function readExportPrefs(storage: Storage | undefined = browserStorage()): ExportPrefs {
	const fallback: ExportPrefs = {
		format: DEFAULT_EXPORT_OPTIONS.format,
		quality: DEFAULT_EXPORT_OPTIONS.quality,
		includeAudio: DEFAULT_EXPORT_OPTIONS.includeAudio ?? true,
		normalizeLoudness: DEFAULT_EXPORT_OPTIONS.normalizeLoudness ?? true,
	};
	try {
		const saved = JSON.parse(storage?.getItem(EXPORT_PREFS_KEY) ?? "{}") as Partial<ExportPrefs> | null;
		if (!saved || typeof saved !== "object") return fallback;
		return {
			format: typeof saved.format === "string" && isExportFormat(saved.format) ? saved.format : fallback.format,
			quality: typeof saved.quality === "string" && isExportQuality(saved.quality) ? saved.quality : fallback.quality,
			includeAudio: typeof saved.includeAudio === "boolean" ? saved.includeAudio : fallback.includeAudio,
			normalizeLoudness:
				typeof saved.normalizeLoudness === "boolean" ? saved.normalizeLoudness : fallback.normalizeLoudness,
			...(typeof saved.audioOnly === "boolean" ? { audioOnly: saved.audioOnly } : {}),
			...(typeof saved.nameTemplate === "string" && saved.nameTemplate.includes("{") ? { nameTemplate: saved.nameTemplate } : {}),
			...(typeof saved.manifest === "boolean" ? { manifest: saved.manifest } : {}),
			...(typeof saved.platform === "string" && (saved.platform === "custom" || isExportPlatform(saved.platform))
				? { platform: saved.platform }
				: {}),
			...(typeof saved.resolution === "number" && saved.resolution >= 240 && saved.resolution <= 4320 ? { resolution: saved.resolution } : {}),
			...(EXPORT_CODECS.some((c) => c.value === saved.codec) ? { codec: saved.codec } : {}),
			...(["mp4", "mov", "webm", "gif"].includes(String(saved.container)) ? { container: saved.container } : {}),
			...(["sdr", "hlg", "pq"].includes(String(saved.color)) ? { color: saved.color } : {}),
			...(saved.bitDepth === 8 || saved.bitDepth === 10 ? { bitDepth: saved.bitDepth } : {}),
			...(typeof saved.fps === "string" && /^(project|\d+(\.\d+)?)$/.test(saved.fps) ? { fps: saved.fps } : {}),
			...(typeof saved.customMbps === "number" && saved.customMbps > 0 && saved.customMbps <= 800 ? { customMbps: saved.customMbps } : {}),
			...(["wav", "mp3", "aac", "flac"].includes(String(saved.audioFormat)) ? { audioFormat: saved.audioFormat } : {}),
			...(typeof saved.folder === "string" && saved.folder.startsWith("/") ? { folder: saved.folder } : {}),
			...(typeof saved.aiUpscale === "boolean" ? { aiUpscale: saved.aiUpscale } : {}),
			...(typeof saved.smoothFps === "boolean" ? { smoothFps: saved.smoothFps } : {}),
		};
	} catch {
		return fallback;
	}
}

export function writeExportPrefs(prefs: ExportPrefs, storage: Storage | undefined = browserStorage()) {
	try {
		storage?.setItem(EXPORT_PREFS_KEY, JSON.stringify(prefs));
	} catch {}
}

/** "0:07" / "1:04:09": the length of what will be exported. */
export function formatLength(ticks: number): string {
	const total = Math.max(0, Math.round(ticks / TICKS_PER_SECOND));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = String(total % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Tokens a file name can hold; the window offers them as chips. */
export const NAME_TOKENS = ["{project}", "{platform}", "{date}", "{time}", "{size}", "{fps}"] as const;

/**
 * "{project}_{platform}_{date}" → "Promo_TikTok_2026-10-25". An empty token takes its separator with it
 * (no platform: "Promo_2026-10-25"); unknown tokens stay as typed.
 */
export function resolveFileName(
	template: string,
	values: { project: string; platform?: string; now: Date; width: number; height: number; fps: number },
): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const { now } = values;
	const filled: Record<string, string> = {
		project: values.project,
		platform: values.platform ?? "",
		date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
		time: `${pad(now.getHours())}.${pad(now.getMinutes())}`,
		size: `${values.width}x${values.height}`,
		fps: `${Math.round(values.fps * 100) / 100}fps`,
	};
	const text = template
		.replace(/\{(\w+)\}/g, (token, key: string) => (key in filled ? filled[key] || "\uE000" : token))
		.replace(/[ _.-]*\uE000/g, "")
		.replace(/^[ _.-]+/, "");
	return exportFileBase(text);
}
