// The hearing models on this Mac (on-device feature "hear", ondevice/manifest.ts): CLAP (LAION larger_clap_general,
// ONNX by Xenova) puts sound and words in one space, so Claude can ask about any sound in plain words; the AudioSet
// tagger (MIT AST, ONNX by Xenova) names what is heard (527 everyday labels: speech, applause, rain, piano, sad
// music…). Both run in a helper process (hear-helper-script.ts) started with the app's own runtime at low priority, on
// two threads — never in this server, which must keep answering the editor. Results are cached per file and window
// next to the file's analysis (Studio/hearing/<key>.ai.json), so a stretch is heard by the models once.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { isDeclined } from "@/ondevice/background";
import { downloadBytes, modelSpec } from "@/ondevice/manifest";
import { ondeviceStatus } from "@/ondevice/server";
import { appNode, modelDirs } from "@/platform/paths";
import { CancelledError, StudioError } from "./errors";
import { dataDir } from "./files";
import { HEAR_HELPER_SCRIPT } from "./hear-helper-script";
import { findTool } from "./tools";

export const CLAP_REPO = "Xenova/larger_clap_general";
export const TAGGER_REPO = "Xenova/ast-finetuned-audioset-10-10-0.4593";
/** Bump when what the helper returns changes: older cached windows (and the label bank) are heard again. */
const CACHE_VERSION = "2";
/** The helper quits after this long without a request (its ~0.9 GB go with it); self-tests may shorten it. */
const IDLE_MS = (process.env.STUDIO_TEST === "1" && Number(process.env.STUDIO_TEST_HEAR_IDLE) > 0 ? Number(process.env.STUDIO_TEST_HEAR_IDLE) : 120) * 1000;
/** ONNX Runtime threads: two of the Mac's cores at most, so playback and the editor stay smooth. */
const THREADS = 2;

// ───────────────────────── is the model here? ─────────────────────────

export type HearModelState =
	| { state: "ready" }
	| { state: "missing" | "downloading" | "removed" | "unavailable"; mb: number; progress?: number; why?: string };

const box = globalThis as typeof globalThis & { __hearHelper?: Helper | null; __hearFatal?: string; __hearModels?: Map<string, FileModels>; __hearText?: Map<string, Float32Array>; __hearBank?: Bank | null };

/** The transformers.js the app carries (Next's standalone output keeps it under node_modules), or null. */
let entryCache: string | null | undefined;
export function runtimeEntry(): string | null {
	if (entryCache !== undefined) return entryCache;
	entryCache = null;
	let dir = process.cwd();
	for (let i = 0; i < 8; i++) {
		const candidates = [path.join(dir, "node_modules", "@huggingface", "transformers")];
		try {
			for (const n of fs.readdirSync(path.join(dir, "node_modules", ".bun"))) if (n.startsWith("@huggingface+transformers@")) candidates.push(path.join(dir, "node_modules", ".bun", n, "node_modules", "@huggingface", "transformers"));
		} catch {}
		for (const c of candidates) {
			const f = path.join(c, "dist", "transformers.node.mjs");
			if (fs.existsSync(f)) return (entryCache = fs.realpathSync(f));
		}
		const up = path.dirname(dir);
		if (up === dir) break;
		dir = up;
	}
	return entryCache;
}

/**
 * Never run: this import is what makes Next's file tracing carry transformers.js and ONNX Runtime into the app (the
 * helper process loads them from there by path).
 */
export const traceRuntime = () => import("@huggingface/transformers");

