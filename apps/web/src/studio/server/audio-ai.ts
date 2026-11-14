// On-device AI on a clip's sound, in CapCut's places (Inspector → Audio): Enhance voice (DeepFilterNet 3), Separate voice
// and music (Demucs v4 — or, before that download, Apple's voice isolation with the music as what is left), Voice changer
// (voice filters without a model, or another voice with OpenVoice v2). And Retouch (Video → Retouch → Face): the person's
// own face restored by GFPGAN, the Face swap models. Each makes a processed copy of the clip's media through the AI-effect
// cache (neural.ts); a video keeps its picture as it is (copied, not re-encoded) with the new sound. ⌘Z or "Use original"
// brings the original back (the editor side is neural/apply.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ondevicePython, ondeviceUnavailable } from "@/ondevice/server";
import { IS_WINDOWS } from "@/platform/os";
import { LIPMARKS, modelDirs } from "@/platform/paths";
import { CancelledError, StudioError } from "./errors";
import type { Job } from "./jobs";
import { colourTags, matchColour, probe, trimVideo } from "./media";
import { heavy } from "./ml-queue";
import { myVoice } from "./my-voices";
import { readyVoice } from "./ready-voices";
import { runSeparate } from "./separate-run";
import { findTool, type RunOptions, type RunResult, reason, run } from "./tools";

export const AUDIO_OPS = ["voice-enhance", "separate", "voice-change"] as const;
export type AudioOp = (typeof AUDIO_OPS)[number];
export const isAudioOp = (op: string): op is AudioOp => (AUDIO_OPS as readonly string[]).includes(op);

/** Voice changer → Voice effects: ffmpeg graphs on 48 kHz sound, no model. Pitch changes keep the clip's length. */
export const VOICE_FILTERS: Record<string, string> = {
	chipmunk: "asetrate=48000*1.5,aresample=48000,atempo=0.6667",
	deep: "asetrate=48000*0.8,aresample=48000,atempo=1.25",
	monster: "asetrate=48000*0.66,aresample=48000,atempo=1.5152,acrusher=bits=10:mix=0.15",
	robot: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
	whisper: "afftfilt=real='hypot(re,im)*cos((random(0)*2-1)*2*3.14)':imag='hypot(re,im)*sin((random(1)*2-1)*2*3.14)':win_size=128:overlap=0.8",
	telephone: "highpass=f=300,lowpass=f=3400,acompressor=threshold=0.125:ratio=4:attack=5:release=60,volume=1.4",
	megaphone: "highpass=f=600,lowpass=f=3800,acrusher=bits=8:mix=0.2,volume=1.6",
	echo: "aecho=0.8:0.85:250|500:0.4|0.25",
};

export interface AiRun {
	source: string;
	/** The result file (the AI-effect cache path of the key). */
	out: string;
	params: Record<string, string | number>;
	/** Separate: where the music goes (the cache path of the music's key). */
	extraOut?: string;
	start?: number;
	duration?: number;
	job: Job;
	signal: AbortSignal;
}

export interface AiRunResult {
	engine: string;
	seconds: number;
	width: number;
	height: number;
}

const bin = (name: string) => path.join(process.env.STUDIO_BIN_DIR || "", name);
const RATE = 48000;

async function ffmpeg(args: string[], what: string, signal: AbortSignal, timeout = 1800) {
	const r = await run(findTool("ffmpeg"), ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args], { timeout, signal });
	if (signal.aborted) throw new CancelledError();
	if (r.status !== 0) throw new StudioError(`${what}: ${reason(r)}`);
}

/** A helper of a downloaded model, below the user's other work (nice), with its STATUS / PROGRESS / ERROR lines. */
async function runHelper(job: Job, python: string, script: string, args: string[], signal: AbortSignal, timeout: number, runner?: (options: RunOptions) => Promise<RunResult>) {
	let error = "";
	const options: RunOptions = {
		heavy: true,
		timeout,
		signal,
		onLine: (line) => {
			if (line.startsWith("PROGRESS ")) job.progress("process", 0.1 + 0.8 * (Number(line.slice(9)) || 0));
			else if (line.startsWith("STATUS ")) job.detail("process", line.slice(7));
			else if (line.startsWith("ERROR ")) error = line.slice(6);
		},
	};
	// `runner`: the helper started by someone who picks its engine (Separate, separate-run.ts); the lines are read the same.
	const r = await (runner ? runner(options) : run(python, ["-I", bin(script), ...args], options));
	if (signal.aborted) throw new CancelledError();
	return { ok: r.status === 0, error: error || reason(r) };
}

