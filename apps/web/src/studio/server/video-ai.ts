// Picture tools without a model, in CapCut's places: Video → Basic → Remove flickers (ffmpeg's deflicker: the frame
// brightness evened out over a few frames — lights on mains power, timelapses) and Adjust → AI color correction (white
// balance by the grey-world rule, then black and white points stretched, both followed smoothly over time). Each makes
// a processed copy of the clip through the AI-effect cache (neural.ts); the sound is copied as it is. ⌘Z or "Use
// original" brings the original back (neural/apply.ts). And Adjust → Color match: the clip's colours brought to a
// reference picture or clip (its histogram comes from the editor) by matching the histograms channel by channel.
import os from "node:os";
import path from "node:path";
import { IS_WINDOWS } from "@/platform/os";
import type { AiRun, AiRunResult } from "./audio-ai";
import { CancelledError, StudioError } from "./errors";
import { colourTags, matchColour, probe } from "./media";
import { findTool, reason, run } from "./tools";
import fs from "node:fs";

export const VIDEO_OPS = ["deflicker", "autocolor", "colormatch"] as const;
export type VideoOp = (typeof VIDEO_OPS)[number];
export const isVideoOp = (op: string): op is VideoOp => (VIDEO_OPS as readonly string[]).includes(op);

/** Remove flickers → how many frames are evened out together (more = steadier, slower to follow real changes). */
const FLICKER_FRAMES: Record<string, number> = { light: 5, medium: 9, strong: 15 };

function amount(params: Record<string, string | number>, fallback: number): number {
	const v = Number(params.strength);
	return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/** "r,…;g,…;b,…": the reference's 256-bin histogram per channel (the editor measures it from the picture). */
function parseHistogram(text: string): number[][] {
	const channels = String(text).split(";").map((c) => c.split(",").map(Number));
	if (channels.length !== 3 || channels.some((c) => c.length !== 256 || c.some((n) => !Number.isFinite(n) || n < 0))) {
		throw new StudioError("Pick a reference picture or clip for Color match.");
	}
	return channels;
}

function cdfOf(h: number[]): number[] {
	const total = h.reduce((a, b) => a + b, 0) || 1;
	const out: number[] = [];
	let sum = 0;
	for (const n of h) {
		sum += n;
		out.push(sum / total);
	}
	return out;
}

/** The clip's own histogram: a small frame twice a second (at most 40 frames) of the piece that is processed. */
async function clipHistogram(source: string, start: number, length: number, signal: AbortSignal): Promise<number[][]> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-colormatch-"));
	try {
		const raw = path.join(dir, "frames.rgb");
		const r = await run(
			findTool("ffmpeg"),
			["-y", "-v", "error", ...(start > 0 ? ["-ss", start.toFixed(3)] : []), "-i", source, "-t", length.toFixed(3), "-vf", "fps=2,scale=160:-2:flags=area,format=rgb24", "-frames:v", "40", "-f", "rawvideo", raw],
			{ timeout: 300, signal },
		);
		if (r.status !== 0 || !fs.existsSync(raw)) throw new StudioError(`Color match couldn't read the clip: ${reason(r)}`);
		const px = fs.readFileSync(raw);
		const h = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)];
		for (let i = 0; i + 2 < px.length; i += 3) {
			h[0][px[i]]++;
			h[1][px[i + 1]]++;
			h[2][px[i + 2]]++;
		}
		return h;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * A 1D LUT (.cube) that gives each channel the reference's distribution: every level goes to the reference level with
 * the same share of pixels below it; Strength mixes it with the level itself.
 */
export function matchLut(clip: number[][], reference: number[][], strength: number): string {
	const maps = clip.map((h, c) => {
		const from = cdfOf(h);
		const to = cdfOf(reference[c]);
		let u = 0;
		return from.map((share, v) => {
			while (u < 255 && to[u] < share) u++;
			return (v + (u - v) * strength) / 255;
		});
	});
	const lines = ["LUT_1D_SIZE 256"];
	for (let v = 0; v < 256; v++) lines.push(`${maps[0][v].toFixed(6)} ${maps[1][v].toFixed(6)} ${maps[2][v].toFixed(6)}`);
	return `${lines.join("\n")}\n`;
}

