// The on-device AI manager: what is installed, one-click install, Repair and remove.
// Guarantees: pinned files with sha256 (mirror fallback, resumable, retried), a fully pinned Python environment
// (bundled uv + uv-managed standalone Python 3.11.17 + hash-locked wheels, no compiler), checks before starting
// (Mac, macOS, memory, disk, network), an atomic install (everything goes into "<folder>.partial" and is moved
// into place only after the self-test passed), and human error messages. No Terminal, no system Python, nothing
// in ~/.local: the Python builds, uv's cache and the environments live in ~/Library/Application Support/Gaziyav.
import { routed } from "@/studio/server/http";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hardware } from "@/platform/hardware";
import { bundledBinDir, isPackaged, LIPMARKS, modelDirs } from "@/platform/paths";
import { CancelledError, StudioError } from "@/studio/server/errors";
import { cancelJob, getJob, type Job, type JobState, startJob } from "@/studio/server/jobs";
import { findTool, reason, run } from "@/studio/server/tools";
import { findModel, findWhisper } from "@/transcribe/server/whisper";
import { clearQuarantine, type DownloadPace, downloadFile, sha256File, UNREACHABLE } from "./download";
import { MIN_NVIDIA_DRIVER, nvidiaGpu } from "./gpu";
import { PYTHON_VERSION } from "./locks";
import { TORCH_INDEX } from "./locks-win";
import { BEATS_WEIGHTS, BEATS_WEIGHTS_SHA256, downloadBytes, LEGACY_VOICE_SNAPSHOT, MODELS, type ModelClass, modelClass, type ModelFile, type ModelId, type ModelSpec, modelSpec, partsOf, VOICE_REV, VOICE_SNAPSHOT } from "./manifest";
import { schedulePrune } from "./prune";

const WINDOWS = IS_WINDOWS;

export interface ModelStatus {
	id: ModelId;
	title: string;
	purpose: string;
	downloadBytes: number;
	diskBytes: number;
	installed: boolean;
	/** Installed and passed the self-test with this build's pinned files. */
	verified: boolean;
	/** Why it can't run on this Mac (Intel, macOS, memory, missing helper). */
	unsupported?: string;
	/** A heads-up that doesn't block (8 GB Macs). */
	note?: string;
	/** The app carries its files (the «with models» build): it installs without the internet. */
	bundled?: boolean;
	/** Runs on another feature's download (Retouch on Face swap's files): nothing of its own to repair or remove. */
	sharedWith?: string;
	job?: JobState;
	/** The job is the quiet background download (background.ts): Settings shows it as one quiet line, no bar. */
	background?: boolean;
	/** The download policy's class: small (≤ 1 GB, comes in the background) or large (on first use). */
	size: ModelClass;
	/** The memory the model wants (bytes), shown beside its size in Settings. */
	minMemory?: number;
}

// One map for the server's lifetime (the dev server reloads this module; the jobs must survive it).
const holder = globalThis as typeof globalThis & { __ondeviceJobs?: Map<ModelId, string>; __ondeviceBackgroundJobs?: Set<string>; __ondeviceUrgent?: Set<string> };
holder.__ondeviceJobs ??= new Map();
const jobs: Map<ModelId, string> = holder.__ondeviceJobs;
/** Ids of the jobs the background queue started. */
holder.__ondeviceBackgroundJobs ??= new Set();
const backgroundJobs: Set<string> = holder.__ondeviceBackgroundJobs;
/** Models a feature (or Settings) asked for while their background download ran: it goes at full speed from then on. */
holder.__ondeviceUrgent ??= new Set();
const urgent: Set<string> = holder.__ondeviceUrgent;

/** The jobs the background queue started (background.ts leaves them out of «the user is busy»). */
export function backgroundJobIds(): ReadonlySet<string> {
	return backgroundJobs;
}

/** A feature is waiting for this model's download: the background pace (pause, speed cap) no longer applies to it. */
export function isUrgent(id: string): boolean {
	return urgent.has(owner(id));
}

const APPLE_SILICON = IS_MAC && ARCH === "arm64";
/** macOS major version (Darwin 23 = macOS 14). */
const MACOS = IS_MAC ? Number(os.release().split(".")[0]) - 9 : 0;
const GB = (b: number) => `${(b / 1e9).toFixed(1)} GB`;
const MB = (b: number) => `${Math.round(b / 1e6)} MB`;
const fmtTime = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);

/**
 * Changes when the pinned files or packages change: older installs then ask for Repair. `original`: as it was before a
 * file moved to our own copy (its `alt`) — an install made from the original files is still verified.
 */
function fingerprint(spec: ModelSpec, original = false): string {
	const h = crypto.createHash("sha256");
	for (const file of spec.files) {
		// An add-on (ModelFile.optional) is not part of what an install is: adding one never asks for Repair.
		if (file.optional) continue;
		const f = original && file.alt ? file.alt : file;
		h.update(`${f.dest}:${f.sha256}\n`);
	}
	if (spec.python) h.update(spec.python.lock).update(PYTHON_VERSION);
	return h.digest("hex").slice(0, 16);
}

const marker = (root: string) => path.join(root, ".installed.json");
const partial = (spec: ModelSpec) => `${spec.root()}.partial`;
const envOf = (spec: ModelSpec, root = spec.root()) => (spec.python ? path.join(root, spec.python.env) : "");
const pythonOf = (spec: ModelSpec, root = spec.root()) =>
	spec.python ? (WINDOWS ? path.join(envOf(spec, root), "Scripts", "python.exe") : path.join(envOf(spec, root), "bin", "python")) : "";

/** Where an environment keeps its packages (a helper run by another environment's Python adds it to its path). */
export const sitePackagesOf = (spec: ModelSpec, root = spec.root()) =>
	WINDOWS ? path.join(envOf(spec, root), "Lib", "site-packages") : path.join(envOf(spec, root), "lib", `python${PYTHON_VERSION.split(".").slice(0, 2).join(".")}`, "site-packages");

function isVerified(spec: ModelSpec): boolean {
	try {
		const saved = JSON.parse(fs.readFileSync(marker(spec.root()), "utf8")).fingerprint;
		return saved === fingerprint(spec) || saved === fingerprint(spec, true);
	} catch {
		return false;
	}
}

