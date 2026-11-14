// Export as a build: the plan of one export (render, 11.11) — its stretches, each with its key, the mix's key, and
// what of it the app's work folder already holds. Null when this export is made the old way: no work folder to keep
// stretches in (a browser, an older app), a format the page does not encode as H.264, the switch off (./switch.ts).
import type { ExportOptions } from "@/export";
import { AUDIO_BITRATE } from "@/export/bitrate";
import { videoEncodingConfig } from "@/export/encoder-config";
import { exportedFrameCount } from "@/export/frame-count";
import { frameRateToFloat } from "@/fps/utils";
import { collectAudibleCandidates } from "@/media/audio";
import type { MediaAsset } from "@/media/types";
import type { TBackground, TCanvasSize } from "@/project/types";
import type { SceneTracks } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import type { FrameRate } from "opencut-wasm";
import { type BuildCache, type KeptInfo, openBuildCache } from "./cache-client";
import type { BuildSegment } from "./exporter";
import { audioKey, type TracksLike, videoKeys } from "./key";
import { cutFrames, segmentRanges } from "./segments";
import { buildExportOn } from "./switch";

export interface BuildPlan {
	cache: BuildCache;
	segments: BuildSegment[];
	/** the mix's key, or null for an export without sound */
	audioKey: string | null;
	kept: Map<string, KeptInfo>;
}


export async function planBuild({
	options,
	tracks,
	mediaAssets,
	duration,
	canvasSize,
	background,
	fps,
}: {
	options: ExportOptions;
	/** the tracks the scene is built from (compositions flattened, the In→Out range cut out) */
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	/** ticks */
	duration: number;
	canvasSize: TCanvasSize;
	background: TBackground;
	fps: FrameRate;
}): Promise<BuildPlan | null> {
	// (a file that can start again from nothing: whatever this way can't finish is then rendered the old way)
	if (!options.toFile?.reset || (options.format !== "mp4" && options.format !== "mov") || !buildExportOn()) return null;
	const fpsFloat = frameRateToFloat(fps);
	if (!(Number.isFinite(fpsFloat) && fpsFloat > 0)) return null;
	const cache = await openBuildCache();
	if (!cache) return null;
	const ticksPerFrame = Math.max(1, Math.round(TICKS_PER_SECOND / fpsFloat));
	const frameCount = exportedFrameCount({ durationTicks: duration, ticksPerFrame });
	if (frameCount <= 0) return null;
	const size = options.size ?? canvasSize;
	const encoding = videoEncodingConfig({ format: options.format, quality: options.quality, bitrate: options.bitrate, size, fps: fpsFloat, hardwareEncoding: options.hardwareEncoding ?? true });
	const visual = [...tracks.overlay, tracks.main];
	const spans = visual.flatMap((track) => track.elements as ReadonlyArray<{ startTime: number; duration: number }>);
	const ranges = segmentRanges({ cuts: cutFrames({ elements: spans, ticksPerFrame, frameCount }), frameCount, fps: fpsFloat });
	const lead = options.cover ? Math.max(1, Math.round(options.cover.seconds * fpsFloat)) / fpsFloat : 0;
	// everything that is the same for every stretch of this export
	const global = {
		salt: cache.salt,
		browser: typeof navigator === "undefined" ? "" : navigator.userAgent,
		canvas: [canvasSize.width, canvasSize.height],
		background,
		size: [size.width, size.height],
		fps: [fps.numerator, fps.denominator],
		codec: encoding.codec,
		bitrate: encoding.bitrate,
		hardware: options.hardwareEncoding ?? true,
		mainTrackOnly: options.mainTrackOnly ?? false,
	};
	const keys = await videoKeys({ tracks: tracks as unknown as TracksLike, assets: mediaAssets, ranges, ticksPerFrame, ticksPerSecond: TICKS_PER_SECOND, global });
	const segments = ranges.map((range, index) => ({ ...range, key: keys[index] }));
	let mix: string | null = null;
	if (options.includeAudio) {
		const audible = collectAudibleCandidates({ tracks, mediaAssets }).map((candidate) => candidate.element);
		mix = await audioKey({
			elements: audible as unknown as Parameters<typeof audioKey>[0]["elements"],
			tracks: tracks as unknown as TracksLike,
			assets: mediaAssets,
			global: { salt: cache.salt, browser: global.browser, duration, lead, normalize: options.normalizeLoudness ?? false, targetLufs: options.normalizeLoudness ? (options.targetLufs ?? null) : null, bitrate: AUDIO_BITRATE[options.quality], format: "aac" },
		});
	}
	const kept = await cache.have(mix ? [...keys, mix] : keys);
	return { cache, segments, audioKey: mix, kept };
}
