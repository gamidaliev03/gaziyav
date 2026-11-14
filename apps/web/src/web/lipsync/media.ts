// Media in the page, with the muxing library the editor already ships for its browser export (mediabunny, MPL-2.0)
// over the browser's WebCodecs — no ffmpeg. The clip's USED span → an MP4 the provider takes (H.264 + AAC, SDR, at
// most 1080 on the short side, the source's own frame rate); the clip's sound → a WAV sample for the voice.
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH, WavOutputFormat } from "mediabunny";
import { WebLipError } from "./sentences";

export interface Probe {
	duration: number;
	hasVideo: boolean;
	hasAudio: boolean;
	width: number;
	height: number;
	fps: number;
	hdr: boolean;
}

export async function probe(blob: Blob): Promise<Probe> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const [duration, video, audio] = await Promise.all([input.computeDuration(), input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
		const fps = video ? (await video.computePacketStats(120)).averagePacketRate : 0;
		const hdr = video ? await video.hasHighDynamicRange().catch(() => false) : false;
		return { duration, hasVideo: !!video, hasAudio: !!audio, width: video?.displayWidth ?? 0, height: video?.displayHeight ?? 0, fps, hdr };
	} finally {
		input.dispose?.();
	}
}

/** Even sides, the short one at most `cap` (the provider's 1080p). */
export function fitSize(w: number, h: number, cap = 1080): { width: number; height: number } {
	const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
	const short = Math.min(w, h);
	if (short <= cap) return { width: even(w), height: even(h) };
	const k = cap / short;
	return { width: even(w * k), height: even(h * k) };
}

/** A clean frame rate: 29.97 stays 29.97, 30.02 measured on packets becomes 30. */
export function cleanFps(measured: number): number {
	if (!(measured > 0)) return 30;
	const near = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60].reduce((a, b) => (Math.abs(b - measured) < Math.abs(a - measured) ? b : a));
	if (Math.abs(near - measured) < 0.06) return near;
	return Math.round(measured * 100) / 100;
}

/** The used span [start, start + length) of the clip as the MP4 that is sent. */
export async function prepareSpan(blob: Blob, start: number, length: number, onProgress?: (p: number) => void): Promise<{ file: Blob; info: Probe }> {
	const info = await probe(blob);
	if (!info.hasVideo) throw new WebLipError("web.no_video");
	const end = Math.min(info.duration, start + length);
	const size = fitSize(info.width, info.height);
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
	try {
		const conversion = await Conversion.init({
			input,
			output,
			trim: { start, end },
			video: { codec: "avc", ...size, fit: "contain", frameRate: cleanFps(info.fps), bitrate: QUALITY_HIGH, forceTranscode: true, allowRotationMetadata: false },
			audio: { codec: "aac", bitrate: 192_000, forceTranscode: true },
			showWarnings: false,
		});
		if (!conversion.isValid) throw new WebLipError("web.prepare", conversion.discardedTracks.map((d) => d.reason).join(", "));
		if (onProgress) conversion.onProgress = onProgress;
		await conversion.execute();
	} catch (error) {
		if (error instanceof WebLipError) throw error;
		throw new WebLipError("web.prepare", String((error as Error)?.message ?? error));
	} finally {
		input.dispose?.();
	}
	const buffer = (output.target as BufferTarget).buffer;
	if (!buffer) throw new WebLipError("web.prepare", "empty output");
	return { file: new Blob([buffer], { type: "video/mp4" }), info };
}

/** The clip's own sound over [start, start + length) as a mono WAV: the voice's sample. */
export async function voiceSample(blob: Blob, start: number, length: number): Promise<{ file: Blob; seconds: number }> {
	const info = await probe(blob);
	if (!info.hasAudio) throw new WebLipError("web.no_sound");
	const end = Math.min(info.duration, start + length);
	if (end - start < 3) throw new WebLipError("web.too_short");
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	const output = new Output({ format: new WavOutputFormat(), target: new BufferTarget() });
	try {
		const conversion = await Conversion.init({ input, output, trim: { start, end }, video: { discard: true }, audio: { numberOfChannels: 1, codec: "pcm-s16" }, showWarnings: false });
		if (!conversion.isValid) throw new WebLipError("web.prepare", "sound");
		await conversion.execute();
	} catch (error) {
		if (error instanceof WebLipError) throw error;
		throw new WebLipError("web.prepare", String((error as Error)?.message ?? error));
	} finally {
		input.dispose?.();
	}
	return { file: new Blob([(output.target as BufferTarget).buffer as ArrayBuffer], { type: "audio/wav" }), seconds: end - start };
}

export interface Media {
	probe: typeof probe;
	prepareSpan: typeof prepareSpan;
	voiceSample: typeof voiceSample;
}

export const browserMedia: Media = { probe, prepareSpan, voiceSample };
