// The file an export wrote, measured as a file (not the timeline it came from): its real length, picture and sound,
// loudness, black and silent stretches, and three of its frames. Five of six exam briefs (11.11) ended with Claude
// wanting to run ffprobe on the export — «look» shows the timeline, and the export's own answer repeated the
// timeline's numbers. Only files of the folders the app may read, or files the app itself exported.
import { execFile } from "node:child_process";
import path from "node:path";
import { StudioError } from "@/studio/server/errors";
import { allowedFile } from "@/studio/server/local-files";
import { findTool } from "@/studio/server/tools";

export interface FileCheck {
	seconds: number;
	width: number;
	height: number;
	fps: number;
	hasVideo: boolean;
	hasAudio: boolean;
	lufs: number | null;
	peak: number | null;
	/** Stretches of black picture, seconds of the file. */
	black: Array<[number, number]>;
	/** Stretches with no sound at all (≥ 2 s). */
	silent: Array<[number, number]>;
	/** Small JPEGs (data URLs): the first frame, the middle, the last second. */
	frames: string[];
	/** The whole picture was read (false: a long file, key frames only). */
	whole: boolean;
}

const run = (file: string, args: string[], timeoutMs: number, binary = false) =>
	new Promise<{ out: Buffer; err: string }>((resolve) => {
		execFile(file, args, { timeout: Math.round(timeoutMs), maxBuffer: 24 * 1024 * 1024, encoding: "buffer" }, (_error, stdout, stderr) => resolve({ out: binary ? (stdout as Buffer) : Buffer.from(stdout as Buffer), err: String(stderr ?? "") }));
	});

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export async function checkFile(file: string, frames = 3): Promise<FileCheck> {
	const real = allowedFile(file);
	if (!/\.(mp4|mov|webm|m4v|mkv)$/i.test(real)) throw new StudioError("Only a video file can be checked.");
	const ffmpeg = findTool("ffmpeg");
	const ffprobe = path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
	const probe = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate", "-of", "json", real], 20_000);
	let meta: { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string }> } = {};
	try {
		meta = JSON.parse(probe.out.toString("utf8"));
	} catch {
		throw new StudioError("The file can't be read as a video.");
	}
	const video = meta.streams?.find((s) => s.codec_type === "video");
	const audio = meta.streams?.find((s) => s.codec_type === "audio");
	const seconds = Number(meta.format?.duration) || 0;
	const [n, d] = String(video?.avg_frame_rate ?? "0/1").split("/").map(Number);
	const whole = seconds <= 240;
	// One pass for the picture (black stretches; a long file by its key frames) and the sound (loudness, silence).
	const pass = await run(
		ffmpeg,
		["-hide_banner", "-nostdin", ...(whole ? [] : ["-skip_frame", "nokey"]), "-i", real, ...(video ? ["-vf", "scale=160:-2,blackdetect=d=0.3:pix_th=0.06"] : ["-vn"]), ...(audio ? ["-af", "silencedetect=n=-55dB:d=2,ebur128=peak=true:framelog=quiet"] : ["-an"]), "-f", "null", "-"],
		Math.max(60_000, seconds * 1500),
	);
	const black = [...pass.err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [round(Number(m[1])), round(Number(m[2]))] as [number, number]);
	const starts = [...pass.err.matchAll(/silence_start: ?(-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
	const ends = [...pass.err.matchAll(/silence_end: ?([\d.]+)/g)].map((m) => Number(m[1]));
	const silent = starts.map((s, i) => [round(s), round(ends[i] ?? seconds)] as [number, number]);
	const tail = pass.err.slice(-2500);
	const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(tail)?.[1]);
	const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(tail)?.[1]);
	const shots: string[] = [];
	if (video && frames > 0 && seconds > 0) {
		const at = [0, seconds / 2, Math.max(0, seconds - 0.5)].slice(0, frames);
		for (const t of at) {
			const r = await run(ffmpeg, ["-v", "error", "-nostdin", "-ss", t.toFixed(2), "-i", real, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),480,-2)':'if(gt(iw,ih),-2,480)'", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "6", "-"], 20_000, true);
			if (r.out.length > 500) shots.push(`data:image/jpeg;base64,${r.out.toString("base64")}`);
		}
	}
	return { seconds: round(seconds), width: video?.width ?? 0, height: video?.height ?? 0, fps: d ? round(n / d, 1) : 0, hasVideo: !!video, hasAudio: !!audio, lufs: Number.isFinite(lufs) ? lufs : null, peak: Number.isFinite(peak) ? peak : null, black, silent, frames: shots, whole };
}

/**
 * Frames of a video file at its own seconds, as small JPEGs (data URLs): a Media file looked at directly — who is on
 * screen at 12:03, where exactly the picture changes, a contact sheet of a 10-s shot before a piece of it is chosen
 * (three exam briefs wanted this: `look` showed only the timeline or one thumbnail per file).
 */
export async function framesAt(file: string, times: number[], side = 480): Promise<Array<{ at: number; src: string }>> {
	const ffmpeg = findTool("ffmpeg");
	const out: Array<{ at: number; src: string }> = [];
	for (const t of times.slice(0, 8)) {
		const at = Math.max(0, Number(t) || 0);
		const r = await run(ffmpeg, ["-v", "error", "-nostdin", "-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale='if(gt(iw,ih),${side},-2)':'if(gt(iw,ih),-2,${side})'`, "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "6", "-"], 20_000, true);
		if (r.out.length > 500) out.push({ at: round(at), src: `data:image/jpeg;base64,${r.out.toString("base64")}` });
	}
	return out;
}

/** The check in words for Claude: the file's own facts first, then only what is wrong with it. */
export function checkLine(c: FileCheck, want?: { seconds?: number }): string {
	const spans = (list: Array<[number, number]>) => list.slice(0, 4).map(([a, b]) => `${a}–${b} s`).join(", ") + (list.length > 4 ? ` and ${list.length - 4} more` : "");
	const wrong: string[] = [];
	if (!c.hasVideo) wrong.push("NO PICTURE in the file");
	if (!c.hasAudio) wrong.push("NO SOUND in the file");
	// (the cover adds a few frames before the video; more than half a second apart is a real difference)
	if (want?.seconds && Math.abs(c.seconds - want.seconds) > 0.5) wrong.push(`the file is ${c.seconds} s but the timeline was ${round(want.seconds)} s`);
	if (c.black.length) wrong.push(`black picture at ${spans(c.black)}`);
	if (c.silent.length) wrong.push(`no sound at all at ${spans(c.silent)}`);
	const facts = [`${c.seconds} s`, c.hasVideo ? `${c.width}×${c.height} ${c.fps} fps` : "", c.hasAudio ? (c.lufs !== null ? `sound ${c.lufs} LUFS${c.peak !== null ? `, peak ${c.peak} dB` : ""}` : "sound") : ""].filter(Boolean).join(" · ");
	return `The file itself, checked: ${facts} · ${wrong.length ? `⚠ ${wrong.join("; ")}` : `no black or silent stretch${c.whole ? "" : " (a long file: its key frames were read)"}`}.${c.frames.length ? ` Its frames: first, middle, last second.` : ""}`;
}
