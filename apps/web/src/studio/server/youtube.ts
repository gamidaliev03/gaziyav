// YouTube via yt-dlp: info and a playable preview stream without downloading, then only the chosen fragment.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegWithProgress } from "./convert";
import { probe } from "./media";
import { CancelledError, StudioError } from "./errors";
import { loadSettings } from "./settings";
import { findTool, reason, run } from "./tools";
import { looksOutdated, runYtdlp, updateWithin, updateYtdlp } from "./ytdlp-update";

export interface YouTubeInfo {
	id: string;
	title: string;
	description: string;
	duration: number;
	thumbnail?: string;
	/** A stream with picture and sound the editor can play directly (usually 360p). */
	preview?: string;
	/** Fallback: separate picture and sound streams. */
	previewVideo?: string;
	previewAudio?: string;
	/**
	 * YouTube's storyboard: small frames of the whole video in a few sprite sheets (~10 KB each), for an instant filmstrip
	 * and hover preview on the piece bar — no seeking of the video, nothing big downloaded.
	 */
	storyboard?: Storyboard;
}

export interface Storyboard {
	/** Sheet images in order; each holds `cols` × `rows` frames of `width` × `height`. */
	sheets: string[];
	cols: number;
	rows: number;
	width: number;
	height: number;
	/** Seconds between frames (frame k shows the video at k × interval). */
	interval: number;
	count: number;
}

/** The sharpest storyboard up to 160 px wide (enough for a filmstrip and a hover preview, a few sheets at most). */
function storyboardOf(formats: any[], duration: number): Storyboard | undefined {
	const boards = formats
		.filter((f) => f?.format_note === "storyboard" && Array.isArray(f.fragments) && f.fragments.length && f.columns && f.rows && f.fps > 0)
		.sort((a, b) => Number(b.width) - Number(a.width));
	const pick = boards.find((f) => Number(f.width) <= 160) ?? boards[boards.length - 1];
	if (!pick) return undefined;
	const interval = 1 / Number(pick.fps);
	return {
		sheets: pick.fragments.map((f: any) => String(f.url)).filter((u: string) => u.startsWith("https://")),
		cols: Number(pick.columns),
		rows: Number(pick.rows),
		width: Number(pick.width),
		height: Number(pick.height),
		interval,
		count: Math.max(1, Math.ceil(duration / interval)),
	};
}

/** What a link answered lately (a reopened link, the piece dialog after a search): 20 minutes, the stream URLs last 6 h. */
const infoCache: Map<string, { at: number; info: Promise<YouTubeInfo> }> =
	((globalThis as any).__studioYouTubeInfo as Map<string, { at: number; info: Promise<YouTubeInfo> }>) ??
	((globalThis as any).__studioYouTubeInfo = new Map());

/** Browsers yt-dlp can take a YouTube sign-in from, with their app names on a Mac. */
export const SIGN_IN_BROWSERS: Record<string, string> = {
	chrome: "Google Chrome",
	safari: "Safari",
	firefox: "Firefox",
	edge: "Microsoft Edge",
	brave: "Brave Browser",
	opera: "Opera",
	vivaldi: "Vivaldi",
	chromium: "Chromium",
	whale: "Whale",
};

/** Where each browser keeps its profile on Windows (where yt-dlp reads the sign-in from). */
const WINDOWS_PROFILES: Record<string, [env: string, dir: string]> = {
	chrome: ["LOCALAPPDATA", "Google\\Chrome\\User Data"],
	firefox: ["APPDATA", "Mozilla\\Firefox\\Profiles"],
	edge: ["LOCALAPPDATA", "Microsoft\\Edge\\User Data"],
	brave: ["LOCALAPPDATA", "BraveSoftware\\Brave-Browser\\User Data"],
	opera: ["APPDATA", "Opera Software\\Opera Stable"],
	vivaldi: ["LOCALAPPDATA", "Vivaldi\\User Data"],
	chromium: ["LOCALAPPDATA", "Chromium\\User Data"],
};

