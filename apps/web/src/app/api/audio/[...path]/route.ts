// Per-clip audio effects, rendered on this Mac (nothing leaves the computer).
//   GET  /api/audio/status            → { isolation: boolean, ffmpeg: boolean }
//   POST /api/audio/fx?chain=a,b,c&settings={…} → WAV body → processed WAV, same length, no added delay
// Voice isolation runs Apple's AUSoundIsolation through the bundled `voiceisolate` helper
// (latency-compensated); the other effects are ffmpeg filters (see sounds/mix/fx.ts).
import fs from "node:fs";
import path from "node:path";
import { explain, StudioError } from "@/studio/server/errors";
import { workDir } from "@/studio/server/files";
import { findTool, run } from "@/studio/server/tools";
import { fxSteps, parseFxChain, parseFxSettings } from "@/sounds/mix/fx";
import { reverbIr } from "@/sounds/mix/reverb-ir";
import { IS_WINDOWS } from "@/platform/os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status = 200) => Response.json(data, { status });
const MAX_BYTES = 1024 * 1024 * 1024;

// Same guard as /api/studio: only the app's own window may call this.
function forbidden(req: Request): Response | null {
	const host = (req.headers.get("host") ?? "").toLowerCase();
	if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json({ error: "Request refused" }, 403);
	const origin = req.headers.get("origin");
	if (origin && origin !== `http://${host}`) return json({ error: "Request refused" }, 403);
	if (req.method !== "GET" && req.headers.get("x-studio") !== "1") return json({ error: "Request refused" }, 403);
	return null;
}

function isolationTool(): string | null {
	const dirs = [process.env.STUDIO_BIN_DIR, process.env.STUDIO_AUDIO_BIN_DIR].filter((d): d is string => !!d);
	for (const dir of dirs) {
		const p = path.join(dir, "voiceisolate");
		try {
			fs.accessSync(p, fs.constants.X_OK);
			return p;
		} catch {}
	}
	return null;
}

function hasFfmpeg(): boolean {
	try {
		findTool("ffmpeg");
		return true;
	} catch {
		return false;
	}
}

/** Integrated loudness (LUFS, EBU R128) of a file by ffmpeg's ebur128; null for silence or when it can't be read. */
async function integratedLoudness(file: string, signal: AbortSignal): Promise<number | null> {
	const r = await run(findTool("ffmpeg"), ["-nostdin", "-hide_banner", "-nostats", "-i", file, "-af", "ebur128=framelog=quiet", "-f", "null", "-"], {
		timeout: 600,
		signal,
	});
	const all = [...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
	const lufs = all.length ? Number(all[all.length - 1][1]) : Number.NaN;
	return Number.isFinite(lufs) && lufs > -60 ? lufs : null;
}

/** Sample rate and channels of a WAV (its fmt chunk). */
function wavFormat(buf: Buffer): { rate: number; channels: number } {
	let pos = 12;
	while (pos + 8 <= buf.length) {
		const id = buf.toString("ascii", pos, pos + 4);
		const size = buf.readUInt32LE(pos + 4);
		if (id === "fmt ") return { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12) };
		pos += 8 + size + (size % 2);
	}
	return { channels: 2, rate: 48000 };
}

/** Sample frames in a PCM WAV (16/24/32-bit or float), from its fmt and data chunks. */
function wavFrames(buf: Buffer): number {
	if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
		throw new StudioError("The audio could not be read (expected WAV). Reload the window and try again.");
	}
	let pos = 12;
	let blockAlign = 0;
	while (pos + 8 <= buf.length) {
		const id = buf.toString("ascii", pos, pos + 4);
		const size = buf.readUInt32LE(pos + 4);
		if (id === "fmt ") blockAlign = buf.readUInt16LE(pos + 20);
		if (id === "data") {
			if (!blockAlign) break;
			return Math.floor(Math.min(size, buf.length - pos - 8) / blockAlign);
		}
		pos += 8 + size + (size % 2);
	}
	throw new StudioError("The audio could not be read (broken WAV). Reload the window and try again.");
}

export async function GET(req: Request, ctx: Ctx) {
	const blocked = forbidden(req);
	if (blocked) return blocked;
	const [head] = (await ctx.params).path;
	if (head === "status") return json({ isolation: !!isolationTool(), ffmpeg: hasFfmpeg() });
	return json({ error: "Unknown request" }, 404);
}

