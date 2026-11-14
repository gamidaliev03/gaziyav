/**
 * The video bit rate behind Export → Bit rate. «Recommended» is what the platforms ask for in H.264: YouTube's upload
 * table for SDR video (the fullest one published; TikTok, Reels and Shorts take the same or less), by the resolution
 * class (the short side) at up to 30 fps and above it. Lower and Higher are steps from it (Higher keeps VK Clips'
 * 12+ Mbit/s at 1080p). Before 07.11 «Recommended» was mediabunny's preset, 6 Mbit/s at 1080p (final-B D6: 9.8 → 6.0).
 */
import type { ExportFormat, ExportQuality } from "./index";

export const RECOMMENDED_MBPS: ReadonlyArray<readonly [short: number, upTo30fps: number, above30fps: number]> = [
	[360, 1, 1.5],
	[480, 2.5, 4],
	[720, 5, 7.5],
	[1080, 8, 12],
	[1440, 16, 24],
	[2160, 35, 53],
];

/** Lower · Recommended · Higher over the quality presets (`low` is an old saved value: it reads as a lower «Lower»). */
export const QUALITY_STEP: Record<ExportQuality, number> = { low: 0.4, medium: 0.6, high: 1, very_high: 1.5 };

/**
 * AAC targets. The Mac's AAC encoder writes fewer bits than asked (no constant mode through WebCodecs): a voice-over
 * mixed to stereo (the same sound left and right) came out at 114 kbit/s for 192 asked, as its joint-stereo coding puts
 * everything into the mid channel (rc9 wrote the mix in mono and read 180; final-B D6, 07.11). 320 kbit/s, AAC-LC's
 * most for stereo, lands such a voice at about 190 and music near 300; 256 where the encoder refuses 320 (mono).
 */
export const AUDIO_BITRATE: Record<ExportQuality, number> = { low: 192_000, medium: 256_000, high: 320_000, very_high: 320_000 };

/**
 * The recommended bits per second for a frame size: its class's row, the 60 fps column above 30 fps, scaled by the
 * pixel count against the class's 16:9 frame (a 9:16 frame is the same; a square one is half; 8K follows on from 4K).
 */
export function recommendedBitrate({ width, height, fps = 30 }: { width: number; height: number; fps?: number }): number {
	const short = Math.max(2, Math.min(width, height));
	const row = RECOMMENDED_MBPS.find(([s]) => short <= s + 8) ?? RECOMMENDED_MBPS[RECOMMENDED_MBPS.length - 1];
	const [rowShort, upTo30, above30] = row;
	const mbps = fps > 30.5 ? above30 : upTo30;
	const area = (width * height) / ((rowShort * rowShort * 16) / 9);
	return Math.round(mbps * 1_000_000 * Math.max(0.5, area));
}

/**
 * What the encoder writes for its target on ordinary footage: VideoToolbox (and the software H.264) land about a
 * fifth under it (a 1080p talking clip at 8 Mbit/s came out at 6.2–7.3, 07.11), so the target is set that much above
 * the platforms' rate for the file to carry it. Measured, not a mode: WebCodecs' `bitrateMode: "constant"` changed nothing.
 */
export const ENCODER_YIELD = 0.8;

/**
 * The encoder's target (bits per second) of a bit-rate choice: the platforms' rate over the encoder's yield, × the
 * step, VP9 (WebM) at 0.6 of H.264. At 1080p30 Recommended asks for 10 Mbit/s and the file carries about 8.
 */
export function videoBitrateFor({ width, height, fps, format, quality }: { width: number; height: number; fps?: number; format: ExportFormat; quality: ExportQuality }): number {
	const codec = format === "webm" ? 0.6 : 1;
	return Math.ceil((recommendedBitrate({ width, height, fps }) * codec * QUALITY_STEP[quality]) / ENCODER_YIELD / 1000) * 1000;
}
