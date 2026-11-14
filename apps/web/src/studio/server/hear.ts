// Claude's ears on the app's server: a media file is listened to once (ffmpeg decodes it at low priority, the frames
// are computed in small slices so the server stays responsive, Whisper's words come from the transcription cache) and
// the result is cached by the file's hash. The window then asks for maps of ranges, cut points, cut plans, seam checks
// and picture data — all answered from the cache, in timeline seconds. Nothing runs in the editor window.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { detectBeatsFromEnvelope, EnvelopeBuilder, hopFor } from "@/assist/beats";
import { IS_WINDOWS } from "@/platform/os";
import { type CutContext, cutPointsNear, endsSentence, isFiller, pauseCutPoints, planPauseCuts, type Rhythm, rhythmOf, snapRange, snapTime, type TimedWord, toFrame, bestCutIn, TAIL_GUARD, HEAD_GUARD } from "@/hear/cuts";
import { describeMusic, describeSound, describeVoice, type Loud, type Note, reverbOf } from "@/hear/describe";
import { ANALYSIS_RATE, analyseFrames, type Click, fft, findClicks, findHoles, findHum, type Frames, frameAt, HOP, type Hum, type Levels, levelsOf, LoudnessMeter, loudnessOf, SLOW_EVERY, type SlowFrame, slowFrame, type Span, toDb } from "@/hear/dsp";
import { type Answer, answer, featuresOf } from "@/hear/ask";
import { type HeardWord, heardWords, type MusicGrid, musicGrid, pausesOf, segmentsOf, sentencesOf, shapeOf, type Pause, type Segment, type Sentence } from "@/hear/map";
import { dropHallucinations } from "@/hear/hallucinations";
import { type MusicStretch, type MusicSummary, type MusicWin, playsDuring, summarizeMusic, sungLines } from "@/hear/music";
import { cachedScore, scoreDir, scoreKey } from "@/hear/score-server";
import { startTranscribe } from "@/transcribe/server/job";
import { fileHash } from "./cache";
import { CancelledError, StudioError } from "./errors";
import { dataDir, getFile } from "./files";
import { getJob, type JobState, startJob } from "./jobs";
import { clapScore, embedTexts, type HearModelState, hearModelState, heardWindows, labelBank, meanOf, mergeTags, modelNote, nearestLabels, type Win, windowsFor, wordsOf } from "./hear-models";
import { findTool } from "./tools";

/** Bump when the analysis changes: old cached results are not reused. */
const VERSION = 1;
const yieldNow = () => new Promise<void>((r) => setImmediate(r));

// ───────────────────────── decoding ─────────────────────────

/** ffmpeg → raw float samples, streamed; at low priority so the editor stays smooth. */
function decode(file: string, { from, length, rate, channels }: { from?: number; length?: number; rate: number; channels: number }, onChunk: (x: Float32Array) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
	const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
	if (from && from > 0) args.push("-ss", from.toFixed(4));
	args.push("-i", file);
	if (length !== undefined) args.push("-t", Math.max(0.01, length).toFixed(4));
	args.push("-vn", "-sn", "-dn", "-ac", String(channels), "-ar", String(rate), "-f", "f32le", "pipe:1");
	const ffmpeg = findTool("ffmpeg");
	return new Promise((resolve, reject) => {
		const child = IS_WINDOWS ? spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }) : spawn("/usr/bin/nice", ["-n", "5", ffmpeg, ...args], { stdio: ["ignore", "pipe", "pipe"] });
		let rest: Buffer = Buffer.alloc(0);
		let err = "";
		let chain = Promise.resolve();
		const abort = () => child.kill("SIGKILL");
		signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (d: Buffer) => {
			const buf = rest.length ? Buffer.concat([rest, d]) : d;
			const usable = buf.length - (buf.length % 4);
			rest = buf.subarray(usable);
			const copy = new Float32Array(usable / 4);
			new Uint8Array(copy.buffer).set(buf.subarray(0, usable));
			child.stdout.pause();
			chain = chain.then(() => onChunk(copy)).then(() => {
				child.stdout.resume();
			});
		});
		child.stderr.on("data", (d) => {
			err += d.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			signal?.removeEventListener("abort", abort);
			chain.then(() => {
				if (signal?.aborted) return reject(new CancelledError());
				if (code !== 0 && !/does not contain any stream|matches no streams/i.test(err)) return reject(new StudioError(`Couldn't read the sound: ${err.trim().split("\n").pop() ?? code}`));
				resolve();
			}, reject);
		});
	});
}