/** The clip's sound as raw 32-bit float samples (exact sample count = its length at `rate`). */
async function decode(source: string, dest: string, rate: number, channels: number, signal: AbortSignal): Promise<number> {
	await ffmpeg(["-i", source, "-vn", "-map", "0:a:0", "-ac", String(channels), "-ar", String(rate), "-f", "f32le", "-c:a", "pcm_f32le", dest], "Couldn't read the clip's sound", signal);
	return fs.statSync(dest).size / 4 / channels;
}

/** Raw samples (or any sound file) → a WAV of exactly `frames` samples at 48 kHz (a filter's tail cut, a short one padded). */
async function toWav(input: string, raw: { rate: number; channels: number } | null, frames: number, dest: string, signal: AbortSignal, filter = "") {
	const from = raw ? ["-f", "f32le", "-ar", String(raw.rate), "-ac", String(raw.channels), "-i", input] : ["-i", input];
	const graph = `${filter ? `${filter},` : ""}aresample=${RATE},apad=whole_len=${frames},atrim=end_sample=${frames}`;
	await ffmpeg([...from, "-af", graph, "-map_metadata", "-1", "-c:a", "pcm_f32le", dest], "Couldn't write the new sound", signal);
}

/** The result file: the clip's picture copied as it is with the new sound, or the sound alone (AAC either way). */
async function finish(source: string, sound: string, keepPicture: boolean, format: string, out: string, signal: AbortSignal) {
	const picture = keepPicture ? (/mov|mp4/.test(format) ? ["-c:v", "copy"] : ["-c:v", IS_WINDOWS ? "libx264" : "h264_videotoolbox", "-b:v", "20M"]) : [];
	const inputs = keepPicture ? ["-i", source, "-i", sound, "-map", "0:v:0", "-map", "1:a:0", ...picture] : ["-i", sound, "-map", "0:a:0", "-vn", "-f", "mp4"];
	await ffmpeg([...inputs, "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", out], "Couldn't save the result", signal);
}

