// The Export window's work on disk (server side, app/api/export/*): the ffmpeg pass for what the page can't encode
// (HEVC, AV1, ProRes, GIF, HDR, MP3/AAC/FLAC) and saving straight into the «Export to» folder. A finished file that
// goes through the Save dialog waits here under a random id until the app quits.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { findTool } from "@/studio/server/tools";
import { type AudioFileFormat, audioArgs, type ExportTarget, type TranscodeExtras, transcodeArgs } from "../target";
import { exactRate, rateValue } from "../frame-count";
import { endSoundAt, findMoov } from "../mp4-edit-list";
import { partPath, placeFile } from "./place";

/**
 * The master as the Mac's media helpers can open it. The app's export file has no media extension (`…/export`, or a
 * hidden `.name.pid-x.gaziyav-part` beside its folder), and AVFoundation picks the reader by the extension: «the file
 * has no picture» — every «Smooth frames» export fell back to ffmpeg's motion interpolation (3 frames short at the end)
 * and every AI upscale to lanczos (exp, 14.11). A link named `master.mp4` in the work folder; the file itself is read
 * in place, never copied (the long-export rule).
 */
function helperInput(input: string, dir: string): string {
	if (/\.(mp4|m4v|mov)$/i.test(input)) return input;
	const link = path.join(dir, "master-in.mp4");
	try {
		fs.rmSync(link, { force: true });
		fs.symlinkSync(input, link);
		return link;
	} catch {
		return input;
	}
}

/** What the ffmpeg pass makes. A video can first go through the app's own AI helpers (st10's tools, run as is):
 * `motion smooth` (Apple frame interpolation) for a higher frame rate, `neuralfx upscale` (MetalFX) for a larger size. */
export type TranscodeJob =
	| { target: ExportTarget; upscale?: { scale: 2 | 4 }; smooth?: { factor: number; fps: number; frames?: number; cut?: number; cuts?: number[] }; force?: ExportFallback[] }
	| { audio: Exclude<AudioFileFormat, "wav"> };

/**
 * A step of the pass that did not work and was replaced by a plainer one (exp2, 14.11: «Smooth frames» and AI upscale
 * had fallen back on every export without a word). The finished export says each one; the flight recorder gets a line.
 * `force` (tests only, STUDIO_TEST=1) makes a step fail on purpose.
 */
export type ExportFallback = "smooth" | "upscale" | "hardware";
const forced = (job: TranscodeJob, step: ExportFallback) => process.env.STUDIO_TEST === "1" && "target" in job && !!job.force?.includes(step);

/**
 * Stops `child` when `signal` aborts — also when it has aborted already: a Cancel that lands between the check and the
 * spawn never fires the event, and the encoder ran on to the end with nobody waiting for it (check-export, cancel-encoder).
 * Returns the listener, for removeEventListener at the end.
 */
export function killWhenAborted(child: { kill: (signal: "SIGKILL") => unknown }, signal?: AbortSignal): () => void {
	const abort = () => child.kill("SIGKILL");
	if (signal?.aborted) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	return abort;
}

/** Runs one of the app's native helpers; its progress lines («P 0.4» or JSON with "p") go to `onProgress`. */
function runHelper(name: string, args: string[], onProgress: (progress: number) => void, signal?: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(findTool(name), args, { stdio: ["ignore", "pipe", "pipe"] });
		let tail = "";
		const abort = killWhenAborted(child, signal);
		child.stdout.on("data", (chunk: Buffer) => {
			const text = String(chunk);
			tail = (tail + text).slice(-1500);
			const match = /"p":\s*([\d.]+)/.exec(text) ?? /(?:^|\n)P\s+([\d.]+)/.exec(text);
			if (match) onProgress(Math.min(1, Number(match[1])));
		});
		child.stderr.on("data", (chunk: Buffer) => {
			tail = (tail + String(chunk)).slice(-1500);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			signal?.removeEventListener("abort", abort);
			if (signal?.aborted) reject(new DOMException("Cancelled", "AbortError"));
			else if (code === 0) resolve();
			else reject(new Error(`${name}: ${tail.trim().split("\n").pop() ?? code}`));
		});
	});
}

