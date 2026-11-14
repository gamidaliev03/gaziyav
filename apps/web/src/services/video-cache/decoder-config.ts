/**
 * How a video file is opened for decoding, and what happens when decoding fails. The preview, export and
 * filmstrip decoders (service.ts, thumbnails.worker.ts) only call these.
 * Owner: codec9 (codecs, video errors).
 */
import { ALL_FORMATS, Input, type InputVideoTrack } from "mediabunny";
import { fileSource } from "@/media/file-source";

export type DecodableVideo = {
	input: Input;
	track: InputVideoTrack;
	/** Draw frames with their alpha (transparent video keeps it). */
	alpha: boolean;
};

/**
 * Opens the file's primary video track, checks this machine can decode its codec (WebCodecs), and decides
 * whether frames keep their alpha. Throws a readable error otherwise; the input is disposed on failure.
 */
export async function openVideoForDecoding(file: File): Promise<DecodableVideo> {
	const input = new Input({
		source: fileSource(file),
		formats: ALL_FORMATS,
	});
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) {
			throw new Error("No video track found");
		}
		if (!(await track.canDecode())) {
			throw new Error("Video codec not supported for decoding");
		}
		const alpha = keepsAlpha({
			codec: track.codec,
			canBeTransparent: await track.canBeTransparent().catch(() => false),
		});
		return { input, track, alpha };
	} catch (error) {
		input.dispose();
		throw error;
	}
}

/**
 * Transparent video keeps its alpha: HEVC with alpha (Effects → AI → Remove Background, Apple cut-outs) and
 * WebM with alpha. Opaque HEVC simply decodes with alpha 1.
 */
export function keepsAlpha({ codec, canBeTransparent }: { codec: string | null; canBeTransparent: boolean }): boolean {
	return codec === "hevc" || canBeTransparent;
}

/**
 * Whether this machine decodes the track on its graphics chip (VideoToolbox). False for codecs decoded in software
 * (AV1 on M1/M2, H.264 10-bit): seeking them costs several times more. Null when unknown.
 */
export async function decodesInHardware(track: InputVideoTrack): Promise<boolean | null> {
	if (typeof VideoDecoder === "undefined") return null;
	try {
		const config = await track.getDecoderConfig();
		if (!config) return null;
		const { supported } = await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration: "prefer-hardware" });
		return !!supported;
	} catch {
		return null;
	}
}

export type DecodeFailure = {
	/** The decoder key (media id, or a lane/track/transition key derived from it). */
	mediaId: string;
	/** Source time in seconds, when the failure is tied to one. */
	time?: number;
	/** "open": the file or its codec could not be opened; "decode": a frame could not be decoded. */
	stage: "open" | "decode";
	error: unknown;
};

/**
 * Every decode failure of the preview and export decoders lands here. For now it only logs, as before;
 * codec9 turns it into a deduplicated message for the user and a repaired copy of the file.
 */
export function reportDecodeFailure({ mediaId, time, stage, error }: DecodeFailure): void {
	if (stage === "open") {
		console.error(`Failed to initialize video sink for ${mediaId}:`, error);
	} else {
		console.warn(`Video decode failed (${mediaId}${time === undefined ? "" : ` at ${time.toFixed(3)} s`}):`, error);
	}
}
