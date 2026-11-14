// Streams a file to disk, made to survive bad networks: resume from what is on disk (.part + HTTP Range), retries
// with backoff, a mirror when the main source keeps failing, and a sha256 check before the file is moved into
// place (rename = atomic: a file is either complete and verified, or absent).
// What the app downloads itself never carries the quarantine flag, so macOS never asks about it later.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CancelledError, StudioError, throwIfAborted } from "@/studio/server/errors";
import { routed } from "@/studio/server/http";
import { run } from "@/studio/server/tools";
import { IS_MAC } from "@/platform/os";

const MB = (b: number) => `${Math.round(b / 1e6)} MB`;

async function hashOf(file: string): Promise<crypto.Hash> {
	const hash = crypto.createHash("sha256");
	await new Promise<void>((resolve, reject) => {
		fs.createReadStream(file).on("data", (d) => hash.update(d)).on("end", () => resolve()).on("error", reject);
	});
	return hash;
}

export async function sha256File(file: string): Promise<string> {
	return (await hashOf(file)).digest("hex");
}

const wait = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(t);
			reject(new CancelledError());
		};
		const t = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});

/**
 * How a download in the background (background.ts) gives way to the user's own work: `pause` says why it must wait
 * right now (null = go on; looked at between chunks, the connection is released while it waits and resumed after),
 * `rate` caps its speed in bytes per second, so the editor's own network and disk stay free.
 */
export interface DownloadPace {
	pause?: () => string | null;
	/** Bytes per second, or a function answering it for the moment (undefined = no cap). */
	rate?: number | (() => number | undefined);
	/** A feature is waiting for it right now: a dead or silent host is said within seconds (CONTACT_MS). */
	quick?: () => boolean;
}

/** Waits while `pause` says so (an export, an AI tool, a download the user asked for); looks again every second. */
async function untilResumed(pause: () => string | null, signal: AbortSignal) {
	while (pause()) await wait(testSeconds() ? 250 : 1000, signal);
}

/**
 * A feature is waiting for this file (craft B, docs/CRAFT.md «A wait tells the truth»): no answer from any source within
 * CONTACT_MS is said at once in one calm sentence (Retry resumes), instead of retrying for a minute at «0 %». The budget is
 * shared by the sources (main, then mirrors). Once bytes flowed, a stall of QUICK_STALL_MS drops and resumes the
 * connection; QUICK_LOST failures in a row without a new byte are said too. Background downloads keep the patient pace.
 */
const CONTACT_MS = 4500;
const QUICK_STALL_MS = 8000;
const QUICK_LOST = 2;
export const UNREACHABLE = "Couldn't reach the download server.";
export const CONNECTION_LOST = "The connection to the download server was lost.";

/** The server sends more than the file should have: it's a different file, retrying won't help. */
class SizeMismatch extends Error {}

/** Self-tests only: every wait and time limit becomes this many seconds (read on each use). */
const testSeconds = () => (process.env.STUDIO_TEST === "1" ? Number(process.env.STUDIO_FAKE_TIMEOUT || 0) : 0);
/** No answer at all (headers) within this long: the server is unreachable from here (a blocked host just hangs). */
const headersMs = () => (testSeconds() || 20) * 1000;
/** No new bytes for this long: the connection is dropped and resumed. */
const stallMs = () => (testSeconds() || 60) * 1000;

/**
 * Hosts that failed twice in a row without answering (e.g. huggingface.co where it is blocked): for half an hour the
 * next files start on a mirror right away instead of waiting for the blocked host again, file after file.
 */
const failing = new Map<string, { count: number; until: number }>();
const hostOf = (url: string) => {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
};
const blocked = (url: string) => (failing.get(hostOf(url))?.until ?? 0) > Date.now();
function noteFailure(url: string) {
	const f = failing.get(hostOf(url)) ?? { count: 0, until: 0 };
	f.count++;
	if (f.count >= 2) f.until = Date.now() + 30 * 60_000;
	failing.set(hostOf(url), f);
}
const noteSuccess = (url: string) => failing.delete(hostOf(url));