async function decodeAll(file: string, o: { from?: number; length?: number; rate: number; channels: number }, signal?: AbortSignal): Promise<Float32Array> {
	const parts: Float32Array[] = [];
	let n = 0;
	await decode(file, o, (x) => {
		parts.push(x);
		n += x.length;
	}, signal);
	const out = new Float32Array(n);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

// ───────────────────────── the whole-file analysis ─────────────────────────

export interface Analysis {
	key: string;
	duration: number;
	language: string;
	rate: number;
	frames: Frames;
	slow: Array<{ t: number; db: number; chroma: number[] }>;
	/** K-weighted mean square per 100 ms (48 kHz stereo), for loudness of any range. */
	blocks: number[];
	peakDb: number;
	clips: number[];
	clicks: Click[];
	holes: Span[];
	levels: Levels;
	words: TimedWord[];
	speech: Span[];
	breaths: Span[];
	rhythm: Rhythm;
	beats: { bpm: number; beats: number[] } | null;
	hum: Hum | null;
	reverb: number | null;
	musicSeconds: number;
}

const BLOCK = 10 * ANALYSIS_RATE;
/** Context each side of a block: the long hum/key window (8192 samples) and the pitch search fit in it. */
const MARGIN = 15 * Math.round(ANALYSIS_RATE * HOP);

/** Frames, clicks, holes, slow spectra and the beat envelope of a stream, block by block (bounded memory). */
class StreamAnalyser {
	private buf = new Float32Array(0);
	/** Sample index of buf[0] in the stream. */
	private base = 0;
	/** Next block start (stream samples). */
	private next = 0;
	readonly parts: Frames[] = [];
	readonly slow: SlowFrame[] = [];
	readonly clicks: Click[] = [];
	readonly holes: Span[] = [];
	readonly env = new EnvelopeBuilder(hopFor(ANALYSIS_RATE));
	total = 0;

	async push(x: Float32Array) {
		const merged = new Float32Array(this.buf.length + x.length);
		merged.set(this.buf);
		merged.set(x, this.buf.length);
		this.buf = merged;
		this.total += x.length;
		while (this.base + this.buf.length - this.next >= BLOCK + MARGIN) {
			this.block(this.next, this.next + BLOCK);
			await yieldNow();
		}
	}

	finish() {
		while (this.next < this.total) this.block(this.next, Math.min(this.total, this.next + BLOCK));
	}

	private block(b0: number, b1: number) {
		const rate = ANALYSIS_RATE;
		const hop = Math.round(rate * HOP);
		const s0 = Math.max(this.base, b0 - MARGIN);
		const s1 = Math.min(this.base + this.buf.length, b1 + MARGIN);
		const slice = this.buf.subarray(s0 - this.base, s1 - this.base);
		const fr = analyseFrames(slice, rate, s0 / rate);
		const skip = Math.round((b0 - s0) / hop);
		const count = Math.floor((b1 - b0) / hop);
		const pick = (a: Float32Array) => a.slice(skip, skip + count);
		this.parts.push({ t0: b0 / rate, n: Math.min(count, fr.n - skip), db: pick(fr.db), voicing: pick(fr.voicing), f0: pick(fr.f0), flat: pick(fr.flat), centroid: pick(fr.centroid), low: pick(fr.low), mud: pick(fr.mud), pres: pick(fr.pres), sib: pick(fr.sib) });
		for (const c of findClicks(slice, rate, s0 / rate)) if (c.at >= b0 / rate && c.at < b1 / rate) this.clicks.push(c);
		for (const h of findHoles(slice, rate, s0 / rate)) if (h.start >= b0 / rate - 1e-6 && h.start < b1 / rate) this.holes.push(h);
		const step = Math.round(SLOW_EVERY * rate);
		for (let c = Math.ceil(b0 / step) * step; c < b1; c += step) this.slow.push(slowFrame(slice, rate, c - s0, c / rate));
		this.env.push(this.buf.subarray(b0 - this.base, b1 - this.base));
		this.next = b1;
		// Keep only the context the next block needs.
		const keepFrom = Math.max(this.base, b1 - MARGIN);
		this.buf = this.buf.slice(keepFrom - this.base);
		this.base = keepFrom;
	}

	frames(): Frames {
		const n = this.parts.reduce((s, p) => s + p.n, 0);
		const out: Frames = { t0: 0, n, db: new Float32Array(n), voicing: new Float32Array(n), f0: new Float32Array(n), flat: new Float32Array(n), centroid: new Float32Array(n), low: new Float32Array(n), mud: new Float32Array(n), pres: new Float32Array(n), sib: new Float32Array(n) };
		let at = 0;
		for (const p of this.parts) {
			for (const k of FRAME_KEYS) out[k].set(p[k].subarray(0, p.n), at);
			at += p.n;
		}
		return out;
	}
}

const FRAME_KEYS = ["db", "voicing", "f0", "flat", "centroid", "low", "mud", "pres", "sib"] as const;

function cacheDir(): string {
	const dir = path.join(dataDir(), "hearing");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** One map per server process, shared by every route (Next may load this module more than once). */
function shared<V>(name: string): Map<string, V> {
	const g = globalThis as unknown as Record<string, Map<string, V> | undefined>;
	const found = g[name];
	if (found) return found;
	const made = new Map<string, V>();
	g[name] = made;
	return made;
}
const memory = shared<Analysis>("__hearMemory");
const keyOfFile = shared<string>("__hearKeys");
/** The file each analysis was made from (the hearing models listen to it again, window by window). */
const fileOfKey = shared<string>("__hearFiles");

/** The song's score (hear/score-server.ts) of each analysis, by the same file: its key, known from the first listen. */
const scoreOfKey = shared<string>("__hearScoreKeys");
const refereedMemo = new Map<string, { at: number; grid: { bpm: number; beats: number[]; bars: number[] } | null }>();

/**
 * The song's refereed grid (hear/score.ts with the beat network's answer, hear/net-grid.ts), in the file's seconds —
 * one source for the beats and bars of the Beat markers, fit_music and check_cuts. Null, and so today's grid of the
 * envelope, when the song has no score yet or the network gave no answer for it.
 */
function refereedGrid(a: Analysis): { bpm: number; beats: number[]; bars: number[] } | null {
	const sk = scoreOfKey.get(a.key);
	if (!sk) return null;
	try {
		const file = path.join(scoreDir(sk), "score.json");
		const at = fs.statSync(file).mtimeMs;
		const known = refereedMemo.get(sk);
		if (known?.at === at) return known.grid;
		const s = cachedScore(sk);
		const main = s?.tempo.length ? s.tempo.reduce((m, t) => (t.end - t.start > m.end - m.start ? t : m)) : null;
		const grid = s?.refereed && main && s.beats.length >= 8 ? { bpm: main.bpm, beats: s.beats, bars: s.bars } : null;
		refereedMemo.set(sk, { at, grid });
		return grid;
	} catch {
		return null;
	}
}

/** The beats a view reads: the refereed grid's when there is one, else the envelope's (file seconds). */
const beatsOf = (a: Analysis): { bpm: number; beats: number[]; bars?: number[] } | null => {
	const r = refereedGrid(a);
	return r ?? a.beats;
};

function sourceFile(key: string, fileId?: unknown): string | null {
	if (fileId) {
		try {
			return getFile(String(fileId)).path;
		} catch {}
	}
	return fileOfKey.get(key) ?? null;
}

function remember(a: Analysis) {
	memory.delete(a.key);
	memory.set(a.key, a);
	while (memory.size > 6) memory.delete(memory.keys().next().value as string);
}

function save(a: Analysis) {
	try {
		const { frames, ...rest } = a;
		const parts = FRAME_KEYS.map((k) => frames[k]);
		const bin = Buffer.alloc(parts.reduce((s, p) => s + p.byteLength, 0));
		let at = 0;
		for (const p of parts) {
			Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(bin, at);
			at += p.byteLength;
		}
		fs.writeFileSync(path.join(cacheDir(), `${a.key}.bin`), bin);
		fs.writeFileSync(path.join(cacheDir(), `${a.key}.json`), JSON.stringify({ ...rest, n: frames.n }));
	} catch {
		// A cache miss later only costs the analysis again.
	}
}

function load(key: string): Analysis | null {
	const hit = memory.get(key);
	if (hit) return hit;
	try {
		const meta = JSON.parse(fs.readFileSync(path.join(cacheDir(), `${key}.json`), "utf8"));
		const bin = fs.readFileSync(path.join(cacheDir(), `${key}.bin`));
		const n = meta.n as number;
		const frames = { t0: 0, n } as Frames;
		FRAME_KEYS.forEach((k, i) => {
			const arr = new Float32Array(n);
			new Uint8Array(arr.buffer).set(bin.subarray(i * n * 4, (i + 1) * n * 4));
			frames[k] = arr;
		});
		const a = { ...meta, frames } as Analysis;
		// Analyses cached before the hallucination filter: the same filter on the way in.
		a.words = dropHallucinations(a.words, (s, e) => musicOnlyIn(frames, a.levels, s, e));
		remember(a);
		return a;
	} catch {
		return null;
	}
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
 * The whole file, once: `POST /api/hear/source { fileId, language?, words? }` → a job whose result is
 * `{ key, duration, words, language }`. Cached by the file's hash (the same clip imported twice is heard once).
 */
export async function startHearing(body: { fileId?: string; language?: string; words?: boolean; cachedOnly?: boolean }): Promise<JobState> {
	const file = getFile(String(body.fileId ?? ""));
	const language = /^[a-z]{2}$/.test(String(body.language)) ? String(body.language) : "auto";
	const wantWords = body.words !== false;
	const key = crypto.createHash("sha256").update([await fileHash(file.path), language, wantWords ? "w" : "-", VERSION].join("|")).digest("hex").slice(0, 32);
	keyOfFile.set(String(body.fileId), key);
	fileOfKey.set(key, file.path);
	scoreOfKey.set(key, await scoreKey(file.path));
	const summary = (a: Analysis) => ({ key: a.key, duration: a.duration, words: a.words.length, language: a.language });
	const cached = load(key);
	// Quick edits (split, trim) only use what was already heard: they never wait for a first listen.
	if (!cached && body.cachedOnly) throw new StudioError("not heard yet");
	return startJob(
		"hear",
		[
			{ id: "sound", title: "Listening to the sound", timeout: 3600 },
			{ id: "words", title: "Hearing the words", timeout: 7200 },
		],
		async (job) => {
			if (cached) {
				job.skip("sound", "Already heard");
				job.skip("words", "From cache");
				return summary(cached);
			}
			const analyser = new StreamAnalyser();
			const meter = new LoudnessMeter(48000);
			const recognize = wantWords ? startTranscribe({ fileId: body.fileId, language }) : null;
			await job.step("sound", async (signal) => {
				await Promise.all([
					decode(file.path, { rate: ANALYSIS_RATE, channels: 1 }, (x) => analyser.push(x), signal),
					decode(
						file.path,
						{ rate: 48000, channels: 2 },
						async (x) => {
							const n = x.length >> 1;
							const l = new Float32Array(n);
							const r = new Float32Array(n);
							for (let i = 0; i < n; i++) {
								l[i] = x[2 * i];
								r[i] = x[2 * i + 1];
							}
							meter.push([l, r], meter.blocks.length * 0.1);
							await yieldNow();
						},
						signal,
					),
				]);
				analyser.finish();
			});
			let words: TimedWord[] = [];
			let speech: Span[] = [];
			let detected = language;
			if (recognize) {
				await job.step("words", async (signal) => {
					const done = await waitJob((await recognize).id, signal);
					if (done.status === "failed") throw new StudioError(done.error || "Speech recognition failed.");
					const r = (done.result ?? {}) as { words?: TimedWord[]; speech?: Span[]; language?: string };
					words = r.words ?? [];
					speech = r.speech ?? [];
					detected = r.language || language;
				});
			} else job.skip("words");
			const frames = analyser.frames();
			const duration = analyser.total / ANALYSIS_RATE;
			const levels = levelsOf(frames);
			// Whisper's hallucinated lines over music with no voice («субтитры подогнал …», «Продолжение следует»).
			words = dropHallucinations(words, (s, e) => musicOnlyIn(frames, levels, s, e));
			const shape = shapeOf(words, frames, levels, 0, duration);
			const segs = shape.segments;
			const musicSeconds = segs.filter((s) => s.kind === "music" || s.kind === "speech+music").reduce((s, x) => s + x.end - x.start, 0);
			let beats: Analysis["beats"] = null;
			if (musicSeconds >= 4 || (!words.length && duration >= 4)) {
				const r = detectBeatsFromEnvelope(analyser.env.env, ANALYSIS_RATE / analyser.env.hop);
				if (r.bpm > 0 && r.beats.length >= 8) beats = { bpm: r.bpm, beats: r.beats.map((b) => Math.round(b * 1000) / 1000) };
			}
			const loud = loudnessOf(meter);
			const a: Analysis = {
				key,
				duration,
				language: detected,
				rate: ANALYSIS_RATE,
				frames,
				slow: analyser.slow.map((s) => ({ t: s.t, db: s.db, chroma: s.chroma.map((c) => Math.round(c * 1e4) / 1e4) })),
				blocks: meter.blocks,
				peakDb: loud.peakDb,
				clips: loud.clips,
				clicks: analyser.clicks,
				holes: analyser.holes,
				levels,
				words: shape.words.map(({ text, start, end, p }) => ({ text, start, end, ...(p !== undefined ? { p } : {}) })),
				speech,
				breaths: shape.breaths,
				rhythm: shape.rhythm,
				beats,
				hum: findHum(analyser.slow, ANALYSIS_RATE),
				reverb: reverbOf(frames, levels, shape.words),
				musicSeconds,
			};
			save(a);
			remember(a);
			return summary(a);
		},
	);
}

/** Only music sounds in [s, e) (source seconds): the measured stretches there, heard without words, are music. */
function musicOnlyIn(frames: Frames, levels: Levels, s: number, e: number): boolean {
	const lo = Math.max(0, s - 0.25);
	const hi = Math.min(frames.t0 + frames.n * HOP, e + 0.25);
	if (hi - lo < 0.3) return false;
	const segs = segmentsOf(frames, levels, [], lo, hi);
	const music = segs.filter((x) => x.kind === "music").reduce((sum, x) => sum + x.end - x.start, 0);
	return music >= 0.6 * (hi - lo);
}

function need(key: unknown): Analysis {
	const a = load(String(key ?? ""));
	if (!a) throw new StudioError("This sound hasn't been listened to yet (or the app restarted). Listen to it again.");
	return a;
}

// ───────────────────────── a range on the timeline ─────────────────────────

/** Where a clip's source plays on the timeline: timeline t = start + (source s − trimStart) / rate. */
export interface Placement {
	start: number;
	trimStart: number;
	rate: number;
}

const toT = (p: Placement, s: number) => p.start + (s - p.trimStart) / (p.rate || 1);
const toS = (p: Placement, t: number) => p.trimStart + (t - p.start) * (p.rate || 1);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The frames of [from, to] (timeline seconds) as the timeline plays them: 10 ms apart in timeline time. */
function framesOn(a: Analysis, p: Placement, from: number, to: number): Frames {
	const n = Math.max(0, Math.ceil((to - from) / HOP));
	const out: Frames = { t0: from, n, db: new Float32Array(n), voicing: new Float32Array(n), f0: new Float32Array(n), flat: new Float32Array(n), centroid: new Float32Array(n), low: new Float32Array(n), mud: new Float32Array(n), pres: new Float32Array(n), sib: new Float32Array(n) };
	for (let j = 0; j < n; j++) {
		const f = frameAt(a.frames, toS(p, from + j * HOP));
		const ok = f >= 0 && f < a.frames.n;
		for (const k of FRAME_KEYS) out[k][j] = ok ? a.frames[k][f] : k === "db" || k === "low" || k === "mud" || k === "pres" || k === "sib" ? -100 : 0;
	}
	return out;
}

interface View {
	ctx: CutContext;
	words: HeardWord[];
	from: number;
	to: number;
	a: Analysis;
	p: Placement;
	grid: MusicGrid | null;
	/** Where its beats came from: the song's refereed grid or the envelope's (file seconds). */
	src: { bpm: number; beats: number[]; bars?: number[] } | null;
}

/** Everything of one clip's range in timeline seconds (words, breaths, beats mapped; frames resampled). */
function viewOf(a: Analysis, p: Placement, from: number, to: number, fps: number, pad = 2): View {
	const lo = Math.max(toT(p, 0), from - pad);
	const hi = Math.min(toT(p, a.duration), to + pad);
	const frames = framesOn(a, p, lo, hi);
	const mapSpan = <T extends Span>(s: T): T => ({ ...s, start: r3(toT(p, s.start)), end: r3(toT(p, s.end)) });
	const raw = a.words.filter((w) => toT(p, w.end) > lo && toT(p, w.start) < hi).map(mapSpan);
	const words = heardWords(raw, frames);
	const breaths = a.breaths.map(mapSpan).filter((b) => b.end > lo && b.start < hi);
	const src = beatsOf(a);
	const beats = src ? src.beats.map((b) => r3(toT(p, b))).filter((b) => b >= lo && b <= hi) : undefined;
	const bars = src?.bars?.map((b) => r3(toT(p, b))).filter((b) => b >= lo && b <= hi);
	const grid = beats && src ? musicGrid(beats, src.bpm * (p.rate || 1), frames, bars) : null;
	return { ctx: { frames, levels: a.levels, words, breaths, fps, beats, downbeats: grid?.downbeats }, words, from: Math.max(from, lo), to: Math.min(to, hi), a, p, grid, src };
}

function loudOf(a: Analysis, p: Placement, from: number, to: number): Loud {
	const b0 = Math.max(0, Math.floor(toS(p, from) / 0.1));
	const b1 = Math.min(a.blocks.length, Math.ceil(toS(p, to) / 0.1));
	const meter = { blocks: a.blocks.slice(b0, b1), peak: 0, clips: [] } as unknown as LoudnessMeter;
	const l = loudnessOf(meter);
	return {
		integrated: Math.round(l.integrated * 10) / 10,
		shortTerm: l.shortTerm.map(([t, v]) => [r3(toT(p, b0 * 0.1 + t)), Math.round(v * 10) / 10] as [number, number]),
		peakDb: a.peakDb,
		clips: a.clips.map((c) => r3(toT(p, c))).filter((c) => c >= from && c <= to),
	};
}

export interface RangeMap {
	from: number;
	to: number;
	language: string;
	words: HeardWord[];
	pauses: Pause[];
	breaths: Span[];
	segments: Segment[];
	sentences: Sentence[];
	clicks: Click[];
	holes: Span[];
	loud: Loud;
	grid: MusicGrid | null;
	rhythm: Rhythm;
	cuts: ReturnType<typeof pauseCutPoints>;
	/** Every beat the tracker found here and its tempo, also when the pulse is too weak for bars (beat markers use them). */
	beats: number[];
	bpm: number;
	notes: Note[];
	/** Filler words and dead air (pauses over 1 s beyond the natural pause) as shares of the range. */
	fillerShare: number;
	deadAir: number;
}

/** `POST /api/hear/map { key, from, to, place, fps, top? }` — the audio map of one clip's range. */
export function hearMap(body: { key?: string; from?: number; to?: number; place?: Placement; fps?: number; top?: number; clip?: Span }): RangeMap & { first: number } {
	const a = need(body.key);
	const p = body.place ?? { start: 0, trimStart: 0, rate: 1 };
	const fps = Number(body.fps) > 0 ? Number(body.fps) : 30;
	const from = Math.max(toT(p, 0), Number(body.from ?? toT(p, 0)));
	const to = Math.min(toT(p, a.duration), Number(body.to ?? toT(p, a.duration)));
	const v = viewOf(a, p, from, to, fps);
	const inside = <T extends Span>(s: T) => s.end > from && s.start < to;
	const words = v.words.filter((w) => w.end > from + 0.01 && w.start < to - 0.01);
	// Word numbers count from the clip's first word (#1), whatever range is asked: cut_point {after: n} finds them again.
	const clipFrom = Math.max(toT(p, 0), Number(body.clip?.start ?? from));
	const first = a.words.filter((w) => toT(p, w.end) > clipFrom + 0.01 && toT(p, w.start) < from + 0.01 && toT(p, w.end) <= from + 0.01).length;
	const pauses = pausesOf(words, v.ctx.frames, a.levels, v.ctx.breaths, from, to).filter(inside);
	const segments = segmentsOf(v.ctx.frames, a.levels, words, from, to);
	const sentences = sentencesOf(words, to);
	const cuts = pauseCutPoints({ ...v.ctx, words }, from, to).filter((c) => c.at >= from && c.at <= to);
	const ranked = [...cuts].sort((x, y) => y.score - x.score).slice(0, Math.max(1, Math.min(30, Number(body.top) || 10)));
	const loud = loudOf(a, p, from, to);
	const musicSpans = segments.filter((s) => s.kind === "music" || s.kind === "speech+music");
	const slow = a.slow.filter((s) => toT(p, s.t) >= from && toT(p, s.t) <= to).map((s) => ({ ...s, t: toT(p, s.t), low: new Float32Array(0) }));
	const input = { frames: v.ctx.frames, levels: a.levels, words, pauses, segments, loud, slow, hum: a.hum, grid: v.grid, from, to, rate: a.rate };
	const notes = [...describeSound(input, a.reverb), ...describeVoice(input, a.rhythm.pause), ...describeMusic(input, musicSpans)];
	const length = Math.max(0.01, to - from);
	const fillers = words.filter((w) => w.filler).length;
	const dead = pauses.filter((x) => x.before >= 0 && x.before < v.words.length - 1).reduce((s, x) => s + Math.max(0, x.length - 1 - a.rhythm.pause), 0);
	return {
		first,
		from: r3(from),
		to: r3(to),
		language: a.language,
		words,
		pauses: pauses.map((x) => ({ ...x, start: r3(x.start), end: r3(x.end), length: r3(x.length) })),
		breaths: v.ctx.breaths.filter(inside),
		segments,
		sentences,
		clicks: a.clicks.map((c) => ({ ...c, at: r3(toT(p, c.at)), over: Math.round(c.over) })).filter((c) => c.at >= from && c.at <= to),
		holes: a.holes.map((h) => ({ start: r3(toT(p, h.start)), end: r3(toT(p, h.end)) })).filter(inside),
		loud,
		grid: v.grid ? { ...v.grid, beats: v.grid.beats.filter((b) => b >= from && b <= to), downbeats: v.grid.downbeats.filter((b) => b >= from && b <= to), sections: v.grid.sections.filter(inside) } : null,
		rhythm: a.rhythm,
		cuts: ranked,
		beats: v.src ? v.src.beats.map((b) => r3(toT(p, b))).filter((b) => b >= from && b <= to) : [],
		bpm: v.src ? Math.round(v.src.bpm * (p.rate || 1) * 10) / 10 : 0,
		notes,
		fillerShare: words.length ? fillers / words.length : 0,
		deadAir: dead / length,
	};
}

/** What the tagger hears in a stretch of the map: its everyday labels with their probabilities (AudioSet). */
export interface HeardStretch {
	start: number;
	end: number;
	kind: Segment["kind"];
	tags: Array<[string, number]>;
	/** The tagger hears a voice here (speech, singing…); false: the stretch is something else, whatever its words. */
	speech: boolean;
}

/** Labels of sounds made of many small hits: a «click» inside them is the sound itself (a raindrop, a clap). */
const IMPULSIVE = /^(Rain|Raindrop|Rain on surface|Applause|Clapping|Cheering|Crackle|Fire|Fireworks|Firecracker|Typing|Computer keyboard|Rustle|Crumpling, crinkling|Gravel|Hail|Drip|Pour|Frying \(food\)|Sizzle|Tick|Tick-tock|Clicking|Footsteps|Knock|Tap|Rattle|Shuffle|Waterfall|Stream|Splash, splatter)$/;
const VOICE = /^(Speech|Male speech, man speaking|Female speech, woman speaking|Child speech, kid speaking|Conversation|Narration, monologue|Speech synthesizer|Babbling|Whispering|Shout|Yell|Singing|Rapping|Choir|Chant)$/;
const MUSICAL = /music|^Musical instrument$|^Song$|^Singing$/i;

/** At most this many tagger windows per map (~0.3–1 s each on two threads; cached after the first time). */
const TAG_BUDGET = 12;

/**
 * `POST /api/hear/map { …, captions: true, fileId? }` — the map plus what the hearing model's tagger hears in each
 * stretch (rain, applause, piano, sad music…): non-speech stretches first, a few 10 s windows each. Without the model:
 * the map alone, and `note` says why.
 */
export async function hearMapWith(body: Parameters<typeof hearMap>[0] & { captions?: boolean; fileId?: string }, signal?: AbortSignal): Promise<RangeMap & { first: number; model?: HearModelState["state"]; note?: string; heard?: HeardStretch[]; heardAll?: Array<[string, number]> }> {
	const m = hearMap(body);
	if (!body.captions) return m;
	const model = hearModelState();
	const a = need(body.key);
	const file = model.state === "ready" ? sourceFile(a.key, body.fileId) : null;
	if (!file) return { ...m, model: model.state, note: model.state === "ready" ? "the hearing model needs the clip's file again: listen to it once more" : (modelNote(model) ?? undefined) };
	const p = body.place ?? { start: 0, trimStart: 0, rate: 1 };
	const r2 = (x: number) => Math.round(x * 100) / 100;
	// Two seconds at least: the tagger guesses wildly on less («quack» for a word).
	const segs = m.segments.filter((x) => x.end - x.start >= 2 && x.kind !== "silence");
	const order = [...segs].sort((x, y) => Number(x.kind === "speech") - Number(y.kind === "speech") || y.end - y.start - (x.end - x.start));
	const plan = new Map<Segment, Win[]>();
	let budget = TAG_BUDGET;
	for (const seg of order) {
		if (budget <= 0) break;
		const s0 = Math.max(0, toS(p, seg.start));
		const s1 = Math.min(a.duration, toS(p, seg.end));
		let wins: Win[];
		if (s1 - s0 <= 12.5) wins = [{ t: r2(s0), len: r2(s1 - s0) }];
		else {
			// 10 s windows on the 10 s grid (reused by later questions), spread over the stretch.
			const grid: Win[] = [];
			for (let t = Math.ceil(s0 / 10) * 10; t + 10 <= s1 + 2; t += 10) grid.push({ t, len: Math.min(10, r2(a.duration - t)) });
			if (!grid.length) grid.push({ t: r2(s0), len: 10 });
			const k = Math.min(seg.kind === "speech" ? 1 : 3, grid.length);
			wins = Array.from({ length: k }, (_, i) => grid[Math.floor(((i + 0.5) * grid.length) / k)]);
		}
		wins = wins.slice(0, budget);
		budget -= wins.length;
		plan.set(seg, wins);
	}
	const all = [...plan.values()].flat();
	let data: Awaited<ReturnType<typeof heardWindows>> = [];
	try {
		data = all.length ? await heardWindows(a.key, file, all, { tags: true }, signal) : [];
	} catch (error) {
		if (error instanceof CancelledError || signal?.aborted) throw error;
		return { ...m, model: model.state, note: `the hearing model failed (${error instanceof Error ? error.message : String(error)})` };
	}
	const of = new Map(all.map((w, i) => [`${w.t}+${w.len}`, data[i]]));
	const heard: HeardStretch[] = segs
		.filter((x) => plan.has(x))
		.map((seg) => {
			const raw = (plan.get(seg) ?? []).map((w) => of.get(`${w.t}+${w.len}`)?.g);
			const all = mergeTags(raw, 12, 0.05);
			return { start: seg.start, end: seg.end, kind: seg.kind, tags: mergeTags(raw), speech: all.some(([l, p]) => VOICE.test(l) && p >= 0.25) };
		});
	// What the tagger hears corrects two guesses of the measurements: a «click» inside rain or applause is the sound
	// itself (no fix to offer), and a beat found in a noise with no music in it is no music grid.
	const inImpulsive = (t: number) => heard.some((h) => t >= h.start && t <= h.end && h.tags.some(([l, p]) => IMPULSIVE.test(l) && p >= 0.3));
	const musicHeard = data.some((d) => (d.g ?? []).some(([l, p]) => MUSICAL.test(l) && p >= 0.2)) || m.segments.some((x) => x.kind === "music" || x.kind === "speech+music");
	return {
		...m,
		clicks: m.clicks.filter((c) => !inImpulsive(c.at)),
		...(data.length && !musicHeard ? { grid: null, beats: [], bpm: 0 } : {}),
		model: model.state,
		heard,
		heardAll: mergeTags(data.map((d) => d.g), 5),
	};
}

/** `POST /api/hear/near { key, place, fps, at, window?, after?, music? }` — the best cuts near a time (or after word #n). */
export function hearNear(body: { key?: string; place?: Placement; fps?: number; at?: number; window?: number; after?: number; music?: boolean; from?: number; to?: number }): { at: number; points: ReturnType<typeof cutPointsNear>; words?: Array<string | null> } {
	const a = need(body.key);
	const p = body.place ?? { start: 0, trimStart: 0, rate: 1 };
	const fps = Number(body.fps) > 0 ? Number(body.fps) : 30;
	const from = Math.max(toT(p, 0), Number(body.from ?? toT(p, 0)));
	const to = Math.min(toT(p, a.duration), Number(body.to ?? toT(p, a.duration)));
	let at = Number(body.at);
	let window = Math.max(0.05, Math.min(3, Number(body.window) || 0.5));
	const v = viewOf(a, p, Number.isFinite(at) ? at : from, Number.isFinite(at) ? at : to, fps, 3);
	if (body.after !== undefined) {
		// Word #n counts from the clip range's first word (as listen numbers them).
		const all = viewOf(a, p, from, to, fps, 0).words.filter((w) => w.end > from + 0.01 && w.start < to - 0.01);
		const w = all[Number(body.after) - 1];
		const next = all[Number(body.after)];
		if (!w) throw new StudioError(`There is no word #${body.after} here (${all.length} words).`);
		at = next ? (w.end + next.start) / 2 : w.end + 0.2;
		window = Math.max(0.05, ((next ? next.start : w.end + 0.6) - w.end) / 2 + 0.02);
		const near = viewOf(a, p, at, at, fps, 3);
		return { at: r3(at), points: cutPointsNear(near.ctx, at, window, { music: !!body.music }).slice(0, 3), words: [w.text, next?.text ?? null] };
	}
	if (!Number.isFinite(at)) throw new StudioError("Give `at` (timeline seconds) or `after` (word number).");
	const music = !!body.music || (!v.words.length && !!v.grid);
	// Nothing in reach (words running on): look further, then fall back to the quietest boundary of the word.
	for (const w of [window, window * 2, Math.max(window * 4, 2.5)]) {
		const points = cutPointsNear(viewOf(a, p, at, at, fps, w + 1.5).ctx, at, w, { music }).slice(0, 3);
		if (points.length) return { at: r3(at), points };
	}
	const s = snapTime(v.ctx, at, 0.6);
	return { at: r3(at), points: [{ at: s.at, score: 0.2, stars: 1, after: -1, reason: s.note ?? "the quietest frame here (no pause near)", db: -60 }] };
}

/**
 * `POST /api/hear/plan { key, place, fps, op, from, to, ranges?, times?, minPause?, fillers? }` — where the editing
 * tools cut: op "pauses" (remove pauses: the cuts), "ranges" (cut_out: each range made seamless), "times" (split/trim).
 */
export function hearPlan(body: { key?: string; place?: Placement; fps?: number; op?: string; from?: number; to?: number; ranges?: Array<{ from: number; to: number }>; times?: number[]; minPause?: number; fillers?: boolean }) {
	const a = need(body.key);
	const p = body.place ?? { start: 0, trimStart: 0, rate: 1 };
	const fps = Number(body.fps) > 0 ? Number(body.fps) : 30;
	const from = Math.max(toT(p, 0), Number(body.from ?? toT(p, 0)));
	const to = Math.min(toT(p, a.duration), Number(body.to ?? toT(p, a.duration)));
	if (body.op === "pauses") {
		// The clip may run past its sound (a video longer than its audio): that tail is dead air too.
		const end = Math.max(to, Number(body.to ?? to));
		const v = viewOf(a, p, from, end, fps, 0.5);
		const cuts = planPauseCuts(v.ctx, from, end, { minPause: Number(body.minPause) || undefined, fillers: body.fillers !== false });
		return { cuts, rhythm: rhythmOf(v.words.filter((w) => !isFiller(w.text))) };
	}
	if (body.op === "ranges") {
		return {
			ranges: (body.ranges ?? []).map((r) => {
				const v = viewOf(a, p, r.from, r.to, fps, 1.5);
				return snapRange(v.ctx, r.from, r.to);
			}),
		};
	}
	if (body.op === "times") {
		return {
			times: (body.times ?? []).map((t) => {
				const v = viewOf(a, p, t, t, fps, 1.5);
				return snapTime(v.ctx, t);
			}),
		};
	}
	throw new StudioError("Unknown plan.");
}

// ───────────────────────── asking the sound ─────────────────────────

/**
 * What the measurements settle (the model's ear is the second opinion there): silence, speech and hum exactly, and
 * «music» as a whole — the model scores a general word low against a piece's own, more exact best label.
 */
const MEASURED = new Set(["silence", "speech", "hum", "music"]);
/** CLAP reads English: a phrase in another script is answered by the measured concepts. */
const english = (q: string) => !/[\u0400-\u04FF]/.test(q);

export interface AskAnswer extends Answer {
	/** heard = the hearing model (CLAP); measured = the signal measurements; both = the higher of the two. */
	by: "heard" | "measured" | "both";
}
type Hit = { start: number; end: number; score: number; why: string };

/** The best stretches: windows ≥ `min` merged where they touch, strongest first. */
function mergeHits(hits: Hit[], min: number): Hit[] {
	const merged: Hit[] = [];
	for (const h of hits.filter((x) => x.score >= min).sort((x, y) => x.start - y.start)) {
		const last = merged[merged.length - 1];
		if (last && h.start <= last.end) {
			last.end = Math.max(last.end, h.end);
			if (h.score > last.score) Object.assign(last, { score: h.score, why: h.why });
		} else merged.push({ ...h });
	}
	return merged.sort((x, y) => y.score - x.score).slice(0, 4);
}

/** One answer from the model's score and the measured one: measured facts stay measured, the rest is heard. */
function combine(q: string, heard: number, dsp: Answer, closest: string[], reverbKnown: boolean): AskAnswer {
	const sounds = closest.length ? `closest sounds: ${closest.join(", ")}` : "";
	if (dsp.score !== null && dsp.concepts.length && dsp.concepts.every((c) => MEASURED.has(c))) return { ...dsp, why: `measured: ${dsp.why}; heard ${heard}/100${sounds ? `, ${sounds}` : ""}`, by: "measured" };
	if (dsp.score !== null && dsp.concepts.includes("echo") && reverbKnown && dsp.score > heard) return { ...dsp, question: q, score: dsp.score, why: `measured: ${dsp.why}; heard ${heard}/100${sounds ? `, ${sounds}` : ""}`, by: "both" };
	return { question: q, score: heard, concepts: dsp.concepts, why: sounds || "heard", by: "heard" };
}

/**
 * `POST /api/hear/ask { key, fileId?, place, fps, from, to, like, find?, window? }` — how much [from, to] sounds like
 * each of `like` (0–100 with the reason), or with `find` where in [from, to] it sounds most like each. With the hearing
 * model on this Mac any English phrase works (CLAP, against the 527 everyday labels as the yardstick) and the answer
 * names the closest everyday sounds; without it the measured concepts answer, and `note` says why.
 */
export async function hearAsk(body: { key?: string; fileId?: string; place?: Placement; fps?: number; from?: number; to?: number; like?: string[] | string; find?: boolean; window?: number }, signal?: AbortSignal) {
	const a = need(body.key);
	const p = body.place ?? { start: 0, trimStart: 0, rate: 1 };
	const fps = Number(body.fps) > 0 ? Number(body.fps) : 30;
	const from = Math.max(toT(p, 0), Number(body.from ?? toT(p, 0)));
	const to = Math.min(toT(p, a.duration), Number(body.to ?? toT(p, a.duration)));
	const like = (Array.isArray(body.like) ? body.like : String(body.like ?? "").split(/[,;/]|\s+или\s+|\s+or\s+/)).map((q) => String(q).trim()).filter(Boolean).slice(0, 12);
	if (!like.length) throw new StudioError("Give `like`: what to compare the sound with, e.g. [\"calm\", \"tense build-up\", \"crowd cheering\"].");
	const v = viewOf(a, p, from, to, fps, 0.5);
	const slow = a.slow.map((s) => ({ ...s, t: toT(p, s.t), low: new Float32Array(0) }));
	const ctx = { words: v.words, slow, pulse: v.grid?.pulse ?? 0, bpm: v.grid && v.grid.pulse >= 5 ? v.grid.bpm : 0, reverb: a.reverb, hum: !!a.hum };
	const measured = (q: string, t0: number, t1: number) => answer(q, featuresOf(v.ctx.frames, t0, t1, ctx));
	const model: HearModelState = hearModelState();
	const file = model.state === "ready" ? sourceFile(a.key, body.fileId) : null;
	let note = file ? null : model.state === "ready" ? "the hearing model needs the clip's file again: listen to it once more" : modelNote(model);
	if (file && !like.some(english)) note = "the hearing model reads English: ask in English words";
	const s0 = toS(p, from);
	const s1 = toS(p, to);
	// The asked window (≥ 1 s) is the window heard; without one: 5 s over a short range, 10 s over a long one.
	const asked = Number(body.window) >= 1 ? Math.min(10, Number(body.window)) : 0;
	const findLen = asked || (s1 - s0 <= 40 ? 5 : 10);
	const wins = file ? (body.find ? windowsFor(s0, s1, { len: findLen, max: asked ? 240 : 72, duration: a.duration }) : windowsFor(s0, s1, { len: 10, max: 24, duration: a.duration })) : [];
	let bank: Awaited<ReturnType<typeof labelBank>> | null = null;
	let data: Awaited<ReturnType<typeof heardWindows>> = [];
	const vec = new Map<string, Float32Array>();
	if (file && like.some(english)) {
		try {
			bank = await labelBank(signal);
			const qs = like.filter(english);
			(await embedTexts(qs, signal)).forEach((e, i) => vec.set(qs[i], e));
			data = await heardWindows(a.key, file, wins, { clap: true }, signal);
		} catch (error) {
			if (error instanceof CancelledError || signal?.aborted) throw error;
			// The model failed: the measurements answer, and say so.
			bank = null;
			data = [];
			note = `the hearing model failed (${error instanceof Error ? error.message : String(error)}) — this is from the signal measurements`;
		}
	}
	const span = (w: Win) => ({ start: r3(Math.max(from, toT(p, w.t))), end: r3(Math.min(to, toT(p, w.t + w.len))) });

	if (!body.find) {
		const mean = meanOf(data.map((d) => d.e as Float32Array));
		const closest = mean && bank ? nearestLabels(mean, bank.labels, bank.vectors, 3) : [];
		const answers: AskAnswer[] = like.map((q) => {
			const dsp = measured(q, from, to);
			const e = vec.get(q);
			if (!mean || !e || !bank) return { ...dsp, by: "measured" as const };
			return combine(q, clapScore(mean, e, bank.vectors, { labels: bank.labels, words: wordsOf(q) }).score, dsp, closest, a.reverb !== null);
		});
		return { from: r3(from), to: r3(to), answers, model: model.state, ...(note ? { note } : {}), ...(closest.length ? { heard: closest } : {}) };
	}

	// find: where in the range it sounds most like each phrase.
	const win = Math.max(1, Math.min(10, asked || Number(body.window) || 3));
	const hop = Math.max(0.5, win / 3);
	const measuredFind = (q: string) => {
		const hits: Hit[] = [];
		for (let t = from; t + Math.min(win, to - from) <= to + 1e-6; t += hop) {
			const e = Math.min(to, t + win);
			const r = measured(q, t, e);
			if (r.score === null) return { question: q, concepts: [], hits: [], why: r.why, by: "measured" as const };
			hits.push({ start: r3(t), end: r3(e), score: r.score, why: r.why });
			if (e >= to) break;
		}
		const best = hits.reduce((m, h) => (h.score > m.score ? h : m), hits[0] ?? { start: from, end: to, score: 0, why: "" });
		return { question: q, concepts: measured(q, from, to).concepts, hits: mergeHits(hits, 50), best, by: "measured" as const };
	};
	const found = like.map((q) => {
		const e = vec.get(q);
		const dsp = measured(q, from, to);
		if (!bank || !e || !data.length || (dsp.concepts.length && dsp.concepts.every((c) => MEASURED.has(c)))) return measuredFind(q);
		const named = { labels: bank.labels, words: wordsOf(q) };
		const per: Hit[] = wins.map((w, i) => {
			const d = data[i]?.e;
			return { ...span(w), score: d?.length ? clapScore(d, e, bank.vectors, named).score : 0, why: d?.length ? `closest sounds: ${nearestLabels(d, bank.labels, bank.vectors, 3).join(", ")}` : "" };
		});
		// Windows overlap by half: each half-window stretch counts as what both windows over it agree on (the lower
		// score), so a hit ends where the sound changes, not a half window later.
		const hop = wins.length > 1 ? wins[1].t - wins[0].t : 0;
		const even = hop > 0 && wins.every((w, i) => i === 0 || Math.abs(w.t - wins[i - 1].t - hop) < 0.01) && Math.abs(wins[0].len - 2 * hop) < 0.02;
		const hits: Hit[] = !even
			? per
			: wins.flatMap((w, i) => {
					const first = { ...span({ t: w.t, len: hop }), score: i ? Math.min(per[i].score, per[i - 1].score) : per[i].score, why: per[i].score >= (per[i - 1]?.score ?? 0) ? per[i].why : per[i - 1].why };
					return i === wins.length - 1 ? [first, { ...span({ t: w.t + hop, len: w.len - hop }), score: per[i].score, why: per[i].why }] : [first];
				});
		const best = per.reduce((m, h) => (h.score > m.score ? h : m), per[0] ?? { start: from, end: to, score: 0, why: "" });
		return { question: q, concepts: dsp.concepts, hits: mergeHits(hits, 60), best, by: "heard" as const };
	});
	return { from: r3(from), to: r3(to), window: bank ? (wins[0]?.len ?? win) : win, found, model: model.state, ...(note ? { note } : {}) };
}

// ───────────────────────── music: what plays when ─────────────────────────

/** Tagger windows over a song: about two bars each (2–5 s), at most this many per call (cached per file). */
const MUSIC_WINDOWS = 96;

export interface MusicAnswer {
	from: number;
	to: number;
	model: HearModelState["state"];
	note?: string;
	bpm: number;
	bar: number;
	window: number;
	summary?: MusicSummary;
	sections: Array<{ start: number; end: number; db: number; plays: string[]; voice: string | null; silent: boolean }>;
	lines: Array<{ start: number; end: number; text: string; first: number }>;
}

/** Mean level of [a, b) of the analysis (source seconds), dBFS. */
function levelIn(a: Analysis, s0: number, s1: number): number {
	let sum = 0;
	let n = 0;
	for (let f = Math.max(0, frameAt(a.frames, s0)); f < Math.min(a.frames.n, frameAt(a.frames, s1)); f++) {
		sum += 10 ** (a.frames.db[f] / 10);
		n++;
	}
	return n ? 10 * Math.log10(sum / n + 1e-12) : -100;
}

/**
 * `POST /api/hear/music { key, fileId, place, fps, from?, to?, quick? }` — a song heard on the FULL MIX (the caller
 * sends the song's own file, never a stem): per window of about two bars the instruments and voices the AudioSet tagger
 * hears (or silence), merged into stretches; the genre and mood from AudioSet's classes; the sections by level with
 * what plays in each; the sung lines with times. `quick`: four 10 s windows only (is it a song, does someone sing).
 */
export async function hearMusic(body: { key?: string; fileId?: string; place?: Placement; fps?: number; from?: number; to?: number; quick?: boolean }, signal?: AbortSignal): Promise<MusicAnswer> {
	if (body.quick && !body.key) return quickMusic(String(body.fileId ?? ""), Number((body as { duration?: number }).duration) || 0, signal);
	const a = need(body.key);
	const p = body.place ?? { start: 0, trimStart: 0, rate: 1 };
	const fps = Number(body.fps) > 0 ? Number(body.fps) : 30;
	const from = Math.max(toT(p, 0), Number(body.from ?? toT(p, 0)));
	const to = Math.min(toT(p, a.duration), Number(body.to ?? toT(p, a.duration)));
	const model = hearModelState();
	const file = model.state === "ready" ? sourceFile(a.key, body.fileId) : null;
	const s0 = Math.max(0, toS(p, from));
	const s1 = Math.min(a.duration, toS(p, to));
	const grid0 = beatsOf(a);
	const bpm = grid0 ? Math.round(grid0.bpm * (p.rate || 1) * 10) / 10 : 0;
	const bar = bpm ? Math.round((240 / bpm) * 1000) / 1000 : 0;
	const base: MusicAnswer = { from: r3(from), to: r3(to), model: model.state, bpm, bar, window: 0, sections: [], lines: [] };
	if (!file) return { ...base, note: model.state === "ready" ? "the hearing model needs the song's file again: listen to it once more" : (modelNote(model) ?? "the hearing model isn't on this Mac") };
	let wins: Win[];
	let len: number;
	if (body.quick) {
		len = 10;
		const grid: Win[] = [];
		for (let t = Math.ceil(s0 / 10) * 10; t + 10 <= s1 + 2; t += 10) grid.push({ t, len: Math.min(10, r3(a.duration - t)) });
		if (!grid.length && s1 - s0 >= 1) grid.push({ t: r3(s0), len: r3(Math.min(10, s1 - s0)) });
		wins = Array.from({ length: Math.min(4, grid.length) }, (_, i) => grid[Math.floor(((i + 0.5) * grid.length) / Math.min(4, grid.length))]);
	} else {
		// About two bars per window (a bar alone when bars are long), on a grid from the file's start: a later call
		// over another range reuses the windows already heard.
		const srcBar = a.beats ? 240 / a.beats.bpm : 0;
		len = srcBar ? Math.max(2, Math.min(5, srcBar * (srcBar < 2.2 ? 2 : 1))) : 3;
		while ((s1 - s0) / len > MUSIC_WINDOWS) len *= 1.5;
		len = Math.round(len * 10) / 10;
		wins = [];
		for (let t = Math.floor(s0 / len) * len; t < s1 - 0.3; t += len) wins.push({ t: r3(t), len: r3(Math.min(len, a.duration - t)) });
		wins = wins.filter((w) => w.len >= 0.5);
	}
	let data: Awaited<ReturnType<typeof heardWindows>> = [];
	try {
		data = wins.length ? await heardWindows(a.key, file, wins, { music: true }, signal) : [];
	} catch (error) {
		if (error instanceof CancelledError || signal?.aborted) throw error;
		return { ...base, note: `the hearing model failed (${error instanceof Error ? error.message : String(error)})` };
	}
	const mw: MusicWin[] = wins.map((w, i) => ({ t: w.t, len: w.len, tags: data[i]?.m ?? data[i]?.g ?? [], db: levelIn(a, w.t, w.t + w.len) }));
	if (body.quick) return { ...base, window: len, summary: summarizeMusic(mw, (s) => toT(p, s)) };
	// The style over longer windows: up to eight 10 s windows on the 10 s grid (the same ones listen's captions hear).
	const grid10: Win[] = [];
	for (let t = Math.floor(s0 / 10) * 10; t + 5 <= s1; t += 10) grid10.push({ t, len: r3(Math.min(10, a.duration - t)) });
	const g10 = grid10.length > 8 ? Array.from({ length: 8 }, (_, i) => grid10[Math.floor(((i + 0.5) * grid10.length) / 8)]) : grid10;
	let long: Awaited<ReturnType<typeof heardWindows>> = [];
	try {
		long = g10.length ? await heardWindows(a.key, file, g10, { music: true }, signal) : [];
	} catch (error) {
		if (error instanceof CancelledError || signal?.aborted) throw error;
	}
	const summary = summarizeMusic(mw, (s) => toT(p, s), g10.map((w, i) => ({ t: w.t, len: w.len, tags: long[i]?.m ?? [] })));
	const v = viewOf(a, p, from, to, fps, 0);
	const sections = (v.grid?.sections ?? []).filter((x) => x.end > from && x.start < to).map((x) => ({ start: r3(Math.max(from, x.start)), end: r3(Math.min(to, x.end)), db: Math.round(x.db), ...playsDuring(summary.stretches, x.start, x.end) }));
	const words = a.words.map((w) => ({ text: w.text, start: r3(toT(p, w.start)), end: r3(toT(p, w.end)) })).filter((w) => w.end > from && w.start < to);
	const lines = sungLines(words, summary.stretches);
	return { ...base, window: len, summary, sections, lines };
}

/** Is it a song, does someone sing: four 10 s windows of a file the tagger hears (no listen needed first). */
async function quickMusic(fileId: string, seconds: number, signal?: AbortSignal): Promise<MusicAnswer> {
	const model = hearModelState();
	const base: MusicAnswer = { from: 0, to: 0, model: model.state, bpm: 0, bar: 0, window: 10, sections: [], lines: [] };
	if (model.state !== "ready") return { ...base, note: modelNote(model) ?? "the hearing model isn't on this Mac" };
	const file = getFile(fileId).path;
	// The caller knows the file's length (Media does); a window past the end is heard empty, never fails.
	const duration = seconds > 0 ? seconds : 30;
	const grid: Win[] = [];
	for (let t = 0; t + 10 <= duration + 2; t += 10) grid.push({ t, len: Math.min(10, r3(duration - t)) });
	if (!grid.length) grid.push({ t: 0, len: r3(Math.max(1, duration)) });
	const k = Math.min(4, grid.length);
	const wins = Array.from({ length: k }, (_, i) => grid[Math.floor(((i + 0.5) * grid.length) / k)]).filter((w) => w.len >= 1);
	const key = `m${(await fileHash(file)).slice(0, 31)}`;
	const data = await heardWindows(key, file, wins, { music: true }, signal);
	const summary = summarizeMusic(wins.map((w, i) => ({ t: w.t, len: w.len, tags: data[i]?.m ?? data[i]?.g ?? [] })));
	return { ...base, to: r3(duration), summary };
}

export type { MusicStretch };

// ───────────────────────── seams: the cuts on the timeline ─────────────────────────

export interface SeamSide {
	key: string;
	fileId: string;
	/** Source seconds of the cut edge (the left piece's end / the right piece's start). */
	edge: number;
	rate: number;
	gainDb: number;
	/** Seconds of fade at this edge (the left piece's fade-out, the right piece's fade-in). */
	fade: number;
	/** Source seconds available beyond the edge (to extend the piece). */
	spare: number;
	music?: boolean;
}

export interface Seam {
	at: number;
	left?: SeamSide;
	right?: SeamSide;
	/** Seconds of empty timeline between the two pieces. */
	gap?: number;
}

export type SeamFix =
	| { op: "fade"; seconds: number }
	| { op: "extendLeft" | "trimLeft" | "extendRight" | "trimRight" | "roll"; seconds: number }
	| { op: "fillGap" }
	| { op: "gain"; db: number }
	| { op: "none"; why: string };

export interface SeamDefect {
	kind: "click" | "level" | "word" | "breath" | "pause" | "hole" | "beat" | "sound";
	severity: 1 | 2 | 3;
	detail: string;
	fix: SeamFix;
}

export interface SeamReport {
	at: number;
	defects: SeamDefect[];
	/** The pause across the cut (seconds), when both sides have words near it. */
	pause?: number;
	natural?: number;
	/** Click strength at the cut, dB over the sound around it. */
	clickDb?: number;
	jumpDb?: number;
}

async function sideSamples(s: SeamSide, before: boolean, seconds: number, signal?: AbortSignal): Promise<Float32Array> {
	const file = getFile(s.fileId);
	const len = seconds * (s.rate || 1);
	const from = before ? Math.max(0, s.edge - len) : s.edge;
	const x = await decodeAll(file.path, { from, length: before ? s.edge - from : len, rate: 48000, channels: 1 }, signal);
	const g = 10 ** ((s.gainDb || 0) / 20);
	const n = x.length;
	const fadeN = Math.round(Math.max(0, s.fade) * 48000);
	for (let i = 0; i < n; i++) {
		// Equal-power fade towards the edge (sounds/mix/fades.ts).
		const d = before ? n - 1 - i : i;
		const f = fadeN > 0 && d < fadeN ? Math.sin((Math.PI / 2) * (d / fadeN)) : 1;
		x[i] *= g * f;
	}
	return x;
}

function rmsDb(x: Float32Array, a: number, b: number): number {
	a = Math.max(0, a);
	b = Math.min(x.length, b);
	if (b <= a) return -100;
	let s = 0;
	for (let i = a; i < b; i++) s += x[i] * x[i];
	return toDb(s / (b - a));
}

/** The background of one side of a cut: its quietest 30 ms (the room between words), not a percentile of speech. */
function floorDb(x: Float32Array): number {
	const hop = 480;
	const vals: number[] = [];
	for (let i = 0; i + 3 * hop <= x.length; i += hop) vals.push(rmsDb(x, i, i + 3 * hop));
	return vals.length ? Math.min(...vals) : -100;
}

/** Words / breaths / sound at a source edge, from the cached analysis. */
function edgeFacts(a: Analysis, edge: number) {
	const cutWord = a.words.find((w) => w.start < edge - 0.02 && w.end > edge + 0.02);
	const cutBreath = a.breaths.find((b) => b.start < edge - 0.02 && b.end > edge + 0.02);
	const f = frameAt(a.frames, edge);
	let loud = 0;
	for (let k = f - 2; k <= f + 1; k++) if (k >= 0 && k < a.frames.n && a.frames.db[k] > a.levels.active && a.frames.voicing[k] > 0.4) loud++;
	// "In the middle of a sound" only for speech: music is sound everywhere (its cuts are judged by the beat).
	return { cutWord, cutBreath, inSound: a.words.length > 0 && loud >= 3 };
}

/**
 * A cut into a word or breath: restore it whole when most of it is on our side and the restored edge lands in a pause;
 * otherwise drop the stub, so the edge sits in the pause on the other side of it. Never into the neighbouring word.
 */
function wordFix(a: Analysis, s: SeamSide, side: "left" | "right", w: Span): SeamFix {
	const rate = s.rate || 1;
	const i = a.words.findIndex((x) => x.start === w.start && x.end === w.end);
	if (side === "left") {
		const inside = s.edge - w.start;
		const missing = w.end - s.edge;
		const next = i >= 0 ? a.words[i + 1] : a.words.find((x) => x.start >= w.end - 0.005);
		const room = next ? next.start - w.end : Infinity;
		if (missing <= inside && room >= 0.1) {
			const by = missing + Math.min(TAIL_GUARD, room / 2);
			if (by <= s.spare) return { op: "extendLeft", seconds: by / rate };
		}
		const prev = i > 0 ? a.words[i - 1] : a.words.filter((x) => x.end <= w.start + 0.005).pop();
		const gapBefore = prev ? w.start - prev.end : Infinity;
		const target = gapBefore >= 0.1 ? w.start - Math.min(HEAD_GUARD, gapBefore / 2) : w.start;
		return { op: "trimLeft", seconds: Math.max(0.01, s.edge - target) / rate };
	}
	const inside = w.end - s.edge;
	const missing = s.edge - w.start;
	const prev = i > 0 ? a.words[i - 1] : a.words.filter((x) => x.end <= w.start + 0.005).pop();
	const room = prev ? w.start - prev.end : Infinity;
	if (missing <= inside && room >= 0.1) {
		const by = missing + Math.min(HEAD_GUARD, room / 2);
		if (by <= s.spare) return { op: "extendRight", seconds: by / rate };
	}
	const next = i >= 0 ? a.words[i + 1] : a.words.find((x) => x.start >= w.end - 0.005);
	const gapAfter = next ? next.start - w.end : Infinity;
	const target = gapAfter >= 0.1 ? w.end + Math.min(TAIL_GUARD, gapAfter / 2) : w.end;
	return { op: "trimRight", seconds: Math.max(0.01, target - s.edge) / rate };
}

/** An edge in the middle of running speech: move it to the nearest pause (≥ 0.12 s) within 1 s, else just fade. */
function soundFix(a: Analysis, s: SeamSide, side: "left" | "right"): SeamFix {
	const rate = s.rate || 1;
	let best: { op: "extendLeft" | "trimLeft" | "extendRight" | "trimRight"; d: number } | null = null;
	for (let k = 1; k < a.words.length; k++) {
		const g0 = a.words[k - 1].end;
		const g1 = a.words[k].start;
		if (g1 - g0 < 0.12) continue;
		if (side === "left") {
			// The left piece ends in the pause: before the edge (trim) or after it (extend, if the source allows).
			const at = g0 > s.edge ? g0 + TAIL_GUARD : g1 - HEAD_GUARD;
			const d = at - s.edge;
			if (Math.abs(d) > 1 || (d > 0 && d > s.spare)) continue;
			if (!best || Math.abs(d) < best.d) best = { op: d > 0 ? "extendLeft" : "trimLeft", d: Math.abs(d) };
		} else {
			const at = g1 < s.edge ? g1 - HEAD_GUARD : g0 + TAIL_GUARD;
			const d = at - s.edge;
			if (Math.abs(d) > 1 || (d < 0 && -d > s.spare)) continue;
			if (!best || Math.abs(d) < best.d) best = { op: d < 0 ? "extendRight" : "trimRight", d: Math.abs(d) };
		}
	}
	return best ? { op: best.op, seconds: best.d / rate } : { op: "fade", seconds: 0.03 };
}

/** `POST /api/hear/seams { seams, fps }` — every cut checked by ear, each defect with its fix. */
export async function hearSeams(body: { seams?: Seam[]; fps?: number }, signal?: AbortSignal): Promise<SeamReport[]> {
	const seams = (body.seams ?? []).slice(0, 400);
	const out: SeamReport[] = [];
	const work = async (seam: Seam) => {
		const report: SeamReport = { at: seam.at, defects: [] };
		const L = seam.left ? need(seam.left.key) : null;
		const R = seam.right ? need(seam.right.key) : null;
		const left = seam.left && L ? await sideSamples(seam.left, true, 0.6, signal) : new Float32Array(0);
		const right = seam.right && R ? await sideSamples(seam.right, false, 0.6, signal) : new Float32Array(0);
		const gapN = Math.round(Math.max(0, seam.gap ?? 0) * 48000);
		const x = new Float32Array(left.length + gapN + right.length);
		x.set(left, 0);
		x.set(right, left.length + gapN);
		const cut = left.length;
		// Click at the join.
		const clicks = findClicks(x, 48000, 0).filter((c) => Math.abs(c.at * 48000 - cut) < 48000 * 0.004 || (gapN && Math.abs(c.at * 48000 - (cut + gapN)) < 48000 * 0.004));
		const click = clicks.sort((p, q) => q.over - p.over)[0];
		if (click) report.clickDb = Math.round(click.over);
		const jump = rmsDb(x, cut + gapN + 240, cut + gapN + 1920) - rmsDb(x, cut - 1920, cut - 240);
		report.jumpDb = Math.round(jump * 10) / 10;
		const bgL = left.length ? floorDb(left) : -100;
		const bgR = right.length ? floorDb(right) : -100;
		const holes = findHoles(x, 48000, 0, 5).filter((h) => h.start * 48000 <= cut + gapN + 480 && h.end * 48000 >= cut - 480);
		const rateL = seam.left?.rate || 1;
		const rateR = seam.right?.rate || 1;
		const lf = L && seam.left ? edgeFacts(L, seam.left.edge) : null;
		const rf = R && seam.right ? edgeFacts(R, seam.right.edge) : null;
		let structural = false;
		if (L && seam.left && lf?.cutWord) {
			const missing = lf.cutWord.end - seam.left.edge;
			report.defects.push({ kind: "word", severity: missing > 0.08 ? 3 : 2, detail: `«${lf.cutWord.text}» is cut off at its end (${Math.round(missing * 1000)} ms missing)`, fix: wordFix(L, seam.left, "left", lf.cutWord) });
			structural = true;
		} else if (L && seam.left && lf?.inSound && !lf.cutBreath) {
			report.defects.push({ kind: "sound", severity: 2, detail: "the left clip stops in the middle of running speech", fix: soundFix(L, seam.left, "left") });
		}
		if (R && seam.right && rf?.cutWord) {
			const missing = seam.right.edge - rf.cutWord.start;
			report.defects.push({ kind: "word", severity: missing > 0.08 ? 3 : 2, detail: `«${rf.cutWord.text}» starts cut (${Math.round(missing * 1000)} ms of its start missing)`, fix: wordFix(R, seam.right, "right", rf.cutWord) });
			structural = true;
		} else if (R && seam.right && rf?.inSound && !rf.cutBreath) {
			report.defects.push({ kind: "sound", severity: 2, detail: "the right clip starts in the middle of running speech", fix: soundFix(R, seam.right, "right") });
		}
		if (L && seam.left && lf?.cutBreath && !lf.cutWord) {
			report.defects.push({ kind: "breath", severity: 2, detail: "a breath is cut in half at the end of the left clip", fix: wordFix(L, seam.left, "left", lf.cutBreath) });
			structural = true;
		}
		if (R && seam.right && rf?.cutBreath && !rf.cutWord) {
			report.defects.push({ kind: "breath", severity: 2, detail: "a breath is cut in half at the start of the right clip", fix: wordFix(R, seam.right, "right", rf.cutBreath) });
			structural = true;
		}
		// The pause across the cut, against the speaker's own rhythm.
		if (L && R && seam.left && seam.right && !structural) {
			const lastL = L.words.filter((w) => w.end <= seam.left!.edge + 0.02).pop();
			const firstR = R.words.find((w) => w.start >= seam.right!.edge - 0.02);
			if (lastL && firstR && seam.left.edge - lastL.end < 3 && firstR.start - seam.right.edge < 3) {
				const tail = Math.max(0, seam.left.edge - lastL.end) / rateL;
				const head = Math.max(0, firstR.start - seam.right.edge) / rateR;
				const pause = tail + head + (seam.gap ?? 0);
				const natural = L.rhythm.pause;
				report.pause = Math.round(pause * 100) / 100;
				report.natural = natural;
				const sentence = endsSentence(lastL.text);
				if (pause > Math.max(1.0, natural * 2.5)) {
					const remove = pause - (sentence ? natural * 1.2 : natural);
					const fromTail = Math.max(0, Math.min(tail - Math.max(TAIL_GUARD, natural * 0.45), remove * (tail / Math.max(0.01, tail + head))));
					const fromHead = Math.max(0, Math.min(head - Math.max(HEAD_GUARD, natural * 0.4), remove - fromTail));
					report.defects.push({ kind: "pause", severity: pause > 2 ? 2 : 1, detail: `a ${pause.toFixed(2)} s pause across the cut: this speaker pauses ~${natural.toFixed(2)} s`, fix: fromTail >= fromHead ? { op: "trimLeft", seconds: fromTail + fromHead } : { op: "trimRight", seconds: fromTail + fromHead } });
				} else if (pause < (sentence ? Math.min(0.15, natural * 0.5) : 0.05)) {
					const add = (sentence ? natural : natural * 0.6) - pause;
					report.defects.push({ kind: "pause", severity: 2, detail: `words run together: only ${Math.round(pause * 1000)} ms between «${lastL.text}» and «${firstR.text}» (natural ~${natural.toFixed(2)} s)`, fix: seam.left.spare >= add ? { op: "extendLeft", seconds: add } : seam.right.spare >= add ? { op: "extendRight", seconds: add } : { op: "none", why: "no room tone left in the clips to widen it" } });
				}
			}
		}
		if (holes.length) {
			const h = holes[0];
			report.defects.push({ kind: "hole", severity: 2, detail: `${Math.round((h.end - h.start) * 1000)} ms of digital silence at the cut`, fix: (seam.gap ?? 0) > 0 ? { op: "fillGap" } : { op: "fade", seconds: 0.03 } });
		}
		if (click && click.over >= 18 && !report.defects.some((d) => d.kind === "word")) report.defects.push({ kind: "click", severity: click.over >= 28 ? 3 : 2, detail: `click at the cut (+${Math.round(click.over)} dB)`, fix: { op: "fade", seconds: 0.03 } });
		if (left.length && right.length && bgL > -80 && bgR > -80 && Math.abs(bgR - bgL) >= 6) {
			report.defects.push({ kind: "level", severity: Math.abs(bgR - bgL) >= 10 ? 2 : 1, detail: `the background jumps ${bgR > bgL ? "up" : "down"} ${Math.round(Math.abs(bgR - bgL))} dB at the cut`, fix: { op: "fade", seconds: 0.04 } });
		}
		// Music: a cut should sit on the beat.
		for (const [side, A, s] of [["left", L, seam.left], ["right", R, seam.right]] as const) {
			if (!A?.beats || !s || (!s.music && A.words.length > 4)) continue;
			// A roll moves the cut by the same timeline time on both sides: the music lands on its beat.
			const near = A.beats.beats.reduce((b, x) => (Math.abs(x - s.edge) < Math.abs(b - s.edge) ? x : b), A.beats.beats[0]);
			const off = s.edge - near;
			if (Math.abs(off) > 0.035 && Math.abs(off) < 60 / A.beats.bpm / 2) {
				report.defects.push({ kind: "beat", severity: Math.abs(off) > 0.08 ? 2 : 1, detail: `the ${side} music is cut ${Math.round(Math.abs(off) * 1000)} ms ${off > 0 ? "after" : "before"} its beat`, fix: { op: "roll", seconds: -off / (s.rate || 1) } });
			}
		}
		out.push(report);
	};
	// A few at a time (each one runs two short ffmpeg reads).
	for (let i = 0; i < seams.length; i += 4) await Promise.all(seams.slice(i, i + 4).map(work));
	return out.sort((p, q) => p.at - q.at);
}

// ───────────────────────── picture data ─────────────────────────

/**
 * `POST /api/hear/picture { fileId, from, length, cols, rows }` (source seconds) — what the window paints: the
 * waveform's min/max per column and a spectrogram (log frequency 60 Hz–12 kHz), as bytes.
 */
export async function hearPicture(body: { fileId?: string; from?: number; length?: number; cols?: number; rows?: number }, signal?: AbortSignal) {
	const file = getFile(String(body.fileId ?? ""));
	const from = Math.max(0, Number(body.from) || 0);
	const length = Math.max(0.1, Math.min(120, Number(body.length) || 10));
	const cols = Math.max(50, Math.min(1600, Math.round(Number(body.cols) || 800)));
	const rows = Math.max(16, Math.min(128, Math.round(Number(body.rows) || 64)));
	const rate = 24000;
	const x = await decodeAll(file.path, { from, length, rate, channels: 1 }, signal);
	const wave = new Uint8Array(cols * 2);
	const spec = new Uint8Array(cols * rows);
	const per = x.length / cols;
	const size = 1024;
	const re = new Float64Array(size);
	const im = new Float64Array(size);
	const lo = Math.log(60);
	const hi = Math.log(12000);
	for (let c = 0; c < cols; c++) {
		const a = Math.floor(c * per);
		const b = Math.max(a + 1, Math.floor((c + 1) * per));
		let mn = 0;
		let mx = 0;
		for (let i = a; i < Math.min(b, x.length); i++) {
			if (x[i] < mn) mn = x[i];
			if (x[i] > mx) mx = x[i];
		}
		wave[2 * c] = Math.round(Math.max(0, Math.min(255, (mn + 1) * 127.5)));
		wave[2 * c + 1] = Math.round(Math.max(0, Math.min(255, (mx + 1) * 127.5)));
		const centre = Math.floor((a + b) / 2);
		for (let i = 0; i < size; i++) {
			const j = centre - size / 2 + i;
			re[i] = j >= 0 && j < x.length ? x[j] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))) : 0;
			im[i] = 0;
		}
		fft(re, im);
		for (let r = 0; r < rows; r++) {
			const f0 = Math.exp(lo + ((hi - lo) * r) / rows);
			const f1 = Math.exp(lo + ((hi - lo) * (r + 1)) / rows);
			const k0 = Math.max(1, Math.floor((f0 / rate) * size));
			const k1 = Math.max(k0 + 1, Math.ceil((f1 / rate) * size));
			let p = 0;
			for (let k = k0; k < k1 && k < size / 2; k++) p += re[k] * re[k] + im[k] * im[k];
			const db = 10 * Math.log10(p / (k1 - k0) / ((size * size) / 16) + 1e-12);
			spec[(rows - 1 - r) * cols + c] = Math.round(Math.max(0, Math.min(255, ((db + 100) / 90) * 255)));
		}
		if (c % 64 === 63) await yieldNow();
	}
	return { cols, rows, wave: Buffer.from(wave).toString("base64"), spec: Buffer.from(spec).toString("base64") };
}