function isInstalled(spec: ModelSpec): boolean {
	if (spec.id === "whisper") return !!findModel();
	// Retouch runs on Face swap's models and environment when they are here (the same files).
	const faceswap = spec.id === "retouch" ? modelSpec("faceswap") : undefined;
	if (faceswap && isInstalled(faceswap)) return true;
	// No Python: the downloaded program and model are all of it.
	if (!spec.python) return isVerified(spec) && spec.files.every((f) => f.optional || fs.existsSync(path.join(spec.root(), f.dest)));
	if (isVerified(spec)) return fs.existsSync(pythonOf(spec));
	// Installed by an earlier build (moved over from the old app folder): usable when the key files are there.
	const root = spec.root();
	const has = (rel: string) => fs.existsSync(path.join(root, rel));
	if (spec.id === "lipsync") {
		// The helper replaces unet.pth by a half-precision copy on its first run (what the GPU runs anyway).
		const unet = has("models/musetalkV15/unet.pth") || has("models/musetalkV15/unet.fp16.safetensors");
		return fs.existsSync(pythonOf(spec)) && unet && has("models/sd-vae/config.json") && has("src/musetalk/utils/utils.py");
	}
	// The voice model (8-bit, or the bf16 one earlier versions downloaded) also speaks the ready-made voices.
	if (spec.id === "voice") {
		return fs.existsSync(pythonOf(spec)) && (has(path.join(VOICE_SNAPSHOT, "model.safetensors")) || has(path.join(LEGACY_VOICE_SNAPSHOT, "model.safetensors")));
	}
	// The generators exist only in this build: installed means installed and self-tested here.
	return false;
}

/** The memory a model may count on: this machine's, or the smallest of a tier STUDIO_HW_TIER stands in for (base = 8 GB). */
export function memoryBytes(): number {
	const hw = hardware();
	if (hw.tierFrom === "override") return { base: 8, standard: 16, pro: 32 }[hw.tier] * 2 ** 30;
	return os.totalmem();
}

function unsupported(spec: ModelSpec): string | undefined {
	// A part (a faster engine) comes after its feature and never without it.
	if (spec.partOf) {
		const feature = modelSpec(spec.partOf);
		if (!feature || !isInstalled(feature)) return `Comes with ${feature?.title ?? "its feature"}.`;
	}
	// Windows: what the PC's NVIDIA card can run (the models are the CUDA versions, manifest-win.ts).
	if (WINDOWS && spec.nvidia) {
		const gpu = nvidiaGpu();
		if (!gpu) return "Needs an NVIDIA graphics card (GeForce RTX). Use a cloud service under API keys instead.";
		if (gpu.driver < MIN_NVIDIA_DRIVER) return `Update the NVIDIA driver to version ${MIN_NVIDIA_DRIVER} or newer (this PC has ${gpu.driver}).`;
		if (gpu.vram < spec.nvidia.minVram * 0.95) return `Needs an NVIDIA card with at least ${Math.round(spec.nvidia.minVram / 1e9)} GB of memory (${gpu.name} has ${Math.round(gpu.vram / 1e9)} GB).`;
	}
	if (spec.appleSiliconOnly && !APPLE_SILICON) return "Needs a Mac with Apple silicon (M1 or later). Use a cloud service under API keys instead.";
	if (spec.minMacOS && MACOS < spec.minMacOS) return `Needs macOS ${spec.minMacOS} or later. Update macOS, or use fal.ai (Settings → Services).`;
	// The heavy models (16 GB) are not offered on a smaller Mac at all — no «run anyway»: the basics (captions, Enhance
	// voice, Separate, CleanUp, Voice changer) are its set, the rest runs on fal.ai.
	if (spec.minMemory && memoryBytes() < spec.minMemory * 0.95) {
		if (!WINDOWS && spec.minMemory >= 16e9) return "Needs a Mac with 16 GB of memory.";
		return `Needs a ${WINDOWS ? "PC" : "Mac"} with at least ${Math.round(spec.minMemory / 1e9)} GB of memory.`;
	}
	const bin = bundledBinDir();
	const has = (name: string) => !!bin && fs.existsSync(path.join(bin, name));
	if (spec.id === "whisper" && !findWhisper()) return "Not available in this build of the app.";
	if (spec.id === "lipsync" && !(has("local-lipsync.py") && has(LIPMARKS))) return "Not available in this build of the app.";
	if (spec.id === "voice" && !has("local-tts.py")) return "Not available in this build of the app.";
	if (spec.id === "faceswap" && !(has("local-faceswap.py") && has(LIPMARKS))) return "Not available in this build of the app.";
	if (spec.id === "cleanup" && !has("local-cleanup.py")) return "Not available in this build of the app.";
	if ((spec.id === "separate" || spec.id === "separate-mlx") && !has("local-separate.py")) return "Not available in this build of the app.";
	if (spec.id === "voicechange" && !has("local-voicechange.py")) return "Not available in this build of the app.";
	if (spec.id === "separate-beats" && !(has("local-beats.py") && has("local-beats-convert.py"))) return "Not available in this build of the app.";
	if (spec.id === "retouch" && !(has("local-faceswap.py") && has(LIPMARKS))) return "Not available in this build of the app.";
	if (spec.python && !findUv()) return "Not available in this build of the app.";
	return undefined;
}

/** Kinds offered online in the same place (none left on this Mac). */
const POINT_KINDS: ReadonlySet<string> = new Set(["image", "music"]);

function note(spec: ModelSpec): string | undefined {
	if (!WINDOWS && spec.minMemory && spec.minMemory >= 8e9 && os.totalmem() < 12e9) return "This Mac has 8 GB of memory: close other apps while it runs.";
	return undefined;
}

/** Null when the feature can run now; otherwise a plain sentence for the panel. */
/** The spec of a feature this build knows (every ModelId has one). */
function specOf(id: ModelId): ModelSpec {
	const spec = modelSpec(id);
	if (!spec) throw new StudioError("Unknown on-device feature");
	return spec;
}

export function ondeviceUnavailable(id: ModelId): string | null {
	const spec = specOf(id);
	const why = unsupported(spec);
	if (why) return why;
	if (!isInstalled(spec)) return `${spec.title} isn't downloaded yet (${GB(downloadBytes(spec))}, once)`;
	return null;
}

/** For panels: can it be installed here at all, and is it installed. */
export function ondeviceState(id: ModelId): { installed: boolean; unsupported?: string; addons?: boolean } {
	const spec = specOf(id);
	const installed = isInstalled(spec);
	return { installed, unsupported: unsupported(spec), ...(installed && missingAddons(spec).length ? { addons: true } : {}) };
}

