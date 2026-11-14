// The lipsync pipeline's own work on this Mac: where the voice is, where the picture cuts, the exact picture that goes
// to the model (SDR BT.709, the source's frame rate, frame-exact pieces) and the stitch that brings the answers back
// into ONE clip of the source's length, the face region composited over our own frames.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { frameLevels, type Span, speechIslands } from "@/transcribe/align";
import { readPcm16 } from "@/transcribe/server/job";
import { CancelledError, StudioError } from "./errors";
import { blendFace, type Box, type FaceMark, MASK_RULES, maskOf, trustedBoxes } from "./lip-compose";
import type { Plan } from "./lip-plan";
import type { ColourTags } from "./media";
import { findTool, reason, run } from "./tools";

// MARK: what the sound and the picture hold

export interface VideoInfo {
	fps: number;
	width: number;
	height: number;
	pixFmt: string;
	frames: number;
}

/** The first video stream's frame rate (its own r_frame_rate: the grid every piece is cut on), size and pixel format. */
export async function videoInfo(file: string, signal?: AbortSignal): Promise<VideoInfo> {
	const r = await run(findTool("ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate,avg_frame_rate,width,height,pix_fmt,nb_frames:stream_tags=rotate:stream_side_data=rotation", "-of", "json", file], { timeout: 60, signal });
	if (r.status !== 0) throw new StudioError(`Can't read the video: ${reason(r)}`);
	const v = JSON.parse(r.stdout || "{}").streams?.[0] ?? {};
	const rate = (s: unknown) => {
		const [n, d] = String(s ?? "0/1").split("/").map(Number);
		return d > 0 && n > 0 ? n / d : 0;
	};
	// a stream that says 1000 fps or 90 000 (a timebase, VFR phone clips) is taken at its average rate
	let fps = rate(v.r_frame_rate);
	const avg = rate(v.avg_frame_rate);
	if (!(fps > 0 && fps <= 120) && avg > 0) fps = avg;
	if (!(fps > 0 && fps <= 120)) fps = 25;
	let width = Number(v.width ?? 0);
	let height = Number(v.height ?? 0);
	const rotation = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((d: { rotation?: number }) => d.rotation != null)?.rotation ?? 0));
	if (rotation === 90 || rotation === 270) [width, height] = [height, width];
	return { fps: Math.round(fps * 1000) / 1000, width, height, pixFmt: String(v.pix_fmt ?? ""), frames: Number(v.nb_frames) || 0 };
}

/** Where somebody speaks in a sound (the islands of the word timing, align.ts), and its loudness per 10 ms. */
export async function soundSpans(audio: string, dir: string, signal?: AbortSignal): Promise<{ speech: Span[]; levels: Float32Array; step: number }> {
	const wav = path.join(dir, `vad-${path.basename(audio)}.wav`);
	try {
		const r = await run(findTool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-i", audio, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeout: 600, signal });
		if (r.status !== 0) throw new StudioError(`Couldn't read the sound: ${reason(r)}`);
		const { samples, sampleRate } = readPcm16(wav);
		const levels = frameLevels(samples, sampleRate);
		return { speech: speechIslands(levels), levels, step: 0.01 };
	} finally {
		fs.rmSync(wav, { force: true });
	}
}

const cutsMemo = new Map<string, number[]>();

/**
 * A hard picture change in a list of ffmpeg scene scores (0…1 per frame): a score of 0.3 or more, or a peak of 0.1 or
 * more that stands 4× above the frames around it (a cut between two dim shots scores 0.14; a moving face 0.01–0.03).
 */
export function cutsInScores(scores: Array<{ t: number; s: number }>, length: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < scores.length; i++) {
		const { t, s } = scores[i];
		if (t <= 0.05 || t >= length - 0.05) continue;
		const near = scores.slice(Math.max(0, i - 12), i + 13).filter((_, k, all) => all[k] !== scores[i]).map((x) => x.s).sort((a, b) => a - b);
		const median = near.length ? near[near.length >> 1] : 0;
		if (s >= 0.3 || (s >= 0.1 && s >= 4 * median + 0.02)) out.push(t);
	}
	// (one cut, not two, when two neighbouring frames both score)
	return out.filter((t, k) => k === 0 || t - out[k - 1] > 0.2);
}