/** The browsers of SIGN_IN_BROWSERS installed on this computer. */
export function installedBrowsers(): string[] {
	if (os.platform() === "win32") {
		return Object.entries(WINDOWS_PROFILES)
			.filter(([, [env, dir]]) => !!process.env[env] && fs.existsSync(path.join(process.env[env] as string, dir)))
			.map(([id]) => id);
	}
	const dirs = ["/Applications", path.join(os.homedir(), "Applications")];
	return Object.entries(SIGN_IN_BROWSERS)
		.filter(([, app]) => dirs.some((d) => fs.existsSync(path.join(d, `${app}.app`))))
		.map(([id]) => id);
}

/** yt-dlp's arguments for the user's YouTube sign-in (only for YouTube links, only when the user chose a browser). */
function signIn(link: string): string[] {
	const browser = loadSettings().youtubeBrowser;
	return isYouTubeLink(link) && browser in SIGN_IN_BROWSERS ? ["--cookies-from-browser", browser] : [];
}

export function isYouTubeLink(text: string): boolean {
	try {
		const host = new URL(text.trim()).hostname.toLowerCase();
		return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
	} catch {
		return false;
	}
}

/** Throws a clear message for links that are not a single video (playlists, channel pages, home page). */
export function checkVideoLink(link: string) {
	let u: URL;
	try {
		u = new URL(link.trim());
	} catch {
		throw new StudioError("Paste a video link (YouTube, TikTok, Instagram, VK, X…)");
	}
	if (!/^https?:$/.test(u.protocol)) throw new StudioError("Paste a web link that starts with https://");
	if (privateHost(u.hostname)) throw new StudioError("That link points into a local network. Paste a link to a public video site.");
	// Other sites (TikTok, Instagram, VK, X…) go straight to yt-dlp; only YouTube links get the playlist/channel checks.
	if (!isYouTubeLink(link)) return;
	const host = u.hostname.toLowerCase();
	const hasVideo =
		(host === "youtu.be" && u.pathname.length > 1) ||
		u.searchParams.has("v") ||
		/^\/(shorts|live|embed)\/[\w-]+/.test(u.pathname);
	if (!hasVideo && u.searchParams.has("list")) {
		throw new StudioError("That's a playlist link — open the video you need and copy its link.");
	}
	if (!hasVideo) throw new StudioError("The link has no video — open the video on YouTube and copy its address.");
}

/** Local, private and link-local addresses: never handed to yt-dlp (the app's server must not probe the user's network). */
function privateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || !host.includes(".") || /\.(local|localhost|internal|lan|home)$/.test(host)) return true;
	if (host.includes(":")) return true; // literal IPv6
	const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Links of other sites that yt-dlp has read in this session (the Add-from-link dialog always reads a link first). */
const checkedLinks: Map<string, number> =
	((globalThis as any).__studioCheckedLinks as Map<string, number>) ?? ((globalThis as any).__studioCheckedLinks = new Map());

/**
 * A download starts only for a link that was read first: YouTube links are checked by their shape, other sites by
 * yt-dlp itself (youtubeInfo). A link nobody read gets a clear answer at once instead of a background job.
 */
export function ensureCheckedLink(link: string) {
	if (isYouTubeLink(link)) return;
	const at = checkedLinks.get(link.trim());
	if (!at || Date.now() - at > 12 * 3600_000) {
		throw new StudioError("Gaziyav hasn't opened this link yet. Paste it in Add from a link to see the video first, then download.");
	}
}

/** "YouTube" or "The site", for messages about a link. */
function siteOf(link: string) {
	return isYouTubeLink(link) ? "YouTube" : "The site";
}