/** Where the hearing model stands: ready, downloading (with progress), not here yet, removed by the user, or can't run. */
export function hearModelState(): HearModelState {
	const spec = modelSpec("hear");
	if (!spec) return { state: "unavailable", mb: 0, why: "not in this build of the app" };
	const mb = Math.round(downloadBytes(spec) / 1e6);
	if (!runtimeEntry()) return { state: "unavailable", mb, why: "this build of the app doesn't carry the hearing runtime" };
	if (box.__hearFatal) return { state: "unavailable", mb, why: box.__hearFatal };
	const st = ondeviceStatus().find((m) => m.id === "hear");
	if (st?.installed) return { state: "ready" };
	if (st?.unsupported) return { state: "unavailable", mb, why: st.unsupported };
	const job = st?.job;
	if (job?.status === "running") {
		const running = job.stages.find((s) => s.status === "running");
		const done = job.stages.filter((s) => s.status === "done" || s.status === "skipped").length;
		return { state: "downloading", mb, progress: Math.min(1, (done + (running?.progress ?? 0)) / Math.max(1, job.stages.length)) };
	}
	if (isDeclined("hear")) return { state: "removed", mb };
	return { state: "missing", mb, ...(job?.status === "failed" && job.error ? { why: job.error } : {}) };
}

/** The plain-words note a tool result carries while the model isn't here (null when it is). */
export function modelNote(s: HearModelState): string | null {
	if (s.state === "ready") return null;
	const any = "questions in any words and names for the sounds come with Claude's hearing model";
	if (s.state === "downloading") return `${any} (${s.mb} MB): downloading now, ${Math.round((s.progress ?? 0) * 100)}% — until then from the signal measurements`;
	if (s.state === "missing") return `${any} (${s.mb} MB, not on this Mac yet: its download starts now${s.why ? `; the last try failed: ${s.why}` : ""}) — until then from the signal measurements`;
	if (s.state === "removed") return `${any}, which was removed in Settings → Services (download it there again) — this is from the signal measurements`;
	return `${any}, which can't run here (${s.why}) — this is from the signal measurements`;
}

// ───────────────────────── the helper process ─────────────────────────

interface Pending {
	req: Record<string, unknown>;
	signal?: AbortSignal;
	resolve: (v: Record<string, unknown>) => void;
	reject: (e: Error) => void;
	onProgress?: (f: number) => void;
}
interface Helper {
	child: ChildProcessWithoutNullStreams;
	pending: Map<number, Pending>;
	next: number;
	stderr: string[];
	/** It said goodbye (idle): it takes no more requests; one already on its way goes to a new helper. */
	bye: boolean;
}

/** The app's own runtime (Electron as Node) in the app; Node in development and tests. */
function runtime(): { bin: string; env: Record<string, string> } {
	if (process.env.STUDIO_NODE && fs.existsSync(process.env.STUDIO_NODE)) return { bin: process.env.STUDIO_NODE, env: {} };
	const own = appNode();
	if (own) return { bin: own.bin, env: { ELECTRON_RUN_AS_NODE: "1" } };
	if (!process.versions.bun) return { bin: process.execPath, env: {} };
	for (const p of [path.join(os.homedir(), ".local", "node", "bin", "node"), "/opt/homebrew/bin/node", "/usr/local/bin/node"]) if (fs.existsSync(p)) return { bin: p, env: {} };
	return { bin: process.execPath, env: {} };
}

