// The agent's eyes: renders still frames of the planned layers with the real export engine (@remotion/renderer +
// the prebuilt bundle), in its own Chrome process, so a broken or hanging component never reaches the editor.
// Reports render errors (from the layer boundary and the loader), empty frames and slow frames; can lay a frame over
// the video under the composition for the art-director check.
import fs from "node:fs";
import path from "node:path";
import { CancelledError } from "@/studio/server/errors";
import { dataDir, getFile } from "@/studio/server/files";
import { findTool, run } from "@/studio/server/tools";
import { LOOPBACK_ONLY_SOURCE, VIA_VPN_SOURCE } from "@/net/remotion-proxy";
import type { MontageInput } from "../types";
import { browserFor, bundleDir, nodeCommand, remotionDir } from "./render";

const STILL_SCRIPT = `
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const require = createRequire(path.join(a.remotionDir, "package.json"));
${LOOPBACK_ONLY_SOURCE}
const { renderStill, selectComposition, openBrowser } = require("@remotion/renderer");
const say = (k, v) => console.log(k + " " + JSON.stringify(v));
const onBrowserLog = (log) => {
	const text = String(log.text || "");
	if (text.includes("[montage-error]") || log.type === "error") say("LOG", { type: log.type, text: text.slice(0, 600) });
};
${VIA_VPN_SOURCE}
const vpn = await viaVpn(a.browserExecutable, path.dirname(process.argv[2]));
const browser = await openBrowser("chrome", { browserExecutable: vpn.exe || null, chromiumOptions: { gl: "angle" }, logLevel: "error" });
try {
	const composition = await selectComposition({ serveUrl: a.serveUrl, id: "Montage", inputProps: a.input, puppeteerInstance: browser, logLevel: "error", onBrowserLog, timeoutInMilliseconds: 30000 });
	for (const f of a.frames) {
		const t0 = Date.now();
		try {
			await renderStill({ composition, serveUrl: a.serveUrl, inputProps: a.input, output: path.join(a.outDir, "f" + f + ".png"), frame: f, imageFormat: "png", puppeteerInstance: browser, onBrowserLog, timeoutInMilliseconds: 25000, logLevel: "error" });
			say("STILL", { frame: f, ms: Date.now() - t0 });
		} catch (e) {
			say("FAIL", { frame: f, ms: Date.now() - t0, message: String((e && e.message) || e).split("\\n")[0].slice(0, 600) });
		}
	}
} finally {
	await browser.close({ silent: true }).catch(() => {});
	vpn.close();
}
console.log("DONE");
`;

export interface StillFrame {
	frame: number;
	/** Composition seconds. */
	at: number;
	file?: string;
	ms?: number;
	/** 0..1 share of covered pixels (alpha). */
	coverage?: number;
	error?: string;
}

export interface StillReport {
	frames: StillFrame[];
	/** Errors logged by components while rendering. */
	logs: string[];
}

export async function renderStills({
	input,
	frames,
	outDir,
	signal,
}: {
	input: MontageInput;
	frames: number[];
	outDir: string;
	signal?: AbortSignal;
}): Promise<StillReport> {
	const script = path.join(dataDir(), "montage-still.mjs");
	fs.writeFileSync(script, STILL_SCRIPT);
	const args = path.join(outDir, "still-args.json");
	const engine = remotionDir();
	fs.writeFileSync(args, JSON.stringify({ remotionDir: engine, browserExecutable: await browserFor(engine), serveUrl: bundleDir(), input, frames, outDir }));
	const node = nodeCommand(script, args);
	const report: StillReport = { frames: frames.map((f) => ({ frame: f, at: f / input.fps })), logs: [] };
	const byFrame = new Map(report.frames.map((f) => [f.frame, f]));
	const r = await run(node.bin, node.argv, {
		timeout: 40 + frames.length * 30,
		signal,
		onLine: (line) => {
			const m = /^(STILL|FAIL|LOG) (.*)$/.exec(line);
			if (!m) return;
			try {
				const v = JSON.parse(m[2]);
				if (m[1] === "LOG") {
					const text = String(v.text).replace(/^.*\[montage-error\]\s*/, "");
					if (/^JSHandle@|^\s*$/.test(text)) return;
					if (!report.logs.includes(text) && report.logs.length < 12) report.logs.push(text);
					return;
				}
				const f = byFrame.get(v.frame);
				if (!f) return;
				f.ms = v.ms;
				if (m[1] === "FAIL") f.error = v.message;
				else f.file = path.join(outDir, `f${v.frame}.png`);
			} catch {}
		},
	});
	if (signal?.aborted) throw new CancelledError();
	if (r.status !== 0 && report.frames.every((f) => !f.file && !f.error)) {
		const why = (r.stderr || r.stdout).split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400);
		for (const f of report.frames) f.error = `the renderer did not start: ${why || `exit ${r.status}`}`;
	}
	for (const f of report.frames) if (f.file) f.coverage = await coverage(f.file, signal).catch(() => undefined);
	return report;
}

