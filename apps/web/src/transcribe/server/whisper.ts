// Local speech recognition with whisper.cpp (whisper-cli, Metal) — free, offline, ~5 s per minute of speech.
// The binary ships in the app (Resources/bin); the model is downloaded once by On-device AI into the app's Models folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { CancelledError, StudioError } from "@/studio/server/errors";
import { isPackaged, modelDirs } from "@/platform/paths";
import type { Span, Word } from "@/transcribe/align";
import { VAD_PAD, vadSegmentOf } from "@/transcribe/vad";
import { IS_WINDOWS } from "@/platform/os";
import { pausableTimeout, trackProcess, waitCool } from "@/ondevice/thermal";
import { MODEL_NICE } from "@/studio/server/tools";

const APP_SUPPORT = path.join(os.homedir(), "Library", "Application Support");

function executable(p: string | undefined): string | null {
	if (!p) return null;
	try {
		fs.accessSync(p, fs.constants.X_OK);
		return fs.statSync(p).isFile() ? p : null;
	} catch {
		return null;
	}
}

export function findWhisper(): string | null {
	const bin = process.env.STUDIO_BIN_DIR;
	// The packaged app only uses its own copy; other places are for a development server.
	const candidates = isPackaged()
		? [process.env.WHISPER_CLI, bin && path.join(bin, IS_WINDOWS ? "whisper-cli.exe" : "whisper-cli")]
		: [
				process.env.WHISPER_CLI,
				path.join(APP_SUPPORT, "Kadr", "Vendor-src", "whisper", "build", "bin", "whisper-cli"),
				"/opt/homebrew/bin/whisper-cli",
				"/usr/local/bin/whisper-cli",
			];
	for (const c of candidates) {
		const found = executable(c ?? undefined);
		if (found) return found;
	}
	return null;
}

/** Best first: the quantized large-v3-turbo is the accuracy/speed sweet spot (~1% WER on Russian). */
const PREFERRED = [
	"ggml-large-v3-turbo-q5_0.bin",
	"ggml-large-v3-turbo-q8_0.bin",
	"ggml-large-v3-turbo.bin",
	"ggml-large-v3.bin",
	"ggml-medium.bin",
	"ggml-small.bin",
];

/** Where the speech model (and the speech detector beside it) may be. */
function speechModelDirs(): string[] {
	const bin = process.env.STUDIO_BIN_DIR;
	return [
		bin && path.join(bin, "..", "models"),
		modelDirs.whisper(),
		!isPackaged() && path.join(APP_SUPPORT, "Kadr", "Models"),
	].filter(Boolean) as string[];
}

export function findModel(): string | null {
	if (process.env.WHISPER_MODEL && fs.existsSync(process.env.WHISPER_MODEL)) return process.env.WHISPER_MODEL;
	const dirs = speechModelDirs();
	for (const name of PREFERRED) {
		for (const dir of dirs) {
			const p = path.join(dir, name);
			if (fs.existsSync(p)) return p;
		}
	}
	for (const dir of dirs) {
		try {
			const any = fs.readdirSync(dir).find((n) => /^ggml-.*\.bin$/.test(n) && !n.includes("silero"));
			if (any) return path.join(dir, any);
		} catch {}
	}
	return null;
}

/**
 * The speech detector: Silero VAD in whisper.cpp's own format (0.9 MB, an add-on file of the speech model in
 * ondevice/manifest.ts). With it whisper-cli decodes only where someone speaks: music and silence are skipped, so a
 * file with pauses goes faster and nothing is invented over an intro or an outro. Without the file everything works
 * as before it existed.
 */
export const VAD_FILE = "ggml-silero-v6.2.0.bin";
export const VAD_BYTES = 885_098;

export function findVad(): string | null {
	// Measurements and tests: WHISPER_VAD=0 runs without the detector, WHISPER_VAD_MODEL names its file.
	// (The Mac's for now: the Windows manifest leaves the file out, the Windows engine was never run with it.)
	if (IS_WINDOWS || process.env.WHISPER_VAD === "0") return null;
	const named = process.env.WHISPER_VAD_MODEL;
	if (named) return fs.existsSync(named) ? named : null;
	for (const dir of speechModelDirs()) {
		const p = path.join(dir, VAD_FILE);
		try {
			// The download puts the file in place only complete and checked; the size keeps a foreign file of this name out.
			const st = fs.statSync(p);
			if (st.size === VAD_BYTES && !broken.has(`${p}:${st.mtimeMs}`)) return p;
		} catch {}
	}
	return null;
}