/** The copied sound of an ffmpeg pass ends where the film ends (`seconds`): only the «moov» is read and rewritten. */
function endSoundOf(file: string, seconds: number) {
	if (!(seconds > 0)) return;
	let fd: number | null = null;
	try {
		fd = fs.openSync(file, "r+");
		const handle = fd;
		const size = fs.fstatSync(handle).size;
		const read = (position: number, length: number) => {
			const buf = Buffer.alloc(Math.max(0, Math.min(length, size - position)));
			fs.readSync(handle, buf, 0, buf.length, position);
			return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
		};
		const where = findMoov(read, size);
		if (!where || where.size > 256 * 1024 * 1024) return;
		const moov = read(where.start, where.size);
		if (endSoundAt(moov, seconds)) fs.writeSync(handle, moov, 0, moov.length, where.start);
	} catch {
		// a file this can't read stays as ffmpeg wrote it (the sound a packet longer at most)
	} finally {
		if (fd !== null) fs.closeSync(fd);
	}
}

const WORK = path.join(os.tmpdir(), "Gaziyav-export-work");
const ready = new Map<string, string>();

/** What macOS and Windows take as a file name: no folders, no ":" "/" "\", never empty. */
export function safeName(name: string): string {
	const base = [...path.basename(String(name)).replace(/[/:\\]/g, ".")]
		.filter((char) => char.charCodeAt(0) >= 32)
		.join("")
		.trim();
	return (base || "Export").slice(0, 200);
}

/** A name not taken in the folder: «Video.mp4», then «Video (2).mp4» … — an export never overwrites a file. */
export function freePath(folder: string, name: string): string {
	const ext = path.extname(name);
	const stem = name.slice(0, name.length - ext.length);
	for (let n = 1; ; n++) {
		const candidate = path.join(folder, n === 1 ? name : `${stem} (${n})${ext}`);
		if (!fs.existsSync(candidate)) return candidate;
	}
}

/** The «Export to» folder the user picked: absolute, there, a folder. */
export function checkFolder(folder: string): string {
	if (!path.isAbsolute(folder)) throw new Error("Choose the export folder again.");
	let stat: fs.Stats;
	try {
		stat = fs.statSync(folder);
	} catch {
		throw new Error(`The folder «${path.basename(folder)}» isn't there any more. Choose another one.`);
	}
	if (!stat.isDirectory()) throw new Error("Choose a folder to export to.");
	return folder;
}

async function writeBody(body: ReadableStream<Uint8Array> | null, file: string): Promise<number> {
	if (!body) throw new Error("Nothing was sent to save.");
	await pipeline(Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream<Uint8Array>), fs.createWriteStream(file));
	// on the disk before it gets its name (a power cut after the rename must not leave a file of nothing)
	const fd = fs.openSync(file, "r+");
	try {
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	return fs.statSync(file).size;
}

/** Saves the request body as `name` in `folder` (a free name), returns the path. */
export async function saveToFolder({ body, folder, name }: { body: ReadableStream<Uint8Array> | null; folder: string; name: string }) {
	const dir = checkFolder(folder);
	const part = partPath(path.join(dir, safeName(name)));
	try {
		await writeBody(body, part);
		return moveInto(part, dir, safeName(name));
	} catch (error) {
		fs.rmSync(part, { force: true });
		throw error;
	}
}

/**
 * Puts a finished file into the folder under a free name in one step: nobody (Finder, an upload, a test) ever sees a
 * half-written file there. Another disk: copied beside its place under a hidden part name first, then renamed (place.ts).
 */
function moveInto(file: string, folder: string, name: string): string {
	const target = freePath(folder, name);
	placeFile(file, target);
	return target;
}

/** The length of a file's picture in seconds (its video stream, not the container), or null when it can't be read. */
function videoSeconds(file: string): Promise<number | null> {
	return new Promise((resolve) => {
		const child = spawn(findTool("ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", file], { stdio: ["ignore", "pipe", "ignore"] });
		let out = "";
		child.stdout.on("data", (chunk: Buffer) => {
			out += String(chunk);
		});
		child.on("error", () => resolve(null));
		child.on("close", () => {
			const seconds = Number.parseFloat(out.trim().split("\n")[0] ?? "");
			resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
		});
	});
}

/** Runs ffmpeg; `onProgress` gets 0…1 from its progress lines when the length is known. */
function runFfmpeg(args: string[], seconds: number, onProgress: (progress: number) => void, signal?: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(findTool("ffmpeg"), ["-progress", "pipe:1", "-nostats", ...args], { stdio: ["ignore", "pipe", "pipe"] });
		let tail = "";
		const abort = killWhenAborted(child, signal);
		child.stdout.on("data", (chunk: Buffer) => {
			const match = /out_time_us=(\d+)/.exec(String(chunk).split("\n").filter((l) => l.startsWith("out_time_us=")).pop() ?? "");
			if (match && seconds > 0) onProgress(Math.min(1, Number(match[1]) / 1e6 / seconds));
		});
		child.stderr.on("data", (chunk: Buffer) => {
			tail = (tail + String(chunk)).slice(-2000);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			signal?.removeEventListener("abort", abort);
			if (signal?.aborted) reject(new DOMException("Cancelled", "AbortError"));
			else if (code === 0) resolve();
			else reject(new Error(tail.trim().split("\n").slice(-2).join(" ").slice(0, 300) || `ffmpeg stopped (${code})`));
		});
	});
}

