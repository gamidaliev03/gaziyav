import type { FrameRate } from "opencut-wasm";

export const EXPORT_QUALITY_VALUES = [
	"low",
	"medium",
	"high",
	"very_high",
] as const;

/** Containers the page itself encodes into (H.264 MP4/MOV, VP9 WebM); GIF and other codecs: export/target.ts. */
export const EXPORT_FORMAT_VALUES = ["mp4", "webm", "mov"] as const;

export type ExportFormat = (typeof EXPORT_FORMAT_VALUES)[number];
export type ExportQuality = (typeof EXPORT_QUALITY_VALUES)[number];

export interface ExportOptions {
	format: ExportFormat;
	quality: ExportQuality;
	fps?: FrameRate;
	includeAudio?: boolean;
	/** Only the main video track: no text, graphics, overlays or audio tracks (e.g. a montage sent to lipsync). */
	mainTrackOnly?: boolean;
	/** Bring the soundtrack to −14 LUFS (social-media loudness). Default: on. */
	normalizeLoudness?: boolean;
	/** Loudness the soundtrack is brought to (Settings → Edit → Target loudness); default −14 LUFS. */
	targetLufs?: number;
	/** Export only this In→Out range (media ticks), e.g. from the I / O marks. */
	range?: { start: number; end: number };
	/** Output size (even numbers) when it is not the canvas: Export → Resolution scales every frame to it. */
	size?: { width: number; height: number };
	/** Video bits per second instead of the quality preset (Export → Bit rate → Custom, or a master for ffmpeg). */
	bitrate?: number;
	/** Settings → Performance → Speed up hardware encoding (default on). */
	hardwareEncoding?: boolean;
	/** Edit cover → «Add video cover at the beginning»: the cover fills the first frames, the sound starts after it. */
	cover?: { image: CanvasImageSource & { width: number; height: number }; seconds: number };
	/**
	 * A master for the server's pass (frame interpolation, upscale, another codec): its sound keeps every packet after
	 * the priming — ffmpeg copies whole packets and drops one the edit cuts into — and the pass ends the sound where the
	 * film ends (export/server/files.ts endSoundOf). A file made in the page ends its sound with the picture itself.
	 */
	master?: boolean;
	/** Export selected clips: only these timeline elements; `plain` keeps just their position, size and speed. */
	elements?: { ids: string[]; plain?: boolean };
	/**
	 * The file is written here as it grows instead of being held in memory: a long video filled the page's memory
	 * («Array buffer allocation failed») and froze the Mac (05.11). The result then has `bytes`, no `buffer`.
	 */
	toFile?: ExportFileWriter;
}

/** Where a growing export goes, piece by piece (the muxer goes back to patch sizes, so positions aren't only rising). */
export interface ExportFileWriter {
	write: (position: number, data: Uint8Array) => Promise<void>;
	/** The file starts again from nothing (the renderer writes the same export another way). */
	reset?: () => Promise<void>;
}

export interface ExportResult {
	success: boolean;
	buffer?: ArrayBuffer;
	/** Size of a file written through `toFile`. */
	bytes?: number;
	error?: string;
	cancelled?: boolean;
}

export interface ExportState {
	isExporting: boolean;
	progress: number;
	result: ExportResult | null;
	/** The time left by the export's measured speed (seconds); null: nothing measured yet; absent: not known this way. */
	etaSeconds?: number | null;
}

export function downloadBuffer({
	buffer,
	filename,
	mimeType,
}: {
	buffer: ArrayBuffer;
	filename: string;
	mimeType: string;
}): void {
	const blob = new Blob([buffer], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const downloadLink = document.createElement("a");
	downloadLink.href = url;
	downloadLink.download = filename;
	document.body.appendChild(downloadLink);
	downloadLink.click();
	document.body.removeChild(downloadLink);
	URL.revokeObjectURL(url);
}