function graphFor(op: VideoOp, params: Record<string, string | number>, lut = ""): string {
	if (op === "colormatch") return `lut1d=file=${lut}`;
	if (op === "deflicker") return `deflicker=size=${FLICKER_FRAMES[String(params.amount)] ?? FLICKER_FRAMES.medium}:mode=am`;
	// White balance mixed in at Strength (grey world can over-correct a scene of one colour), then levels.
	const s = amount(params, 0.6);
	return `split=2[o][w];[w]grayworld[g];[o][g]blend=all_mode=normal:all_opacity=${s.toFixed(2)},normalize=smoothing=30:independence=0.4:strength=${(s * 0.8).toFixed(2)}`;
}

export async function runVideoOp(op: VideoOp, r: AiRun): Promise<AiRunResult> {
	const info = await probe(r.source, r.signal);
	if (!info.hasVideo) throw new StudioError("This tool works on a video clip.");
	const colour = await colourTags(r.source, r.signal);
	const start = r.start ?? 0;
	const length = r.duration ?? Math.max(0.1, info.duration - start);
	const out = `${r.out}.part.mov`;
	let lut = "";
	if (op === "colormatch") {
		const reference = parseHistogram(String(r.params.ref ?? ""));
		r.job.detail("process", "Measuring the colours");
		// The LUT file sits in a temporary folder: a filter graph can't take every path (spaces, colons) as it is.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-lut-"));
		lut = path.join(dir, "match.cube");
		fs.writeFileSync(lut, matchLut(await clipHistogram(r.source, start, length, r.signal), reference, amount(r.params, 0.8)));
	}
	const rate = Math.max(8, Math.min(40, Math.round((info.width * info.height * 30) / 1e6 * 0.25)));
	const encoder = IS_WINDOWS ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17"] : ["-c:v", "h264_videotoolbox", "-b:v", `${rate}M`, "-allow_sw", "1"];
	const args = [
		"-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats",
		...(start > 0 ? ["-ss", start.toFixed(3)] : []), "-i", r.source, ...(r.duration != null ? ["-t", length.toFixed(3)] : []),
		"-filter_complex", `[0:v:0]${graphFor(op, r.params, lut)},format=yuv420p[v]`, "-map", "[v]", "-map", "0:a:0?",
		...encoder, "-c:a", "copy", "-movflags", "+faststart", "-f", "mov", out,
	];
	r.job.detail("process", op === "deflicker" ? "Evening out the flicker" : op === "colormatch" ? "Matching the colours" : "Correcting the colour");
	const res = await run(findTool("ffmpeg"), args, {
		timeout: Math.max(600, length * 20),
		signal: r.signal,
		onLine: (line) => {
			const us = /^out_time_us=(\d+)/.exec(line);
			if (us) r.job.progress("process", Math.min(0.97, Number(us[1]) / 1e6 / length));
		},
	});
	if (lut) fs.rmSync(path.dirname(lut), { recursive: true, force: true });
	if (r.signal.aborted) throw new CancelledError();
	if (res.status !== 0 || !fs.existsSync(out)) {
		fs.rmSync(out, { force: true });
		throw new StudioError(`${op === "deflicker" ? "Remove flickers" : op === "colormatch" ? "Color match" : "AI color correction"} stopped: ${reason(res)}`);
	}
	if (await matchColour(out, colour, r.out, r.signal)) fs.rmSync(out, { force: true });
	else fs.renameSync(out, r.out);
	const done = await probe(r.out, r.signal);
	const engine = op === "deflicker" ? "ffmpeg deflicker" : op === "colormatch" ? "histogram match" : "grey world + levels";
	return { engine, seconds: done.duration, width: done.width, height: done.height };
}