/** Add-on files (ModelFile.optional) of a model that are not on this Mac yet. */
function missingAddons(spec: ModelSpec, root = spec.root()): ModelFile[] {
	return spec.files.filter((f) => f.optional && fs.statSync(path.join(root, f.dest), { throwIfNoEntry: false })?.size !== f.size);
}

/** The Python of a feature's environment. */
export function ondevicePython(id: ModelId): string {
	return pythonOf(specOf(id));
}

/**
 * Room an install needs on the disk: the download, the unpacked runtime and uv's cache (removed at the end); a Repair
 * in place reuses what is there; from the «with models» build: clones, ~no room. The page asks the same question with
 * this figure before it starts anything, so the two never disagree.
 */
export function installBytes(spec: ModelSpec, inPlace = false): number {
	if (isBundled(spec)) return spec.python ? 2e9 : 0;
	return Math.max(0, downloadBytes(spec) * (spec.python ? 1.6 : 1.05) - (inPlace ? spec.diskBytes : 0));
}

export function ondeviceStatus(): ModelStatus[] {
	return MODELS.map((spec) => {
		const jobId = jobs.get(owner(spec.id) as ModelId);
		const job = jobId ? (getJob(jobId) ?? undefined) : undefined;
		const sharedWith = spec.id === "retouch" && !isVerified(spec) && isInstalled(spec) ? modelSpec("faceswap")?.title : undefined;
		return {
			id: spec.id,
			title: spec.title,
			purpose: spec.purpose,
			downloadBytes: downloadBytes(spec),
			diskBytes: spec.diskBytes,
			installBytes: installBytes(spec),
			installed: isInstalled(spec),
			verified: spec.id === "whisper" || sharedWith ? isInstalled(spec) : isVerified(spec),
			...(sharedWith ? { sharedWith, diskBytes: 0 } : {}),
			unsupported: unsupported(spec),
			note: note(spec),
			bundled: isBundled(spec),
			job,
			size: modelClass(spec),
			minMemory: spec.minMemory,
			...(jobId && backgroundJobs.has(jobId) && !urgent.has(spec.id) ? { background: true } : {}),
		};
	});
}

// ───────────────────────── Bundled models (the «with models» build) ─────────────────────────
// That build carries every model's files, the Python builds and the wheels in Gaziyav.app/Contents/Resources/seed
// (seed.json marks it). An install then copies them — APFS clones: instant, no extra space — instead of downloading,
// uv runs offline, and everything installs by itself on the first launch.

function seedDir(): string | null {
	const bin = bundledBinDir();
	const dir = bin ? path.join(bin, "..", "seed") : null;
	return dir && fs.existsSync(path.join(dir, "seed.json")) ? dir : null;
}

/** All of the model's files are in the app, with the expected sizes (and the wheels for its Python). */
export function isBundled(spec: ModelSpec): boolean {
	const seed = seedDir();
	if (!seed) return false;
	if (spec.python && !fs.existsSync(path.join(seed, "runtime", "uv-cache"))) return false;
	return spec.files.every((f) => f.optional || fs.statSync(path.join(seed, "models", spec.id, f.dest), { throwIfNoEntry: false })?.size === f.size);
}

const CLONE = fs.constants.COPYFILE_FICLONE; // copy-on-write where the volume allows it, a plain copy otherwise

function seedFiles(spec: ModelSpec, work: string) {
	const seed = seedDir();
	if (!seed) return;
	const from = path.join(seed, "models", spec.id);
	for (const f of spec.files) {
		const dest = path.join(work, f.dest);
		if (fs.statSync(dest, { throwIfNoEntry: false })?.size === f.size) continue;
		// An add-on the app does not carry comes from the internet later (the background queue).
		if (f.optional && !fs.existsSync(path.join(from, f.dest))) continue;
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(path.join(from, f.dest), dest, CLONE);
	}
}

/** The Python builds and the wheels, from the app into its folder (uv needs them writable). */
function seedRuntime() {
	const seed = seedDir();
	if (!seed) return;
	const runtime = path.join(seed, "runtime");
	for (const [from, to] of [
		[path.join(runtime, "python"), modelDirs.python()],
		[path.join(runtime, "uv-cache"), modelDirs.uvCache()],
	]) {
		fs.mkdirSync(to, { recursive: true });
		// Clones (-c), links kept as links (-P), what is already there kept (-n): the second model's install finds
		// the Python of the first. (fs.cpSync stops with EEXIST on a link that exists.)
		const r = spawnSync("/bin/cp", ["-cRPn", `${from}/`, to], { encoding: "utf8" });
		const problems = (r.stderr ?? "").split("\n").filter((l) => l.trim() && !/not overwritten|File exists/i.test(l));
		if (r.status !== 0 && problems.length) throw new StudioError(`Preparing the runtime failed: ${problems[0].slice(0, 200)}`);
	}
}

let bundledQueue: Promise<void> | null = null;
let bundledChecked = false;

/** Everything the app carries installs once, one model after another, without asking (checked once per run). */
export function installBundled(): void {
	if (bundledQueue || bundledChecked) return;
	bundledChecked = true;
	if (!seedDir()) return;
	bundledQueue = (async () => {
		for (const spec of MODELS) {
			if (!isBundled(spec) || isInstalled(spec) || unsupported(spec)) continue;
			try {
				const job = await startInstall(spec.id);
				while (getJob(job.id)?.status === "running") await new Promise((r) => setTimeout(r, 1000));
			} catch {}
		}
	})().finally(() => {
		bundledQueue = null;
	});
}

// ───────────────────────── Python runtime (bundled uv) ─────────────────────────

function findUv(): string | null {
	const bin = bundledBinDir();
	const own = bin && path.join(bin, WINDOWS ? "uv.exe" : "uv");
	if (own && fs.existsSync(own)) return own;
	if (!isPackaged()) for (const p of ["/opt/homebrew/bin/uv", "/usr/local/bin/uv"]) if (fs.existsSync(p)) return p;
	return null;
}