/** Hard picture changes inside start…start+length (seconds from start): no piece is sent across one. */
export async function sceneCuts(file: string, start: number, length: number, signal?: AbortSignal): Promise<number[]> {
	const st = fs.statSync(file);
	const memo = `${file}|${st.size}|${st.mtimeMs}|${start.toFixed(3)}|${length.toFixed(3)}`;
	const known = cutsMemo.get(memo);
	if (known) return known;
	const scores: Array<{ t: number; s: number }> = [];
	let t = Number.NaN;
	const r = await run(
		findTool("ffmpeg"),
		["-hide_banner", "-loglevel", "info", "-ss", start.toFixed(3), "-t", length.toFixed(3), "-i", file, "-an", "-vf", "scale=160:-2,select='gte(scene\\,0)',metadata=print:key=lavfi.scene_score", "-f", "null", "-"],
		{
			timeout: 1800,
			signal,
			onLine: (l) => {
				const pts = /pts_time:\s*([\d.]+)/.exec(l);
				if (pts) t = Number(pts[1]);
				const sc = /lavfi\.scene_score=([\d.]+)/.exec(l);
				if (sc && Number.isFinite(t)) scores.push({ t, s: Number(sc[1]) });
			},
		},
	);
	if (r.status !== 0) throw new StudioError(`Couldn't check the picture's cuts: ${reason(r)}`);
	const cuts = cutsInScores(scores, length);
	cutsMemo.set(memo, cuts);
	return cuts;
}

// MARK: the picture that is sent

/** The source is HDR (PQ / HLG): converted to SDR once, here, with a known operator — never left to the provider. */
export const isHdr = (c: ColourTags) => c.transfer === "smpte2084" || c.transfer === "arib-std-b67" || c.primaries === "bt2020";

export interface Picture {
	/** The filter that makes the frames that go out (and the frames the answer is laid over). */
	vf: string;
	/** The colour description of those frames. */
	tags: Required<Pick<ColourTags, "primaries" | "transfer" | "matrix" | "range">>;
	/** What was done, for the note and the status: "as-is" | "tagged-709" | "matrix-601-to-709" | "hdr-to-sdr". */
	how: string;
	pixFmt: "yuv420p" | "yuv444p";
}

/**
 * What the model gets: 8-bit, BT.709 described explicitly (an untagged clip is guessed as BT.601 by some decoders: the
 * colour shift the vendors themselves name), HDR tone-mapped to SDR here, the source's own frame rate.
 */
export function pictureOf(c: ColourTags, o: { chroma444?: boolean; zscale?: boolean } = {}): Picture {
	const pixFmt = o.chroma444 ? "yuv444p" : "yuv420p";
	const sdr = { primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "tv" } as const;
	if (isHdr(c) && o.zscale !== false) {
		return { vf: `zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=${pixFmt}`, tags: sdr, how: "hdr-to-sdr", pixFmt };
	}
	if (c.matrix === "smpte170m" || c.matrix === "bt470bg") {
		return { vf: `scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=${c.range === "pc" ? "pc" : "tv"}:out_range=tv,format=${pixFmt}`, tags: { ...sdr, primaries: c.primaries ?? "bt709" }, how: "matrix-601-to-709", pixFmt };
	}
	const range = c.range === "pc" ? "pc" : "tv";
	return { vf: `format=${pixFmt}`, tags: { primaries: c.primaries ?? "bt709", transfer: c.transfer ?? "bt709", matrix: c.matrix ?? "bt709", range }, how: c.primaries && c.matrix ? "as-is" : "tagged-709", pixFmt };
}

const tagArgs = (t: Picture["tags"]) => ["-color_primaries", t.primaries, "-color_trc", t.transfer, "-colorspace", t.matrix, "-color_range", t.range];
/**
 * The frames LABELLED as what they are tagged, before the encoder: ffmpeg 9 (the app's) converts frames whose description
 * is unknown into the output's tags — an untagged clip or raw frames came out re-matrixed (every pixel off), measured 14.11.
 */
const label = (t: Picture["tags"]) => `setparams=color_primaries=${t.primaries}:color_trc=${t.transfer}:colorspace=${t.matrix}:range=${t.range}`;

/**
 * The bit rate of what is sent: near-transparent x264 (CRF 12, adaptive quantisation that guards flat dark areas —
 * the banding on a face's cheek), capped at 25 Mbit/s so a 40 s piece stays under 125 MB.
 */
