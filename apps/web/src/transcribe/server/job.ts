// The transcription job: audio → 16 kHz mono WAV (ffmpeg) → whisper-cli → words aligned to the real speech.
// Results are cached by the audio's hash, so pressing Generate again on the same timeline is instant.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dropHallucinations } from "@/hear/hallucinations";
import { fileHash } from "@/studio/server/cache";
import { StudioError } from "@/studio/server/errors";
import { dataDir, getFile, workDir } from "@/studio/server/files";
import { type JobState, startJob } from "@/studio/server/jobs";
import { findTool, reason, run } from "@/studio/server/tools";
import { frameLevels, type Span, speechIslands, type Word } from "@/transcribe/align";
import { hear, lay } from "./listen";
import { findModel, findVad, isWarming, logLine } from "./whisper";

/** Bump when alignment or parsing changes, so old cached results are not reused. */
const VERSION = 4;
/** The same for what only the path with the speech detector does (listen.ts, vad.ts). */
const VAD_VERSION = 2;
const KEEP_MS = 60 * 24 * 3600 * 1000;

export interface TranscribeResult {
	words: Word[];
	/** Where there is speech (seconds) — for pause removal. */
	speech: Span[];
	language: string;
	duration: number;
	cached?: boolean;
	/**
	 * The speech detector's file is on this Mac (listen.ts): stretches with a voice (0: the detector was caught missing
	 * a voice and the file was heard the old way), loud stretches without one that the plain engine checked, in how many
	 * it heard a stream of words, words the backstop still dropped.
	 */
	detector?: { voiced: number; again: number; believed: number; dropped: number };
}

let cleaned = false;
function cacheDir(): string {
	const dir = path.join(dataDir(), "transcripts");
	fs.mkdirSync(dir, { recursive: true });
	if (!cleaned) {
		cleaned = true;
		const now = Date.now();
		for (const name of fs.readdirSync(dir)) {
			try {
				const p = path.join(dir, name);
				if (now - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { force: true });
			} catch {}
		}
	}
	return dir;
}

function readCache(key: string): TranscribeResult | null {
	try {
		const p = path.join(cacheDir(), `${key}.json`);
		const data = JSON.parse(fs.readFileSync(p, "utf8")) as TranscribeResult;
		fs.utimesSync(p, new Date(), new Date());
		return Array.isArray(data.words) ? { ...data, cached: true } : null;
	} catch {
		return null;
	}
}

function writeCache(key: string, result: TranscribeResult) {
	try {
		fs.writeFileSync(path.join(cacheDir(), `${key}.json`), JSON.stringify(result));
	} catch {
		// A cache miss later only costs a few seconds.
	}
}

/** 16-bit mono samples of a WAV written by ffmpeg (pcm_s16le), wherever its data chunk is. */
export function readPcm16(file: string): { samples: Int16Array; sampleRate: number } {
	const buf = fs.readFileSync(file);
	if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
		throw new StudioError("Could not read the audio for transcription");
	}
	let offset = 12;
	let sampleRate = 16000;
	while (offset + 8 <= buf.length) {
		const id = buf.toString("ascii", offset, offset + 4);
		let size = buf.readUInt32LE(offset + 4);
		if (id === "fmt ") sampleRate = buf.readUInt32LE(offset + 12);
		if (id === "data") {
			if (size === 0 || offset + 8 + size > buf.length) size = buf.length - offset - 8;
			const start = offset + 8;
			const count = Math.floor(size / 2);
			const samples = new Int16Array(count);
			new Uint8Array(samples.buffer).set(buf.subarray(start, start + count * 2));
			return { samples, sampleRate };
		}
		offset += 8 + size + (size % 2);
	}
	throw new StudioError("Could not read the audio for transcription");
}