/** uv keeps everything inside the app's folder: its Python builds, cache, links; it never reads user config. */
function uvEnv(offline = false): string[] {
	const runtime = path.dirname(modelDirs.python());
	const env: Record<string, string> = {
		UV_PYTHON_INSTALL_DIR: modelDirs.python(),
		UV_PYTHON_BIN_DIR: path.join(runtime, "bin"),
		UV_CACHE_DIR: modelDirs.uvCache(),
		UV_TOOL_DIR: path.join(runtime, "tools"),
		UV_NO_CONFIG: "1",
		UV_PYTHON_PREFERENCE: "only-managed",
		UV_PYTHON_DOWNLOADS: "automatic",
		UV_NO_PROGRESS: "1",
		UV_HTTP_TIMEOUT: "120",
		UV_HTTP_RETRIES: "8",
		UV_LINK_MODE: "copy",
		UV_COMPILE_BYTECODE: "0",
		PYTHONNOUSERSITE: "1",
		// uv runs install_name_tool on its Python: on a Mac without the developer tools the system's one is a stub that
		// asks to install them, in the middle of a model's setup. The app's shim answers for it.
		...(!WINDOWS && bundledBinDir() ? { PATH: `${path.join(bundledBinDir() as string, "shims")}:${process.env.PATH ?? "/usr/bin:/bin"}` } : {}),
		// The «with models» build: the wheels and Python came with the app; the same wheel on every Mac (macOS 14+).
		...(offline ? { UV_OFFLINE: "1", UV_PYTHON_DOWNLOADS: "never", UV_LINK_MODE: "clone" } : {}),
		// Windows: PyTorch's CUDA builds come from PyTorch's own index (every wheel is still hash-checked). Hard links
		// from uv's cache, which stays, so the 5 GB of PyTorch is on disk once for all the models that use it.
		...(WINDOWS ? { UV_EXTRA_INDEX_URL: TORCH_INDEX, UV_INDEX_STRATEGY: "unsafe-best-match", UV_LINK_MODE: "hardlink" } : {}),
	};
	return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}

async function uv(args: string[], signal: AbortSignal, timeout: number, onLine?: (line: string) => void, offline = false) {
	const tool = findUv();
	if (!tool) throw new StudioError("This build of the app has no Python installer. Reinstall the app.");
	const r = await run("/usr/bin/env", [...uvEnv(offline), tool, ...args], { timeout, signal, onLine });
	if (r.status !== 0) {
		const text = reason(r);
		if (/network|dns|connect|timed out|tcp|tls|resolve/i.test(text)) throw new StudioError("The download stopped: no internet connection. Connect and press Retry.");
		if (/No space left/i.test(text)) throw new StudioError("The disk is full. Free some space and press Retry.");
		throw new StudioError(`Setting up the runtime failed: ${text}`);
	}
	return r;
}

/** True when the environment was made by this manager (its Python lives in the app's folder). */
function envIsOurs(env: string): boolean {
	try {
		const home = /home\s*=\s*(.*)/.exec(fs.readFileSync(path.join(env, "pyvenv.cfg"), "utf8"))?.[1]?.trim() ?? "";
		return home.startsWith(modelDirs.python());
	} catch {
		return false;
	}
}

async function setUpPython(spec: ModelSpec, root: string, job: Job, signal: AbortSignal, reinstall: boolean, offline = false) {
	const py = spec.python;
	if (!py) return;
	const env = envOf(spec, root);
	if (!envIsOurs(env)) {
		job.detail("runtime", `Python ${PYTHON_VERSION}`);
		fs.rmSync(env, { recursive: true, force: true });
		await uv(["venv", "--python", PYTHON_VERSION, "--relocatable", "--no-project", env], signal, 1800, undefined, offline);
	}
	const lock = path.join(root, ".requirements.lock");
	fs.writeFileSync(lock, py.lock);
	const total = (py.lock.match(/^[a-z0-9][\w.-]*==/gim) ?? []).length || 40;
	let n = 0;
	job.detail("runtime", "Libraries");
	await uv(
		["pip", "sync", "--python", pythonOf(spec, root), "--require-hashes", "--only-binary", ":all:", ...(reinstall ? ["--reinstall"] : []), lock],
		signal,
		3600,
		(line) => {
			const l = line.trim();
			if (/^(Downloading|Downloaded|Prepared|Installed|Uninstalled|Resolved|Audited)/.test(l)) {
				n += /^Downloaded/.test(l) ? 1 : 0;
				job.detail("runtime", l.replace(/\s+in\s+[\d.]+m?s$/, "").slice(0, 90));
				job.progress("runtime", Math.min(0.95, n / total));
			}
		},
		offline,
	);
	fs.rmSync(lock, { force: true });
	if (WINDOWS) copyRuntimeDlls(env);
}

/**
 * The Microsoft C++ runtime next to the environment's Python (PyTorch, OpenCV and ONNX Runtime need it), from the app's
 * own copy: a PC without the Visual C++ Redistributable works the same. Files already there are left as they are.
 */
function copyRuntimeDlls(env: string) {
	const bin = bundledBinDir();
	if (!bin) return;
	let home = "";
	try {
		home = /home\s*=\s*(.*)/.exec(fs.readFileSync(path.join(env, "pyvenv.cfg"), "utf8"))?.[1]?.trim() ?? "";
	} catch {}
	if (!home || !fs.existsSync(home)) return;
	for (const name of fs.readdirSync(bin)) {
		if (!/^(msvcp140.*|vcruntime140.*|vcomp140|concrt140)\.dll$/i.test(name) || fs.existsSync(path.join(home, name))) continue;
		try {
			fs.copyFileSync(path.join(bin, name), path.join(home, name));
		} catch {}
	}
}

// ───────────────────────── Files ─────────────────────────

/**
 * One pinned file: its main source and mirrors, then — when none of them has it — the original file (`alt`). Resolves
 * with the path that was written.
 */
export async function fetchModelFile(f: ModelFile, root: string, signal: AbortSignal, progress: (bytes: number) => void, pace: DownloadPace = {}): Promise<string> {
	const dest = path.join(root, f.dest);
	try {
		await downloadFile([f.url, ...(f.mirrors ?? [])], dest, f.size, f.sha256, signal, progress, pace);
		if (f.executable) fs.chmodSync(dest, 0o755);
		return dest;
	} catch (error) {
		const original = f.alt;
		if (!original || signal.aborted || error instanceof CancelledError) throw error;
		// The original lives on the same hosts: when none of them answered a waiting feature, it is said now.
		if (pace.quick?.() && (error as Error).message === UNREACHABLE) throw error;
		const alt = path.join(root, original.dest);
		await downloadFile([original.url, ...(original.mirrors ?? [])], alt, original.size, original.sha256, signal, (got) => progress((got * f.size) / original.size), pace);
		return alt;
	}
}