/**
 * Detector files the engine could not load (damaged on disk): not tried again while this file stays as it is, so
 * a broken file costs one failed start, not one per recognition. Settings → Speech recognition → Repair brings a
 * good one (a new file is a new entry).
 */
const broken: Set<string> = ((globalThis as any).__whisperVadBroken as Set<string>) ?? ((globalThis as any).__whisperVadBroken = new Set());

/**
 * A line for the app's own log (logs/studio.log; the shell writes the server's stderr there). The production build
 * strips every console call (next.config.ts removeConsole), so what must be found afterwards goes this way.
 */
export function logLine(text: string) {
	try {
		process.stderr.write(`${text}\n`);
	} catch {}
}

export interface EngineStatus {
	available: boolean;
	/** The engine is here, only the model has to be downloaded (On-device AI). */
	needsDownload?: boolean;
	model?: string;
	reason?: string;
}

export function engineStatus(): EngineStatus {
	const cli = findWhisper();
	if (!cli) return { available: false, reason: "The offline speech engine is not installed." };
	const model = findModel();
	if (!model) return { available: false, needsDownload: true, reason: "The offline speech model is not downloaded yet (574 MB, once)." };
	return { available: true, model: path.basename(model) };
}

let warmed = false;
let warming = false;

/** The background warm-up is still running (a real run will wait for it). */
export function isWarming(): boolean {
	return warming;
}

/**
 * Loads the model once in the background (when the Captions tab opens), so the first real run does not pay
 * for the cold start: reading ~0.6 GB from disk and compiling the Metal kernels (10–20 s on a cold Mac).
 */
export function warmUp() {
	if (warmed || !findWhisper() || !findModel()) return;
	warmed = true;
	warming = true;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whisper-warm-"));
	const wav = path.join(dir, "silence.wav");
	const rate = 16000;
	const data = Buffer.alloc(rate * 2);
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	fs.writeFileSync(wav, Buffer.concat([header, data]));
	// (Without the speech detector: on silence it would skip the engine, and the engine is what has to warm up.)
	recognize({ wav, outDir: dir, language: "en", duration: 1, background: true })
		.catch(() => {
			warmed = false;
		})
		.finally(() => {
			warming = false;
			fs.rmSync(dir, { recursive: true, force: true });
		});
}

// Running recognizers die with the app: a quit, crash or cancel never leaves an orphan whisper-cli.
const children: Set<ChildProcess> =
	((globalThis as any).__whisperChildren as Set<ChildProcess>) ?? ((globalThis as any).__whisperChildren = new Set());

function killAll() {
	for (const c of children) {
		try {
			c.kill("SIGKILL");
		} catch {}
	}
	children.clear();
}

if (!(globalThis as any).__whisperExitHooks) {
	(globalThis as any).__whisperExitHooks = true;
	process.on("exit", killAll);
	for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
		process.on(sig, () => {
			killAll();
			// Only take over the exit when nobody else (Next's own shutdown) listens for the signal.
			if (process.listenerCount(sig) === 1) process.exit(0);
		});
	}
}

function runWhisper(
	cli: string,
	args: string[],
	{ timeout, signal, onLine, background }: { timeout: number; signal?: AbortSignal; onLine: (line: string) => void; background?: boolean },
): Promise<{ status: number; log: string }> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new CancelledError());
		const child = spawn(cli, args, { stdio: ["ignore", "pipe", "pipe"] });
		children.add(child);
		// Below the editor's own work (nice 5, like every model; the warm-up lower still).
		if (child.pid) {
			try {
				os.setPriority(child.pid, background ? 15 : Number(MODEL_NICE));
			} catch {}
		}
		// It stands still while the Mac is hot (ondevice/thermal.ts); whisper-cli starts nothing of its own.
		const untrack = child.pid ? trackProcess(child.pid, { group: false }) : () => {};
		let log = "";
		let partial = "";
		let finished = false;
		const take = (d: Buffer) => {
			const text = d.toString();
			log = (log + text).slice(-20_000);
			partial += text;
			const lines = partial.split(/\r?\n|\r/);
			partial = lines.pop() ?? "";
			for (const l of lines) if (l.trim()) onLine(l);
		};
		child.stdout.on("data", take);
		child.stderr.on("data", take);
		const done = (fn: () => void) => {
			if (finished) return;
			finished = true;
			timer.clear();
			untrack();
			signal?.removeEventListener("abort", onAbort);
			children.delete(child);
			fn();
		};
		// Counts only the time the Mac was not hot (the engine stands still meanwhile).
		const timer = pausableTimeout(timeout * 1000, () => {
			child.kill("SIGKILL");
			done(() => reject(new StudioError(`Transcription did not finish within ${Math.round(timeout / 60)} min. Try again.`)));
		});
		const onAbort = () => {
			child.kill("SIGKILL");
			done(() => reject(new CancelledError()));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.on("error", (err) => done(() => reject(new StudioError(`Could not start the speech engine: ${err.message}`))));
		child.on("close", (code) => done(() => resolve({ status: code ?? -1, log })));
	});
}