function strength(params: Record<string, string | number>, fallback: number): number {
	const v = Number(params.strength);
	return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/** Enhance voice: DeepFilterNet 3 removes noise and room; Strength mixes the original back in (100 % = clean voice only). */
async function enhanceVoice(r: AiRun, dir: string, frames: number): Promise<{ wav: string; engine: string }> {
	const why = ondeviceUnavailable("denoise");
	if (why) throw new StudioError(why);
	const speech = path.join(dir, "speech.wav");
	await ffmpeg(["-i", r.source, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", String(RATE), "-c:a", "pcm_s16le", speech], "Couldn't read the clip's sound", r.signal);
	const cleanDir = path.join(dir, "clean");
	fs.mkdirSync(cleanDir);
	r.job.detail("process", "Cleaning the voice");
	const root = modelDirs.denoise();
	const res = await run(
		path.join(root, IS_WINDOWS ? "deep-filter.exe" : "deep-filter"),
		["-m", path.join(root, "DeepFilterNet3_onnx.tar.gz"), "-D", "--pf", "-o", cleanDir, speech],
		{ heavy: true, timeout: Math.max(600, (frames / RATE) * 10), signal: r.signal },
	);
	if (r.signal.aborted) throw new CancelledError();
	const clean = fs.readdirSync(cleanDir).find((f) => f.toLowerCase().endsWith(".wav"));
	if (res.status !== 0 || !clean) throw new StudioError(`Enhance voice stopped: ${reason(res)}`);
	r.job.progress("process", 0.85);
	const amount = strength(r.params, 1);
	const wav = path.join(dir, "enhanced.wav");
	const graph = `[0:a]volume=${(1 - amount).toFixed(3)}[d];[1:a]volume=${amount.toFixed(3)}[w];[d][w]amix=inputs=2:normalize=0,apad=whole_len=${frames},atrim=end_sample=${frames}`;
	await ffmpeg(["-i", speech, "-i", path.join(cleanDir, clean), "-filter_complex", graph, "-c:a", "pcm_f32le", wav], "Couldn't mix the clean voice", r.signal);
	return { wav, engine: "DeepFilterNet 3" };
}

/** The reference recording of a target voice: one of the ready-made voices ("ready:<id>") or one of My voices ("my:<id>"). */
function targetRecording(voice: string): string {
	// at the FIRST colon only: a voice of «My voices» is "my:local:<key>", and JavaScript's split(":", 2) cut its id
	// down to "local" — every one of them answered «isn't on this Mac any more» (the owner's «ell», 14.11)
	const at = voice.indexOf(":");
	const kind = voice.slice(0, at);
	const id = voice.slice(at + 1);
	const file = kind === "ready" ? readyVoice(id, "neutral")?.ref : kind === "my" ? myVoice(id)?.path : undefined;
	if (!file || !fs.existsSync(file)) throw new StudioError("That voice isn't on this Mac any more. Pick another one.");
	return file;
}

/** Voice changer: a voice effect (filters) or another voice (OpenVoice v2, the clip's own timing and intonation). */
async function changeVoice(r: AiRun, dir: string, frames: number): Promise<{ wav: string; engine: string }> {
	const voice = String(r.params.voice ?? "");
	const wav = path.join(dir, "changed.wav");
	if (VOICE_FILTERS[voice]) {
		r.job.detail("process", "Changing the voice");
		// The pitch shifts count on 48 kHz in.
		await toWav(r.source, null, frames, wav, r.signal, `aresample=${RATE},${VOICE_FILTERS[voice]}`);
		return { wav, engine: "Voice effect" };
	}
	if (!voice.includes(":")) throw new StudioError("Pick a voice first.");
	const why = ondeviceUnavailable("voicechange");
	if (why) throw new StudioError(why);
	const reference = targetRecording(voice);
	const speech = path.join(dir, "speech.f32");
	const target = path.join(dir, "target.f32");
	const changed = path.join(dir, "changed.f32");
	await decode(r.source, speech, 22050, 1, r.signal);
	await decode(reference, target, 22050, 1, r.signal);
	const seconds = frames / RATE;
	const res = await heavy(() =>
		runHelper(
			r.job,
			ondevicePython("voicechange"),
			"local-voicechange.py",
			["--models", modelDirs.voicechange(), "--input", speech, "--target", target, "--out", changed],
			r.signal,
			Math.max(600, seconds * 20),
		),
	);
	if (!res.ok || !fs.existsSync(changed)) throw new StudioError(`Voice changer: ${res.error}`);
	await toWav(changed, { rate: 22050, channels: 1 }, frames, wav, r.signal);
	return { wav, engine: "OpenVoice v2" };
}

/**
 * Separate: the voice (the clip keeps it) and the music (a new clip on its own track). `engine` "demucs" (the download)
 * or "apple" (built in); the editor picks, so each engine's result has its own cache key.
 */
async function separate(r: AiRun, dir: string, frames: number): Promise<{ wav: string; music: string; engine: string }> {
	const wav = path.join(dir, "voice.wav");
	const music = path.join(dir, "music.wav");
	if (r.params.engine === "demucs") {
		const why = ondeviceUnavailable("separate");
		if (why) throw new StudioError(why);
		const mix = path.join(dir, "mix.f32");
		const voiceRaw = path.join(dir, "voice.f32");
		const musicRaw = path.join(dir, "music.f32");
		const n = await decode(r.source, mix, 44100, 2, r.signal);
		// The faster engine when it is on this Mac, PyTorch otherwise and whenever that one fails (separate-run.ts).
		const res = await heavy(() =>
			runHelper(r.job, "", "local-separate.py", [], r.signal, Math.max(900, (n / 44100) * 30), (options) =>
				runSeparate({ input: mix, args: ["--voice", voiceRaw, "--music", musicRaw], outputs: [voiceRaw, musicRaw], seconds: n / 44100 }, options),
			),
		);
		if (!res.ok || !fs.existsSync(voiceRaw) || !fs.existsSync(musicRaw)) throw new StudioError(`Separate voice and music: ${res.error}`);
		await toWav(voiceRaw, { rate: 44100, channels: 2 }, frames, wav, r.signal);
		await toWav(musicRaw, { rate: 44100, channels: 2 }, frames, music, r.signal);
		return { wav, music, engine: "Demucs v4" };
	}
	// Apple's voice isolation (the Voice Isolation of FaceTime, on this Mac, no download) gives the voice; the music is
	// the clip minus that voice (the helper lines its output up sample for sample with the input).
	const tool = bin("voiceisolate");
	if (IS_WINDOWS || !fs.existsSync(tool)) throw new StudioError(ondeviceUnavailable("separate") ?? "Separate voice and music needs the download first.");
	const mixWav = path.join(dir, "mix.wav");
	await ffmpeg(["-i", r.source, "-vn", "-map", "0:a:0", "-ac", "2", "-ar", String(RATE), "-c:a", "pcm_s16le", mixWav], "Couldn't read the clip's sound", r.signal);
	r.job.detail("process", "Finding the voice");
	const isolated = path.join(dir, "isolated.wav");
	const res = await run(tool, [mixWav, isolated, "100"], { timeout: Math.max(600, (frames / RATE) * 4), signal: r.signal });
	if (r.signal.aborted) throw new CancelledError();
	if (res.status === 3) throw new StudioError("Separating needs macOS 13 or newer.");
	if (res.status !== 0 || !fs.existsSync(isolated)) throw new StudioError(`Separate voice and music: ${res.stderr.trim().split("\n").pop() || reason(res)}`);
	r.job.progress("process", 0.7);
	r.job.detail("process", "Taking the voice out of the music");
	await toWav(isolated, null, frames, wav, r.signal);
	await ffmpeg(
		["-i", mixWav, "-i", isolated, "-filter_complex", `[0:a][1:a]amerge=inputs=2,pan=stereo|c0=c0-c2|c1=c1-c3,apad=whole_len=${frames},atrim=end_sample=${frames}`, "-c:a", "pcm_f32le", music],
		"Couldn't make the music track",
		r.signal,
	);
	return { wav, music, engine: "Apple voice isolation" };
}

/** Enhance voice / Separate / Voice changer on the clip's file (the whole file: sound is fast and stays in sync). */
export async function runAudioOp(op: AudioOp, r: AiRun): Promise<AiRunResult> {
	const info = await probe(r.source, r.signal);
	if (!info.hasAudio) throw new StudioError("This clip has no sound.");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-audio-ai-"));
	try {
		r.job.detail("process", "Reading the sound");
		const frames = await decode(r.source, path.join(dir, "length.f32"), RATE, 1, r.signal);
		fs.rmSync(path.join(dir, "length.f32"), { force: true });
		if (frames < RATE / 10) throw new StudioError("This clip's sound is too short.");
		r.job.progress("process", 0.08);
		const keepPicture = info.hasVideo && r.params.kind !== "audio";
		let result: { wav: string; engine: string; music?: string };
		if (op === "voice-enhance") result = await enhanceVoice(r, dir, frames);
		else if (op === "voice-change") result = await changeVoice(r, dir, frames);
		else result = await separate(r, dir, frames);
		r.job.detail("process", "Saving");
		r.job.progress("process", 0.92);
		await finish(r.source, result.wav, keepPicture, info.format, r.out, r.signal);
		if (result.music) {
			if (!r.extraOut) throw new StudioError("The music has nowhere to go. Update Gaziyav.");
			await finish(r.source, result.music, false, info.format, r.extraOut, r.signal);
		}
		return { engine: result.engine, seconds: frames / RATE, width: keepPicture ? info.width : 0, height: keepPicture ? info.height : 0 };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** Retouch: GFPGAN on the person's own face (Face swap's models, or Retouch's own download). The piece only, if asked. */
export async function runRetouch(r: AiRun): Promise<AiRunResult> {
	const own = "retouch" as "faceswap" | "retouch";
	const why = ondeviceUnavailable(own);
	if (why) throw new StudioError(own === "faceswap" ? why : (ondeviceUnavailable("retouch") ?? why));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-retouch-"));
	try {
		const colour = await colourTags(r.source, r.signal);
		let piece = r.source;
		if ((r.start ?? 0) > 0 || r.duration != null) {
			r.job.detail("process", "Preparing the clip");
			piece = path.join(dir, "piece.mp4");
			const info = await probe(r.source, r.signal);
			await trimVideo(r.source, r.start ?? 0, r.duration ?? Math.max(0.1, info.duration - (r.start ?? 0)), piece, r.signal);
		}
		const done = path.join(dir, "retouched.mp4");
		const python = ondevicePython(own);
		const root = own === "faceswap" ? modelDirs.faceswap() : modelDirs.retouch();
		const args = ["--models", root, "--lipmarks", bin(LIPMARKS), "--ffmpeg", findTool("ffmpeg"), "--look", "retouch", "--strength", String(strength(r.params, 0.7)), "--video", piece, "--out", done];
		const length = Math.max(1, r.duration ?? (await probe(piece, r.signal)).duration);
		let res = await heavy(() => runHelper(r.job, python, "local-faceswap.py", args, r.signal, Math.max(900, length * 60)));
		// Core ML can stop on some Macs without a message: the same on the processor, slower but sure.
		if (!res.ok && !fs.existsSync(done)) {
			r.job.detail("process", "Trying again without the graphics chip");
			res = await heavy(() => runHelper(r.job, python, "local-faceswap.py", [...args, "--cpu"], r.signal, Math.max(900, length * 120)));
		}
		if (!res.ok || !fs.existsSync(done)) throw new StudioError(`Retouch: ${res.error}`);
		if (!(await matchColour(done, colour, r.out, r.signal))) fs.renameSync(done, r.out);
		const info = await probe(r.out, r.signal);
		return { engine: "GFPGAN 1.4", seconds: info.duration, width: info.width, height: info.height };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
