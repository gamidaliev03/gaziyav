// Manual benchmark (not a unit test): the speech detector (Silero VAD in whisper-cli) against the plain engine, through
// the app's own arguments, alignment and backstops, on clips with a ground truth (GaziyavShell/test/media-gen/make-speech.mjs).
//   WHISPER_CLI=<bundle>/Contents/Resources/bin/whisper-cli WHISPER_MODEL=<ggml model> WHISPER_VAD_MODEL=<ggml-silero…>
//   FFMPEG=<bundle>/…/ffmpeg bun src/transcribe/__tests__/vad-eval.ts <media dir> <clip,clip…> [variant,variant…] [out.json] [reps]
// Variants: plain and app — what the app runs (transcribe/server/listen.ts, the engine's own queue, priority and
// thermal pauses) without and with the detector's file; and for trying settings, whisper-cli run directly: cli (no
// detector), vad (the app's flags, nothing else) or vad:<whisper-cli VAD flags joined by «_»> (vad:-vp_200_-vsd_500);
// «+gate» after a vad variant also aligns on the islands kept where the detector heard a voice (transcribe/vad.ts),
// «+gate=flat» without looking for the pauses in the sound.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dropHallucinations } from "@/hear/hallucinations";
import { alignWords, dropPhantoms, FINE, frameLevels, speechIslands, type Word } from "@/transcribe/align";
import { readPcm16 } from "@/transcribe/server/job";
import { hear, lay } from "@/transcribe/server/listen";
import { findModel, findVad, findWhisper, parseWhisperJson, VAD_ARGS, whisperArgs } from "@/transcribe/server/whisper";
import { vadSegmentOf, voiceZones, voicedIslands } from "@/transcribe/vad";
import { drift, type Score, score, stats, type Truth } from "./speech-eval-lib";

const [dir, clipList, variantList = "plain,vad", outFile, repsArg] = process.argv.slice(2);
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const cli = findWhisper();
const model = findModel();
const vadFile = findVad();
if (!cli || !model || !vadFile) throw new Error(`whisper-cli ${cli}, model ${model}, detector ${vadFile}: set WHISPER_CLI, WHISPER_MODEL, WHISPER_VAD_MODEL`);
const reps = Number(repsArg) || 1;
const levelsOf = new Map<string, Float32Array>();
const load = () => os.loadavg()[0].toFixed(1);

interface Run {
	variant: string;
	wall: number[];
	rssMb: number;
	raw: number;
	aligned: number;
	afterPhantoms: number;
	final: number;
	rawScore: Score;
	score: Score;
	words: Word[];
}

type One = Omit<Run, "wall"> & { wall: number };

/** What the app runs (listen.ts): with the detector's file (WHISPER_VAD_MODEL), or as on a Mac that has none (WHISPER_VAD=0). */
async function runApp(detector: boolean, wav: string, language: string, work: string, samples: Int16Array, sampleRate: number, levels: Float32Array, islands: ReturnType<typeof speechIslands>, truth: Truth): Promise<One> {
	const dir = fs.mkdtempSync(path.join(work, "app-"));
	if (detector) delete process.env.WHISPER_VAD;
	else process.env.WHISPER_VAD = "0";
	const t0 = performance.now();
	const heard = await hear({ wav, samples, sampleRate, levels, islands, dir, language, duration: samples.length / sampleRate });
	const laid = lay(heard, levels, islands);
	const wall = (performance.now() - t0) / 1000;
	delete process.env.WHISPER_VAD;
	if (detector !== !!heard.voiced) throw new Error(`app: the detector ${heard.voiced ? "took" : "did not take"} part`);
	const final = dropHallucinations(laid);
	return {
		variant: detector ? `app (again ${heard.doubted ?? 0}, believed ${heard.believed ?? 0})` : "plain",
		wall,
		rssMb: 0,
		raw: heard.words.length,
		aligned: heard.words.length,
		afterPhantoms: laid.length,
		final: final.length,
		rawScore: score(truth, heard.words),
		score: score(truth, final),
		words: final,
	};
}

function run(variantSpec: string, wav: string, language: string, work: string, islands: ReturnType<typeof speechIslands>, fine: ReturnType<typeof speechIslands>, truth: Truth): One {
	const [variant, gate] = variantSpec.split("+gate");
	const gated = gate !== undefined;
	const out = path.join(work, variantSpec.replace(/[^\w]+/g, "_"));
	let base = whisperArgs({ model: model as string, wav, language, out, vad: null });
	// the detector's stretches are in the engine's log: it must not be silenced
	if (gated) base = base.filter((a) => a !== "-np");
	const extra = variant === "cli" ? [] : variant === "vad" ? ["--vad", "-vm", vadFile as string, ...VAD_ARGS] : ["--vad", "-vm", vadFile as string, ...variant.slice(4).split("_")];
	fs.rmSync(`${out}.json`, { force: true });
	const t0 = performance.now();
	const r = spawnSync("/usr/bin/time", ["-l", cli as string, ...base, ...extra], { encoding: "utf8", maxBuffer: 256e6 });
	const wall = (performance.now() - t0) / 1000;
	if (r.status !== 0 || !fs.existsSync(`${out}.json`)) throw new Error(`${variantSpec}: whisper-cli failed (${r.status}): ${r.stderr.slice(-400)}`);
	const rss = Number(/(\d+)\s+peak memory footprint/.exec(r.stderr)?.[1] ?? /(\d+)\s+maximum resident set size/.exec(r.stderr)?.[1] ?? 0);
	const raw = parseWhisperJson(fs.readFileSync(`${out}.json`, "utf8")).words;
	let useIslands = islands;
	let useFine = fine;
	if (gated) {
		const reported = r.stderr.split("\n").map(vadSegmentOf).filter((v): v is NonNullable<typeof v> => !!v);
		const pad = Number(extra[extra.indexOf("-vp") + 1] ?? 30) / 1000;
		const zones = voiceZones(reported, gate === "=flat" ? undefined : levelsOf.get(wav), { pad });
		useIslands = voicedIslands(islands, zones);
		useFine = voicedIslands(fine, zones);
	}
	// exactly transcribe/server/job.ts
	const aligned = alignWords(raw, useIslands, useFine);
	const kept = dropPhantoms(aligned, useIslands);
	const final = dropHallucinations(kept);
	return { variant: variantSpec, wall, rssMb: Math.round(rss / 1e6), raw: raw.length, aligned: aligned.length, afterPhantoms: kept.length, final: final.length, rawScore: score(truth, raw), score: score(truth, final), words: final };
}

