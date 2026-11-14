// The song's score on the app's server: the four Demucs stems kept (AAC, ~6 MB a part for 4 minutes) beside the
// other separation results, the score computed from them (score.ts), the words heard on the vocal stem by the app's own
// speech-to-words (transcribe), all cached by the file's content hash — a song is separated once.
//   POST /api/hear/score { fileId }               → a job (separate → read → words); result { key, score }
//   POST /api/hear/score { fileId, cachedOnly }   → { key, score | null } at once
//   GET  /api/hear/score?key=…&part=vocals        → that stem (audio/mp4)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ondeviceUnavailable } from "@/ondevice/server";
import { fileHash } from "@/studio/server/cache";
import { CancelledError, StudioError } from "@/studio/server/errors";
import { dataDir, getFile, newFile } from "@/studio/server/files";
import { getJob, type JobState, startJob } from "@/studio/server/jobs";
import { heavy } from "@/studio/server/ml-queue";
import { beatsReady, netBeats } from "@/studio/server/beats-run";
import { runSeparate } from "@/studio/server/separate-run";
import { findTool, reason, run } from "@/studio/server/tools";
import { startTranscribe } from "@/transcribe/server/job";
import type { NetBeats } from "./net-grid";
import { NET_SCORE_VERSION, phrasesOf, SCORE_RATE, SCORE_VERSION, scoreSong } from "./score";
import { PARTS, type PartName, type SongScore } from "./score-types";

const yieldNow = () => new Promise<void>((r) => setImmediate(r));

/** One folder per song: score.json and the four stems. */
export function scoreDir(key: string): string {
	if (!/^[0-9a-f]{32}$/.test(key)) throw new StudioError("Invalid score key");
	return path.join(dataDir(), "cache", `score-${key}`);
}

const running = ((globalThis as Record<string, unknown>).__scoreJobs as Map<string, string>) ?? new Map<string, string>();
(globalThis as Record<string, unknown>).__scoreJobs = running;

export async function scoreKey(file: string): Promise<string> {
	return crypto.createHash("sha256").update([await fileHash(file), "score", SCORE_VERSION].join("|")).digest("hex").slice(0, 32);
}

export function cachedScore(key: string): SongScore | null {
	try {
		const dir = scoreDir(key);
		const s = JSON.parse(fs.readFileSync(path.join(dir, "score.json"), "utf8")) as SongScore;
		// A score made before the beat model came (v 2) is made again once it is here; one it was asked about stands.
		if ((s.v !== SCORE_VERSION && s.v !== NET_SCORE_VERSION) || (s.v === SCORE_VERSION && beatsReady())) return null;
		if (!PARTS.every((p) => fs.existsSync(path.join(dir, `${p}.m4a`)))) return null;
		return s;
	} catch {
		return null;
	}
}

export function stemPath(key: string, part: string): string {
	if (!(PARTS as readonly string[]).includes(part)) throw new StudioError("Unknown part");
	const file = path.join(scoreDir(key), `${part}.m4a`);
	if (!fs.existsSync(file)) throw new StudioError("This song's parts aren't separated yet.");
	return file;
}

async function ffmpeg(args: string[], what: string, signal: AbortSignal, timeout = 900) {
	const r = await run(findTool("ffmpeg"), ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args], { timeout, signal });
	if (signal.aborted) throw new CancelledError();
	if (r.status !== 0) throw new StudioError(`${what}: ${reason(r)}`);
}

function readF32(file: string): Float32Array {
	const b = fs.readFileSync(file);
	const out = new Float32Array(b.byteLength >> 2);
	new Uint8Array(out.buffer).set(b.subarray(0, out.length * 4));
	return out;
}

async function waitJob(id: string, signal: AbortSignal): Promise<JobState> {
	for (;;) {
		if (signal.aborted) throw new CancelledError();
		const j = getJob(id);
		if (!j) throw new StudioError("The speech recognition stopped. Try again.");
		if (j.status !== "running") return j;
		await new Promise((r) => setTimeout(r, 250));
	}
}

/**
 * The vocal stem's phrases one after another (±0.15 s each, 0.8 s of silence between) as a 16-bit mono WAV, with the
 * map from the reel's seconds back to the song's.
 */