function helper(): Helper {
	const live = box.__hearHelper;
	if (live && !live.bye && live.child.exitCode === null && live.child.signalCode === null) return live;
	const entry = runtimeEntry();
	if (!entry) throw new StudioError("This build of the app doesn't carry the hearing runtime.");
	const hash = crypto.createHash("sha256").update(HEAR_HELPER_SCRIPT).digest("hex").slice(0, 10);
	const script = path.join(dataDir(), `hear-helper-${hash}.mjs`);
	if (!fs.existsSync(script)) fs.writeFileSync(script, HEAR_HELPER_SCRIPT);
	const node = runtime();
	const cfg = { transformers: entry, models: modelDirs.hear(), ffmpeg: findTool("ffmpeg"), threads: THREADS, idleMs: IDLE_MS, clap: CLAP_REPO, tagger: TAGGER_REPO };
	const child = spawn(node.bin, [script, JSON.stringify(cfg)], { env: { ...process.env, ...node.env }, stdio: ["pipe", "pipe", "pipe"] });
	try {
		if (child.pid) os.setPriority(child.pid, 10);
	} catch {}
	const h: Helper = { child, pending: new Map(), next: 1, stderr: [], bye: false };
	child.stdin.on("error", () => {});
	readline.createInterface({ input: child.stdout }).on("line", (line) => {
		let m: Record<string, unknown>;
		try {
			m = JSON.parse(line);
		} catch {
			return;
		}
		if (typeof m.fatal === "string") box.__hearFatal = m.fatal;
		if (m.bye) {
			h.bye = true;
			if (box.__hearHelper === h) box.__hearHelper = null;
			return;
		}
		const p = typeof m.id === "number" ? h.pending.get(m.id) : undefined;
		if (!p) return;
		if (typeof m.progress === "number" && !("ok" in m)) return p.onProgress?.(m.progress);
		h.pending.delete(m.id as number);
		if (m.ok) p.resolve(m);
		else p.reject(String(m.error) === "Cancelled" ? new CancelledError() : new StudioError(`Claude's hearing model failed: ${m.error}`));
	});
	child.stderr.on("data", (d: Buffer) => {
		h.stderr.push(...String(d).split("\n").filter(Boolean));
		if (h.stderr.length > 30) h.stderr.splice(0, h.stderr.length - 30);
	});
	const gone = (why: string) => {
		const left = [...h.pending.values()];
		h.pending.clear();
		if (box.__hearHelper === h) box.__hearHelper = null;
		for (const p of left) {
			// Sent while it was quitting for being idle: asked again of a new helper.
			if (h.bye) request(p.req, p.signal, p.onProgress).then(p.resolve, p.reject);
			else p.reject(new StudioError(`Claude's hearing model stopped (${why}).`));
		}
	};
	child.on("exit", (code, signal) => gone(box.__hearFatal ?? (h.stderr.slice(-2).join(" ").slice(0, 200) || `${code ?? signal}`)));
	child.on("error", (e) => gone(e.message));
	box.__hearHelper = h;
	return h;
}

function request(req: Record<string, unknown>, signal?: AbortSignal, onProgress?: (f: number) => void): Promise<Record<string, unknown>> {
	if (signal?.aborted) return Promise.reject(new CancelledError());
	const h = helper();
	const id = h.next++;
	return new Promise((resolve, reject) => {
		const abort = () => h.child.stdin.write(`${JSON.stringify({ op: "cancel", of: id })}\n`);
		signal?.addEventListener("abort", abort, { once: true });
		const done = () => signal?.removeEventListener("abort", abort);
		h.pending.set(id, {
			req,
			signal,
			resolve: (v) => {
				done();
				resolve(v);
			},
			reject: (e) => {
				done();
				reject(e);
			},
			onProgress,
		});
		h.child.stdin.write(`${JSON.stringify({ ...req, id })}\n`);
	});
}

/** The helper's memory (for the measurements); null when it isn't running. */
export async function helperRss(): Promise<number | null> {
	const live = box.__hearHelper;
	if (!live || live.child.exitCode !== null) return null;
	return Number((await request({ op: "stats" })).rss) || null;
}

const fromB64 = (s: string): Float32Array => {
	const b = Buffer.from(s, "base64");
	const out = new Float32Array(b.length >> 2);
	new Uint8Array(out.buffer).set(b.subarray(0, out.length * 4));
	return out;
};
const toB64 = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");

// ───────────────────────── windows of a file, cached ─────────────────────────

/** A stretch of a file's source the models hear as one (seconds). */
export interface Win {
	t: number;
	len: number;
}
export interface WinData {
	/** CLAP sound embedding (unit length). */
	e?: Float32Array;
	/** The tagger's top labels with their probabilities. */
	g?: Array<[string, number]>;
	/** More of the tagger's labels (down to 2 %): the instruments, voices, genres and moods of a song. */
	m?: Array<[string, number]>;
}
interface FileModels {
	key: string;
	win: Map<string, WinData>;
}

