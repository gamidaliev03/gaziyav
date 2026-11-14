// Export of the AI layers. The transparent layer (ProRes 4444, only the frames the layers cover) is rendered with
// @remotion/renderer from the prebuilt bundle (public/montage-bundle) WHILE OpenCut exports the video, and cached by
// content hash (an unchanged composition re-exports instantly). Then ffmpeg lays it over the exported video.
// Runs only when the user presses Export; progress and cancel through the jobs.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CancelledError, StudioError } from "@/studio/server/errors";
import { dataDir, getFile, newFile } from "@/studio/server/files";
import { getJob, type Job, startJob } from "@/studio/server/jobs";
import { appNode, isPackaged, resourcesDir } from "@/platform/paths";
import { ARCH, IS_MAC, IS_WINDOWS } from "@/platform/os";
import { ensureComponent } from "@/studio/server/components";
import { findTool, reason, run } from "@/studio/server/tools";
import { LOOPBACK_ONLY_SOURCE, VIA_VPN_SOURCE } from "@/net/remotion-proxy";
import type { MontageInput } from "../types";

const RENDER_SCRIPT = `
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const require = createRequire(path.join(a.remotionDir, "package.json"));
${LOOPBACK_ONLY_SOURCE}
const { renderMedia, selectComposition, openBrowser } = require("@remotion/renderer");
${VIA_VPN_SOURCE}
const vpn = await viaVpn(a.browserExecutable, path.dirname(process.argv[2]));
const browser = await openBrowser("chrome", { browserExecutable: vpn.exe || null, chromiumOptions: { gl: "angle" }, logLevel: "error" });
try {
	const composition = await selectComposition({ serveUrl: a.serveUrl, id: "Montage", inputProps: a.input, puppeteerInstance: browser, logLevel: "error" });
	let last = -1;
	await renderMedia({
		composition, serveUrl: a.serveUrl, inputProps: a.input, outputLocation: a.out, frameRange: a.frameRange,
		codec: "prores", proResProfile: "4444", imageFormat: "png", pixelFormat: "yuva444p10le",
		concurrency: a.concurrency, logLevel: "error", puppeteerInstance: browser,
		onProgress: ({ progress }) => { const p = Math.round(progress * 100); if (p !== last) { last = p; console.log("PROGRESS " + progress); } },
	});
} finally {
	await browser.close({ silent: true }).catch(() => {});
	vpn.close();
}
console.log("DONE");
`;

/** The render engine: bundled in the app (Resources/remotion); a development server may use MONTAGE_REMOTION_DIR or the old LipSync Studio folder. */
export function remotionDir(): string {
	const res = resourcesDir();
	const dirs = [
		process.env.MONTAGE_REMOTION_DIR,
		res && path.join(res, "remotion"),
	].filter(Boolean) as string[];
	const dir = dirs.find((d) => fs.existsSync(path.join(d, "node_modules", "@remotion", "renderer", "package.json")));
	if (!dir) throw new StudioError("The AI layer renderer is missing from this copy of Gaziyav, so AI layers can't be exported. Reinstall Gaziyav.");
	return dir;
}

/**
 * The headless browser for a render: a copy inside the app (a development build), else the one fetched the first time
 * motion graphics are rendered (studio/server/components.ts). null = the renderer's own download, development only.
 */
export async function browserFor(dir: string, onProgress?: (fraction: number) => void): Promise<string | null> {
	return browserExecutable(dir) ?? (isPackaged() ? ensureComponent("chrome", onProgress) : null);
}

/** A headless browser inside the app (a development build): null otherwise. */
export function browserExecutable(dir: string): string | null {
	const platform = IS_WINDOWS ? "win64" : ARCH === "arm64" ? "mac-arm64" : "mac-x64";
	const exe = path.join(dir, "chrome-headless-shell", platform, `chrome-headless-shell-${platform}`, IS_WINDOWS ? "chrome-headless-shell.exe" : "chrome-headless-shell");
	return fs.existsSync(exe) ? exe : null;
}

export function bundleDir(): string {
	const candidates = [process.env.MONTAGE_BUNDLE_DIR, path.join(process.cwd(), "public", "montage-bundle")].filter(Boolean) as string[];
	const dir = candidates.find((d) => fs.existsSync(path.join(d, "index.html")));
	if (!dir) throw new StudioError("The AI layer renderer is missing from this copy of Gaziyav. Reinstall Gaziyav.");
	return dir;
}

