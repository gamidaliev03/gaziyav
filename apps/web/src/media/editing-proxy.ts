import { appPrefs } from "@/settings/app-prefs";
import { hardwareTier } from "@/platform/hardware-client";

/** Below this size software decoding is cheap enough. */
const MIN_PIXELS = 1280 * 720;

/** 4K and up: there a phone's HEVC is too slow to seek (below, at 1080p, it is fine). */
const HEVC_PROXY_PIXELS = 3840 * 2160;

/**
 * Whether a decodable clip gets an H.264 copy for editing (decoded by the graphics chip, a key frame every half second):
 * codecs this Mac decodes in software (AV1 on M1/M2, H.264 10-bit) seeked in 0.2–1.6 s and scrubbed at 3–11 frames
 * per second. Key frames far apart alone are not enough: at 1080p the copy gained little for its conversion time.
 * 4K HEVC (a phone's 4K, 8 or 10 bit), though decoded by the graphics chip, seeked in 150–171 ms (p95) and its 10-bit
 * missed a third of a mouse scrub's frames, against 77 ms for 4K H.264 (test/media-4k-hevc.mjs): it gets the copy too.
 * Transparent video keeps its original (the copy would lose the alpha).
 */
export function needsEditingProxy({
	width,
	height,
	hardwareDecode,
	transparent,
	codec = null,
}: {
	width: number;
	height: number;
	hardwareDecode: boolean | null;
	transparent: boolean;
	codec?: string | null;
}): boolean {
	// No switch in Settings any more (perf round B): the stored pref is a test knob (pro-heavy edits the original).
	if (!appPrefs().editingProxies || transparent) return false;
	const pixels = width * height;
	if (hardwareDecode === false && pixels >= MIN_PIXELS) return true;
	// An 8 GB Mac (platform/hardware.ts "base") edits every 4K file from its copy: decoding 4K frames for scrubbing
	// there pushes memory and seeks.
	if (pixels >= HEVC_PROXY_PIXELS && hardwareTier() === "base") return true;
	return codec === "hevc" && pixels >= HEVC_PROXY_PIXELS;
}
