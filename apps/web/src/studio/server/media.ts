// Local video/audio work with ffmpeg: probing, trimming, voice samples, loops, frame fitting, face check.
import fs from "node:fs";
import path from "node:path";
import { StudioError } from "./errors";
import { findTool, reason, run } from "./tools";

export interface Probe {
	/** ffprobe container names, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
	format: string;
	duration: number;
	width: number;
	height: number;
	hasVideo: boolean;
	hasAudio: boolean;
}

export async function probe(file: string, signal?: AbortSignal): Promise<Probe> {
	const r = await run(
		findTool("ffprobe"),
		["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation", "-of", "json", file],
		{ timeout: 60, signal },
	);
	if (r.status !== 0) throw new StudioError(`Can't read the file: ${reason(r)}`);
	const j = JSON.parse(r.stdout || "{}");
	const streams: any[] = j.streams ?? [];
	const v = streams.find((s) => s.codec_type === "video");
	let width = Number(v?.width ?? 0);
	let height = Number(v?.height ?? 0);
	const rotation = Math.abs(Number(v?.tags?.rotate ?? v?.side_data_list?.find((d: any) => d.rotation != null)?.rotation ?? 0));
	if (rotation === 90 || rotation === 270) [width, height] = [height, width];
	return {
		format: String(j.format?.format_name ?? ""),
		duration: Number(j.format?.duration ?? 0),
		width,
		height,
		hasVideo: !!v,
		hasAudio: streams.some((s) => s.codec_type === "audio"),
	};
}

const H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p"];
const AAC = ["-c:a", "aac", "-b:a", "192k"];

async function ffmpeg(args: string[], what: string, { signal, timeout = 900 }: { signal?: AbortSignal; timeout?: number } = {}) {
	const r = await run(findTool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", ...args], { timeout, signal });
	if (r.status !== 0) throw new StudioError(`${what}: ${reason(r)}`);
}

/** Colour description of the first video stream (primaries / transfer / matrix / range), as ffprobe names them. */
export interface ColourTags {
	primaries?: string;
	transfer?: string;
	matrix?: string;
	range?: string;
	codec?: string;
}

export async function colourTags(file: string, signal?: AbortSignal): Promise<ColourTags> {
	const r = await run(
		findTool("ffprobe"),
		["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,color_primaries,color_transfer,color_space,color_range", "-of", "json", file],
		{ timeout: 60, signal },
	);
	if (r.status !== 0) return {};
	const v = JSON.parse(r.stdout || "{}").streams?.[0] ?? {};
	const known = (x: unknown) => (typeof x === "string" && x !== "unknown" && x !== "reserved" ? x : undefined);
	return { primaries: known(v.color_primaries), transfer: known(v.color_transfer), matrix: known(v.color_space), range: known(v.color_range), codec: v.codec_name };
}

/** ffmpeg output flags that keep the source's colour description (no shift when the piece is re-encoded). */
function colourArgs(c: ColourTags): string[] {
	return [
		...(c.primaries ? ["-color_primaries", c.primaries] : []),
		...(c.transfer ? ["-color_trc", c.transfer] : []),
		...(c.matrix ? ["-colorspace", c.matrix] : []),
		...(c.range ? ["-color_range", c.range] : []),
	];
}

// H.264 VUI codes for h264_metadata.
const PRIMARIES: Record<string, number> = { bt709: 1, bt470m: 4, bt470bg: 5, smpte170m: 6, smpte240m: 7, bt2020: 9 };
const TRANSFER: Record<string, number> = { bt709: 1, smpte170m: 6, smpte240m: 7, linear: 8, iec61966_2_1: 13, bt2020_10: 14, smpte2084: 16, "arib-std-b67": 18 };
const MATRIX: Record<string, number> = { bt709: 1, fcc: 4, bt470bg: 5, smpte170m: 6, smpte240m: 7, bt2020nc: 9 };

/**
 * Gives the provider's result the source's colour description without re-encoding (h264_metadata), so the
 * lipsynced piece doesn't shift in colour next to the untouched parts of the clip. Returns false when not needed.
 */
export async function matchColour(file: string, source: ColourTags, dest: string, signal?: AbortSignal): Promise<boolean> {
	const have = await colourTags(file, signal);
	if (have.codec !== "h264" || !source.primaries) return false;
	if (have.primaries === source.primaries && have.transfer === source.transfer && have.matrix === source.matrix) return false;
	const parts = [
		PRIMARIES[source.primaries] ? `colour_primaries=${PRIMARIES[source.primaries]}` : "",
		source.transfer && TRANSFER[source.transfer] ? `transfer_characteristics=${TRANSFER[source.transfer]}` : "",
		source.matrix && MATRIX[source.matrix] ? `matrix_coefficients=${MATRIX[source.matrix]}` : "",
		source.range ? `video_full_range_flag=${source.range === "pc" ? 1 : 0}` : "",
	].filter(Boolean);
	if (!parts.length) return false;
	await ffmpeg(["-i", file, "-map", "0", "-c", "copy", "-bsf:v", `h264_metadata=${parts.join(":")}`, "-movflags", "+faststart", dest], "Couldn't tag the result's colours", { signal });
	return true;
}



/** Changes the speech tempo (0.8–1.25×) so it fits the piece exactly; pitch stays the same. */
export async function retimeSpeech(input: string, factor: number, dest: string, signal?: AbortSignal) {
	const f = Math.max(0.8, Math.min(1.25, factor));
	await ffmpeg(["-i", input, "-filter:a", `atempo=${f.toFixed(4)}`, "-vn", "-c:a", "aac", "-b:a", "192k", dest], "Couldn't fit the speech", { signal });
}

/** The speech with silence after it up to `seconds`: the lipsync then covers the whole clip, lips at rest after the voice. */
export async function padSpeech(input: string, seconds: number, dest: string, signal?: AbortSignal) {
	await ffmpeg(
		["-i", input, "-filter:a", `apad=whole_dur=${seconds.toFixed(3)}`, "-t", seconds.toFixed(3), "-vn", "-c:a", "aac", "-b:a", "192k", dest],
		"Couldn't prepare the speech",
		{ signal },
	);
}

/** Re-encodes `length` seconds from `start` to H.264 mp4 so we only pay for the part that gets lipsynced. */
export async function trimVideo(input: string, start: number, length: number, dest: string, signal?: AbortSignal, fps?: number) {
	const colour = await colourTags(input, signal);
	await ffmpeg(
		["-ss", start.toFixed(3), "-i", input, "-t", length.toFixed(3), "-map", "0:v:0", "-map", "0:a:0?", ...(fps ? ["-r", String(fps)] : []), ...H264, ...colourArgs(colour), ...AAC, "-movflags", "+faststart", dest],
		"Couldn't cut the piece",
		{ signal },
	);
}

/** A file's mean bit rate in bits per second: its size over its length (what a provider's «1–30 Mbit/s» is about). 0 when unknown. */
export async function bitrateOf(file: string, signal?: AbortSignal): Promise<number> {
	const r = await run(findTool("ffprobe"), ["-v", "error", "-show_entries", "format=duration,size,bit_rate", "-of", "json", file], { timeout: 60, signal });
	if (r.status !== 0) return 0;
	const f = JSON.parse(r.stdout || "{}").format ?? {};
	const size = Number(f.size) || (fs.existsSync(file) ? fs.statSync(file).size : 0);
	const seconds = Number(f.duration);
	return seconds > 0 && size > 0 ? Math.round((size * 8) / seconds) : Number(f.bit_rate) || 0;
}

/**
 * A clip whose bit rate is inside `min`..`max` (bits per second), for a provider that refuses anything else (kie's ByteDance
 * lipsync: 1–30 Mbit/s; a still talking head at the quality the cut was made with came out at a few hundred kbit/s, and the
 * job was refused after the upload). Too low: it is encoded again at constant bit rate (x264 pads with filler up to it),
 * too high: capped. Returns the clip to send, and whether it is a new file the caller removes after the call.
 */
export async function fitBitrate(input: string, dest: string, range: { min: number; max: number }, signal?: AbortSignal): Promise<{ file: string; changed: boolean; from: number; to: number }> {
	const from = await bitrateOf(input, signal);
	if (from === 0 || (from >= range.min && from <= range.max)) return { file: input, changed: false, from, to: from };
	const colour = await colourTags(input, signal);
	const rate = from < range.min ? Math.round(range.min * 2) : Math.round(range.max * 0.7);
	const rateArgs = from < range.min ? ["-b:v", String(rate), "-minrate", String(rate), "-maxrate", String(rate), "-bufsize", String(rate * 2), "-x264-params", "nal-hrd=cbr"] : ["-crf", "20", "-maxrate", String(rate), "-bufsize", String(rate * 2)];
	await ffmpeg(["-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", ...rateArgs, "-pix_fmt", "yuv420p", ...colourArgs(colour), "-c:a", "copy", "-movflags", "+faststart", dest], "Couldn't raise the video's bit rate", { signal });
	const to = await bitrateOf(dest, signal);
	if (to < range.min || to > range.max) {
		fs.rmSync(dest, { force: true });
		throw new StudioError(`This piece is ${(from / 1e6).toFixed(2)} Mbit/s and the model takes ${range.min / 1e6}–${range.max / 1e6} Mbit/s. Mark a longer piece or pick another model.`);
	}
	return { file: dest, changed: true, from, to };
}

/** Up to `length` seconds of speech for voice cloning; MiniMax needs at least 10 s, so short clips are looped to ~10.5 s. */
export async function voiceSample(input: string, start: number, length: number, dest: string, signal?: AbortSignal) {
	const info = await probe(input, signal);
	if (!info.hasAudio) {
		// (Claude's tools turn this into the arguments to pass instead: agent/tools.ts noVoiceToClone)
		throw new StudioError("This video has no sound — there is no voice to clone. Use a saved voice, an audio file or the audio under the clip instead.");
	}
	// Exactly the asked piece (the selected clip): a short one is looped to 10.5 s below, never widened into the
	// footage around it (another speaker).
	const len = Math.min(Math.max(length, 1), info.duration);
	if (len < 1) throw new StudioError("The video is too short to clone a voice (needs at least 1 s of speech).");
	const from = Math.max(0, Math.min(start, info.duration - len));
	const once = `${dest}.once.m4a`;
	try {
		await ffmpeg(["-ss", from.toFixed(3), "-t", len.toFixed(3), "-i", input, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "160k", once], "Couldn't extract the sound", { signal });
		if (len >= 10.5) {
			fs.renameSync(once, dest);
		} else {
			await ffmpeg(["-stream_loop", "-1", "-i", once, "-t", "10.5", "-c:a", "aac", "-b:a", "160k", dest], "Couldn't prepare the voice sample", { signal });
		}
	} finally {
		fs.rmSync(once, { force: true });
	}
	return len;
}

/** Plays the picture forward then backward (ping-pong) until it covers `length` seconds: no jump at the loop point. */
export async function pingpongVideo(input: string, length: number, dest: string, signal?: AbortSignal) {
	const once = `${dest}.pp.mp4`;
	try {
		await ffmpeg(["-i", input, "-filter_complex", "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-an", ...H264, once], "Couldn't prepare the video", { signal });
		await ffmpeg(["-stream_loop", "-1", "-i", once, "-t", length.toFixed(3), "-an", ...H264, "-movflags", "+faststart", dest], "Couldn't prepare the video", { signal });
	} finally {
		fs.rmSync(once, { force: true });
	}
}

/** Holds the last frame until the picture covers `length` seconds. */
export async function freezeVideo(input: string, length: number, dest: string, signal?: AbortSignal) {
	const info = await probe(input, signal);
	const hold = Math.max(0, length - (info.duration || 0)) + 0.05;
	await ffmpeg(["-i", input, "-vf", `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}`, "-t", length.toFixed(3), "-an", ...H264, "-movflags", "+faststart", dest], "Couldn't prepare the video", { signal });
}

/** The speech cut to `seconds` with a short fade, when it must not run past the picture. */
export async function cutSpeech(input: string, seconds: number, dest: string, signal?: AbortSignal) {
	const fade = Math.min(0.15, seconds / 4);
	await ffmpeg(["-i", input, "-t", seconds.toFixed(3), "-af", `afade=t=out:st=${Math.max(0, seconds - fade).toFixed(3)}:d=${fade.toFixed(3)}`, "-vn", ...AAC, dest], "Couldn't cut the speech", { signal });
}

/**
 * Cuts a result back to `seconds` in place, to the frame (a stream copy ends on a packet: 0.07–0.17 s long, which pushed
 * the next clip); a result already that short stays.
 */
export async function endAt(file: string, seconds: number, dir: string, signal?: AbortSignal) {
	if ((await probe(file, signal)).duration <= seconds + 0.02) return;
	const cut = path.join(dir, "result_end.mp4");
	await ffmpeg(["-i", file, "-t", seconds.toFixed(3), "-map", "0:v:0", "-map", "0:a:0?", ...H264, ...AAC, "-movflags", "+faststart", cut], "Couldn't finish the result", { signal });
	fs.renameSync(cut, file);
}

/** Loops the picture (without sound) until it covers `length` seconds, for models that would cut the speech. */
export async function loopVideo(input: string, length: number, dest: string, signal?: AbortSignal) {
	await ffmpeg(["-stream_loop", "-1", "-i", input, "-t", length.toFixed(3), "-an", ...H264, "-movflags", "+faststart", dest], "Couldn't loop the video", { signal });
}

/** One face the check saw (box in 0…1 of the frame, top-left origin), followed over the sampled frames. */
export interface SeenFace {
	box: [number, number, number, number];
	/** Sampled frames it was in (of `frames`). */
	hits: number;
	/** The largest head turn seen, radians (0 = facing the camera). */
	yaw: number;
	roll: number;
	/** The lip landmarks' lowest confidence (low: the mouth is hidden or blurred). */
	conf: number;
	/** A hand at the mouth in a sampled frame. */
	hand: boolean;
}

/** Face check with Apple Vision (a small helper shipped inside the app). Null when the helper is missing. */
export async function faceCheck(
	file: string,
	range: { start: number; length: number } | null,
	signal?: AbortSignal,
): Promise<{ found: boolean; size: number; frames: number; faces: SeenFace[] } | null> {
	const tool = process.env.STUDIO_BIN_DIR && path.join(process.env.STUDIO_BIN_DIR, "facecheck");
	if (!tool || !fs.existsSync(tool)) return null;
	try {
		const args = range ? [file, range.start.toFixed(3), range.length.toFixed(3)] : [file];
		const r = await run(tool, args, { timeout: 60, signal });
		const j = JSON.parse(r.stdout.trim().split("\n").pop() || "{}");
		if (j.error) return null;
		// (an older helper has no "faces": its one box stands for one face)
		const faces: SeenFace[] = Array.isArray(j.faces)
			? j.faces.map((f: Partial<SeenFace>) => ({ box: (f.box ?? [0, 0, 0, 0]).map(Number) as SeenFace["box"], hits: Number(f.hits ?? 0), yaw: Number(f.yaw ?? 0), roll: Number(f.roll ?? 0), conf: Number(f.conf ?? 1), hand: !!f.hand }))
			: j.found
				? [{ box: j.box, hits: Number(j.hits ?? 1), yaw: 0, roll: 0, conf: 1, hand: false }]
				: [];
		return { found: !!j.found, size: j.found ? Number(j.box?.[2] ?? 0) : 0, frames: Number(j.frames ?? 0), faces };
	} catch {
		return null;
	}
}