const winKey = (w: Win) => `${w.t.toFixed(2)}+${w.len.toFixed(2)}`;
const cacheFile = (key: string) => path.join(dataDir(), "hearing", `${key}.ai.json`);

function fileModels(key: string): FileModels {
	box.__hearModels ??= new Map();
	const mem = box.__hearModels;
	const hit = mem.get(key);
	if (hit) return hit;
	const fm: FileModels = { key, win: new Map() };
	try {
		const saved = JSON.parse(fs.readFileSync(cacheFile(key), "utf8"));
		if (saved.v === CACHE_VERSION) for (const [k, d] of Object.entries(saved.win ?? {}) as Array<[string, { e?: string; g?: Array<[string, number]>; m?: Array<[string, number]> }]>) fm.win.set(k, { ...(d.e !== undefined ? { e: fromB64(d.e) } : {}), ...(d.g ? { g: d.g } : {}), ...(d.m ? { m: d.m } : {}) });
	} catch {}
	mem.set(key, fm);
	while (mem.size > 8) mem.delete(mem.keys().next().value as string);
	return fm;
}

function saveModels(fm: FileModels) {
	try {
		const win: Record<string, { e?: string; g?: Array<[string, number]>; m?: Array<[string, number]> }> = {};
		for (const [k, d] of fm.win) win[k] = { ...(d.e ? { e: d.e.length ? toB64(d.e) : "" } : {}), ...(d.g ? { g: d.g } : {}), ...(d.m ? { m: d.m } : {}) };
		fs.mkdirSync(path.dirname(cacheFile(fm.key)), { recursive: true });
		fs.writeFileSync(cacheFile(fm.key), JSON.stringify({ v: CACHE_VERSION, win }));
	} catch {
		// A miss later only costs hearing those windows again.
	}
}

/** CLAP embeddings (`clap`) and/or tags (`tags`) of these windows of a file, from the cache or heard now. */
export async function heardWindows(key: string, file: string, wins: Win[], want: { clap?: boolean; tags?: boolean; music?: boolean }, signal?: AbortSignal, onProgress?: (f: number) => void): Promise<WinData[]> {
	const fm = fileModels(key);
	const missing = wins.filter((w) => {
		const d = fm.win.get(winKey(w));
		return !d || (want.clap && !d.e) || (want.tags && !d.g) || (want.music && !d.m);
	});
	if (missing.length) {
		const r = await request({ op: "windows", file, items: missing, clap: !!want.clap, tags: !!want.tags || !!want.music, music: !!want.music }, signal, onProgress);
		for (const w of (r.windows ?? []) as Array<{ t: number; len: number; e?: string; g?: Array<[string, number]>; m?: Array<[string, number]> }>) {
			const k = winKey(w);
			const old = fm.win.get(k) ?? {};
			fm.win.set(k, { ...old, ...(w.e ? { e: fromB64(w.e) } : {}), ...(w.g ? { g: w.g } : {}), ...(w.m ? { m: w.m } : {}) });
		}
		// A window with no sound in it (past the file's end) is remembered as heard-empty, not asked again.
		for (const w of missing) {
			const k = winKey(w);
			const d = fm.win.get(k) ?? {};
			fm.win.set(k, { ...d, ...(want.clap && !d.e ? { e: new Float32Array(0) } : {}), ...(want.tags && !d.g ? { g: [] } : {}), ...(want.music && !d.m ? { m: [] } : {}) });
		}
		saveModels(fm);
	}
	return wins.map((w) => fm.win.get(winKey(w)) ?? {});
}

/**
 * The windows that cover [from, to] of a source (seconds), on a fixed grid so later questions reuse them: one window of
 * exactly the stretch when it is short, else `len`-second windows every `len / 2` s (spread out, at most `max`).
 */
