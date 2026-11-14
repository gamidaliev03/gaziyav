// The material brief, made on the server in the background: one clip at a time, low priority, standing still while
// the user plays or exports (store.ts runQuiet), cached by the file's content key so the same file in another project
// is free. Picture: ffmpeg samples (exposure, motion, cuts) + Apple Vision on candidate frames (framejudge). Sound:
// ffmpeg's EBU R128 meter + claude-hear's ears (src/hear: pauses, breaths, rhythm, the cut points in each pause).
// Speech: whisper on this Mac. Music: the beat tracker of assist/beats.ts and claude-hear's bar grid.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectBeats } from "@/assist/beats";
import { analyseFrames, ANALYSIS_RATE, type Frames, frameAt, type Levels, levelsOf } from "@/hear/dsp";
import { bestCutIn, type CutContext, rhythmOf, targetPause, type TimedWord } from "@/hear/cuts";
import { dropHallucinations } from "@/hear/hallucinations";
import { findBreaths, musicGrid, refineWords, segmentsOf } from "@/hear/map";
import { findTool } from "@/studio/server/tools";
import { frameLevels, speechIslands } from "@/transcribe/align";
import { readPcm16 } from "@/transcribe/server/job";
import { listen } from "@/transcribe/server/listen";
import { findModel } from "@/transcribe/server/whisper";
import {
	BRIEF_VERSION,
	castOf,
	exposureOf,
	type JudgedFrame,
	judgeFrame,
	type MaterialBrief,
	median,
	type PauseCut,
	salientOf,
	shotOf,
	speechFacts,
	type Word,
} from "../material";
import { readBrief, runQuiet, waitQuiet, writeBrief } from "./store";

export interface AnalysisState {
	key: string;
	name: string;
	status: "queued" | "running" | "done" | "failed";
	progress: number;
	stage: string;
	error?: string;
	queuedAt: number;
	startedAt?: number;
	endedAt?: number;
}

const states = new Map<string, AnalysisState>();
const files = new Map<string, string>();
/** Library music: no speech to recognise, only the beat grid. */
const musicOnly = new Set<string>();
/** Asked for by Claude (someone waits): the speech model runs at the models' usual priority, not the background's. */
const urgent = new Set<string>();
const queue: string[] = [];
let busy = false;

/** Asks for a brief (the file is on this Mac at `file`); `front` puts it before the background work. */
export function requestAnalysis({ key, file, name, front = false, music = false }: { key: string; file: string; name: string; front?: boolean; music?: boolean }): AnalysisState {
	const cached = readBrief(key);
	if (cached) return { key, name, status: "done", progress: 1, stage: "ready", queuedAt: Date.now() };
	const known = states.get(key);
	if (known && (known.status === "queued" || known.status === "running")) {
		if (front && known.status === "queued") {
			queue.splice(queue.indexOf(key), 1);
			queue.unshift(key);
		}
		if (front) urgent.add(key);
		return known;
	}
	const state: AnalysisState = { key, name, status: "queued", progress: 0, stage: "waiting", queuedAt: Date.now() };
	states.set(key, state);
	files.set(key, file);
	if (music) musicOnly.add(key);
	if (front) urgent.add(key);
	if (front) queue.unshift(key);
	else queue.push(key);
	void pump();
	return state;
}

export function analysisState(key: string): AnalysisState | null {
	if (readBrief(key)) return { key, name: "", status: "done", progress: 1, stage: "ready", queuedAt: 0 };
	return states.get(key) ?? null;
}

async function pump() {
	if (busy) return;
	busy = true;
	try {
		for (let key = queue.shift(); key; key = queue.shift()) {
			const state = states.get(key);
			const file = files.get(key);
			if (!state || !file) continue;
			state.status = "running";
			state.startedAt = Date.now();
			const wasUrgent = urgent.has(key);
			try {
				const brief = await analyse(key, file, state.name, (stage, progress) => {
					state.stage = stage;
					state.progress = Math.max(state.progress, Math.min(0.99, progress));
				}, musicOnly.has(key), wasUrgent);
				writeBrief(brief);
				state.status = "done";
				state.progress = 1;
				state.stage = "ready";
			} catch (error) {
				const message = (error as Error).message || String(error);
				// A background run that a busy Mac starved past the speech model's time limit goes again at once, at
				// the usual priority (once).
				if (!wasUrgent && /did not finish|timed out|time limit/i.test(message)) {
					urgent.add(key);
					state.status = "queued";
					state.stage = "again, sooner";
					queue.unshift(key);
					continue;
				}
				state.status = "failed";
				state.error = message;
			} finally {
				state.endedAt = Date.now();
			}
		}
	} finally {
		busy = false;
	}
}