export function phraseReel(x: Float32Array, spans: Array<[number, number]>): { file: Buffer; map: Array<{ at: number; from: number; len: number }> } {
	const gap = Math.round(0.8 * SCORE_RATE);
	const pieces = spans.map(([a, b]) => [Math.max(0, Math.round((a - 0.15) * SCORE_RATE)), Math.min(x.length, Math.round((b + 0.15) * SCORE_RATE))]);
	// pieces that overlap after the padding are one
	const merged: number[][] = [];
	for (const p of pieces) {
		const last = merged[merged.length - 1];
		if (last && p[0] <= last[1]) last[1] = Math.max(last[1], p[1]);
		else merged.push([...p]);
	}
	const total = merged.reduce((n, [a, b]) => n + (b - a) + gap, gap);
	const pcm = Buffer.alloc(total * 2);
	const map: Array<{ at: number; from: number; len: number }> = [];
	let at = gap;
	for (const [a, b] of merged) {
		map.push({ at: at / SCORE_RATE, from: a / SCORE_RATE, len: (b - a) / SCORE_RATE });
		for (let i = a; i < b; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), (at + i - a) * 2);
		at += b - a + gap;
	}
	const h = Buffer.alloc(44);
	h.write("RIFF", 0);
	h.writeUInt32LE(36 + pcm.length, 4);
	h.write("WAVEfmt ", 8);
	h.writeUInt32LE(16, 16);
	h.writeUInt16LE(1, 20);
	h.writeUInt16LE(1, 22);
	h.writeUInt32LE(SCORE_RATE, 24);
	h.writeUInt32LE(SCORE_RATE * 2, 28);
	h.writeUInt16LE(2, 32);
	h.writeUInt16LE(16, 34);
	h.write("data", 36);
	h.writeUInt32LE(pcm.length, 40);
	return { file: Buffer.concat([h, pcm]), map };
}

