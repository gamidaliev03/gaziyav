// Where Claude's production data lives on the server: material briefs (by content key, shared by every project),
// the taste profile, each project's plan / review / provenance record, and the uploaded sources the analysis reads.
// Plus the «quiet» switch: the window says when it plays or exports, and every analysis process stands still then.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/studio/server/files";
import { findTool } from "@/studio/server/tools";
import { BRIEF_VERSION, type MaterialBrief } from "../material";
import { DEFAULT_TASTE, normalizeTaste, type TasteProfile } from "../taste";

export function prodDir(...parts: string[]): string {
	const dir = path.join(dataDir(), "production", ...parts);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

const safeKey = (key: string) => key.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);

function readJson<T>(file: string): T | null {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch {
		return null;
	}
}

function writeJson(file: string, data: unknown) {
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data));
	fs.renameSync(tmp, file);
}

// ───────────────────────── briefs ─────────────────────────

export function readBrief(key: string): MaterialBrief | null {
	const b = readJson<MaterialBrief>(path.join(prodDir("briefs"), `${safeKey(key)}.json`));
	return b && b.version === BRIEF_VERSION ? b : null;
}

export function writeBrief(brief: MaterialBrief) {
	writeJson(path.join(prodDir("briefs"), `${safeKey(brief.key)}.json`), brief);
}

// ───────────────────────── uploads (the source files the analysis and the sound check read) ─────────────────────────

interface SourceIndex {
	[key: string]: { path: string; at: number };
}

const sourcesFile = () => path.join(prodDir(), "sources.json");

export function sourcePath(key: string): string | null {
	const entry = (readJson<SourceIndex>(sourcesFile()) ?? {})[key];
	return entry?.path && fs.existsSync(entry.path) ? entry.path : null;
}

export function noteSource(key: string, file: string) {
	const index = readJson<SourceIndex>(sourcesFile()) ?? {};
	index[key] = { path: file, at: Date.now() };
	// The newest 300 only (the files themselves are the studio's temporary files, cleaned after two days).
	const kept = Object.entries(index)
		.filter(([, v]) => fs.existsSync(v.path))
		.sort((a, b) => b[1].at - a[1].at)
		.slice(0, 300);
	writeJson(sourcesFile(), Object.fromEntries(kept));
}

/** Where an uploaded source goes: its own folder under production/sources, kept while it is used. */
export function sourceSlot(key: string, name: string): string {
	const dir = prodDir("sources", safeKey(key));
	const base = path.basename(name || "media").replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(-100) || "media";
	return path.join(dir, base);
}

/** Sources not used for 3 days go (their briefs stay). */
export function pruneSources(now = Date.now()) {
	const index = readJson<SourceIndex>(sourcesFile()) ?? {};
	const own = `${prodDir("sources")}${path.sep}`;
	let changed = false;
	for (const [key, v] of Object.entries(index)) {
		if (now - v.at > 3 * 86400_000) {
			// only an upload's own folder is ever removed — never a folder outside production/sources (a user's file)
			if (typeof v.path === "string" && path.resolve(v.path).startsWith(own)) fs.rmSync(path.dirname(v.path), { recursive: true, force: true });
			delete index[key];
			changed = true;
		}
	}
	if (changed) writeJson(sourcesFile(), index);
}

// ───────────────────────── the taste profile ─────────────────────────

export function readTaste(): TasteProfile {
	return normalizeTaste(readJson(path.join(prodDir(), "taste.json")) ?? DEFAULT_TASTE);
}

export function writeTaste(t: TasteProfile) {
	writeJson(path.join(prodDir(), "taste.json"), t);
}

// ───────────────────────── a project's record ─────────────────────────