export const SEND_X264 = ["-c:v", "libx264", "-preset", "medium", "-crf", "12", "-tune", "film", "-x264-params", "aq-mode=3", "-maxrate", "25M", "-bufsize", "50M"];

/** Seconds to seek to for frame `k` of a constant-rate stream: half a frame before it, so the first frame out is exactly k. */
const seekOf = (k: number, fps: number) => Math.max(0, (k - 0.5) / fps);

/**
 * The picture and the sound of one request: its segments (frames of the piece, `k0` = the piece's first frame in the
 * base file) one after the other, then `tail` seconds of the last frame held over silence.
 */
export async function cutRequest(o: {
	base: string;
	k0: number;
	fps: number;
	segments: Array<{ from: number; to: number }>;
	audio: string;
	picture: Picture;
	tail: number;
	/** The model's shortest take: a shorter request is held on its last frame up to it. */
	minSeconds?: number;
	video: string;
	sound: string;
	signal?: AbortSignal;
}): Promise<{ frames: number; seconds: number }> {
	const frames = o.segments.reduce((s, g) => s + g.to - g.from, 0);
	const hold = Math.max(o.tail, (o.minSeconds ?? 0) - frames / o.fps);
	const inputs: string[] = [];
	const chains: string[] = [];
	o.segments.forEach((g, i) => {
		inputs.push("-ss", seekOf(o.k0 + g.from, o.fps).toFixed(6), "-i", o.base);
		chains.push(`[${i}:v:0]setpts=PTS-STARTPTS,fps=${o.fps},${o.picture.vf},${label(o.picture.tags)},trim=end_frame=${g.to - g.from},setpts=PTS-STARTPTS[s${i}]`);
	});
	const cat = o.segments.length > 1 ? `${o.segments.map((_, i) => `[s${i}]`).join("")}concat=n=${o.segments.length}:v=1:a=0[c]` : "[s0]null[c]";
	const graph = [...chains, cat, `[c]tpad=stop_mode=clone:stop_duration=${hold.toFixed(4)},setsar=1[v]`].join(";");
	const total = frames + Math.round(hold * o.fps);
	let r = await run(findTool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[v]", "-frames:v", String(total), "-r", String(o.fps), ...SEND_X264, "-pix_fmt", o.picture.pixFmt, ...(o.picture.pixFmt === "yuv444p" ? ["-profile:v", "high444"] : ["-profile:v", "high"]), ...tagArgs(o.picture.tags), "-an", "-movflags", "+faststart", o.video], { timeout: 1800, signal: o.signal });
	if (r.status !== 0) throw new StudioError(`Couldn't cut the piece: ${reason(r)}`);
	// the sound: the same frames' time, sample-exact, then silence
	const parts = o.segments.map((g, i) => `[0:a]atrim=start=${(g.from / o.fps).toFixed(6)}:end=${(g.to / o.fps).toFixed(6)},asetpts=PTS-STARTPTS[a${i}]`);
	const acat = o.segments.length > 1 ? `${o.segments.map((_, i) => `[a${i}]`).join("")}concat=n=${o.segments.length}:v=0:a=1[ac]` : "[a0]anull[ac]";
	const seconds = total / o.fps;
	r = await run(findTool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-i", o.audio, "-filter_complex", [...parts, acat, `[ac]apad=whole_dur=${seconds.toFixed(4)},atrim=end=${seconds.toFixed(4)}[a]`].join(";"), "-map", "[a]", "-c:a", "aac", "-b:a", "192k", o.sound], { timeout: 600, signal: o.signal });
	if (r.status !== 0) throw new StudioError(`Couldn't cut the speech: ${reason(r)}`);
	return { frames: total, seconds };
}

/** Face marks of every frame of a sent request (lipmarks, Apple Vision): null when the helper is missing. */
export async function faceMarks(video: string, signal?: AbortSignal): Promise<Array<FaceMark | null> | null> {
	const tool = process.env.STUDIO_BIN_DIR && path.join(process.env.STUDIO_BIN_DIR, "lipmarks");
	if (!tool || !fs.existsSync(tool)) return null;
	const r = await run(tool, [video, "--nohands"], { timeout: 1800, signal });
	if (r.status !== 0) return null;
	try {
		const j = JSON.parse(r.stdout.trim().split("\n").pop() || "{}") as { frames?: Array<{ box?: Box; conf?: number; yaw?: number } | null> };
		return (j.frames ?? []).map((f) => (f?.box ? { box: f.box, conf: f.conf, yaw: f.yaw } : null));
	} catch {
		return null;
	}
}

// MARK: raw frames

/** The frames of an ffmpeg decode as exact frame-sized buffers. */
class Frames {
	private chunks: Buffer[] = [];
	private have = 0;
	private ended = false;
	private wake: (() => void) | null = null;
	private failure = "";
	readonly proc;
	constructor(args: string[], readonly size: number, signal?: AbortSignal) {
		this.proc = spawn(findTool("ffmpeg"), ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
		this.proc.stdout.on("data", (d: Buffer) => {
			this.chunks.push(d);
			this.have += d.length;
			if (this.have > size * 4) this.proc.stdout.pause();
			this.wake?.();
		});
		this.proc.stderr.on("data", (d: Buffer) => {
			this.failure = (this.failure + d.toString()).slice(-600);
		});
		this.proc.on("close", () => {
			this.ended = true;
			this.wake?.();
		});
		signal?.addEventListener("abort", () => this.close(), { once: true });
	}
	async next(): Promise<Buffer | null> {
		while (this.have < this.size && !this.ended) {
			this.proc.stdout.resume();
			await new Promise<void>((r) => {
				this.wake = r;
			});
			this.wake = null;
		}
		if (this.have < this.size) return null;
		const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
		const frame = Buffer.from(all.subarray(0, this.size));
		const rest = all.subarray(this.size);
		this.chunks = rest.length ? [rest] : [];
		this.have = rest.length;
		if (this.have <= this.size * 4) this.proc.stdout.resume();
		return frame;
	}
	get error() {
		return this.failure.trim();
	}
	close() {
		try {
			this.proc.kill("SIGKILL");
		} catch {}
	}
}

/** One answer and which of its frames go where: answer frame `at + (f - from)` is piece frame f, for f in [a, b). */
export interface StitchPart {
	answer: string;
	/** The piece's frames this part fills. */
	a: number;
	b: number;
	/** The answer's frame that is piece frame `a`. */
	at: number;
	/** Face marks of the sent request's frames (index = answer frame), when lipmarks ran. */
	marks?: Array<FaceMark | null> | null;
}

export interface StitchStats {
	frames: number;
	/** Piece frames that took the answer (inside a lipsynced part). */
	answered: number;
	/** …of them, composited inside the face region only. */
	composited: number;
	/** …taken whole from the provider: no trustworthy face box for that frame. */
	wholeFrame: number;
	/** …kept as the source: the answer ended before that frame (models drop the end of a take). */
	short: number;
	/** Source frames missing at the end (the base ended early): the last one held. */
	held: number;
	/** Luma pixels that took any of an answer, in all. */
	pixels: number;
}

/**
 * ONE clip from the base and the answers: frame-exact (frame i of the result = frame i of the piece's grid), the sound
 * the lips follow muxed as it is (not re-encoded by any provider), colours described as the base's.
 */
export async function stitch(o: {
	base: string;
	k0: number;
	fps: number;
	frames: number;
	width: number;
	height: number;
	picture: Picture;
	parts: StitchPart[];
	audio: string;
	seconds: number;
	composite: boolean;
	out: string;
	/** Tests: lossless x264 (qp 0), so a decode of the result is the composited frames to the bit. */
	lossless?: boolean;
	signal?: AbortSignal;
}): Promise<StitchStats> {
	const { width: W, height: H, fps } = o;
	if (W % 2 || H % 2) throw new StudioError("The clip's size is odd — it can't be stitched");
	const size = (W * H * 3) / 2;
	// (timestamps from 0 before the rate filter: a seek half a frame early would sit every frame between two slots)
	const raw = (input: string[], vf: string, limit?: number) => [...input, "-an", ...(limit ? ["-frames:v", String(limit)] : []), "-vf", `setpts=PTS-STARTPTS,fps=${fps},${vf},scale=${W}:${H}:flags=bicubic,format=yuv420p`, "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"];
	const base = new Frames(raw(["-ss", seekOf(o.k0, fps).toFixed(6), "-i", o.base], o.picture.vf.replace(/format=yuv444p$/, "format=yuv420p"), o.frames), size, o.signal);
	const enc = spawn(findTool("ffmpeg"), [
		"-y", "-hide_banner", "-loglevel", "error",
		"-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", `${W}x${H}`, "-r", String(fps), ...tagArgs(o.picture.tags), "-i", "-",
		"-i", o.audio,
		"-map", "0:v:0", "-map", "1:a:0?", "-frames:v", String(o.frames),
		"-c:v", "libx264", "-preset", "veryfast", ...(o.lossless ? ["-qp", "0"] : ["-crf", "17"]), "-pix_fmt", "yuv420p", ...tagArgs(o.picture.tags),
		"-c:a", "aac", "-b:a", "192k", "-t", o.seconds.toFixed(4), "-movflags", "+faststart", o.out,
	], { stdio: ["pipe", "ignore", "pipe"] });
	let encError = "";
	enc.stderr.on("data", (d: Buffer) => {
		encError = (encError + d.toString()).slice(-600);
	});
	const encDone = new Promise<number>((r) => enc.on("close", (code) => r(code ?? 1)));
	let pipeError: Error | null = null;
	enc.stdin.on("error", (e) => {
		pipeError = e;
	});
	const write = async (buf: Buffer) => {
		if (pipeError) throw new StudioError(`Couldn't write the result: ${encError.trim() || pipeError.message}`);
		if (!enc.stdin.write(buf)) await new Promise<void>((resolve) => enc.stdin.once("drain", resolve));
	};
	const stats: StitchStats = { frames: o.frames, answered: 0, composited: 0, wholeFrame: 0, short: 0, held: 0, pixels: 0 };
	const parts = [...o.parts].sort((p, q) => p.a - q.a);
	let last: Buffer | null = null;
	type Open = { part: StitchPart; reader: Frames; next: number; boxes: Array<Box | null> | null };
	let open = null as Open | null;
	try {
		for (let f = 0; f < o.frames; f++) {
			if (o.signal?.aborted) throw new CancelledError();
			let frame = await base.next();
			if (!frame) {
				if (!last) throw new StudioError(`Couldn't read the clip's frames: ${base.error || "no frames"}`);
				frame = Buffer.from(last);
				stats.held++;
			}
			last = frame;
			const part = parts.find((p) => f >= p.a && f < p.b);
			if (part) {
				if (open?.part !== part) {
					open?.reader.close();
					// the answer from its frame `at`, on the same grid and size as the base
					open = {
						part,
						reader: new Frames(raw(["-i", part.answer], `trim=start_frame=${part.at},setpts=PTS-STARTPTS`), size, o.signal),
						next: part.at,
						boxes: part.marks ? trustedBoxes(part.marks, MASK_RULES) : null,
					};
				}
				const want = part.at + (f - part.a);
				let answer: Buffer | null = null;
				while (open.next <= want) {
					answer = await open.reader.next();
					open.next++;
					if (!answer) break;
				}
				if (answer) {
					stats.answered++;
					const box = open.boxes?.[want] ?? null;
					if (o.composite && box) {
						const out = Buffer.from(frame);
						stats.pixels += blendFace(out, answer, W, H, maskOf(box, W, H));
						frame = out;
						stats.composited++;
					} else {
						frame = answer;
						stats.wholeFrame++;
						stats.pixels += W * H;
					}
				} else stats.short++;
			}
			await write(frame);
		}
		enc.stdin.end();
		const code = await encDone;
		if (code !== 0) throw new StudioError(`Couldn't write the result: ${encError.trim() || `ffmpeg ${code}`}`);
		return stats;
	} catch (error) {
		enc.kill("SIGKILL");
		throw error;
	} finally {
		base.close();
		open?.reader.close();
	}
}

/** The plan's parts for the stitch: where in each answer every unit's frames are. */
export function partsOf(plan: Plan, answers: Map<number, { file: string; marks?: Array<FaceMark | null> | null }>): StitchPart[] {
	const parts: StitchPart[] = [];
	plan.requests.forEach((r, ri) => {
		const got = answers.get(ri);
		if (!got) return;
		let offset = 0;
		for (const s of r.segments) {
			const u = plan.units[s.unit];
			// the unit's own frames inside this segment (a segment may begin with a lead or the silence before the unit)
			const a = Math.max(u.a, s.from);
			const b = Math.min(u.b, s.to);
			if (b > a) parts.push({ answer: got.file, a, b, at: offset + (a - s.from), marks: got.marks });
			offset += s.to - s.from;
		}
	});
	return parts;
}