/** The whole file's size from an answer: Content-Range of a resumed piece, or Content-Length of the whole file. */
function totalOf(res: Response): number | undefined {
	const range = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1];
	const length = res.status === 200 && !res.headers.get("content-encoding") ? res.headers.get("content-length") : null;
	const n = Number(range ?? length);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * One attempt: appends to `part` from byte `have`. Returns the bytes on disk afterwards, the file's size when the
 * server tells it, and whether the answer ended normally (all it had to send). `paused`: it stopped because the
 * pace said so (not a failure; the next attempt resumes from the bytes on disk).
 */
async function attempt(
	url: string,
	part: string,
	have: number,
	expected: number | undefined,
	signal: AbortSignal,
	progress: (bytes: number) => void,
	pace: DownloadPace = {},
	limits: { headers: number; stall: number } = { headers: headersMs(), stall: stallMs() },
): Promise<{ have: number; total?: number; ended: boolean; paused?: boolean }> {
	// No answer (or no first byte) within 20 s, or no bytes for 60 s: the connection is dropped (and resumed) instead of
	// hanging forever. A feature waiting for the file gets the short limits (CONTACT_MS, QUICK_STALL_MS).
	const stall = new AbortController();
	let timer = setTimeout(() => stall.abort(), limits.headers);
	let res: Response;
	try {
		res = await fetch(routed(url), {
			signal: AbortSignal.any([signal, stall.signal]),
			headers: have > 0 ? { Range: `bytes=${have}-` } : {},
			redirect: "follow",
		});
	} catch (error) {
		clearTimeout(timer);
		throw error;
	}
	if (res.status === 416) {
		// Nothing after `have`: complete, unless the server says the file is shorter than what is on disk.
		clearTimeout(timer);
		void res.body?.cancel().catch(() => {});
		const total = totalOf(res) ?? expected ?? have;
		return total === have ? { have, total, ended: true } : { have: 0, total, ended: false };
	}
	if (!res.ok) {
		clearTimeout(timer);
		void res.body?.cancel().catch(() => {});
		throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
	}
	if (have > 0 && res.status === 200) have = 0; // the server ignored the range: start over
	const total = expected ?? totalOf(res);
	if (!res.body) {
		clearTimeout(timer);
		throw new Error("empty answer");
	}
	const out = fs.createWriteStream(part, { flags: have > 0 ? "a" : "w" });
	const t0 = Date.now();
	const from = have;
	let paused = false;
	try {
		let last = 0;
		for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
			clearTimeout(timer);
			timer = setTimeout(() => stall.abort(), limits.stall);
			if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
			have += chunk.length;
			if (total !== undefined && have > total) throw new SizeMismatch();
			if (Date.now() - last > 250) {
				last = Date.now();
				progress(have);
			}
			if (pace.pause?.()) {
				// The user's own work comes first: the connection is let go (leaving the loop cancels the body) and the
				// next attempt continues from the bytes on disk once the work is over.
				paused = true;
				progress(have);
				break;
			}
			const cap = typeof pace.rate === "function" ? pace.rate() : pace.rate;
			if (cap) {
				// Ahead of the allowance (this attempt's average): wait for the clock.
				const ahead = ((have - from) / cap) * 1000 - (Date.now() - t0);
				if (ahead > 20) await wait(Math.min(1000, ahead), signal);
			}
		}
	} finally {
		clearTimeout(timer);
		await new Promise<void>((r) => out.end(r));
	}
	return { have, total, ended: !paused, paused };
}

/**
 * Downloads `urls[0]` (or a mirror) to `dest`, verified by size and sha256 when they are known (an unknown size is
 * learnt from the server's answer). Safe to call again after a cancel, a crash or a lost connection: it continues
 * from the bytes already on disk. `name` is how messages call the file (its file name by default); `pause` and
 * `rate` (DownloadPace) make it a background download that gives way to the user's work.
 */