// ───────────────────────── the passes ─────────────────────────

interface Probe {
	kind: MaterialBrief["kind"];
	seconds: number;
	width?: number;
	height?: number;
	fps?: number;
	hasAudio: boolean;
}

const IMAGE_CODECS = new Set(["mjpeg", "png", "webp", "gif", "bmp", "tiff", "heic", "hevc_image", "jpegxl"]);

async function probe(file: string): Promise<Probe> {
	const r = await runQuiet(findTool("ffprobe"), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeout: 60 });
	if (r.status !== 0) throw new Error(`Can't read this file: ${r.stderr.trim().split("\n").pop() ?? ""}`);
	const j = JSON.parse(r.stdout.toString() || "{}") as {
		streams?: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; nb_frames?: string; duration?: string; disposition?: { attached_pic?: number } }>;
		format?: { duration?: string; format_name?: string };
	};
	const streams = j.streams ?? [];
	const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
	const audio = streams.find((s) => s.codec_type === "audio");
	const seconds = Number(j.format?.duration ?? video?.duration ?? 0) || 0;
	const rate = (v?: string) => {
		const [a, b] = String(v ?? "0/1").split("/").map(Number);
		return b ? a / b : 0;
	};
	const still = !!video && (IMAGE_CODECS.has(String(video.codec_name)) || /image2|_pipe/.test(String(j.format?.format_name))) && (!seconds || Number(video.nb_frames ?? 1) <= 1);
	if (video) {
		return {
			kind: still ? "image" : "video",
			seconds: still ? 0 : seconds,
			width: video.width,
			height: video.height,
			fps: still ? undefined : Math.round((rate(video.avg_frame_rate) || rate(video.r_frame_rate)) * 100) / 100 || undefined,
			hasAudio: !!audio,
		};
	}
	if (audio) return { kind: "audio", seconds, hasAudio: true };
	throw new Error("No picture or sound in this file.");
}

interface PictureStats {
	motionScore: number;
	scenes: number[];
	frames: string[];
	times: number[];
}

