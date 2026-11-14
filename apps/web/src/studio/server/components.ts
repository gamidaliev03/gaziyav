// The two big helpers fetched the first time they are needed instead of carried inside the app (1.0.72: the app went
// from 1.4 GB toward 600 MB): the headless Chrome that renders motion graphics into an export (≈ 300 MB) and yt-dlp
// for imports by link (≈ 46 MB). Each comes from its maker's own address in the exact version the app is built and
// in Application Support/Gaziyav/Tools/<id>/<version>. A copy built into the app (a development build) is used as is.
import fs from "node:fs";
import path from "node:path";
import { downloadFile } from "@/ondevice/download";
import { resourcesDir, supportDir } from "@/platform/paths";
import { StudioError } from "./errors";
import { findTool, run } from "./tools";

export type ComponentId = "chrome" | "yt-dlp";

interface Spec {
	/** What the user is told is being fetched. */
	label: string;
	version: string;
	url: string;
	sha256: string;
	size: number;
	/** The program inside the unpacked archive. */
	exe: string;
}

const ARM = process.arch === "arm64";
const CHROME = "157.0.8080.0";
const YTDLP = "2026.08.19";

const SPECS: Record<ComponentId, Spec> = {
	// Remotion's own build for Apple silicon (what its renderer is tested with), Google's Chrome for Testing for Intel.
	chrome: ARM
		? {
				label: "the motion graphics renderer",
				version: CHROME,
				url: `https://remotion.media/chromium-headless-shell-mac-arm64-${CHROME}.zip?clear`,
				sha256: "3d9fd9a997915fa295ba6fbd66b2eaad2b9578101aa9dcde5e2eb737afa4f459",
				size: 179_230_663,
				exe: "chrome-headless-shell-mac-arm64/chrome-headless-shell",
			}
		: {
				label: "the motion graphics renderer",
				version: CHROME,
				url: `https://storage.googleapis.com/chrome-for-testing-public/${CHROME}/mac-x64/chrome-headless-shell-mac-x64.zip`,
				sha256: "b4a3f7e8aed11e7814fdaf49ddadab0ec3e0c7527f0ffeed5b208d7a856ebf6a",
				size: 109_113_968,
				exe: "chrome-headless-shell-mac-x64/chrome-headless-shell",
			},
	// The one-folder build (starts in 0.3 s); newer releases still come through ytdlp-update.ts, signature-checked.
	"yt-dlp": {
		label: "the link downloader",
		version: YTDLP,
		url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP}/yt-dlp_macos.zip`,
		sha256: "07e54b0865303c864006925913bce2604f8ee8cc6f18699bac9c309f9328a6d8",
		size: 53_923_637,
		exe: "yt-dlp_macos",
	},
};

const home = (id: ComponentId) => path.join(supportDir(), "Tools", id === "chrome" ? "chrome-headless-shell" : "yt-dlp-base", SPECS[id].version);
const MARK = ".ok";

/** A copy built into the app (a development build or an older one): used as it is, nothing is fetched. */
function builtIn(id: ComponentId): string | null {
	if (id === "yt-dlp") {
		try {
			return findTool("yt-dlp");
		} catch {
			return null;
		}
	}
	const res = resourcesDir();
	const platform = ARM ? "mac-arm64" : "mac-x64";
	const exe = res && path.join(res, "remotion", "chrome-headless-shell", platform, `chrome-headless-shell-${platform}`, "chrome-headless-shell");
	return exe && fs.existsSync(exe) ? exe : null;
}

/** The installed program, or null (never fetched, or a fetch that didn't finish). */
export function installedComponent(id: ComponentId): string | null {
	const dir = home(id);
	const exe = path.join(dir, SPECS[id].exe);
	return fs.existsSync(path.join(dir, MARK)) && fs.existsSync(exe) ? exe : null;
}

export interface ComponentStatus {
	id: ComponentId;
	label: string;
	size: number;
	state: "missing" | "downloading" | "ready" | "failed";
	/** 0…1 while downloading. */
	progress: number;
	error?: string;
}

const fetching = new Map<ComponentId, Promise<string>>();
const progressOf = new Map<ComponentId, number>();
const failures = new Map<ComponentId, string>();
const listeners = new Map<ComponentId, Set<(fraction: number) => void>>();

export function componentStatus(id: ComponentId): ComponentStatus {
	const spec = SPECS[id];
	const base = { id, label: spec.label, size: spec.size, progress: progressOf.get(id) ?? 0 };
	if (builtIn(id) || installedComponent(id)) return { ...base, state: "ready", progress: 1 };
	if (fetching.has(id)) return { ...base, state: "downloading" };
	const error = failures.get(id);
	return error ? { ...base, state: "failed", error } : { ...base, state: "missing" };
}

/**
 * The program, fetched first when it isn't here. Everyone asking meanwhile shares the one download; each gets the
 * progress (0…1). A failed or cancelled fetch leaves nothing half-installed, and the next ask starts it again.
 */
export function ensureComponent(id: ComponentId, onProgress?: (fraction: number) => void): Promise<string> {
	const ready = builtIn(id) ?? installedComponent(id);
	if (ready) return Promise.resolve(ready);
	if (onProgress) {
		const set = listeners.get(id) ?? new Set();
		set.add(onProgress);
		listeners.set(id, set);
	}
	let job = fetching.get(id);
	if (!job) {
		failures.delete(id);
		job = install(id)
			.catch((error: unknown) => {
				failures.set(id, error instanceof Error ? error.message : String(error));
				throw error;
			})
			.finally(() => {
				fetching.delete(id);
				listeners.delete(id);
			});
		fetching.set(id, job);
	}
	return job;
}

async function install(id: ComponentId): Promise<string> {
	const spec = SPECS[id];
	const dir = home(id);
	const zip = `${dir}.zip`;
	const unpack = `${dir}.unpack`;
	progressOf.set(id, 0);
	const tell = (bytes: number) => {
		const fraction = Math.min(1, bytes / spec.size);
		progressOf.set(id, fraction);
		for (const listener of listeners.get(id) ?? []) listener(fraction);
	};
	try {
		await downloadFile(spec.url, zip, spec.size, spec.sha256, AbortSignal.timeout(60 * 60_000), tell, { name: spec.label });
		fs.rmSync(unpack, { recursive: true, force: true });
		fs.mkdirSync(unpack, { recursive: true });
		const r = await run("/usr/bin/ditto", ["-x", "-k", zip, unpack], { timeout: 600 });
		if (r.status !== 0) throw new StudioError(`Couldn't unpack ${spec.label}: ${r.stderr.slice(-200)}`);
		const exe = path.join(unpack, spec.exe);
		if (!fs.existsSync(exe)) throw new StudioError(`${spec.label} came without its program. Try again.`);
		fs.chmodSync(exe, 0o755);
		fs.writeFileSync(path.join(unpack, MARK), spec.sha256);
		fs.rmSync(dir, { recursive: true, force: true });
		fs.renameSync(unpack, dir);
		return path.join(dir, spec.exe);
	} catch (error) {
		fs.rmSync(unpack, { recursive: true, force: true });
		if (error instanceof StudioError) throw error;
		throw new StudioError(`Couldn't get ${spec.label}: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		fs.rmSync(zip, { force: true });
	}
}
