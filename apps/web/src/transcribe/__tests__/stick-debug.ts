// Manual: islands and words of one set-A clip from the kept engine output (stick-eval.ts): bun stick-debug.ts <cache dir> <clip>
import fs from "node:fs";
import path from "node:path";
import { FINE, frameLevels, speechIslands } from "@/transcribe/align";
import { readPcm16 } from "@/transcribe/server/job";
import { type Heard, lay } from "@/transcribe/server/listen";
import { voicedIslands } from "@/transcribe/vad";

const [cache, id] = process.argv.slice(2);
const { samples, sampleRate } = readPcm16(path.join(cache, `${id}.16k.wav`));
const levels = frameLevels(samples, sampleRate);
const islands = speechIslands(levels);
const heard = JSON.parse(fs.readFileSync(path.join(cache, `${id}.heard.json`), "utf8")) as Heard;
const f = (s: { start: number; end: number }) => `${s.start.toFixed(2)}-${s.end.toFixed(2)}`;
console.log("islands", islands.length, islands.map(f).join(" "));
if (heard.voiced) console.log("gated", voicedIslands(islands, heard.voiced).map(f).join(" "));
const laid = lay(heard, levels, islands);
console.log("raw   ", heard.words.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(" "));
console.log("laid  ", laid.map((w) => `${w.text}@${w.start.toFixed(2)}`).join(" "));