/** One pass over the picture at 4 frames a second: level change frame to frame (motion), scene cuts; candidate stills. */
async function picture(file: string, p: Probe, dir: string, signal?: AbortSignal): Promise<PictureStats> {
	const ffmpeg = findTool("ffmpeg");
	if (p.kind === "image") {
		const out = path.join(dir, "f0001.jpg");
		const r = await runQuiet(ffmpeg, ["-y", "-v", "error", "-i", file, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", out], { timeout: 60, signal });
		if (r.status !== 0) throw new Error("Can't read the picture.");
		return { motionScore: 0, scenes: [], frames: [out], times: [0] };
	}
	const stats = await runQuiet(
		ffmpeg,
		["-hide_banner", "-nostdin", "-v", "info", "-i", file, "-an", "-sn", "-dn", "-vf", "fps=4,scale=160:-2,scdet=threshold=12,signalstats,metadata=mode=print", "-f", "null", "-"],
		{ timeout: Math.max(120, p.seconds * 2), signal },
	);
	const ydif: number[] = [];
	const scenes: number[] = [];
	let t = 0;
	for (const line of stats.stderr.split("\n")) {
		const f = /pts_time:([\d.]+)/.exec(line);
		if (f) {
			t = Number(f[1]);
			continue;
		}
		const d = /signalstats\.YDIF=([\d.]+)/.exec(line);
		if (d) ydif.push(Number(d[1]));
		const s = /lavfi\.scd\.time=([\d.]+)/.exec(line);
		if (s && t > 0.3) scenes.push(Math.round(Number(s[1]) * 100) / 100);
	}
	// Candidate stills: about 60 per clip at most, one every 1–6 s, half a step in (not the fade-in frame).
	const step = Math.max(1, Math.min(6, p.seconds / 60));
	const off = Math.min(step / 2, Math.max(0, p.seconds / 2));
	const r = await runQuiet(
		ffmpeg,
		["-y", "-v", "error", "-ss", String(off), "-i", file, "-an", "-vf", `fps=1/${step}:round=near,scale='min(640,iw)':-2`, "-q:v", "4", path.join(dir, "f%04d.jpg")],
		{ timeout: Math.max(120, p.seconds * 2), signal },
	);
	if (r.status !== 0) throw new Error("Couldn't read frames of the video.");
	const frames = fs.readdirSync(dir).filter((n) => /^f\d+\.jpg$/.test(n)).sort().map((n) => path.join(dir, n));
	const times = frames.map((_, i) => Math.round((off + i * step) * 100) / 100).filter((x) => x <= p.seconds);
	return { motionScore: Math.round(median(ydif) * 100) / 100, scenes, frames: frames.slice(0, times.length), times };
}

/** Apple Vision on the stills (framejudge in Resources/bin); without it (an older Mac build) only ffmpeg's numbers. */
export async function judge(images: string[], times: number[], signal?: AbortSignal, { corners = true }: { corners?: boolean } = {}): Promise<JudgedFrame[]> {
	if (!images.length) return [];
	let tool = "";
	try {
		tool = findTool("framejudge");
	} catch {
		return [];
	}
	if (!tool || !fs.existsSync(tool)) return [];
	const out: JudgedFrame[] = [];
	for (let i = 0; i < images.length; i += 20) {
		const chunk = images.slice(i, i + 20);
		const r = await runQuiet(tool, chunk, { timeout: 120, signal });
		const lines = r.stdout.toString().split("\n").filter((l) => l.startsWith("{"));
		for (const line of lines) {
			try {
				const j = JSON.parse(line) as JudgedFrame & { file: string; error?: string };
				if (j.error) continue;
				const k = images.indexOf(j.file);
				out.push({ ...j, t: times[k] ?? 0, faces: j.faces ?? [], salient: j.salient ?? null, horizon: j.horizon ?? null, aesthetic: j.aesthetic ?? null });
			} catch {}
		}
	}
	// Watermarks: the corners read carefully on up to three frames (a still: its one frame); a logo on most of them
	// marks the whole clip. The careful read decides: the quick whole-frame pass reads foliage or gravel as letters now
	// and then. (Rendered frames skip it: their corners hold the edit's own titles.)
	if (out.length && corners) {
		const pick = out.length <= 3 ? out : [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]];
		const r = await runQuiet(tool, ["--corners", ...pick.map((f) => (f as unknown as { file: string }).file)], { timeout: 60, signal }).catch(() => null);
		const marked = (r?.stdout.toString() ?? "").split("\n").filter((l) => l.startsWith("{")).map((l) => {
			try {
				return (JSON.parse(l) as { cornerText?: number }).cornerText ?? 0;
			} catch {
				return 0;
			}
		});
		if (r && r.status === 0 && marked.length === pick.length) {
			const hits = marked.filter((n) => n > 0).length;
			if (out.length <= 3) for (const [i, f] of out.entries()) f.cornerText = marked[i] ?? 0;
			else for (const f of out) f.cornerText = hits >= 2 ? Math.max(1, f.cornerText ?? 0) : 0;
		}
	}
	return out;
}

interface SoundStats {
	lufs: number | null;
	truePeak: number | null;
	lra: number | null;
	noiseDb: number | null;
	clipping: boolean;
	samples: Float32Array;
}

async function sound(file: string, p: Probe, signal?: AbortSignal): Promise<SoundStats> {
	const ffmpeg = findTool("ffmpeg");
	const meter = await runQuiet(
		ffmpeg,
		["-hide_banner", "-nostdin", "-v", "info", "-i", file, "-vn", "-af", "ebur128=peak=true:framelog=quiet,astats=metadata=0:measure_perchannel=none:measure_overall=Noise_floor+Peak_level+Number_of_samples", "-f", "null", "-"],
		{ timeout: Math.max(120, p.seconds), signal },
	);
	const tail = meter.stderr.slice(-6000);
	const num = (re: RegExp) => {
		const m = re.exec(tail);
		return m && Number.isFinite(Number(m[1])) ? Math.round(Number(m[1]) * 10) / 10 : null;
	};
	const lufs = num(/I:\s+(-?[\d.]+) LUFS/);
	const lra = num(/LRA:\s+(-?[\d.]+) LU/);
	const truePeak = num(/Peak:\s+(-?[\d.]+) dBFS/);
	const noise = num(/Noise floor dB:\s+(-?[\d.inf]+)/);
	const peak = num(/Peak level dB:\s+(-?[\d.]+)/);
	const pcm = await runQuiet(ffmpeg, ["-v", "error", "-nostdin", "-i", file, "-vn", "-ac", "1", "-ar", String(ANALYSIS_RATE), "-f", "f32le", "-"], { timeout: Math.max(120, p.seconds), signal });
	const buf = pcm.stdout;
	const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.byteLength - (buf.byteLength % 4))));
	let clipped = 0;
	for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.999) clipped++;
	return { lufs: lufs !== null && lufs < -69 ? null : lufs, truePeak, lra, noiseDb: noise !== null && noise > -150 ? noise : null, clipping: (peak ?? -99) > -0.1 && clipped > samples.length * 1e-5, samples };
}