export function youtubeInfo(link: string, signal?: AbortSignal): Promise<YouTubeInfo> {
	checkVideoLink(link);
	void updateYtdlp("daily");
	const key = link.trim();
	const hit = infoCache.get(key);
	if (hit && Date.now() - hit.at < 20 * 60_000) return hit.info;
	// Not tied to one caller's signal: a second dialog asking for the same link shares the answer.
	const info = readInfo(key);
	infoCache.set(key, { at: Date.now(), info });
	info.catch(() => infoCache.delete(key));
	while (infoCache.size > 40) infoCache.delete(infoCache.keys().next().value as string);
	if (!signal) return info;
	return new Promise((resolve, reject) => {
		const abort = () => reject(new CancelledError());
		if (signal.aborted) return abort();
		signal.addEventListener("abort", abort, { once: true });
		info.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}

async function readInfo(link: string): Promise<YouTubeInfo> {
	const args = ["-J", "--no-playlist", "--no-warnings", "--socket-timeout", "20", ...signIn(link), "--", link.trim()];
	let r = await runYtdlp(args, { timeout: 90 });
	// YouTube changed something a newer yt-dlp handles: the signed update is fetched (up to 2 min) and asked once more.
	if (r.status !== 0 && isYouTubeLink(link) && looksOutdated(r.stderr) && (await updateWithin(120))) r = await runYtdlp(args, { timeout: 90 });
	if (r.status !== 0) throw new StudioError(`${siteOf(link)}: ${reason(r)}`);
	let j: any;
	try {
		j = JSON.parse(r.stdout);
	} catch {
		throw new StudioError(`${siteOf(link)} returned an unexpected answer. Press Retry.`);
	}
	if (j?._type === "playlist") j = (Array.isArray(j.entries) ? j.entries : []).find((e: any) => Array.isArray(e?.formats)) ?? null;
	if (!j || typeof j !== "object") throw new StudioError("That link is a list, not one video. Open the video itself and copy its link.");
	checkedLinks.set(link.trim(), Date.now());
	const formats: any[] = j.formats ?? [];
	const direct = (f: any) => f.protocol === "https" && f.url && !String(f.format_id ?? "").includes("drc");
	const height = (f: any) => Number(f.height ?? 0);
	const muxed = formats
		.filter((f) => direct(f) && f.vcodec && f.vcodec !== "none" && f.acodec && f.acodec !== "none" && height(f) <= 720)
		.sort((a, b) => height(b) - height(a))[0];
	const video = formats
		.filter((f) => direct(f) && String(f.vcodec ?? "").startsWith("avc1") && (f.acodec ?? "none") === "none" && height(f) <= 480)
		.sort((a, b) => height(b) - height(a))[0];
	const audio = formats
		.filter((f) => direct(f) && (f.vcodec ?? "none") === "none" && String(f.acodec ?? "").startsWith("mp4a"))
		.sort((a, b) => Number(b.abr ?? 0) - Number(a.abr ?? 0))[0];
	return {
		id: String(j.id ?? ""),
		title: String(j.title ?? "YouTube"),
		description: String(j.description ?? "").slice(0, 2000),
		duration: Number(j.duration ?? 0),
		thumbnail: j.thumbnail,
		preview: muxed?.url,
		previewVideo: video?.url,
		previewAudio: audio?.url,
		storyboard: storyboardOf(formats, Number(j.duration ?? 0)),
	};
}

/** Seconds of picture fetched before a piece, so the local cut can start on its exact frame. */
const LEAD_IN = 1;

/**
 * ffmpeg (yt-dlp hands it piece downloads) reads the network with no time limit by default: a connection that goes
 * silent hung the job until its 15-minute limit. 20 s without a byte is an error now, and a dropped connection is
 * reopened.
 */
const FFMPEG_NET = ["--downloader-args", "ffmpeg_i:-rw_timeout 20000000 -reconnect 1 -reconnect_on_network_error 1 -reconnect_delay_max 4"];

/** A download whose files haven't grown (and yt-dlp hasn't said anything) for this long is stopped as stalled. */
const STALL_MS = process.env.STUDIO_TEST === "1" && process.env.STUDIO_FAKE_TIMEOUT ? Number(process.env.STUDIO_FAKE_TIMEOUT) * 1000 : 60_000;

/** Bytes on disk of a download in progress (yt-dlp's .part files, the pieces it merges). */
function bytesOf(dir: string, stem: string): number {
	let total = 0;
	try {
		for (const f of fs.readdirSync(dir)) {
			if (!f.startsWith(`${stem}.`)) continue;
			try {
				total += fs.statSync(path.join(dir, f)).size;
			} catch {}
		}
	} catch {}
	return total;
}

/**
 * Downloads `start…end` (frame-accurate), or the whole video when `full`, into `dir/name.mp4`. Leaves nothing behind on failure.
 * A piece: yt-dlp fetches only the segments around it, unchanged and in parallel (YouTube's segmented formats), then
 * ffmpeg cuts the exact frames on this Mac's hardware encoder — ~3× faster than re-encoding while downloading, which
 * stays as the fallback.
 */
export async function downloadSection(
	link: string,
	start: number,
	end: number,
	dir: string,
	name: string,
	opts: {
		audioOnly?: boolean;
		full?: boolean;
		onProgress?: (p: number) => void;
		signal?: AbortSignal;
		updated?: boolean;
		/** The piece's real first frame (a small JPEG), as soon as its raw download is here — its Media item shows it. */
		onPreview?: (file: string) => void;
	} = {},
): Promise<string> {
	const { audioOnly = false, full = false, onProgress, signal } = opts;
	fs.mkdirSync(dir, { recursive: true });
	const clear = () => {
		for (const f of fs.readdirSync(dir)) if (f.startsWith(`${name}.`)) fs.rmSync(path.join(dir, f), { force: true });
	};
	clear();
	const base = ["--no-playlist", "--no-warnings", "--newline", "--socket-timeout", "20", "--ffmpeg-location", findTool("ffmpeg"), ...FFMPEG_NET, ...signIn(link)];
	const format = audioOnly
		? ["-f", "ba[ext=m4a]/ba"]
		: ["-f", "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba/b", "--merge-output-format", "mp4"];
	const ytdlp = async (args: string[], stem: string, share: number) => {
		const ytArgs = [...args, "-o", path.join(dir, `${stem}.%(ext)s`), "--", link.trim()];
		// Stall guard: yt-dlp is silent while ffmpeg fetches a piece, so the files growing on disk count as life too.
		const stall = new AbortController();
		let alive = Date.now();
		let bytes = -1;
		const watch = setInterval(() => {
			const now = bytesOf(dir, stem);
			if (now !== bytes) {
				bytes = now;
				alive = Date.now();
			} else if (Date.now() - alive > STALL_MS) stall.abort();
		}, Math.min(5000, STALL_MS / 3));
		let r: Awaited<ReturnType<typeof runYtdlp>>;
		try {
			r = await runYtdlp(ytArgs, {
				timeout: full ? 3600 : 900,
				signal: signal ? AbortSignal.any([signal, stall.signal]) : stall.signal,
				// Only yt-dlp's own progress lines: the URLs it logs are full of "%3D".
				onLine: (line) => {
					alive = Date.now();
					const m = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line.trim());
					if (m) onProgress?.(Math.min(1, Number(m[1]) / 100) * share);
				},
			});
		} catch (error) {
			if (stall.signal.aborted && !signal?.aborted) {
				throw new StudioError(`${siteOf(link)} stopped sending the video (nothing arrived for ${Math.round(STALL_MS / 1000)} s). Press Retry.`);
			}
			throw error;
		} finally {
			clearInterval(watch);
		}
		if (r.status !== 0) throw new StudioError(`${siteOf(link)}: ${reason(r)}`);
		const file = fs.readdirSync(dir).find((f) => f.startsWith(`${stem}.`) && !f.endsWith(".part") && !f.endsWith(".ytdl"));
		if (!file) throw new StudioError("The download finished but the file is missing. Press Retry.");
		return path.join(dir, file);
	};
	try {
		// Many connections at once: YouTube slows down a single one to about the playback speed.
		if (full) return await ytdlp([...base, "-N", "8", ...format], name, 1);
		if (!audioOnly) {
			try {
				return await fastPiece();
			} catch (error) {
				if (error instanceof CancelledError) throw error;
				clear();
			}
		}
		return await ytdlp([...base, "--download-sections", `*${start.toFixed(2)}-${end.toFixed(2)}`, "--force-keyframes-at-cuts", ...format], name, 1);
	} catch (error) {
		clear();
		// YouTube changed something a newer yt-dlp handles: the signed update is fetched (up to 2 min) and the piece tried once more.
		if (!opts.updated && !(error instanceof CancelledError) && isYouTubeLink(link) && looksOutdated((error as Error).message) && (await updateWithin(120))) {
			return downloadSection(link, start, end, dir, name, { ...opts, updated: true });
		}
		throw error;
	}

	async function fastPiece() {
		const from = Math.max(0, start - LEAD_IN);
		// "dashy": YouTube's whole-file formats as segments, so only the piece's segments are fetched (no slow single stream).
		const raw = await ytdlp(
			[...base, "--extractor-args", "youtube:formats=dashy", "-N", "8", "--download-sections", `*${from.toFixed(2)}-${(end + 0.5).toFixed(2)}`, ...format],
			`${name}.raw`,
			0.5,
		);
		// The cut below takes the raw file to start exactly at `from` (ffmpeg's section download keeps that start). A file
		// clearly longer than asked for may start at an earlier segment boundary instead: then the exact (slower) way.
		const rawSeconds = await probe(raw, signal).then((i) => i.duration).catch(() => 0);
		if (!(rawSeconds > 0) || rawSeconds > end + 0.5 - from + 0.4) throw new StudioError("The piece came with more than asked for");
		// the piece's real first frame for its placeholder (CRAFT.md §1); a failure here changes nothing
		if (opts.onPreview) {
			const still = path.join(dir, `${name}.preview.jpg`);
			const r = await run(findTool("ffmpeg"), ["-y", "-loglevel", "error", "-ss", (start - from).toFixed(3), "-i", raw, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4", still], { timeout: 20, signal }).catch(() => null);
			if (r?.status === 0 && fs.existsSync(still)) opts.onPreview(still);
		}
		const dest = path.join(dir, `${name}.mp4`);
		const duration = end - start;
		const common = [
			"-ss", (start - from).toFixed(3), "-i", raw, "-t", duration.toFixed(3),
			"-map", "0:v:0", "-map", "0:a:0?", "-pix_fmt", "yuv420p",
			"-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
		];
		const progress = (p: number) => onProgress?.(0.5 + 0.5 * Math.min(1, p));
		const ready = () => fs.existsSync(dest) && fs.statSync(dest).size > 0;
		// Hardware encoder first (Apple silicon), the software one where there is none.
		let cut = await ffmpegWithProgress([...common, "-c:v", "h264_videotoolbox", "-q:v", "65", "-allow_sw", "1", dest], duration, signal ?? NEVER, progress);
		if (!cut.ok || !ready()) cut = await ffmpegWithProgress([...common, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", dest], duration, signal ?? NEVER, progress);
		fs.rmSync(raw, { force: true });
		if (!cut.ok || !ready()) throw new StudioError(`Couldn't cut the piece: ${cut.why}`);
		return dest;
	}
}

const NEVER = new AbortController().signal;

export interface YouTubeHit {
	id: string;
	url: string;
	title: string;
	channel: string;
	duration: number;
	thumbnail: string;
}

/** YouTube search right in the link field: the first `count` videos for a plain query (no browser trip). */
export async function youtubeSearch(query: string, count = 6, signal?: AbortSignal): Promise<YouTubeHit[]> {
	const q = query.trim().replace(/\s+/g, " ").slice(0, 200);
	if (!q) return [];
	const r = await runYtdlp(["--flat-playlist", "-J", "--no-warnings", "--socket-timeout", "15", "--", `ytsearch${Math.min(10, Math.max(1, count))}:${q}`], { timeout: 45, signal });
	if (r.status !== 0) throw new StudioError(`YouTube search: ${reason(r)}`);
	let j: any;
	try {
		j = JSON.parse(r.stdout);
	} catch {
		throw new StudioError("YouTube returned an unexpected answer. Try again.");
	}
	return (Array.isArray(j?.entries) ? j.entries : [])
		.filter((e: any) => e?.id && (e.duration == null || Number(e.duration) > 0))
		.map((e: any) => ({
			id: String(e.id),
			url: `https://www.youtube.com/watch?v=${e.id}`,
			title: String(e.title ?? "Video"),
			channel: String(e.channel ?? e.uploader ?? ""),
			duration: Number(e.duration ?? 0),
			thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
		}));
}