export interface ProjectRecord {
	plan?: unknown;
	/** The last review: score, the hard checks that failed, when, and on which state of the timeline. */
	review?: { score: number; hardFailed: string[]; at: number; stamp: string };
	waived: string[];
	/** Pieces from outside: YouTube excerpts (may be claimed when posted), web pictures, generated shots. */
	provenance: Array<{ media: string; name: string; from: "youtube" | "web" | "generated" | "library"; source?: string; at: number }>;
	/** Elements apply_plan made, by role, with the style they were made in (the profile learns from changes). */
	made?: { stamp: string; roles: Record<string, string[]>; style: Record<string, string | number> };
}

export function readProject(id: string): ProjectRecord {
	return { waived: [], provenance: [], ...(readJson<ProjectRecord>(path.join(prodDir("projects"), `${safeKey(id)}.json`)) ?? {}) };
}

export function writeProject(id: string, record: ProjectRecord) {
	writeJson(path.join(prodDir("projects"), `${safeKey(id)}.json`), record);
}

// ───────────────────────── quiet: nothing runs while the user plays or exports ─────────────────────────

const quiet = { playing: false, exporting: false, until: 0 };
const running = new Set<number>();

export const isQuiet = () => quiet.playing || quiet.exporting || Date.now() < quiet.until;

/** The window's state; analysis processes stop (SIGSTOP) while it plays or exports and go on after. */
export function setQuiet(state: { playing?: boolean; exporting?: boolean }) {
	if (typeof state.playing === "boolean") quiet.playing = state.playing;
	if (typeof state.exporting === "boolean") quiet.exporting = state.exporting;
	const q = isQuiet();
	for (const pid of running) {
		try {
			process.kill(-pid, q ? "SIGSTOP" : "SIGCONT");
		} catch {}
	}
}

export async function waitQuiet(signal?: AbortSignal) {
	while (isQuiet()) {
		if (signal?.aborted) throw new Error("Cancelled");
		await new Promise((r) => setTimeout(r, 300));
	}
}

export interface Ran {
	status: number;
	stdout: Buffer;
	stderr: string;
}

/**
 * A tool run for the analysis: low priority (nice 10), its own process group (stopped and continued as a whole while
 * the window plays or exports), stdout as bytes (raw samples) and stderr as text (ffmpeg's reports).
 */
export function runQuiet(tool: string, args: string[], { timeout = 600, signal }: { timeout?: number; signal?: AbortSignal } = {}): Promise<Ran> {
	return new Promise((resolve, reject) => {
		const bin = tool.includes("/") ? tool : findTool(tool);
		const child = spawn("/usr/bin/nice", ["-n", "10", bin, ...args], { stdio: ["ignore", "pipe", "pipe"], detached: true });
		const out: Buffer[] = [];
		let err = "";
		let ran = 0;
		let last = Date.now();
		if (child.pid) running.add(child.pid);
		if (child.pid && isQuiet()) {
			try {
				process.kill(-child.pid, "SIGSTOP");
			} catch {}
		}
		// The time limit counts only the time it ran (a long playback doesn't fail it).
		const tick = setInterval(() => {
			const now = Date.now();
			if (!isQuiet()) ran += now - last;
			last = now;
			if (ran > timeout * 1000) {
				try {
					process.kill(-(child.pid ?? 0), "SIGKILL");
				} catch {}
			}
		}, 500);
		const abort = () => {
			try {
				process.kill(-(child.pid ?? 0), "SIGKILL");
			} catch {}
		};
		signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (d: Buffer) => out.push(d));
		child.stderr.on("data", (d: Buffer) => {
			err += d.toString();
			if (err.length > 400_000) err = err.slice(-200_000);
		});
		child.on("error", (e) => {
			clearInterval(tick);
			if (child.pid) running.delete(child.pid);
			reject(e);
		});
		child.on("close", (code) => {
			clearInterval(tick);
			signal?.removeEventListener("abort", abort);
			if (child.pid) running.delete(child.pid);
			resolve({ status: code ?? 1, stdout: Buffer.concat(out), stderr: err });
		});
	});
}