export function nodeCommand(script: string, args: string): { bin: string; argv: string[] } {
	// The app's own runtime (Electron works as Node with ELECTRON_RUN_AS_NODE): nothing to install.
	const own = appNode();
	if (process.env.STUDIO_NODE && fs.existsSync(process.env.STUDIO_NODE)) return { bin: process.env.STUDIO_NODE, argv: [script, args] };
	if (own) return { bin: "/usr/bin/env", argv: [...own.env, own.bin, script, args] };
	for (const p of [path.join(os.homedir(), ".local", "node", "bin", "node"), "/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
		if (fs.existsSync(p)) return { bin: p, argv: [script, args] };
	}
	return { bin: "/usr/bin/env", argv: ["ELECTRON_RUN_AS_NODE=1", process.execPath, script, args] };
}

// Rendered AI layers are reused while they match the composition; they go after a week unused, and the oldest go
// first once the folder passes 2 GB (one ProRes layer can be 1 GB). Checked once per app run.
const CACHE_KEEP_MS = 7 * 24 * 3600 * 1000;
const CACHE_MAX_BYTES = 2e9;
let pruned = false;

function cacheDir(): string {
	const dir = path.join(dataDir(), "montage-cache");
	fs.mkdirSync(dir, { recursive: true });
	if (!pruned) {
		pruned = true;
		try {
			const now = Date.now();
			const entries = fs
				.readdirSync(dir)
				.map((name) => ({ p: path.join(dir, name), st: fs.statSync(path.join(dir, name)) }))
				.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
			let total = 0;
			for (const { p, st } of entries) {
				total += st.size;
				const stale = now - st.mtimeMs > CACHE_KEEP_MS || (total > CACHE_MAX_BYTES && now - st.mtimeMs > 3600 * 1000);
				if (stale || path.basename(p).startsWith("tmp-")) fs.rmSync(p, { recursive: true, force: true });
			}
		} catch {}
	}
	return dir;
}

/** A reused render counts as fresh (the week starts again). */
function touch(file: string) {
	try {
		fs.utimesSync(file, new Date(), new Date());
	} catch {}
}

/** Frames the layers cover (nothing is rendered outside them). */
function coveredFrames(input: MontageInput): [number, number] {
	const first = Math.max(0, Math.floor(Math.min(...input.items.map((i) => i.from)) * input.fps));
	const end = Math.max(...input.items.map((i) => i.from + i.dur));
	const last = Math.min(input.durationInFrames - 1, Math.max(first, Math.ceil(end * input.fps) - 1));
	return [first, last];
}

const inflight: Map<string, string> = ((globalThis as any).__montageLayerJobs as Map<string, string>) ?? ((globalThis as any).__montageLayerJobs = new Map());

/** Starts (or reuses) the render of the transparent AI layer. Result: { overlay, offset (s) }. */
export function startLayerRender(body: { input: MontageInput }) {
	const input = body.input;
	if (!input?.items?.length) throw new StudioError("Nothing to render: there are no AI layers.");
	input.durationInFrames = Math.max(1, Math.round(input.durationInFrames || 1));
	const bundle = bundleDir();
	const stamp = fs.statSync(path.join(bundle, "bundle.js")).mtimeMs;
	const hash = crypto.createHash("sha1").update(JSON.stringify({ input, stamp })).digest("hex").slice(0, 20);
	const range = coveredFrames(input);
	const cached = path.join(cacheDir(), `${hash}.mov`);
	const running = inflight.get(hash);
	if (running && getJob(running)?.status === "running") return getJob(running)!;
	const job = startJob(
		"montage-layer",
		[
			{ id: "browser", title: "Getting the motion graphics renderer", timeout: 3600 },
			{ id: "render", title: "Rendering AI layers", timeout: 1800 },
		],
		async (job: Job) => {
			const result = { overlay: cached, offset: range[0] / input.fps, cached: false };
			if (fs.existsSync(cached)) {
				touch(cached);
				job.skip("browser", "Not needed");
				job.skip("render", "Unchanged — reused");
				return { ...result, cached: true };
			}
			const engine = remotionDir();
			// The first motion graphics export fetches the browser it renders with (once, ≈ 180 MB), with its own progress.
			let browser = browserExecutable(engine);
			if (browser || !isPackaged()) job.skip("browser", "Ready");
			else
				await job.step("browser", async () => {
					browser = await ensureComponent("chrome", (fraction) => job.progress("browser", fraction));
				});
			await job.step("render", async (signal) => {
				const dir = fs.mkdtempSync(path.join(cacheDir(), "tmp-"));
				try {
					const out = path.join(dir, "overlay.mov");
					const args = path.join(dir, "args.json");
					const script = path.join(dataDir(), "montage-render.mjs");
					fs.writeFileSync(script, RENDER_SCRIPT);
					// Measured on M1 Pro (Untitled.mp4, 430 frames): 4 tabs 6.7–7.5 s, 8 tabs 9.9 s — more tabs only fight for cores.
					const concurrency = Math.max(2, Math.min(6, Math.round(os.cpus().length / 2)));
					fs.writeFileSync(args, JSON.stringify({ remotionDir: engine, browserExecutable: browser, serveUrl: bundle, input, out, concurrency, frameRange: range }));
					const node = nodeCommand(script, args);
					const r = await run(node.bin, node.argv, {
						timeout: 1800,
						signal,
						onLine: (line) => {
							const m = /^PROGRESS ([\d.]+)/.exec(line);
							if (m) job.progress("render", Number(m[1]));
						},
					});
					if (r.status !== 0 || !fs.existsSync(out)) throw new StudioError(`Rendering AI layers failed: ${reason(r)}`);
					fs.renameSync(out, cached);
				} finally {
					fs.rmSync(dir, { recursive: true, force: true });
				}
			});
			pruneCache(cached);
			return result;
		},
	);
	inflight.set(hash, job.id);
	return job;
}

/** Keeps the cache small: the newest 6 layer renders. */
function pruneCache(keep: string) {
	try {
		const dir = cacheDir();
		const files = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".mov"))
			.map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
			.sort((a, b) => b.t - a.t);
		for (const { f } of files.slice(6)) if (f !== keep) fs.rmSync(f, { force: true });
	} catch {}
}

