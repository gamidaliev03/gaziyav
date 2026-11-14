// Where the app keeps things on this Mac. Everything the app writes lives in ONE folder,
// ~/Library/Application Support/Gaziyav (the shell passes it as STUDIO_SUPPORT_DIR = Electron's userData).
// Tools ship inside the app (Resources/bin, Resources/remotion). The packaged app never looks at Homebrew,
// ~/.local or other apps' folders; those fallbacks exist only for a development server (no STUDIO_BIN_DIR).
import os from "node:os";
import path from "node:path";
import { IS_WINDOWS } from "./os";

export const APP_FOLDER = "Gaziyav";

/** ~/Library/Application Support/Gaziyav (or STUDIO_SUPPORT_DIR, or the parent of STUDIO_DATA_DIR). */
export function supportDir(): string {
	if (process.env.STUDIO_SUPPORT_DIR) return process.env.STUDIO_SUPPORT_DIR;
	if (process.env.STUDIO_DATA_DIR) return path.dirname(process.env.STUDIO_DATA_DIR);
	if (IS_WINDOWS) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), APP_FOLDER);
	return path.join(os.homedir(), "Library", "Application Support", APP_FOLDER);
}

/**
 * Where the on-device models and their Python runtimes live: STUDIO_MODELS_DIR (the shell sets it while the encrypted
 * work space is open: models are public weights with absolute paths inside, so they stay outside the volume), else the
 * support folder.
 */
export function modelsDir(): string {
	return process.env.STUDIO_MODELS_DIR || supportDir();
}

/** The app's Resources/bin, or null for a development server. */
export function bundledBinDir(): string | null {
	return process.env.STUDIO_BIN_DIR || null;
}

/** The face-landmark helper in the app's bin: Apple Vision on a Mac, MediaPipe (run by the model's Python) on Windows. */
export const LIPMARKS = IS_WINDOWS ? "lipmarks.py" : "lipmarks";

/** The app's Resources folder, or null for a development server. */
export function resourcesDir(): string | null {
	const bin = bundledBinDir();
	return bin ? path.dirname(bin) : null;
}

/** Running inside the packaged app: only bundled tools and the app's own folder are used. */
export function isPackaged(): boolean {
	return !!process.env.STUDIO_BIN_DIR;
}

/** On-device models and their Python runtimes (sub-folders of the models folder, modelsDir()). */
export const modelDirs = {
	whisper: () => path.join(modelsDir(), "Models"),
	lipsync: () => path.join(modelsDir(), "LocalLipsync", "musetalk"),
	voice: () => path.join(modelsDir(), "LocalTTS"),
	/** Ready-made voices (text to speech with preset characters). */
	voices: () => path.join(modelsDir(), "LocalVoices"),
	/** Face swap (a new face on a person in a clip). */
	faceswap: () => path.join(modelsDir(), "LocalFaceSwap"),
	cleanup: () => path.join(modelsDir(), "LocalCleanup"),
	/** Enhance voice: speech without noise and room (Audio → Enhance voice). */
	denoise: () => path.join(modelsDir(), "LocalDenoise"),
	/** Separate voice and music (Audio → Separate). */
	separate: () => path.join(modelsDir(), "LocalSeparate"),
	/** Voice changer: the clip's speech in another voice (Audio → Voice changer). */
	voicechange: () => path.join(modelsDir(), "LocalVoiceChange"),
	/** Face retouch (Video → Retouch → Face) when Face swap, which carries the same models, isn't installed. */
	retouch: () => path.join(modelsDir(), "LocalRetouch"),
	/** Claude's hearing models: sound ↔ words (CLAP) and the AudioSet tagger (studio/server/hear-models.ts). */
	hear: () => path.join(modelsDir(), "LocalHearing"),
	/** uv-managed standalone Python builds shared by the model environments. */
	python: () => path.join(modelsDir(), "Runtime", "python"),
	uvCache: () => path.join(modelsDir(), "Runtime", "uv-cache"),
};

/**
 * Node for helper scripts and yt-dlp's YouTube challenge solver: the app's own runtime (Electron runs as Node
 * with ELECTRON_RUN_AS_NODE=1), so no Node install is needed. Null for a development server.
 */
export function appNode(): { bin: string; env: string[] } | null {
	if (!isPackaged()) return null;
	return { bin: process.execPath, env: ["ELECTRON_RUN_AS_NODE=1"] };
}

/** yt-dlp as a command: no user config, its cache inside the app's folder, the app's Node for YouTube. */
export function ytdlpCommand(ytdlp: string, args: string[]): { bin: string; argv: string[] } {
	const node = appNode();
	const own = ["--ignore-config", "--cache-dir", path.join(supportDir(), "Cache", "yt-dlp")];
	// keeps current — never `--proxy <url>`: a command line is readable by every account on the Mac (`ps`), and the URL
	// carries the local proxy's password (yt-dlp would also copy it onto ffmpeg's command line as -http_proxy).
	if (!node) return { bin: ytdlp, argv: [...own, ...args] };
	return { bin: "/usr/bin/env", argv: [...node.env, ytdlp, ...own, "--js-runtimes", `node:${node.bin}`, ...args] };
}