export async function POST(req: Request, ctx: Ctx) {
	const blocked = forbidden(req);
	if (blocked) return blocked;
	const [head] = (await ctx.params).path;
	if (head !== "fx") return json({ error: "Unknown request" }, 404);
	const chain = parseFxChain(new URL(req.url).searchParams.get("chain") ?? "");
	if (!chain) return json({ error: "Unknown audio effect. Reload the window and try again." }, 400);

	const work = workDir();
	try {
		const body = Buffer.from(await req.arrayBuffer());
		if (body.length > MAX_BYTES) throw new StudioError("This clip is too long for audio effects (over 1 GB of audio).");
		const frames = wavFrames(body);
		let current = path.join(work.dir, "in.wav");
		fs.writeFileSync(current, body);

		if (chain.includes("isolate")) {
			const tool = isolationTool();
			if (!tool) throw new StudioError(IS_WINDOWS ? "Voice isolation isn't available on Windows yet." : "Voice isolation needs macOS 13 or newer (the voice isolation helper is missing).");
			const out = path.join(work.dir, "isolated.wav");
			const r = await run(tool, [current, out, "100"], { timeout: 600, signal: req.signal });
			if (r.status === 3) throw new StudioError("Voice isolation needs macOS 13 or newer.");
			if (r.status !== 0) throw new StudioError(`Voice isolation failed: ${r.stderr.trim().split("\n").pop() || "unknown reason"}`);
			current = out;
		}

		// Always through ffmpeg: exact length (pad what a filter shortened, cut an echo tail) and a plain PCM WAV every
		// decoder reads (Apple's writer adds chunks some demuxers reject). The chain runs as steps (sounds/mix/fx.ts):
		// filter graphs; the reverb against its own impulse response; Normalize loudness measured between two passes,
		// one gain, then what follows it (or the safety limiter when nothing does).
		const settings = parseFxSettings(new URL(req.url).searchParams.get("settings"));
		const steps = fxSteps(chain, settings);
		const { rate, channels } = wavFormat(body);
		const tail = `apad=whole_len=${frames},atrim=end_sample=${frames}`;
		const ffmpeg = async (args: string[], label: string) => {
			const r = await run(findTool("ffmpeg"), ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", ...args], { timeout: 600, signal: req.signal });
			if (r.status !== 0) throw new StudioError(`Audio effects failed (${label}): ${r.stderr.trim().split("\n").pop() || "unknown reason"}`);
		};
		const pcm = ["-map_metadata", "-1", "-fflags", "+bitexact", "-c:a", "pcm_s16le"];
		let index = 0;
		const graphPass = async (graph: string) => {
			const out = path.join(work.dir, `out${index++}.wav`);
			await ffmpeg(["-i", current, "-af", `${graph ? `${graph},` : ""}${tail}`, ...pcm, out], "ffmpeg");
			current = out;
		};
		if (steps.length === 0) await graphPass("");
		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];
			if (step.kind === "graph") await graphPass(step.graph);
			else if (step.kind === "reverb") {
				const ir = path.join(work.dir, `ir${index}.wav`);
				fs.writeFileSync(ir, reverbIr(step.plan, rate, channels));
				const wet = Math.max(0, Math.min(100, step.plan.mix)) / 100;
				const out = path.join(work.dir, `out${index++}.wav`);
				const graph = `[0:a]asplit=2[dry][send];[send][1:a]afir=gtype=none:irnorm=-1:irgain=1[room];[dry][room]amix=inputs=2:weights=1 ${wet.toFixed(3)}:normalize=0,${tail}[out]`;
				await ffmpeg(["-i", current, "-i", ir, "-filter_complex", graph, "-map", "[out]", ...pcm, out], "reverb");
				current = out;
			} else {
				const lufs = await integratedLoudness(current, req.signal);
				// silence stays silence; the gain is held to ±20 dB, and peaks are kept under −1 dB by the limiter
				const gain = lufs === null ? 0 : Math.max(-20, Math.min(20, step.target - lufs));
				const next = steps[i + 1];
				const rest = next?.kind === "graph" ? next.graph : "alimiter=limit=0.891:release=80:latency=1:level=false";
				if (next?.kind === "graph") i++;
				await graphPass(`volume=${gain.toFixed(2)}dB,${rest}`);
			}
		}

		const result = fs.readFileSync(current);
		return new Response(new Uint8Array(result), {
			headers: { "Content-Type": "audio/wav", "Content-Length": String(result.length), "X-Frames": String(frames) },
		});
	} catch (error) {
		console.error("audio fx:", error);
		return json({ error: error instanceof StudioError ? error.message : explain(error) }, 400);
	} finally {
		work.dispose();
	}
}