/** The score of an uploaded file: from the cache, or a job that makes it (one per song at a time). */
export async function startScore(body: { fileId?: string; cachedOnly?: boolean; words?: boolean; language?: string }): Promise<JobState | { key: string; score: SongScore | null }> {
	const file = getFile(String(body.fileId ?? ""));
	const key = await scoreKey(file.path);
	const hit = cachedScore(key);
	if (body.cachedOnly) return { key, score: hit };
	const busy = running.get(key);
	const state = busy ? getJob(busy) : null;
	if (state && state.status === "running") return state;
	const language = /^[a-z]{2}$/.test(String(body.language)) ? String(body.language) : "auto";
	const job = startJob(
		"score",
		[
			{ id: "separate", title: "Separating the parts", timeout: 3600 },
			{ id: "read", title: "Reading the parts", timeout: 900 },
			{ id: "words", title: "Hearing the sung words", timeout: 3600 },
		],
		async (job) => {
			if (hit) {
				job.skip("separate", "Already separated");
				job.skip("read", "From cache");
				job.skip("words", "From cache");
				return { key, score: hit };
			}
			const why = ondeviceUnavailable("separate");
			if (why) throw new StudioError(why);
			const dir = scoreDir(key);
			fs.mkdirSync(dir, { recursive: true });
			const work = path.join(dir, "work");
			fs.rmSync(work, { recursive: true, force: true });
			fs.mkdirSync(work, { recursive: true });
			const took = { separate: 0, analyse: 0, words: 0 };
			try {
				let t = Date.now();
				await job.step("separate", async (signal) => {
					job.detail("separate", "Reading the song");
					const mix = path.join(work, "mix.f32");
					await ffmpeg(["-i", file.path, "-vn", "-map", "0:a:0", "-ac", "2", "-ar", "44100", "-f", "f32le", "-c:a", "pcm_f32le", mix], "Couldn't read the song", signal);
					const seconds = fs.statSync(mix).size / 8 / 44100;
					if (seconds < 1) throw new StudioError("The song is too short to separate.");
					let error = "";
					const res = await heavy(() =>
						// The faster engine when it is on this Mac, PyTorch otherwise and whenever that one fails (separate-run.ts).
						runSeparate({ input: mix, args: ["--stems", work], outputs: PARTS.map((p) => path.join(work, `${p}.wav`)), seconds }, {
							heavy: true,
							timeout: Math.max(900, seconds * 30),
							signal,
							onLine: (line) => {
								if (line.startsWith("PROGRESS ")) job.progress("separate", Number(line.slice(9)) || 0);
								else if (line.startsWith("STATUS ")) job.detail("separate", line.slice(7));
								else if (line.startsWith("ERROR ")) error = line.slice(6);
							},
						}),
					);
					if (signal.aborted) throw new CancelledError();
					fs.rmSync(mix, { force: true });
					if (res.status !== 0 || !PARTS.every((p) => fs.existsSync(path.join(work, `${p}.wav`)))) throw new StudioError(`Separating the parts: ${error || reason(res)}`);
				});
				took.separate = (Date.now() - t) / 1000;
				t = Date.now();
				const stems = {} as Record<PartName, Float32Array>;
				let net: NetBeats | null | undefined;
				await job.step("read", async (signal) => {
					for (const [i, p] of PARTS.entries()) {
						job.detail("read", `Reading the ${p === "other" ? "guitars and keys" : p}`);
						const wav = path.join(work, `${p}.wav`);
						const raw = path.join(work, `${p}.f32`);
						// AAC like the two-way separation's music (an edit list keeps it in sync); mono 24 kHz to measure
						await ffmpeg(["-i", wav, "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", path.join(work, `${p}.m4a`)], "Couldn't save a part", signal);
						await ffmpeg(["-i", wav, "-ac", "1", "-ar", String(SCORE_RATE), "-f", "f32le", "-c:a", "pcm_f32le", raw], "Couldn't read a part", signal);
						stems[p] = readF32(raw);
						fs.rmSync(raw, { force: true });
						fs.rmSync(wav, { force: true });
						job.progress("read", (i + 1) / (PARTS.length + 1));
						await yieldNow();
					}
					// The beat model's second opinion, when it is on this Mac (null: asked, no answer — today's grid stands).
					if (beatsReady()) {
						job.detail("read", "Checking the beat");
						net = await netBeats(file.path, stems.drums.length / SCORE_RATE, { signal });
					}
				});
				took.analyse = (Date.now() - t) / 1000;
				for (const p of PARTS) fs.renameSync(path.join(work, `${p}.m4a`), path.join(dir, `${p}.m4a`));
				const ta = Date.now();
				const duration = stems.drums.length / SCORE_RATE;
				const score = scoreSong({ key, duration, stems, took, net });
				took.analyse += (Date.now() - ta) / 1000;
				const tw = Date.now();
				if (body.words !== false && score.parts.vocals.active.length) {
					await job.step("words", async (signal) => {
						// The phrases alone, 0.8 s of silence between them: the recogniser never sits through a minute
						// of nothing (where it loses its place and moves words to the next phrase), and its times are
						// mapped back phrase by phrase.
						const { file, map } = phraseReel(stems.vocals, score.parts.vocals.active);
						const slot = newFile("vocal-phrases.wav");
						fs.writeFileSync(slot.path, file);
						const started = await startTranscribe({ fileId: slot.id, language });
						const done = await waitJob(started.id, signal);
						if (done.status === "done") {
							const r = (done.result ?? {}) as { words?: Array<{ text: string; start: number; end: number }>; language?: string };
							const words = (r.words ?? []).flatMap((w) => {
								const mid = (w.start + w.end) / 2;
								const m = map.find((x) => mid >= x.at && mid < x.at + x.len) ?? null;
								if (!m) return [];
								const shift = m.from - m.at;
								return [{ text: w.text, start: Math.max(m.from, w.start + shift), end: Math.min(m.from + m.len, w.end + shift) }];
							});
							score.phrases = phrasesOf(score.parts.vocals.active, words);
							score.language = words.length ? (r.language ?? "") : "";
						} else job.detail("words", "No words heard");
					});
				} else job.skip("words");
				took.words = (Date.now() - tw) / 1000;
				score.took = { separate: Math.round(took.separate * 10) / 10, analyse: Math.round(took.analyse * 10) / 10, words: Math.round(took.words * 10) / 10 };
				fs.writeFileSync(path.join(dir, "score.json"), JSON.stringify(score));
				return { key, score };
			} finally {
				fs.rmSync(work, { recursive: true, force: true });
				running.delete(key);
			}
		},
	);
	running.set(key, job.id);
	return job;
}