export async function startTranscribe(body: { fileId?: string; language?: string }): Promise<JobState> {
	const file = getFile(String(body.fileId ?? ""));
	const language = /^[a-z]{2}$/.test(String(body.language)) ? String(body.language) : "auto";
	const model = findModel();
	// With the speech detector on this Mac the words come another way (listen.ts): its own key, so what was cached
	// without it is heard once more with it — and without it the key, and so the cache, is what it always was.
	const vad = findVad();
	const key = crypto
		.createHash("sha256")
		.update([await fileHash(file.path), language, model ? path.basename(model) : "", VERSION, ...(vad ? [`${path.basename(vad)}:${VAD_VERSION}`] : [])].join("|"))
		.digest("hex");
	const hit = readCache(key);

	return startJob(
		"transcribe",
		[
			{ id: "audio", title: "Preparing audio", timeout: 600 },
			{ id: "recognize", title: "Recognizing speech", timeout: 7200 },
			{ id: "align", title: "Aligning word timings", timeout: 300 },
		],
		async (job) => {
			if (hit) {
				job.skip("audio", "Already transcribed");
				job.skip("recognize", "From cache");
				job.skip("align");
				return hit;
			}
			const work = workDir();
			try {
				const wav = path.join(work.dir, "speech.wav");
				await job.step("audio", async (signal) => {
					const r = await run(
						findTool("ffmpeg"),
						["-y", "-hide_banner", "-loglevel", "error", "-i", file.path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav],
						{ timeout: 600, signal },
					);
					if (r.status !== 0) {
						const why = reason(r);
						if (/does not contain any stream|matches no streams|Output file.*does not contain/i.test(why)) {
							throw new StudioError("This clip has no audio, so there is nothing to transcribe.");
						}
						throw new StudioError(`Could not extract the audio: ${why}`);
					}
				});
				const { samples, sampleRate } = readPcm16(wav);
				const duration = samples.length / sampleRate;
				if (duration < 0.2) throw new StudioError("The audio is too short to transcribe.");
				const levels = frameLevels(samples, sampleRate);
				const speech = speechIslands(levels);
				if (speech.length === 0) {
					job.skip("recognize", "No speech heard");
					job.skip("align");
					const empty: TranscribeResult = { words: [], speech, language, duration };
					writeCache(key, empty);
					return empty;
				}
				// Whisper reports progress per 30 s window only; between reports the bar moves on an estimate
				// (~3 s start + 0.15 s per second of audio on Apple Silicon), never past 95 %.
				let real = 0;
				let began = Date.now();
				let waiting = isWarming();
				if (waiting) job.detail("recognize", "Preparing speech model (first run only)…");
				const expected = 3 + duration * 0.15;
				const ticker = setInterval(() => {
					if (waiting) return;
					const guess = Math.min(0.95, (Date.now() - began) / 1000 / expected);
					job.progress("recognize", Math.max(real, guess));
				}, 300);
				const raw = await job.step("recognize", (signal) =>
					hear({
						wav,
						samples,
						sampleRate,
						levels,
						islands: speech,
						dir: work.dir,
						language,
						duration,
						signal,
						onStart: () => {
							if (waiting) job.detail("recognize", "");
							waiting = false;
							began = Date.now();
						},
						onProgress: (p) => {
							real = Math.max(real, p);
						},
					}).finally(() => clearInterval(ticker)),
				);
				// (Whisper's credit lines over silence — «Субтитры сделал …» — never reach the captions)
				let detector: TranscribeResult["detector"];
				const words = await job.step("align", async () => {
					const laid = lay(raw, levels, speech);
					const kept = dropHallucinations(laid);
					// With the detector the backstop should have nothing left to do: the log says how often it still does.
					if (raw.voiced || raw.doubted !== undefined) {
						detector = { voiced: raw.voiced?.length ?? 0, again: raw.doubted ?? 0, believed: raw.believed ?? 0, dropped: laid.length - kept.length };
						// Into the app's log only when there is something to find there later: the backstop still had work, or
						// the detector was caught missing a voice. (Every run's figures are in the result: `detector`.)
						if (detector.dropped || !raw.voiced) {
							logLine(
								raw.voiced
									? `[whisper] speech detector: ${detector.voiced} voiced stretch(es), ${kept.length} words; the backstop still dropped ${detector.dropped} word(s)`
									: `[whisper] speech detector: a stream of words in ${detector.believed} of ${detector.again} stretch(es) it called voiceless — the file was heard without it (${kept.length} words; the backstop dropped ${detector.dropped})`,
							);
						}
					}
					return kept;
				});
				const result: TranscribeResult = { words, speech, language: raw.language || language, duration, ...(detector ? { detector } : {}) };
				writeCache(key, result);
				return result;
			} finally {
				work.dispose();
			}
		},
	);
}