async function fetchFiles(spec: ModelSpec, root: string, job: Job, signal: AbortSignal, verifyExisting: boolean, pace: DownloadPace = {}, files: ModelFile[] = spec.files) {
	const total = files.reduce((s, f) => s + f.size, 0);
	let before = 0;
	const t0 = Date.now();
	let first = -1;
	for (const f of files) {
		const dest = path.join(root, f.dest);
		if (verifyExisting && fs.existsSync(dest)) {
			job.detail("files", `Checking ${path.basename(f.dest)}`);
			if (fs.statSync(dest).size !== f.size || (await sha256File(dest)) !== f.sha256) {
				fs.rmSync(dest, { force: true });
			}
		}
		try {
			await fetchModelFile(
				f,
				root,
				signal,
				(got) => {
					const all = before + got;
					if (first < 0) first = all;
					const speed = (all - first) / Math.max(0.5, (Date.now() - t0) / 1000);
					const left = speed > 0 ? (total - all) / speed : 0;
					job.progress("files", all / total);
					job.detail("files", `${MB(all)} of ${MB(total)}${speed > 1e5 ? ` · ${MB(speed)}/s` : ""}${left > 1 ? ` · about ${fmtTime(left)} left` : ""}`);
				},
				pace,
			);
		} catch (error) {
			// An add-on that can't be had now is not the install's failure (unless add-ons are all this job is for):
			// the feature works without it and the background queue asks for it again.
			if (!f.optional || files !== spec.files || signal.aborted || error instanceof CancelledError) throw error;
			console.log(`[ondevice] ${spec.id}: the add-on ${path.basename(f.dest)} did not download (${(error as Error).message}); it will come later`);
		}
		before += f.size;
	}
	// Hugging Face cache layout: refs/main names the snapshot, so the helper finds the model offline.
	// (Windows loads its voice models from their own folder: no cache layout there.)
	const snapshot = WINDOWS ? null : spec.id === "voice" ? { dir: VOICE_SNAPSHOT, rev: VOICE_REV } : null;
	if (snapshot) {
		const repoDir = path.join(root, snapshot.dir, "..", "..");
		fs.mkdirSync(path.join(repoDir, "refs"), { recursive: true });
		fs.writeFileSync(path.join(repoDir, "refs", "main"), snapshot.rev);
	}
}

// ───────────────────────── Self-tests ─────────────────────────

/** Loads every lipsync model on the GPU and runs one full generation step on 1 s of synthetic speech. */
const LIPSYNC_SELFTEST = `
import os, sys
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")  # same as local-lipsync.py: the face-parsing weights are a legacy pickle
import numpy as np, torch
root, wav = sys.argv[1], sys.argv[2]
os.chdir(root); sys.path.insert(0, os.path.join(root, "src"))
dev = torch.device("cuda") if torch.cuda.is_available() else torch.device("mps") if torch.backends.mps.is_available() else None
assert dev is not None, "the GPU is not available"
from transformers import WhisperModel
from musetalk.utils.utils import load_all_model, datagen
from musetalk.utils.audio_processor import AudioProcessor
from musetalk.utils.face_parsing import FaceParsing
half = torch.float16
fp = FaceParsing(left_cheek_width=90, right_cheek_width=90); fp.net.to(dev).eval()
if os.path.exists("models/musetalkV15/unet.pth"):
    vae, unet, pe = load_all_model(unet_model_path="models/musetalkV15/unet.pth", vae_type="sd-vae", unet_config="models/musetalkV15/musetalk.json", device=dev)
    net = unet.model
else:  # the engine's half-precision copy (it replaces unet.pth on its first run)
    import json
    from diffusers import UNet2DConditionModel
    from safetensors.torch import load_file
    from musetalk.models.unet import PositionalEncoding
    from musetalk.models.vae import VAE
    vae, pe = VAE(model_path="models/sd-vae"), PositionalEncoding(d_model=384)
    net = UNet2DConditionModel(**json.load(open("models/musetalkV15/musetalk.json")))
    net.load_state_dict(load_file("models/musetalkV15/unet.fp16.safetensors"))
vae.vae = vae.vae.to(dev); vae.device = dev; net = net.to(dev, half); pe = pe.to(dev, half)
ap = AudioProcessor(feature_extractor_path="models/whisper")
whisper = WhisperModel.from_pretrained("models/whisper").to(dev, half).eval()
feats, length = ap.get_audio_feature(wav)
chunks = ap.get_whisper_chunk(feats, dev, half, whisper, length, fps=25, audio_padding_length_left=2, audio_padding_length_right=2)
x = torch.rand(2, 3, 256, 256, device=dev) * 2 - 1
with torch.no_grad():
    lat = vae.vae.encode(x).latent_dist.sample() * vae.scaling_factor
    lat = torch.cat([lat[:1], lat[1:]], 1)
    for wb, lb in datagen(chunks[:2], [lat, lat], batch_size=2, delay_frame=0, device=dev):
        pred = net(lb.to(dev, half), torch.tensor([0], device=dev), encoder_hidden_states=pe(wb.to(dev, half))).sample
        img = vae.decode_latents(pred.float())
        break
    seg = fp.net(torch.rand(1, 3, 512, 512, device=dev))[0]
assert len(img) and np.isfinite(np.asarray(img[0], dtype=np.float32)).all(), "the model produced no image"
print("SELFTEST ok", len(chunks), "audio frames,", tuple(pred.shape))
`;
import { ARCH, IS_MAC, IS_WINDOWS } from "@/platform/os";

async function speechSample(dir: string, signal: AbortSignal): Promise<{ wav: string; text: string }> {
	// Windows has no "say": the app carries a sample spoken on the Mac when it was built (build-win.sh).
	if (WINDOWS) return { wav: path.join(bundledBinDir() ?? "", "selftest-speech.wav"), text: "This is a short test of the voice." };
	const text = "This is a short test of the voice on this Mac.";
	const aiff = path.join(dir, "sample.aiff");
	const wav = path.join(dir, "sample.wav");
	const said = await run("/usr/bin/say", ["-o", aiff, text], { timeout: 60, signal });
	if (said.status !== 0 || !fs.existsSync(aiff)) throw new StudioError(`The self-test couldn't make a speech sample: ${reason(said)}`);
	const r = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", aiff, "-ac", "1", "-ar", "24000", wav], { timeout: 60, signal });
	if (r.status !== 0) throw new StudioError(`The self-test couldn't make a speech sample: ${reason(r)}`);
	return { wav, text };
}

