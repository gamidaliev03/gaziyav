// Manual: prints, for one clip, the detector's stretches, the gated islands and every sentence's first and last word.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { frameLevels, speechIslands } from "@/transcribe/align";
import { readPcm16 } from "@/transcribe/server/job";
import { hear, lay } from "@/transcribe/server/listen";
import { voicedIslands } from "@/transcribe/vad";
import { score, type Truth } from "./speech-eval-lib";

const [wav, truthFile] = process.argv.slice(2);
const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as Truth;
const { samples, sampleRate } = readPcm16(wav);
const levels = frameLevels(samples, sampleRate);
const islands = speechIslands(levels);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vad-dbg-"));
const heard = await hear({ wav, samples, sampleRate, levels, islands, dir, language: truth.lang, duration: samples.length / sampleRate });
const f = (n: number) => n.toFixed(2);
console.log("islands", islands.length, islands.slice(0, 12).map((s) => `${f(s.start)}-${f(s.end)}`).join(" "));
console.log("voiced ", heard.voiced?.map((s) => `${f(s.start)}-${f(s.end)}`).join(" "));
const gated = voicedIslands(islands, heard.voiced ?? []);
console.log("gated  ", gated.map((s) => `${f(s.start)}-${f(s.end)}`).join(" "));
console.log("raw    ", heard.words.map((w) => `${f(w.start)}:${w.text}`).join(" ").slice(0, 1500));
const words = lay(heard, levels, islands);
console.log("laid   ", words.map((w) => `${f(w.start)}-${f(w.end)}:${w.text}`).join(" ").slice(0, 3000));
const s = score(truth, words);
console.log("misplaced", s.misplaced, "start errs", s.startErr.map((e) => Math.round(e)).join(","), "end errs", s.endErr.map((e) => Math.round(e)).join(","));
for (const t of truth.sentences) console.log(`truth ${f(t.start)}-${f(t.end)} ${t.text.slice(0, 40)}`);
fs.rmSync(dir, { recursive: true, force: true });