async function speech(file: string, p: Probe, dir: string, front: boolean, signal?: AbortSignal): Promise<{ words: Word[]; language: string } | null> {
	if (!findModel()) return null;
	const wav = path.join(dir, "speech.wav");
	const r = await runQuiet(findTool("ffmpeg"), ["-y", "-v", "error", "-nostdin", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeout: Math.max(120, p.seconds), signal });
	if (r.status !== 0) return null;
	const { samples, sampleRate } = readPcm16(wav);
	const duration = samples.length / sampleRate;
	if (duration < 0.3) return null;
	const levels = frameLevels(samples, sampleRate);
	const islands = speechIslands(levels);
	if (!islands.length) return { words: [], language: "auto" };
	await waitQuiet(signal);
	// Whisper's own low priority (background: true) and its queue: the user's captions go first.
	// (the same path as the transcription job: with the speech detector when its file is on this Mac)
	const raw = await listen({ wav, samples, sampleRate, levels, islands, dir, language: "auto", duration, signal, background: !front });
	const words = raw.words;
	return { words: words.map((w) => ({ text: w.text, start: w.start, end: w.end, ...(typeof (w as { p?: number }).p === "number" ? { p: (w as { p?: number }).p } : {}) })), language: raw.language || "auto" };
}

/** The cut points claude-hear's ears pick in every pause: where a piece may end, where the next may start. */
function pauseCuts(ctx: CutContext, words: TimedWord[]): { cuts: PauseCut[]; pause: number } {
	const rhythm = rhythmOf(words);
	const cuts: PauseCut[] = [];
	const edges: Array<[number, number, boolean]> = [];
	if (words.length) edges.push([Math.max(0, words[0].start - 1.5), words[0].start, true]);
	for (let i = 1; i < words.length; i++) {
		const lo = words[i - 1].end;
		const hi = words[i].start;
		if (hi - lo >= 0.06) edges.push([lo, hi, /[.!?…]["»”)]*$/.test(words[i - 1].text.trim())]);
	}
	if (words.length) {
		const last = words[words.length - 1].end;
		edges.push([last, last + 1.5, true]);
	}
	for (const [lo, hi, sentenceEnd] of edges) {
		const air = targetPause(rhythm, sentenceEnd) / 2;
		const end = bestCutIn(ctx, lo, hi, Math.min(hi, lo + air))?.at ?? Math.min(hi, lo + air);
		const start = bestCutIn(ctx, lo, hi, Math.max(lo, hi - air))?.at ?? Math.max(lo, hi - air);
		cuts.push({ lo: r3(lo), hi: r3(hi), end: r3(end), start: r3(start) });
	}
	return { cuts, pause: Math.round(rhythm.pause * 100) / 100 };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function emphasisOf(frames: Frames, levels: Levels) {
	return (from: number, to: number) => {
		let sum = 0;
		let n = 0;
		for (let f = Math.max(0, frameAt(frames, from)); f < Math.min(frames.n, frameAt(frames, to)); f++) {
			if (frames.db[f] > levels.active) {
				sum += frames.db[f];
				n++;
			}
		}
		return n ? sum / n - (levels.loud - 8) : 0;
	};
}

function tagsOf(name: string, extra: string[]): string[] {
	const words = name
		.replace(/\.[a-z0-9]{2,5}$/i, "")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !["img", "mov", "vid", "video", "clip", "final", "copy"].includes(w));
	return [...new Set([...words, ...extra])].slice(0, 16);
}

async function analyse(key: string, file: string, name: string, step: (stage: string, progress: number) => void, music = false, front = false, signal?: AbortSignal): Promise<MaterialBrief> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-brief-"));
	try {
		step("reading the file", 0.02);
		await waitQuiet(signal);
		const p = await probe(file);
		let judged: JudgedFrame[] = [];
		let motionScore = 0;
		let scenes: number[] = [];
		if (p.kind !== "audio") {
			step("watching the picture", 0.08);
			const pic = await picture(file, p, dir, signal);
			motionScore = pic.motionScore;
			scenes = pic.scenes;
			step("judging the frames", 0.3);
			judged = await judge(pic.frames, pic.times, signal);
		}
		const sharpRef = median(judged.map((f) => f.sharp));
		const frames = judged.map((f) => judgeFrame(f, { sharp: sharpRef }));
		const { shot, faces, faceBox } = shotOf(judged);
		let audio: MaterialBrief["audio"];
		let grid: MaterialBrief["music"];
		let speechBrief: MaterialBrief["speech"];
		if (p.hasAudio) {
			step("listening", 0.4);
			await waitQuiet(signal);
			const s = await sound(file, p, signal);
			const hearFrames = analyseFrames(s.samples, ANALYSIS_RATE);
			const levels = levelsOf(hearFrames);
			step("recognizing speech", 0.5);
			const heard = music ? null : await speech(file, p, dir, front, signal);
			const seconds = p.seconds || s.samples.length / ANALYSIS_RATE;
			let speechShare = 0;
			if (heard && heard.words.length >= 3) {
				// Whisper's hallucinated lines over music with no voice («Продолжение следует», subtitle credits) go first.
				const musicOnly = (a: number, b: number) => {
					const segs = segmentsOf(hearFrames, levels, [], Math.max(0, a - 0.25), b + 0.25);
					return segs.filter((x) => x.kind === "music").reduce((sum, x) => sum + x.end - x.start, 0) >= 0.6 * (b - a + 0.5);
				};
				const refined = refineWords(dropHallucinations(heard.words as TimedWord[], musicOnly), hearFrames, levels) as Word[];
				const breaths = findBreaths(hearFrames, levels, refined as TimedWord[]);
				const ctx: CutContext = { frames: hearFrames, levels, words: refined as TimedWord[], breaths, fps: p.fps || 30 };
				const { cuts, pause } = pauseCuts(ctx, refined as TimedWord[]);
				const facts = speechFacts(refined, seconds, emphasisOf(hearFrames, levels));
				speechShare = refined.reduce((sum, w) => sum + (w.end - w.start), 0) / Math.max(1, seconds);
				speechBrief = { language: heard.language, words: refined.map((w) => ({ ...w, start: r3(w.start), end: r3(w.end) })), pause, cuts, ...facts };
			}
			if (!speechBrief || speechBrief.words.length < 20) {
				step("finding the beat", 0.9);
				const beats = detectBeats(s.samples, ANALYSIS_RATE);
				const found = beats.bpm > 0 ? musicGrid(beats.beats, beats.bpm, hearFrames) : null;
				if (found && found.beats.length >= 8 && s.lufs !== null) {
					grid = { bpm: Math.round(found.bpm * 10) / 10, beats: found.beats.map(r3), downbeats: found.downbeats.map(r3), bar: Math.round((240 / found.bpm) * 1000) / 1000 };
				}
			}
			audio = { lufs: s.lufs, truePeak: s.truePeak, lra: s.lra, noiseDb: s.noiseDb, clipping: s.clipping, speechShare: Math.round(speechShare * 100) / 100 };
		}
		const motion = motionScore < 1.2 ? "static" : motionScore < 4 ? "low" : motionScore < 10 ? "medium" : "high";
		const extra = [p.kind, shot === "no-face" ? "b-roll" : `${shot}-up`, motion === "static" ? "still" : `${motion}-motion`, ...(speechBrief ? ["speech"] : []), ...(grid ? ["music"] : [])];
		step("done", 1);
		return {
			key,
			name,
			kind: p.kind,
			seconds: Math.round((p.seconds || 0) * 100) / 100,
			width: p.width,
			height: p.height,
			fps: p.fps,
			hasAudio: p.hasAudio,
			shot,
			faces,
			faceBox,
			salientBox: salientOf(judged),
			motion: p.kind === "image" ? "static" : motion,
			motionScore,
			scenes,
			exposure: exposureOf(judged),
			cast: castOf(judged),
			frames,
			looks: judged.map((f) => [f.t, Math.round(f.luma * 1000) / 1000, Math.round(f.castR * 1000) / 1000, Math.round(f.castB * 1000) / 1000]),
			audio,
			music: grid,
			speech: speechBrief,
			tags: tagsOf(name, extra),
			analysedAt: Date.now(),
			version: BRIEF_VERSION,
		};
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