async function selfTest(spec: ModelSpec, root: string, job: Job, signal: AbortSignal) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-selftest-"));
	try {
		const sample = await speechSample(dir, signal);
		const bin = bundledBinDir() ?? "";
		if (spec.id === "voice") {
			job.detail("check", "Saying a test sentence");
			const out = path.join(dir, "voice.wav");
			let error = "";
			const r = await run(
				pythonOf(spec, root),
				[path.join(bin, "local-tts.py"), "--home", root, "--ref", sample.wav, "--ref-text", sample.text, "--lang", "english", "--text", "Ready.", "--out", out],
				{
					timeout: 600,
					signal,
					onLine: (l) => {
						if (l.startsWith("ERROR ")) error = l.slice(6);
					},
				},
			);
			if (r.status !== 0 || !fs.existsSync(out) || fs.statSync(out).size < 8000) throw new StudioError(`The voice self-test failed: ${error || reason(r)}`);
		} else if (spec.id === "faceswap") {
			// The whole pipeline once: one made-up face onto a half-second clip of another (also compiles Core ML).
			job.detail("check", "Swapping a test face");
			const faces = path.join(process.cwd(), "public", "faces");
			const clip = path.join(dir, "face.mp4");
			const encoder = WINDOWS ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"] : ["-c:v", "h264_videotoolbox", "-b:v", "4M"];
			const made = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-loop", "1", "-i", path.join(faces, "hero.jpg"), "-t", "0.5", "-r", "10", "-vf", "scale=512:512,format=yuv420p", ...encoder, clip], { timeout: 60, signal });
			if (made.status !== 0) throw new StudioError(`The face swap self-test couldn't make its clip: ${reason(made)}`);
			const out = path.join(dir, "swapped.mp4");
			const args = ["-I", path.join(bin, "local-faceswap.py"), "--models", root, "--lipmarks", path.join(bin, LIPMARKS), "--ffmpeg", findTool("ffmpeg"), "--face", path.join(faces, "diva.jpg"), "--video", clip, "--out", out];
			let r = await run(pythonOf(spec, root), args, { timeout: 900, signal });
			if (r.status !== 0 || !fs.existsSync(out)) r = await run(pythonOf(spec, root), [...args, "--cpu"], { timeout: 900, signal });
			if (r.status !== 0 || !fs.existsSync(out)) throw new StudioError(`The face swap self-test failed: ${reason(r)}`);
		} else if (spec.id === "retouch") {
			// The whole retouch once, on a half-second clip of a made-up face (also compiles Core ML).
			job.detail("check", "Retouching a test face");
			const clip = path.join(dir, "face.mp4");
			const encoder = WINDOWS ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"] : ["-c:v", "h264_videotoolbox", "-b:v", "4M"];
			const made = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-loop", "1", "-i", path.join(process.cwd(), "public", "faces", "hero.jpg"), "-t", "0.5", "-r", "10", "-vf", "scale=512:512,format=yuv420p", ...encoder, clip], { timeout: 60, signal });
			if (made.status !== 0) throw new StudioError(`The retouch self-test couldn't make its clip: ${reason(made)}`);
			const out = path.join(dir, "retouched.mp4");
			const args = ["-I", path.join(bin, "local-faceswap.py"), "--models", root, "--lipmarks", path.join(bin, LIPMARKS), "--ffmpeg", findTool("ffmpeg"), "--look", "retouch", "--video", clip, "--out", out];
			let r = await run(pythonOf(spec, root), args, { timeout: 900, signal });
			if (r.status !== 0 || !fs.existsSync(out)) r = await run(pythonOf(spec, root), [...args, "--cpu"], { timeout: 900, signal });
			if (r.status !== 0 || !fs.existsSync(out)) throw new StudioError(`The retouch self-test failed: ${reason(r)}`);
		} else if (spec.id === "denoise") {
			// The downloaded program cleans the test sentence (it runs at all, the model loads, a WAV comes out).
			job.detail("check", "Cleaning a test sentence");
			const wav = path.join(dir, "speech48.wav");
			await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", sample.wav, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav], { timeout: 60, signal });
			const out = path.join(dir, "clean");
			fs.mkdirSync(out);
			const r = await run(path.join(root, WINDOWS ? "deep-filter.exe" : "deep-filter"), ["-m", path.join(root, "DeepFilterNet3_onnx.tar.gz"), "-D", "--pf", "-o", out, wav], { timeout: 300, signal });
			const clean = fs.readdirSync(out).find((f) => f.toLowerCase().endsWith(".wav"));
			if (r.status !== 0 || !clean || fs.statSync(path.join(out, clean)).size < 8000) throw new StudioError(`The Enhance voice self-test failed: ${reason(r)}`);
		} else if (spec.id === "separate" || spec.id === "separate-mlx" || spec.id === "voicechange") {
			// The helper on the test sentence, as the editor runs it (Separate: stereo 44.1 kHz; Voice changer: mono 22.05 kHz,
			// the sentence as its own target voice).
			const mlx = spec.id === "separate-mlx";
			const separate = spec.id === "separate" || mlx;
			job.detail("check", separate ? "Separating a test sentence" : "Changing a test sentence's voice");
			const input = path.join(dir, "in.f32");
			await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", sample.wav, "-ac", separate ? "2" : "1", "-ar", separate ? "44100" : "22050", "-f", "f32le", "-c:a", "pcm_f32le", input], { timeout: 60, signal });
			const outs = separate ? [path.join(dir, "voice.f32"), path.join(dir, "music.f32")] : [path.join(dir, "out.f32")];
			const args = separate
				? ["-I", path.join(bin, "local-separate.py"), ...(mlx ? ["--engine", "mlx", "--weights", root] : ["--models", root]), "--input", input, "--voice", outs[0], "--music", outs[1]]
				: ["-I", path.join(bin, "local-voicechange.py"), "--models", root, "--input", input, "--target", input, "--out", outs[0]];
			let error = "";
			const r = await run(pythonOf(spec, root), args, {
				timeout: 900,
				signal,
				onLine: (l) => {
					if (l.startsWith("ERROR ")) error = l.slice(6);
				},
			});
			const size = fs.statSync(input).size;
			if (r.status !== 0 || !outs.every((f) => fs.existsSync(f) && fs.statSync(f).size === size)) {
				throw new StudioError(`The ${separate ? "separation" : "voice changer"} self-test failed: ${error || reason(r)}`);
			}
		} else if (spec.id === "separate-beats") {
			// The authors' checkpoint → safetensors, once: read with weights_only by Separate's own Python (PyTorch), the
			// result checked against its pinned sha256; then the helper on the test sentence, as the editor runs it.
			job.detail("check", "Preparing the beat model");
			const python = pythonOf(specOf("separate"));
			const ckpt = path.join(root, "final0.ckpt");
			const weights = path.join(root, BEATS_WEIGHTS);
			if (!fs.existsSync(weights) || (await sha256File(weights)) !== BEATS_WEIGHTS_SHA256) {
				const made = await run(python, ["-I", path.join(bin, "local-beats-convert.py"), ckpt, weights], { timeout: 900, signal });
				if (made.status !== 0 || !fs.existsSync(weights) || (await sha256File(weights)) !== BEATS_WEIGHTS_SHA256) {
					fs.rmSync(weights, { force: true });
					throw new StudioError(`The beat model self-test failed: ${made.status !== 0 ? reason(made) : "the converted model is not the pinned one"}`);
				}
			}
			const input = path.join(dir, "in.f32");
			const out = path.join(dir, "beats.json");
			await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", sample.wav, "-ac", "1", "-ar", "22050", "-f", "f32le", "-c:a", "pcm_f32le", input], { timeout: 60, signal });
			let error = "";
			const r = await run(python, ["-I", path.join(bin, "local-beats.py"), "--weights", weights, "--site", sitePackagesOf(spec, root), "--input", input, "--out", out], {
				timeout: 900,
				signal,
				onLine: (l) => {
					if (l.startsWith("ERROR ")) error = l.slice(6);
				},
			});
			if (r.status !== 0 || !fs.existsSync(out)) throw new StudioError(`The beat model self-test failed: ${error || reason(r)}`);
			// Only the safetensors stays (a Repair fetches the checkpoint again, sha256-checked, and converts again).
			fs.rmSync(ckpt, { force: true });
		} else if (spec.id === "lipsync") {
			job.detail("check", "Running one lipsync step on the GPU");
			const wav16 = path.join(dir, "sample16k.wav");
			await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", sample.wav, "-ac", "1", "-ar", "16000", wav16], { timeout: 60, signal });
			const r = await run(pythonOf(spec, root), ["-I", "-c", LIPSYNC_SELFTEST, root, wav16], { timeout: 600, signal });
			if (r.status !== 0 || !r.stdout.includes("SELFTEST ok")) throw new StudioError(`The lipsync self-test failed: ${reason(r)}`);
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// ───────────────────────── Install / Repair ─────────────────────────

/** Whether the internet can be reached from here (one of the download hosts answers). */
export async function online(): Promise<boolean> {
	// All at once, 4 s at most (one after another it took up to 24 s before a dead network was said — craft B).
	const probe = async (url: string) => {
		const res = await fetch(routed(url), { method: "HEAD", signal: AbortSignal.timeout(4000) });
		if (res.status >= 500) throw new Error(String(res.status));
	};
	return Promise.any(["https://huggingface.co/api/whoami-v2", "https://pypi.org/simple/", "https://hf-mirror.com"].map(probe)).then(
		() => true,
		() => false,
	);
}

/** Free bytes of the volume `dir` is on (the models' folder: supportDir()); unknown counts as plenty. */
export function freeBytes(dir: string): number {
	try {
		const st = fs.statfsSync(dir);
		return st.bavail * st.bsize;
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

/**
 * The feature whose install a feature is: the ready-made voices were a feature of their own before they became the voice
 * model speaking from recordings (one model for every voice): an older page or agent asking for them gets the voice.
 */
function owner(id: string): string {
	return id === "voices" ? "voice" : id;
}

/**
 * Starts the install (or Repair when `repair`): checks first, then a job with stages, progress and cancel.
 * `background`: the quiet queue's download (background.ts) — it gives way to the user's work through `pace` and
 * Settings shows it as one line; a feature asking for the same model meanwhile makes it urgent (full speed, no pauses).
 */
export async function startInstall(id: string, { repair = false, background = false, pace = {} }: { repair?: boolean; background?: boolean; pace?: DownloadPace } = {}): Promise<JobState> {
	const spec = modelSpec(owner(id));
	if (!spec) throw new StudioError("Unknown on-device feature");
	const running = jobs.get(spec.id);
	const current = running ? getJob(running) : null;
	if (current?.status === "running") {
		if (!background) urgent.add(spec.id);
		return current;
	}
	urgent.delete(spec.id);
	const why = unsupported(spec);
	if (why) throw new StudioError(why);
	const root = spec.root();
	const parent = path.dirname(root);
	fs.mkdirSync(parent, { recursive: true });
	// The model is here and only add-on files are missing (ModelFile.optional): this job brings just those, in place.
	const addons = !repair && isInstalled(spec) ? missingAddons(spec, root) : [];
	if (addons.length) return startAddons(spec, addons, root, { background, pace });
	const inPlace = repair && isInstalled(spec);
	const bundled = isBundled(spec);
	const need = installBytes(spec, inPlace);
	const free = freeBytes(parent);
	if (free < need) throw new StudioError(`Not enough disk space: needs ${GB(need)}, ${WINDOWS ? "this PC" : "this Mac"} has ${GB(free)} free.`);
	if (!bundled && !(await online())) throw new StudioError("No internet connection.");

	const work = spec.id === "whisper" || inPlace ? root : partial(spec);
	const fileBytes = spec.files.reduce((s, f) => s + f.size, 0);
	const stages = [
		...(spec.python ? [{ id: "runtime", title: "Setting up the runtime", timeout: 3600 }] : []),
		// A background download waits out every export and AI run: its time limit is a day, not six hours.
		{ id: "files", title: inPlace ? "Checking the model files" : bundled ? "Preparing the model" : `Downloading the model (${GB(fileBytes)})`, timeout: (background ? 24 : 6) * 3600 },
		...(spec.python || spec.id === "denoise" ? [{ id: "check", title: "Self-test", timeout: 900 }] : []),
	];
	// The pace stops applying the moment a feature asks for this very model (it then waits for it in its own progress).
	const cap = typeof pace.rate === "function" ? pace.rate : () => pace.rate as number | undefined;
	// A feature waits for it (asked by one, or a feature took the background download over): a dead host is said in seconds.
	const paced: DownloadPace = background
		? { pause: () => (urgent.has(spec.id) ? null : (pace.pause?.() ?? null)), rate: () => (urgent.has(spec.id) ? undefined : cap()), quick: () => urgent.has(spec.id) }
		: { quick: () => true };
	works.set(spec.id, { dir: work, temp: work !== root, files: spec.files });
	const job = startJob(`ondevice-${spec.id}`, stages, async (job) => {
		fs.mkdirSync(work, { recursive: true });
		if (bundled && spec.python) {
			seedRuntime();
			// Copied out of a downloaded app, Python and its libraries carry the quarantine flag: macOS would refuse to run them.
			await clearQuarantine(path.dirname(modelDirs.python()));
		}
		if (spec.python) await job.step("runtime", (signal) => setUpPython(spec, work, job, signal, inPlace, bundled));
		if (bundled) seedFiles(spec, work);
		await job.step("files", (signal) => fetchFiles(spec, work, job, signal, inPlace, paced));
		// Before the self-test runs anything from them (wheels cloned from the app keep the flag too).
		await clearQuarantine(work);
		await clearQuarantine(path.dirname(modelDirs.python()));
		if (spec.python || spec.id === "denoise") await job.step("check", (signal) => selfTest(spec, work, job, signal));
		if (work !== root) {
			// Atomic switch: the old (broken or older) folder goes aside first, then the tested one takes its place.
			const aside = `${root}.old-${Date.now()}`;
			if (fs.existsSync(root)) fs.renameSync(root, aside);
			fs.renameSync(work, root);
			fs.rmSync(aside, { recursive: true, force: true });
		}
		if (spec.id !== "whisper") fs.writeFileSync(marker(root), JSON.stringify({ fingerprint: fingerprint(spec), at: new Date().toISOString() }));
		// uv's cache (the downloaded wheels) goes once no other install needs it. Windows keeps it: the environments are
		// hard links into it, so the next model reuses PyTorch instead of downloading and storing it again.
		const others = [...jobs.entries()].some(([other, jobId]) => other !== spec.id && getJob(jobId)?.status === "running");
		if (!others && !WINDOWS) fs.rmSync(modelDirs.uvCache(), { recursive: true, force: true });
		return { installed: true };
	});
	jobs.set(spec.id, job.id);
	if (background) backgroundJobs.add(job.id);
	return job;
}

/** The add-on files of an installed model: a small download in place, no set-up, no self-test, the model keeps working meanwhile. */
async function startAddons(spec: ModelSpec, addons: ModelFile[], root: string, { background, pace }: { background: boolean; pace: DownloadPace }): Promise<JobState> {
	const bytes = addons.reduce((s, f) => s + f.size, 0);
	const free = freeBytes(path.dirname(root));
	if (free < bytes * 1.05) throw new StudioError(`Not enough disk space: needs ${MB(bytes)}, ${WINDOWS ? "this PC" : "this Mac"} has ${MB(free)} free.`);
	if (!(await online())) throw new StudioError("No internet connection.");
	const cap = typeof pace.rate === "function" ? pace.rate : () => pace.rate as number | undefined;
	// A feature waits for it (asked by one, or a feature took the background download over): a dead host is said in seconds.
	const paced: DownloadPace = background
		? { pause: () => (urgent.has(spec.id) ? null : (pace.pause?.() ?? null)), rate: () => (urgent.has(spec.id) ? undefined : cap()), quick: () => urgent.has(spec.id) }
		: { quick: () => true };
	works.set(spec.id, { dir: root, temp: false, files: addons });
	const job = startJob(`ondevice-${spec.id}`, [{ id: "files", title: `Downloading the model (${MB(bytes)})`, timeout: (background ? 24 : 6) * 3600 }], async (job) => {
		fs.mkdirSync(root, { recursive: true });
		await job.step("files", (signal) => fetchFiles(spec, root, job, signal, false, paced, addons));
		return { installed: true };
	});
	jobs.set(spec.id, job.id);
	if (background) backgroundJobs.add(job.id);
	return job;
}

/** Where each install writes while it runs: what a cancel takes away (CRAFT.md §6 — cancel leaves nothing behind). */
const works = new Map<string, { dir: string; temp: boolean; files: ModelFile[] }>();

/** The user's cancel: the job stops, then its partial files go (a crash keeps them: Retry resumes from them). */
export function cancelInstall(id: string): boolean {
	const key = owner(id);
	const jobId = jobs.get(key as ModelId);
	const stopped = jobId ? cancelJob(jobId) : false;
	const work = works.get(key);
	if (stopped && work) {
		const sweep = () => {
			for (const f of work.files) fs.rmSync(`${path.join(work.dir, f.dest)}.part`, { force: true });
			if (work.temp) fs.rmSync(work.dir, { recursive: true, force: true });
		};
		// Once the stream let go of the file (the job leaves «running» within moments), and once more to be sure.
		const until = Date.now() + 10_000;
		const tick = () => {
			if (getJob(jobId as string)?.status === "running" && Date.now() < until) return void setTimeout(tick, 100);
			sweep();
			setTimeout(sweep, 500);
		};
		tick();
	}
	return stopped;
}

/** Deletes what the install put on disk (the model files and its Python environment, finished or not). */
export function removeModel(id: string) {
	const spec = modelSpec(owner(id));
	if (!spec) throw new StudioError("Unknown on-device feature");
	const jobId = jobs.get(spec.id);
	if (jobId && getJob(jobId)?.status === "running") throw new StudioError("Cancel the download first.");
	// Its parts live inside its folder and leave with it; one that is downloading right now stops first.
	for (const part of partsOf(spec.id)) cancelInstall(part.id);
	if (spec.id === "whisper") {
		for (const f of spec.files) {
			const p = path.join(spec.root(), f.dest);
			fs.rmSync(p, { force: true });
			fs.rmSync(`${p}.part`, { force: true });
		}
		return;
	}
	fs.rmSync(spec.root(), { recursive: true, force: true });
	fs.rmSync(partial(spec), { recursive: true, force: true });
}

// Leftovers of earlier versions' models leave the disk, once per launch, a little after start (Mac).
schedulePrune((text) => console.log(text));