function lastError(log: string): string {
	const lines = log
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !/progress\s*=/.test(l));
	const errors = lines.filter((l) => /error|failed/i.test(l));
	return (errors.length ? errors : lines).slice(-2).join(" ").slice(0, 400) || "no details";
}

// One recognition at a time: the model takes ~0.6 GB of GPU memory, and two at once are slower than in turn.
let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
	const next = queue.then(fn, fn);
	queue = next.catch(() => {});
	return next;
}

export interface WhisperOptions {
	wav: string;
	outDir: string;
	language: string;
	duration: number;
	signal?: AbortSignal;
	onProgress?: (fraction: number) => void;
	/** Called when this run actually starts (after any run ahead of it in the queue). */
	onStart?: () => void;
	/** Low CPU priority (warm-up): never competes with the editor. */
	background?: boolean;
	/**
	 * With the speech detector when its file is here: only the stretches with a voice are decoded, and `voiced` names
	 * them. The caller then owns what the detector may have missed (transcribe/server/listen.ts does).
	 */
	vad?: boolean;
	/**
	 * One decoding pass per window, no second tries at a higher temperature: for stretches the detector called voiceless
	 * (listen.ts hears them again). Over music alone the engine fails its own checks window after window and tries each
	 * up to six times — most of the time such a stretch costs; lyrics come out on the first try.
	 */
	quick?: boolean;
}

/**
 * The speech detector's settings. whisper.cpp's defaults (threshold 0.5, a voice from 250 ms, a pause from 100 ms,
 * 0.1 s between the pieces) except the padding: 400 ms around every stretch instead of 30 — a soft first consonant
 * right after loud music is noticed up to 0.4 s late, and with 30 ms the first word of a phrase was lost
 */
export const VAD_ARGS = ["-vt", "0.5", "-vspd", "250", "-vsd", "100", "-vp", String(Math.round(VAD_PAD * 1000)), "-vo", "0.1"];

/** whisper-cli's arguments for one file; `vad` is the speech detector's file when it is used. */
export function whisperArgs({ model, wav, language, out, vad, quick }: { model: string; wav: string; language: string; out: string; vad?: string | null; quick?: boolean }): string[] {
	const threads = String(Math.max(2, Math.min(8, os.cpus().length - 2)));
	return [
		"-m", model,
		"-f", wav,
		"-l", language || "auto",
		"-ml", "1",
		"-sow",
		"-oj",
		// Full JSON: each word's token probabilities, so Claude's audio map marks the words Whisper wasn't sure of.
		"-ojf",
		"-of", out,
		"-pp",
		// Quiet, except with the detector: the stretches it found are in the engine's log (vadSegmentOf reads them).
		...(vad ? [] : ["-np"]),
		"-t", threads,
		// Beam search (whisper.cpp's default 5): greedy decoding dropped the closing sentence of a short speech once
		// (24 of 28 words, check-edit W1). Measured on this Mac with large-v3-turbo: an 8 s file 1.5 s either way,
		// a 130 s file 7.8 s greedy → 9.0 s with beam 5.
		"-bs", "5",
		"-bo", "5",
		// No text carried from one window to the next: with it, a sentence said twice came out once (the second take
		// dropped, its time given to the words around it), so a retake could not be found and cut. Measured 11.11 on
		// say -v Milena: 1 of 2 takes heard with the default context, 2 of 2 with -mc 0.
		"-mc", "0",
		...(quick ? ["-nf"] : []),
		...(vad ? ["--vad", "-vm", vad, ...VAD_ARGS] : []),
	];
}