export function windowsFor(from: number, to: number, { len = 10, max = 48, duration = Infinity }: { len?: number; max?: number; duration?: number } = {}): Win[] {
	const a = Math.max(0, from);
	const b = Math.min(duration, to);
	if (b - a <= len * 1.25) return b - a >= 0.1 ? [{ t: Math.round(a * 100) / 100, len: Math.round((b - a) * 100) / 100 }] : [];
	const hop = len / 2;
	const out: Win[] = [];
	for (let t = Math.ceil(a / hop) * hop; t + len <= b + hop / 2; t += hop) out.push({ t, len: Math.min(len, Math.round((duration - t) * 100) / 100) });
	if (!out.length) out.push({ t: a, len });
	if (out.length <= max) return out;
	const step = out.length / max;
	return Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]);
}

// ───────────────────────── words ─────────────────────────

/** CLAP text embeddings (unit length), cached per phrase. */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
	box.__hearText ??= new Map();
	const cache = box.__hearText;
	const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
	if (missing.length) {
		const r = await request({ op: "texts", texts: missing }, signal);
		(r.e as string[]).forEach((e, i) => cache.set(missing[i], fromB64(e)));
	}
	return texts.map((t) => cache.get(t) as Float32Array);
}

interface Bank {
	labels: string[];
	vectors: Float32Array[];
}

/** The tagger's 527 everyday labels (AudioSet), in its own order. */
export function tagLabels(): string[] {
	try {
		const config = JSON.parse(fs.readFileSync(path.join(modelDirs.hear(), TAGGER_REPO, "config.json"), "utf8"));
		return Object.keys(config.id2label)
			.sort((a, b) => Number(a) - Number(b))
			.map((k) => String(config.id2label[k]));
	} catch {
		return [];
	}
}

/** The 527 labels as CLAP text: the yardstick a phrase's similarity is measured against (cached on disk once). */
export async function labelBank(signal?: AbortSignal): Promise<Bank> {
	if (box.__hearBank) return box.__hearBank;
	const labels = tagLabels();
	if (!labels.length) throw new StudioError("The hearing model's labels are missing: repair it in Settings → Services.");
	const file = path.join(dataDir(), "hearing", `label-bank-${CACHE_VERSION}-${labels.length}.bin`);
	let vectors: Float32Array[] | null = null;
	try {
		const b = fs.readFileSync(file);
		const all = new Float32Array(b.length >> 2);
		new Uint8Array(all.buffer).set(b.subarray(0, all.length * 4));
		const dim = all.length / labels.length;
		if (Number.isInteger(dim) && dim > 0) vectors = labels.map((_, i) => all.slice(i * dim, (i + 1) * dim));
	} catch {}
	if (!vectors) {
		vectors = await embedTexts(labels, signal);
		try {
			const dim = vectors[0].length;
			const all = new Float32Array(dim * labels.length);
			vectors.forEach((v, i) => all.set(v, i * dim));
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, Buffer.from(all.buffer));
		} catch {}
	}
	box.__hearBank = { labels, vectors };
	return box.__hearBank;
}

// ───────────────────────── scores ─────────────────────────

export const dot = (a: Float32Array, b: Float32Array) => {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
};

/** The mean direction of several embeddings (unit length): how a longer stretch sounds overall. */
export function meanOf(list: Float32Array[]): Float32Array | null {
	const ok = list.filter((v) => v?.length);
	if (!ok.length) return null;
	const out = new Float32Array(ok[0].length);
	for (const v of ok) for (let i = 0; i < out.length; i++) out[i] += v[i];
	let n = 0;
	for (let i = 0; i < out.length; i++) n += out[i] * out[i];
	n = Math.sqrt(n) || 1;
	for (let i = 0; i < out.length; i++) out[i] /= n;
	return out;
}