/**
 * The second pass: the body (the page's H.264 master, or its WAV mix) becomes `name` — in `folder` when given,
 * else kept for the Save dialog (`id`).
 */
export async function transcode({
	body,
	inputFile,
	job,
	name,
	folder,
	seconds,
	onProgress,
	onStage,
	signal,
}: {
	body: ReadableStream<Uint8Array> | null;
	/** The master as a file of the app's on disk (rendered-file.ts) instead of `body`: read in place, never removed here. */
	inputFile?: string;
	job: TranscodeJob;
	name: string;
	folder?: string;
	seconds: number;
	onProgress: (progress: number) => void;
	onStage?: (stage: string) => void;
	signal?: AbortSignal;
}): Promise<{ path: string; id?: string; bytes: number; fallbacks?: { step: ExportFallback; reason: string }[] }> {
	const fallbacks: { step: ExportFallback; reason: string }[] = [];
	const fellBack = (step: ExportFallback, error: unknown) => fallbacks.push({ step, reason: (error instanceof Error ? error.message : String(error)).slice(0, 200) });
	// (the folder carries this server's pid: what a kill leaves is cleared at the next start, not a day later)
	const id = `${process.pid}-${randomUUID()}`;
	const dir = path.join(WORK, id);
	fs.mkdirSync(dir, { recursive: true });
	// A master the app already has on disk is read where it is: no second copy of gigabytes, no time spent copying.
	const input = inputFile ?? path.join(dir, "audio" in job ? "mix.wav" : "master.mp4");
	const file = safeName(name);
	if (folder) checkFolder(folder);
	const output = path.join(dir, file);
	try {
		if (!inputFile) await writeBody(body, input);
		let args: string[];
		let base = 0;
		if ("audio" in job) args = audioArgs(job.audio, input, output);
		else {
			// Higher frame rate: in-between frames by frame interpolation, drawn straight at the target rate over the
			// master's own length. (Slowed and played back faster through setpts + -r, the file got one frame more than
			// the timeline and, at 50 fps, the picture sat a frame behind the sound: check-export E2.)
			const extras: TranscodeExtras = {};
			let video = input;
			if ((job.smooth && job.smooth.factor > 1) || job.upscale) video = helperInput(input, dir);
			if (job.smooth && job.smooth.factor > 1) {
				onStage?.("Smoothing frames (optical flow)");
				const smooth = path.join(dir, "smooth.mp4");
				// the exact rate (60000/1001, never 59.94) and the exact number of frames the page counted from ticks;
				// an older page without it: the picture's length (not the container's: the last AAC packet is longer)
				const rate = exactRate(job.target.fps);
				const fps = rateValue(rate);
				const frames = job.smooth.frames && job.smooth.frames > 0 ? Math.round(job.smooth.frames) : 0;
				const measured = frames ? null : ((await videoSeconds(input)) ?? seconds);
				const length = frames ? (frames * rate.denominator) / rate.numerator : (measured ?? 0);
				if (length > 0) extras.frames = frames || Math.max(1, Math.ceil(length * fps - 1e-6));
				try {
					// Test harness only: a Mac without Apple frame interpolation (macOS < 15.4, Intel) takes the fallback.
					if ((process.env.STUDIO_TEST === "1" && process.env.STUDIO_NO_FRAME_INTERPOLATION === "1") || forced(job, "smooth")) throw new Error("frame interpolation off");
					// the cover's end and every cut of the film: no frame is made across one (exp2, 14.11)
					const cuts = [...(job.smooth.cut && job.smooth.cut > 0 ? [job.smooth.cut] : []), ...(job.smooth.cuts ?? [])].filter((t) => Number.isFinite(t) && t > 0);
					const cut = cuts.length ? ["--cuts", cuts.map((t) => t.toFixed(6)).join(",")] : [];
					const args = ["smooth", video, smooth, "--start", "0", ...(length > 0 ? ["--end", String(length)] : []), "--factor", "1", "--fps", String(fps), ...cut];
					await runHelper("motion", args, (p) => onProgress(p * 0.35), signal);
					video = smooth;
				} catch (error) {
					if (signal?.aborted) throw error;
					extras.minterpolate = true;
					fellBack("smooth", error);
					onStage?.("Smoothing frames (motion interpolation)");
				}
				base = 0.35;
			}
			// Larger than the project: the AI upscaler (MetalFX) enlarges the frames, ffmpeg brings them to the exact size.
			if (job.upscale) {
				onStage?.("AI upscale");
				const upscaled = path.join(dir, "upscaled.mov");
				try {
					if (forced(job, "upscale")) throw new Error("AI upscale off");
					await runHelper("neuralfx", ["upscale", video, upscaled, "--scale", String(job.upscale.scale)], (p) => onProgress(base + p * 0.25), signal);
					video = upscaled;
				} catch (error) {
					if (signal?.aborted) throw error;
					fellBack("upscale", error);
					onStage?.("AI upscale isn't available on this Mac: enlarged by lanczos");
				}
				base += 0.25;
			}
			if (video !== input) extras.audio = input;
			if (base > 0) onStage?.("Encoding");
			args = transcodeArgs(job.target, video, output, extras);
			// the Mac's hardware encoder (VideoToolbox) refused: the same file by the software encoder, said at the end
			if (job.target.hardware && hardwareEncodes(job.target)) {
				const software = transcodeArgs({ ...job.target, hardware: false }, video, output, extras);
				const encode = args;
				args = [];
				try {
					if (forced(job, "hardware")) throw new Error("hardware encoder off");
					await runFfmpeg(encode, seconds, (p) => onProgress(base + p * (1 - base)), signal);
				} catch (error) {
					// (a full disk is no encoder's fault: said as such by the page, not retried here)
					if (signal?.aborted || /no space|ENOSPC|disk full/i.test(String((error as Error)?.message ?? error))) throw error;
					fellBack("hardware", error);
					fs.rmSync(output, { force: true });
					args = software;
				}
			}
		}
		if (args.length) await runFfmpeg(args, seconds, (p) => onProgress(base + p * (1 - base)), signal);
		if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error("ffmpeg wrote an empty file.");
		if (!("audio" in job) && (job.target.container === "mp4" || job.target.container === "mov")) endSoundOf(output, seconds);
	} catch (error) {
		fs.rmSync(dir, { recursive: true, force: true });
		throw error;
	}
	if (!inputFile) fs.rmSync(input, { force: true });
	const bytes = fs.statSync(output).size;
	ready.set(id, output);
	const fell = fallbacks.length ? { fallbacks } : {};
	if (!folder) return { path: output, id, bytes, ...fell };
	// Made; only its place is left. A folder whose disk is full or gone keeps the file here (`id`): the page waits for
	// room, or the user picks another place, and it is placed without being encoded again.
	try {
		return { path: placeReady(id, folder, file), bytes, ...fell };
	} catch (error) {
		throw Object.assign(error instanceof Error ? error : new Error(String(error)), { kept: { id, path: output, bytes } });
	}
}