const report: Record<string, unknown> = { at: new Date().toISOString(), cli, model: path.basename(model), detector: path.basename(vadFile), vadArgs: VAD_ARGS, clips: {} };
const work = fs.mkdtempSync(path.join(os.tmpdir(), "vad-eval-"));
try {
	for (const clip of clipList.split(",")) {
		const truth = JSON.parse(fs.readFileSync(path.join(dir, `${clip}.json`), "utf8")) as Truth;
		const wav = path.join(work, `${clip}.16k.wav`);
		const src = fs.existsSync(path.join(dir, `${clip}.wav`)) ? path.join(dir, `${clip}.wav`) : path.join(dir, `${clip}.mp4`);
		const c = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
		if (c.status !== 0) throw new Error(`ffmpeg: ${c.stderr}`);
		const { samples, sampleRate } = readPcm16(wav);
		const levels = frameLevels(samples, sampleRate);
		levelsOf.set(wav, levels);
		const islands = speechIslands(levels);
		const fine = speechIslands(levels, FINE);
		const variants = variantList.split(",");
		const runs = new Map<string, Run>();
		console.log(`\n== ${clip}: ${truth.seconds.toFixed(1)} s, ${truth.sentences.length} sentences, quiet ${truth.quiet.map((q) => `${q.kind} ${(q.end - q.start).toFixed(0)} s`).join(", ") || "none"} · load ${load()}`);
		// alternating: plain, vad, plain, vad … so a busy minute hits both alike
		for (let rep = 0; rep < reps; rep++) {
			for (const v of variants) {
				const r = v === "app" || v === "plain" ? await runApp(v === "app", wav, truth.lang, work, samples, sampleRate, levels, islands, truth) : run(v, wav, truth.lang, work, islands, fine, truth);
				const had = runs.get(v);
				if (had) had.wall.push(r.wall);
				else runs.set(v, { ...r, wall: [r.wall] });
			}
		}
		const first = runs.get(variants[0]) as Run;
		const rows: Record<string, unknown> = {};
		for (const [v0, r] of runs) {
			const v = r.variant.startsWith("app") ? r.variant : v0;
			const s = r.score;
			const d = v0 === variants[0] ? null : drift(first.score, s);
			const wall = [...r.wall].sort((a, b) => a - b)[Math.floor((r.wall.length - 1) / 2)];
			console.log(
				`${v.padEnd(26)} ${wall.toFixed(1).padStart(6)} s  ${String(r.rssMb).padStart(5)} MB  words ${r.raw}→${r.final} (phantoms −${r.aligned - r.afterPhantoms}, credit lines −${r.afterPhantoms - r.final})  WER ${(s.wer * 100).toFixed(1)} % (lost ${s.lost}, wrong ${s.wrong}, invented ${s.invented})  invented lines raw ${r.rawScore.inventedLines.length} → final ${s.inventedLines.length}  misplaced raw ${r.rawScore.misplaced} → final ${s.misplaced} (max ${s.misplacedMax} s)  start err ${JSON.stringify(stats(s.startErr))}  end err ${JSON.stringify(stats(s.endErr))}${d ? `  drift vs ${variants[0]}: start ${JSON.stringify(stats(d.start))} end ${JSON.stringify(stats(d.end))}` : ""}`,
			);
			for (const l of r.rawScore.inventedLines) console.log(`      raw invented  ${l.start.toFixed(1)}–${l.end.toFixed(1)}  ${l.text}`);
			for (const l of s.inventedLines) console.log(`      FINAL invented ${l.start.toFixed(1)}–${l.end.toFixed(1)}  ${l.text}`);
			rows[v] = {
				wall: r.wall.map((w) => Math.round(w * 100) / 100),
				rssMb: r.rssMb,
				words: { raw: r.raw, aligned: r.aligned, afterPhantoms: r.afterPhantoms, final: r.final },
				wer: Math.round(s.wer * 1000) / 10,
				lost: s.lost,
				wrong: s.wrong,
				invented: s.invented,
				inventedLinesRaw: r.rawScore.inventedLines,
				inventedLinesFinal: s.inventedLines,
				misplacedRaw: r.rawScore.misplaced,
				misplaced: s.misplaced,
				misplacedMax: s.misplacedMax,
				startErr: stats(s.startErr),
				endErr: stats(s.endErr),
				...(d ? { drift: { start: stats(d.start), end: stats(d.end) } } : {}),
			};
		}
		(report.clips as Record<string, unknown>)[clip] = { seconds: truth.seconds, load: load(), rows };
	}
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