export async function downloadFile(
	urls: string | string[],
	dest: string,
	size: number | undefined,
	sha256: string | undefined,
	signal: AbortSignal,
	progress: (bytes: number) => void,
	{ name = path.basename(dest), pause, rate, quick }: { name?: string } & DownloadPace = {},
) {
	const sources = Array.isArray(urls) ? urls : [urls];
	if (size !== undefined && fs.existsSync(dest) && fs.statSync(dest).size === size) {
		progress(size);
		return;
	}
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	const part = `${dest}.part`;
	let total = size;
	let failures = 0;
	let lastError = "";
	// A feature is waiting (quick): the first contact has CONTACT_MS for all sources, each tried once in turn.
	const quickNow = () => !!quick?.();
	const t0 = Date.now();
	let flowed = false;
	let tried = 0;
	let lost = 0;
	for (;;) {
		throwIfAborted(signal);
		if (pause) await untilResumed(pause, signal);
		let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
		if (total !== undefined && have > total) {
			fs.rmSync(part);
			have = 0;
		}
		if (total !== undefined && have === total) break;
		// The main source first (hosts failing lately sit out while another works); after two failures in a row, the
		// mirrors take turns.
		const healthy = sources.filter((u) => !blocked(u));
		const pool = healthy.length ? healthy : sources;
		const contact = quickNow() && !flowed;
		const left = CONTACT_MS - (Date.now() - t0);
		const url = contact ? sources[Math.min(tried, sources.length - 1)] : failures < 2 ? pool[0] : pool[(failures - 1) % pool.length];
		const limits = contact
			? { headers: Math.max(1000, left / Math.max(1, sources.length - tried)), stall: QUICK_STALL_MS }
			: quickNow()
				? { headers: CONTACT_MS, stall: QUICK_STALL_MS }
				: { headers: headersMs(), stall: stallMs() };
		const onDisk = () => (fs.existsSync(part) ? fs.statSync(part).size : 0);
		try {
			const got = await attempt(url, part, have, total, signal, progress, { pause, rate }, limits);
			if (got.have > have) {
				noteSuccess(url);
				flowed = true;
				lost = 0;
			}
			total ??= got.total;
			// A server that never says the size: the file is complete when its answer ends normally.
			if (total === undefined ? got.ended && got.have > 0 : got.have === total) break;
			// Gave way to the user's work: no failure, the next round waits for it to end and resumes.
			if (got.paused) continue;
			if (got.have === 0 && fs.existsSync(part)) fs.rmSync(part, { force: true });
			failures++;
			lastError = "the connection dropped";
			if (contact) tried++;
		} catch (error) {
			if (signal.aborted || error instanceof CancelledError) throw new CancelledError();
			if (error instanceof SizeMismatch) {
				fs.rmSync(part, { force: true });
				throw new StudioError(`${name} on the server isn't the expected file. Update the app, then press Retry.`);
			}
			failures++;
			const status = (error as { status?: number }).status;
			lastError = status ? `the server answered ${status}` : "no connection";
			if (!status || status >= 500) noteFailure(url);
			if (onDisk() > have) {
				flowed = true;
				lost = 0;
			}
			if (contact) tried++;
			// 404/403 on every source = the file moved: no point retrying for ever.
			if (status && status >= 400 && status < 500 && status !== 408 && status !== 429 && failures > sources.length * 2) {
				throw new StudioError(`Couldn't download ${name} (${lastError}). Press Retry later.`);
			}
		}
		if (quickNow()) {
			// Said now, calmly: nobody answered in time (Retry resumes from the bytes on disk) …
			if (!flowed && (tried >= sources.length || Date.now() - t0 >= CONTACT_MS)) throw new StudioError(UNREACHABLE, { plain: true });
			// … or the bytes stopped coming, again and again.
			if (flowed && ++lost >= QUICK_LOST) throw new StudioError(CONNECTION_LOST, { plain: true });
			if (!flowed) continue; // the next source, at once
			await wait(1000 * lost, signal);
			continue;
		}
		if (failures >= 12) {
			throw new StudioError(`The download stopped (${lastError}). Check the internet connection and press Retry — it resumes where it stopped.`);
		}
		await wait(testSeconds() ? 10 : Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)), signal);
	}
	const got = fs.statSync(part).size;
	if (total !== undefined && got !== total) throw new StudioError(`Download incomplete: ${name} has ${MB(got)} of ${MB(total)}. Press Retry to resume.`);
	if (sha256 && (await sha256File(part)) !== sha256) {
		fs.rmSync(part, { force: true });
		throw new StudioError(`${name} arrived damaged and was deleted. Press Retry to download it again.`);
	}
	fs.renameSync(part, dest);
	progress(got);
}

/** Removes the quarantine flag from everything under `dir` (the app's own downloads, never user files). */
export async function clearQuarantine(dir: string) {
	if (!IS_MAC || !fs.existsSync(dir)) return;
	await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", dir], { timeout: 300 }).catch(() => {});
}