/** Share of non-transparent pixels of a PNG (mean alpha), 0..1. */
async function coverage(file: string, signal?: AbortSignal): Promise<number | undefined> {
	const r = await run(findTool("ffmpeg"), ["-nostdin", "-v", "info", "-i", file, "-vf", "format=rgba,alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"], { timeout: 20, signal });
	const m = /YAVG=([\d.]+)/.exec(r.stderr + r.stdout);
	return m ? Number(m[1]) / 255 : undefined;
}

/**
 * The frame as the viewer will see it: the still laid over the video under the composition (when known), small
 * JPEG for the art-director check. Returns a data URL or null.
 */
export async function viewFrame({
	still,
	video,
	at,
	width,
	height,
	outFile,
	signal,
}: {
	still: string;
	video: { fileId: string; start: number; at: number } | null;
	at: number;
	width: number;
	height: number;
	outFile: string;
	signal?: AbortSignal;
}): Promise<string | null> {
	const ffmpeg = findTool("ffmpeg");
	const w = 432;
	const h = Math.round((w * height) / Math.max(1, width) / 2) * 2;
	let args: string[];
	let source: string | null = null;
	if (video) {
		try {
			source = getFile(video.fileId).path;
		} catch {}
	}
	const t = video ? Math.max(0, video.start + (at - video.at)) : 0;
	if (source) {
		args = [
			"-nostdin", "-y", "-v", "error", "-ss", t.toFixed(3), "-i", source, "-i", still,
			"-filter_complex",
			`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[b];[b][1:v]overlay=0:0:format=auto,scale=${w}:${h}[v]`,
			"-map", "[v]", "-frames:v", "1", "-q:v", "4", outFile,
		];
	} else {
		args = ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=0x1d2230:s=${width}x${height}`, "-i", still, "-filter_complex", `[0:v][1:v]overlay=0:0:format=auto,scale=${w}:${h}[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "4", outFile];
	}
	const r = await run(ffmpeg, args, { timeout: 30, signal });
	if (r.status !== 0 || !fs.existsSync(outFile)) return null;
	return `data:image/jpeg;base64,${fs.readFileSync(outFile).toString("base64")}`;
}

/** Moments of one beat side by side (left to right in time): the art director sees the motion, not one still. */
export async function stripOf(files: string[], outFile: string, signal?: AbortSignal): Promise<string | null> {
	const ok = files.filter((f) => fs.existsSync(f));
	if (!ok.length) return null;
	if (ok.length === 1) return `data:image/jpeg;base64,${fs.readFileSync(ok[0]).toString("base64")}`;
	const args = ["-nostdin", "-y", "-v", "error", ...ok.flatMap((f) => ["-i", f]), "-filter_complex", `${ok.map((_, i) => `[${i}:v]`).join("")}hstack=inputs=${ok.length}[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "4", outFile];
	const r = await run(findTool("ffmpeg"), args, { timeout: 30, signal });
	if (r.status !== 0 || !fs.existsSync(outFile)) return null;
	return `data:image/jpeg;base64,${fs.readFileSync(outFile).toString("base64")}`;
}
