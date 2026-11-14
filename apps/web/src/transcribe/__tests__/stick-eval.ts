// Manual benchmark (not a unit test): the transcription job's own path — listen.ts `hear` + `lay`, then the backstop of
// hear/hallucinations.ts, exactly transcribe/server/job.ts without its cache — on the captions department's set A
// prints the stick's own table. What the engine heard is kept per clip in <cache dir>/<plain|vad>, so a change to how
// the words are laid is scored again in seconds.
//   WHISPER_CLI=<bundle>/Contents/Resources/bin/whisper-cli WHISPER_MODEL=<ggml model> WHISPER_VAD_MODEL=<ggml-silero…>
//   FFMPEG=<bundle>/…/ffmpeg bun src/transcribe/__tests__/stick-eval.ts <media dir> <out.json> [all | clip,kind…] [cache dir]
// WHISPER_VAD=0: as on a Mac without the detector's file; STICK_VARIANT=<name> keeps the engine's output under another
// name (a try of other detector settings).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dropHallucinations } from "@/hear/hallucinations";
import { frameLevels, speechIslands } from "@/transcribe/align";
import { readPcm16 } from "@/transcribe/server/job";
import { type Heard, hear, lay } from "@/transcribe/server/listen";

interface Clip {
	id: string;
	kind: string;
	lang: string;
	files: { wav: string };
}

const [media, outFile, only = "all", cacheArg] = process.argv.slice(2);
if (!media || !outFile) throw new Error("usage: stick-eval.ts <media dir> <out.json> [all | clip,kind…] [cache dir]");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const set = JSON.parse(fs.readFileSync(path.join(media, "set-a.json"), "utf8")) as { clips: Clip[] };
const clips = set.clips.filter((c) => only === "all" || only.split(",").some((o) => o === c.id || o === c.kind));
const variant = process.env.WHISPER_VAD === "0" ? "plain" : (process.env.STICK_VARIANT ?? "vad");
const cache = cacheArg ? path.join(cacheArg, variant) : null;
if (cache) fs.mkdirSync(cache, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), "stick-eval-"));
const raw = { label: path.basename(outFile, ".json").replace(/^captions-raw-/, ""), made: new Date().toISOString(), engine: {} as Record<string, unknown>, ui: {}, known: {}, names: {} };
const load = () => os.loadavg()[0];

try {
	for (const clip of clips) {
		const wav = path.join(cache ?? work, `${clip.id}.16k.wav`);
		if (!fs.existsSync(wav)) {
			const c = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", path.join(media, clip.files.wav), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
			if (c.status !== 0) throw new Error(`ffmpeg: ${c.stderr}`);
		}
		const { samples, sampleRate } = readPcm16(wav);
		const levels = frameLevels(samples, sampleRate);
		const islands = speechIslands(levels);
		const kept = cache ? path.join(cache, `${clip.id}.heard.json`) : "";
		const at = load();
		let heard: Heard;
		let recognize = 0;
		if (kept && fs.existsSync(kept)) heard = JSON.parse(fs.readFileSync(kept, "utf8")) as Heard;
		else {
			const dir = fs.mkdtempSync(path.join(work, `${clip.id}-`));
			const t0 = performance.now();
			heard = await hear({ wav, samples, sampleRate, levels, islands, dir, language: clip.lang, duration: samples.length / sampleRate });
			recognize = (performance.now() - t0) / 1000;
			if (kept) fs.writeFileSync(kept, JSON.stringify({ ...heard, recognize, load: at }));
		}
		const t1 = performance.now();
		const words = dropHallucinations(lay(heard, levels, islands));
		const align = (performance.now() - t1) / 1000;
		const r = heard as Heard & { recognize?: number; load?: number };
		const took = recognize || r.recognize || 0;
		raw.engine[clip.id] = { set: { words, language: heard.language, wall: took + align, recognize: took, load: recognize ? at : (r.load ?? at) } };
		console.log(`${clip.id.padEnd(14)} ${variant} words ${String(words.length).padStart(4)}  voiced ${heard.voiced?.length ?? "—"} doubted ${heard.doubted ?? "—"} believed ${heard.believed ?? "—"}  hear ${took.toFixed(1)} s${recognize ? "" : " (kept)"} lay ${align.toFixed(2)} s (load ${at.toFixed(0)})`);
	}
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
fs.writeFileSync(outFile, JSON.stringify(raw));
console.log(`→ ${outFile}`);