/** One frame of a file at a source time as a small JPEG (ffmpeg, low priority): the filmstrip of a cut's review. */
function frameJpeg(file: string, at: number, height: number, signal?: AbortSignal): Promise<string | null> {
	const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", Math.max(0, at).toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=-2:${height}`, "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"];
	const ffmpeg = findTool("ffmpeg");
	return new Promise((resolve) => {
		const child = IS_WINDOWS ? spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }) : spawn("/usr/bin/nice", ["-n", "5", ffmpeg, ...args], { stdio: ["ignore", "pipe", "ignore"] });
		const parts: Buffer[] = [];
		const abort = () => child.kill("SIGKILL");
		signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (d: Buffer) => parts.push(d));
		child.on("error", () => resolve(null));
		child.on("close", (code) => {
			signal?.removeEventListener("abort", abort);
			const buf = Buffer.concat(parts);
			resolve(code === 0 && buf.length > 100 ? `data:image/jpeg;base64,${buf.toString("base64")}` : null);
		});
	});
}

/** `POST /api/hear/frames { items: [{ fileId, at }], height? }` — frames for the window to lay out (no preview seeks). */
export async function hearFrames(body: { items?: Array<{ fileId?: string; at?: number }>; height?: number }, signal?: AbortSignal): Promise<Array<string | null>> {
	const items = (body.items ?? []).slice(0, 24);
	const height = Math.max(60, Math.min(360, Math.round(Number(body.height) || 160)));
	const out: Array<string | null> = new Array(items.length).fill(null);
	for (let i = 0; i < items.length; i += 4) {
		await Promise.all(
			items.slice(i, i + 4).map(async (it, k) => {
				try {
					out[i + k] = await frameJpeg(getFile(String(it.fileId ?? "")).path, Number(it.at) || 0, height, signal);
				} catch {
					out[i + k] = null;
				}
			}),
		);
	}
	return out;
}

export const hearKeyOf = (fileId: string) => keyOfFile.get(fileId) ?? null;
export { toFrame, bestCutIn };
