// Manual benchmark (not a unit test): the Russian engine (GigaAM v3 through native/local-asr.py) against Whisper as the
// app runs it (without and with the speech detector), on clips with a ground truth (GaziyavShell/test/media-gen/make-speech.mjs).
//   WHISPER_CLI=… WHISPER_MODEL=… WHISPER_VAD_MODEL=… FFMPEG=… ASR_PYTHON=<env>/bin/python ASR_HELPER=<shell>/native/local-asr.py
//   ASR_MODELS=<folder with the model's files> bun src/transcribe/__tests__/asr-eval.ts <media dir> <clip,clip…> [out.json] [reps] [engines=plain,app,giga]
// The Russian engine is scored twice: with its own word times (giga-own) and laid on the sound like Whisper's words
// (giga, what the app would run).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dropHallucinations } from "@/hear/hallucinations";
import { alignWords, dropPhantoms, FINE, frameLevels, speechIslands, type Word } from "@/transcribe/align";
import { readPcm16 } from "@/transcribe/server/job";
import { hear, lay } from "@/transcribe/server/listen";
import { voicedIslands } from "@/transcribe/vad";
import { speechWindows, zonesOfWords } from "@/transcribe/windows";
import { type Score, score, stats, type Truth } from "./speech-eval-lib";

const [dir, clipList, outFile, repsArg, engineList = "plain,app,giga"] = process.argv.slice(2);
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const PY = process.env.ASR_PYTHON as string;
const HELPER = process.env.ASR_HELPER as string;
const MODELS = process.env.ASR_MODELS as string;
const reps = Number(repsArg) || 1;
const engines = engineList.split(",");
const load = () => os.loadavg()[0].toFixed(1);
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)];

interface Row {
	engine: string;
	wall: number[];
	extra: string;
	rssMb?: number;
	score: Score;
	words: Word[];
}

const report: Record<string, unknown> = { at: new Date().toISOString(), clips: {} };
const work = fs.mkdtempSync(path.join(os.tmpdir(), "asr-eval-"));
try {
	for (const clip of clipList.split(",")) {
		const truth = JSON.parse(fs.readFileSync(path.join(dir, `${clip}.json`), "utf8")) as Truth;
		const wav = path.join(work, `${clip}.16k.wav`);
		const src = fs.existsSync(path.join(dir, `${clip}.wav`)) ? path.join(dir, `${clip}.wav`) : path.join(dir, `${clip}.mp4`);
		const c = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
		if (c.status !== 0) throw new Error(`ffmpeg: ${c.stderr}`);
		const { samples, sampleRate } = readPcm16(wav);
		const seconds = samples.length / sampleRate;
		const levels = frameLevels(samples, sampleRate);
		const islands = speechIslands(levels);
		const fine = speechIslands(levels, FINE);
		console.log(`\n== ${clip}: ${truth.seconds.toFixed(1)} s, ${truth.sentences.length} sentences · load ${load()}`);
		const rows = new Map<string, Row>();
		const add = (engine: string, wall: number, words: Word[], extra = "", rssMb?: number) => {
			const had = rows.get(engine);
			if (had) had.wall.push(wall);
			else rows.set(engine, { engine, wall: [wall], extra, rssMb, score: score(truth, words), words });
		};
		for (let rep = 0; rep < reps; rep++) {
			for (const engine of engines) {
				if (engine === "plain" || engine === "app") {
					if (engine === "app") delete process.env.WHISPER_VAD;
					else process.env.WHISPER_VAD = "0";
					const d = fs.mkdtempSync(path.join(work, "w-"));
					const t0 = performance.now();
					const heard = await hear({ wav, samples, sampleRate, levels, islands, dir: d, language: truth.lang, duration: seconds });
					const final = dropHallucinations(lay(heard, levels, islands));
					add(engine, (performance.now() - t0) / 1000, final, heard.voiced ? `again ${heard.doubted}, believed ${heard.believed}` : "");
					delete process.env.WHISPER_VAD;
				} else if (engine === "giga") {
					const windows = speechWindows(islands, levels, seconds);
					const wfile = path.join(work, "windows.json");
					const out = path.join(work, "giga.json");
					fs.writeFileSync(wfile, JSON.stringify(windows.map((w) => [w.start, w.end])));
					fs.rmSync(out, { force: true });
					const t0 = performance.now();
					const r = spawnSync("/usr/bin/time", ["-l", PY, "-I", HELPER, "--models", MODELS, "--input", wav, "--windows", wfile, "--out", out, "--threads", String(Math.max(2, Math.min(8, os.cpus().length - 2))), ...(process.env.ASR_COREML ? ["--coreml"] : [])], {
						encoding: "utf8",
						env: { ...process.env, HF_HUB_OFFLINE: "1" },
					});
					const wall = (performance.now() - t0) / 1000;
					if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`giga: ${r.stdout.slice(-300)} ${r.stderr.slice(-300)}`);
					const rss = Number(/(\d+)\s+peak memory footprint/.exec(r.stderr)?.[1] ?? 0);
					const res = JSON.parse(fs.readFileSync(out, "utf8")) as { words: Word[]; seconds: number; load: number };
					const zones = zonesOfWords(res.words);
					const gated = voicedIslands(islands, zones);
					const laid = dropHallucinations(dropPhantoms(alignWords(res.words, gated, voicedIslands(fine, zones)), gated));
					const extra = `${windows.length} windows (longest ${Math.max(...windows.map((w) => w.end - w.start)).toFixed(1)} s), model load ${res.load} s, recognition ${res.seconds} s`;
					add("giga-own", wall, dropHallucinations(res.words), extra, Math.round(rss / 1e6));
					add("giga", wall, laid, extra, Math.round(rss / 1e6));
				}
			}
		}
		const out: Record<string, unknown> = {};
		for (const r of rows.values()) {
			const s = r.score;
			console.log(
				`${r.engine.padEnd(9)} ${med(r.wall).toFixed(1).padStart(6)} s${r.rssMb ? ` ${String(r.rssMb).padStart(5)} MB` : "         "}  ${String(r.words.length).padStart(4)} words  WER ${(s.wer * 100).toFixed(1).padStart(5)} % (lost ${s.lost}, wrong ${s.wrong}, invented ${s.invented})  outside sentence ${s.misplaced} (max ${s.misplacedMax} s)  starts ${JSON.stringify(stats(s.startErr))}  ends ${JSON.stringify(stats(s.endErr))}  ${r.extra}`,
			);
			for (const l of s.inventedLines) console.log(`      invented ${l.start.toFixed(1)}–${l.end.toFixed(1)}  ${l.text}`);
			out[r.engine] = { wall: r.wall.map((w) => Math.round(w * 100) / 100), rssMb: r.rssMb, words: r.words.length, wer: Math.round(s.wer * 1000) / 10, lost: s.lost, wrong: s.wrong, invented: s.invented, inventedLines: s.inventedLines, misplaced: s.misplaced, misplacedMax: s.misplacedMax, startErr: stats(s.startErr), endErr: stats(s.endErr), extra: r.extra, text: r.words.map((w) => w.text).join(" ") };
		}
		(report.clips as Record<string, unknown>)[clip] = { seconds: truth.seconds, load: load(), rows: out };
	}
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
