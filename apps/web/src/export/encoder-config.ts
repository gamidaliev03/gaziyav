/**
 * Encoder settings of an export: video codec and bitrate, audio codec, bitrate and mode, encoder priming.
 * The exporter (services/renderer/scene-exporter.ts) only calls these.
 * Owner: codec9 (codecs).
 */
import {
	type AudioEncodingConfig,
	QUALITY_HIGH,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_VERY_HIGH,
	type VideoEncodingConfig,
} from "mediabunny";
import { AUDIO_BITRATE, videoBitrateFor } from "./bitrate";
import type { ExportFormat, ExportQuality } from "./index";

const VIDEO_BITRATE = {
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
} as const;

export function videoEncodingConfig({
	format,
	quality,
	bitrate,
	size,
	fps,
	hardwareEncoding = true,
}: {
	format: ExportFormat;
	quality: ExportQuality;
	/** Bits per second (Export → Bit rate → Custom, or a master for the ffmpeg pass); else the quality's rate. */
	bitrate?: number;
	/** The frame size and rate: with them the quality's rate is the platforms' recommended one (export/bitrate.ts), as
	 * the Export window computes it; without them mediabunny's preset (an export asked for by a tool, not the window). */
	size?: { width: number; height: number };
	fps?: number;
	/** Settings → Performance → Speed up hardware encoding. */
	hardwareEncoding?: boolean;
}): VideoEncodingConfig {
	return {
		codec: format === "webm" ? "vp9" : "avc",
		bitrate: bitrate && bitrate > 0 ? Math.round(bitrate) : size ? videoBitrateFor({ ...size, fps, format, quality }) : VIDEO_BITRATE[quality],
		...(hardwareEncoding ? {} : { hardwareAcceleration: "prefer-software" as const }),
	};
}

export type ExportAudioCodec = "aac" | "opus" | "pcm-s16";

/** The steps here that fell back since the last take (exp2, 14.11: no silent fallback — the export says each one). */
const fellBack: Array<{ step: "aac"; reason: string }> = [];
export function takeEncoderFallbacks(): Array<{ step: "aac"; reason: string }> {
	return fellBack.splice(0, fellBack.length);
}
/** Test harness only (a test sets `window.__exportForce` through the debug port): the AAC encoder taken as missing. */
const aacForced = (): boolean => {
	const list = typeof window === "undefined" ? null : (window as unknown as { __exportForce?: unknown }).__exportForce;
	return Array.isArray(list) && list.includes("aac");
};

/**
 * AAC in MP4 (Opus when this machine has no AAC encoder for the mix), Opus in WebM. The rates are export/bitrate.ts
 * AUDIO_BITRATE (320 kbit/s for Recommended: the Mac's encoder writes well under what is asked, see there); «constant»
 * is asked for but the Mac's AAC encoder does not keep it.
 */
export async function audioEncodingConfig({
	format,
	quality,
	sampleRate,
	numberOfChannels,
}: {
	format: ExportFormat;
	quality: ExportQuality;
	sampleRate: number;
	numberOfChannels: number;
}): Promise<AudioEncodingConfig & { codec: ExportAudioCodec }> {
	let codec: ExportAudioCodec = format === "webm" ? "opus" : "aac";
	let bitrate = AUDIO_BITRATE[quality];
	// A browser with no audio encoder for pages at all (Safari up to 18, macOS 15 / iOS 18): the mix goes in
	// uncompressed — 16-bit PCM, which MP4 carries and mediabunny writes itself — a bigger file WITH its sound instead
	// of an export that fails. Never taken in the Mac app, Chrome, Edge or Safari 26+ (they have AudioEncoder).
	if (typeof AudioEncoder === "undefined" && format !== "webm") {
		fellBack.push({ step: "aac", reason: "this browser has no audio encoder: the sound is written uncompressed (PCM)" });
		return { codec: "pcm-s16" };
	}
	if (codec === "aac" && typeof AudioEncoder !== "undefined") {
		// The rate the encoder takes for this layout (320 kbit/s is stereo only: mono stops at 256), else Opus.
		const steps = [...new Set([bitrate, 256000, 192000])].filter((b) => b <= bitrate);
		let taken: number | null = null;
		for (const b of aacForced() ? [] : steps) {
			const { supported } = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate, numberOfChannels, bitrate: b });
			if (supported) {
				taken = b;
				break;
			}
		}
		if (taken === null) {
			codec = "opus";
			fellBack.push({ step: "aac", reason: `no AAC encoder for ${numberOfChannels} ch ${sampleRate} Hz` });
		}
		else bitrate = taken;
	}
	return {
		codec,
		bitrate: codec === "opus" ? Math.min(bitrate, 256000) : bitrate,
		bitrateMode: "constant",
	};
}

/**
 * The AAC encoder behind WebCodecs on macOS (AudioToolbox) prepends 2112
 * priming samples, and the MP4 gets no edit list for them, so every exported
 * file had its audio 44 ms late (gate export.av: 44-60 ms). The mix is fed that
 * many samples early instead (the first 44 ms of the mix are dropped).
 */
export const AAC_ENCODER_DELAY_SAMPLES = 2112;

/** Samples of the mix to skip so the encoded audio starts on time. */
export function encoderDelaySamples(codec: ExportAudioCodec): number {
	return codec === "aac" ? AAC_ENCODER_DELAY_SAMPLES : 0;
}