async function waitForJob(id: string, signal: AbortSignal): Promise<{ overlay: string; offset: number }> {
	for (;;) {
		if (signal.aborted) throw new CancelledError();
		const j = getJob(id);
		if (!j) throw new StudioError("The AI layer render was lost. Export again.");
		if (j.status === "done") return j.result as { overlay: string; offset: number };
		if (j.status === "cancelled") throw new CancelledError();
		if (j.status === "failed") throw new StudioError(j.error || "Rendering AI layers failed.");
		await new Promise((r) => setTimeout(r, 150));
	}
}

/** Lays the rendered AI layer over OpenCut's exported video. */
export function startComposite(body: { fileId: string; layerJob: string; format?: string }) {
	const base = getFile(String(body.fileId ?? ""));
	const layerJob = String(body.layerJob ?? "");
	return startJob("montage-composite", [{ id: "composite", title: "Compositing", timeout: 600 }], async (job: Job) => {
		const { overlay, offset } = await waitForJob(layerJob, job.signal);
		const ext = body.format === "webm" ? "webm" : "mp4";
		const out = newFile(`export.${ext}`);
		await job.step("composite", async (signal) => {
			const video =
				ext === "webm"
					? ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "24", "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8"]
					: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p"];
			const c = await run(
				findTool("ffmpeg"),
				[
					"-nostdin", "-y", "-i", base.path, "-i", overlay,
					"-filter_complex",
					`[1:v]setpts=PTS+${offset.toFixed(6)}/TB[o];[o][0:v]scale2ref[ov][base];[base][ov]overlay=0:0:format=auto:eof_action=pass:repeatlast=0[v]`,
					"-map", "[v]", "-map", "0:a?", ...video, "-c:a", "copy",
					...(ext === "mp4" ? ["-movflags", "+faststart"] : []),
					out.path,
				],
				{ timeout: 600, signal },
			);
			if (c.status !== 0) throw new StudioError(`Compositing the AI layers failed: ${reason(c)}`);
		});
		return { fileId: out.id };
	});
}

/**
 * An AI layer as a regular transparent video (HEVC with alpha, Apple's hardware encoder), so the editor can place it
 * at its own track position: clips laid ABOVE an AI layer then really cover it, in the preview and in the export.
 * Converted copies are cached by the layer render they come from.
 */
export function startLayerProxy(body: { input: MontageInput }) {
	const render = startLayerRender(body);
	return startJob("montage-layer-proxy", [{ id: "render", title: "Rendering the AI layer", timeout: 1800 }, { id: "convert", title: "Preparing it for the timeline", timeout: 600 }], async (job: Job) => {
		const { overlay, offset } = await job.step("render", async (signal) => {
			for (;;) {
				const r = getJob(render.id);
				if (r?.stages?.[0]?.progress != null) job.progress("render", r.stages[0].progress);
				if (signal.aborted) throw new CancelledError();
				if (!r) throw new StudioError("The AI layer render was lost. Try again.");
				if (r.status === "done") return r.result as { overlay: string; offset: number };
				if (r.status === "failed" || r.status === "cancelled") throw new StudioError(r.error || "Rendering the AI layer failed.");
				await new Promise((res) => setTimeout(res, 150));
			}
		});
		// HEVC with alpha is Apple's (encoder and decoder); Windows gets VP9 with alpha in WebM, which Chromium plays there.
		const mac = IS_MAC;
		const cached = overlay.replace(/\.mov$/, mac ? ".hevc.mov" : ".vp9.webm");
		if (!fs.existsSync(cached)) {
			await job.step("convert", async (signal) => {
				const tmp = mac ? `${cached}.tmp.mov` : `${cached}.tmp.webm`;
				const codec = mac
					? ["-c:v", "hevc_videotoolbox", "-alpha_quality", "0.9", "-pix_fmt", "bgra", "-q:v", "45", "-tag:v", "hvc1"]
					: ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-auto-alt-ref", "0"];
				const c = await run(findTool("ffmpeg"), ["-nostdin", "-y", "-v", "error", "-i", overlay, ...codec, "-an", tmp], { timeout: 600, signal });
				if (c.status !== 0 || !fs.existsSync(tmp)) throw new StudioError(`Preparing the AI layer failed: ${reason(c)}`);
				fs.renameSync(tmp, cached);
			});
		} else job.skip("convert", "Unchanged — reused");
		const out = newFile(mac ? "AI layer.mov" : "AI layer.webm");
		fs.copyFileSync(cached, out.path);
		return { fileId: out.id, name: out.name, offset };
	});
}