const STOP = new Set(["a", "an", "the", "of", "on", "and", "or", "in", "with", "to", "by", "from"]);
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ey|es|ed|s|y)$/, "") : w);
/** The words of a phrase or a label, lower case, lightly stemmed («Cheering» and «cheering» → «cheer»). */
export const wordsOf = (t: string): string[] =>
	t
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w && !STOP.has(w))
		.map(stem);

/**
 * How much a sound (embedding) is like a phrase, 0–100: the lower of two measures, both from CLAP. How far the phrase's
 * similarity stands above the sound's similarity to the 527 everyday labels (z, squeezed by a logistic: «is it this at
 * all?»), and how close the phrase comes to the sound's best label («is it as good a description as the best one?»:
 * it keeps a sad piece from scoring «happy upbeat music» merely for being music). When one of the sound's 5 best labels
 * is named by the phrase's words (the clapping crowd is «Cheering» for «crowd cheering»), that label speaks for the
 * phrase. 70+ clearly, 40–70 somewhat, under 40 not. Measured on the app's library (09.11, unpadded text embeddings):
 * heavy rain → «rain» 92; a sad classical piece → «sad piano» 98, «happy upbeat music» 39, «upbeat pop» 1; a happy track
 * → «happy upbeat music» 88, «sad piano» 22; a drama riser → «tense build-up» 94, «scary music» 95; applause → 98.
 */
export function clapScore(sound: Float32Array, phrase: Float32Array, bankVectors: Float32Array[], named?: { labels: string[]; words: string[] }): { score: number; z: number; via?: string } {
	let s = dot(sound, phrase);
	const sims = bankVectors.map((v) => dot(sound, v));
	let mu = 0;
	for (const x of sims) mu += x;
	mu /= sims.length;
	let sd = 0;
	for (const x of sims) sd += (x - mu) ** 2;
	sd = Math.sqrt(sd / sims.length) || 0.05;
	const best = Math.max(...sims);
	let via: string | undefined;
	if (named?.words.length) {
		const words = new Set(named.words);
		const top = sims
			.map((x, i) => [x, i] as const)
			.sort((p, q) => q[0] - p[0])
			.slice(0, 5);
		for (const [x, i] of top) {
			const lw = wordsOf(named.labels[i] ?? "");
			if (lw.length && lw.every((w) => words.has(w)) && x > s) {
				s = x;
				via = named.labels[i];
			}
		}
	}
	const z = (s - mu) / sd;
	const fits = 100 / (1 + Math.exp(-1.4 * (z - 1.5)));
	const asGood = 100 / (1 + Math.exp(-25 * (s - best + 0.15)));
	return { score: Math.round(Math.min(fits, asGood)), z: Math.round(z * 10) / 10, ...(via ? { via } : {}) };
}

/** The labels a sound is closest to in CLAP's space (a second opinion next to the tagger's). */
export function nearestLabels(sound: Float32Array, labels: string[], vectors: Float32Array[], k = 3): string[] {
	return vectors
		.map((v, i) => [dot(sound, v), i] as const)
		.sort((a, b) => b[0] - a[0])
		.slice(0, k)
		.map(([, i]) => labels[i]);
}

/** Tags of several windows merged: each label's mean probability over them (absent = 0), strongest first. */
export function mergeTags(list: Array<Array<[string, number]> | undefined>, k = 4, min = 0.12): Array<[string, number]> {
	const ok = list.filter((g): g is Array<[string, number]> => !!g?.length);
	if (!ok.length) return [];
	const sum = new Map<string, number>();
	for (const g of ok) for (const [l, p] of g) sum.set(l, (sum.get(l) ?? 0) + p);
	return [...sum.entries()]
		.map(([l, s]) => [l, Math.round((s / ok.length) * 100) / 100] as [string, number])
		.filter(([, p]) => p >= min)
		.sort((a, b) => b[1] - a[1])
		.slice(0, k);
}