/** The target goes through a VideoToolbox encoder when `hardware` is on (target.ts transcodeArgs). */
function hardwareEncodes(target: ExportTarget): boolean {
	const probe = transcodeArgs(target, "in.mp4", "out.mp4", {});
	return probe.some((arg) => /_videotoolbox$/.test(arg));
}

/** A file made earlier and kept (`id`) goes into `folder` under a free name, in one step; returns where. */
export function placeReady(id: string, folder: string, name?: string): string {
	const file = readyFile(id);
	if (!file) throw new Error("This export is gone: export it again.");
	const saved = moveInto(file, checkFolder(folder), safeName(name || path.basename(file)));
	ready.delete(id);
	fs.rmSync(path.dirname(file), { recursive: true, force: true });
	return saved;
}

/** A finished file waiting for the Save dialog. */
export function readyFile(id: string): string | null {
	const file = ready.get(id);
	return file && fs.existsSync(file) ? file : null;
}

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

/**
 * Files of an earlier run of the app: a folder whose server no longer runs goes at once (a kill in the middle of a
 * ProRes pass left gigabytes for a day), one of a running server (this one, another copy of the app, a test) never;
 * a folder from before the pid was in its name goes after a day.
 */
export function sweepOldWork(maxAgeMs = 24 * 3600 * 1000) {
	try {
		for (const entry of fs.readdirSync(WORK)) {
			const dir = path.join(WORK, entry);
			const pid = Number(/^(\d+)-/.exec(entry)?.[1] ?? 0);
			if (pid ? !alive(pid) : Date.now() - fs.statSync(dir).mtimeMs > maxAgeMs && !ready.has(entry)) fs.rmSync(dir, { recursive: true, force: true });
		}
	} catch {}
}