/**
 * Runs whisper-cli on a 16 kHz mono WAV and returns its raw words (seconds, not yet aligned to the audio). `voiced`:
 * the stretches the speech detector found, when it took part (asked for with `vad`, its file here, and it ran).
 */
export function recognize({ wav, outDir, language, duration, signal, onProgress, onStart, background, vad: wantVad, quick }: WhisperOptions): Promise<{ words: Word[]; language: string; voiced?: Span[] }> {
	return exclusive(async () => {
		onStart?.();
		const cli = findWhisper();
		const model = findModel();
		if (!cli || !model) throw new StudioError(engineStatus().reason ?? "Speech recognition is unavailable");
		const out = path.join(outDir, "words");
		const file = `${out}.json`;
		// Generous: ~12× slower than usual still finishes (cold Metal start, old Macs, long files).
		const timeout = 120 + duration * 1.5;
		let voiced: Span[] = [];
		const onLine = (line: string) => {
			const m = /progress\s*=\s*(\d+)%/.exec(line);
			if (m) return onProgress?.(Number(m[1]) / 100);
			const segment = vadSegmentOf(line);
			if (segment) voiced.push(segment);
		};
		// A hot Mac: the engine waits for it to cool down (ondevice/thermal.ts).
		await waitCool(signal);
		let vad = wantVad ? findVad() : null;
		fs.rmSync(file, { force: true });
		let r = await runWhisper(cli, whisperArgs({ model, wav, language, out, vad, quick }), { timeout, signal, background, onLine });
		if (vad && (r.status !== 0 || !fs.existsSync(file))) {
			// The detector could not be loaded or run: the engine answers alone, as it did before the detector existed.
			logLine(`[whisper] the speech detector failed (${lastError(r.log)}): recognizing without it`);
			try {
				broken.add(`${vad}:${fs.statSync(vad).mtimeMs}`);
			} catch {}
			vad = null;
			voiced = [];
			fs.rmSync(file, { force: true });
			r = await runWhisper(cli, whisperArgs({ model, wav, language, out, vad, quick }), { timeout, signal, background, onLine });
		}
		if (r.status !== 0) throw new StudioError(`Transcription failed: ${lastError(r.log)}`);
		if (!fs.existsSync(file)) throw new StudioError("Transcription returned no result. Try again.");
		return { ...parseWhisperJson(fs.readFileSync(file, "utf8")), ...(vad ? { voiced } : {}) };
	});
}

export function parseWhisperJson(raw: string): { words: Word[]; language: string } {
	let data: any;
	try {
		data = JSON.parse(raw);
	} catch {
		// whisper.cpp may write invalid UTF-8 halves of a character; keep what parses.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are exactly what breaks the JSON
		data = JSON.parse(raw.replace(/[\u0000-\u001f]/g, " "));
	}
	const words: Word[] = [];
	for (const item of data?.transcription ?? []) {
		const text = String(item?.text ?? "").replace(/�/g, "").trim();
		const from = Number(item?.offsets?.from);
		const to = Number(item?.offsets?.to);
		if (!text || !Number.isFinite(from) || !Number.isFinite(to)) continue;
		// Bracketed non-speech tags: [музыка], (смех), [BLANK_AUDIO].
		if (/^[[(*♪].*[\])*♪]$/.test(text)) continue;
		// Confidence: the geometric mean of the word's own tokens' probabilities (punctuation and special tokens left out).
		const probs = (Array.isArray(item?.tokens) ? item.tokens : [])
			.filter((t: any) => typeof t?.p === "number" && /[\p{L}\p{N}]/u.test(String(t?.text ?? "")) && !/^\[_/.test(String(t?.text ?? "")))
			.map((t: any) => Math.max(1e-4, Math.min(1, t.p as number)));
		const p = probs.length ? Math.round(Math.exp(probs.reduce((a: number, b: number) => a + Math.log(b), 0) / probs.length) * 1000) / 1000 : undefined;
		words.push({ text, start: from / 1000, end: Math.max(from, to) / 1000, ...(p !== undefined ? { p } : {}) });
	}
	return { words, language: String(data?.result?.language ?? data?.params?.language ?? "") };
}
