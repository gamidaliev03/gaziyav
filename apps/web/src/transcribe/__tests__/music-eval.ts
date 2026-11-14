// Manual benchmark (not a unit test): what the plain engine «hears» over music without a voice, and how often the
// rule that guards the second listening (vad.ts believable) would take it for words. The input is one 16 kHz WAV of
// equal pieces of instrumental tracks laid end to end (20 s of every track of the built-in library); every piece is
// treated as a stretch the detector called voiceless, exactly as transcribe/server/listen.ts does: laid end to end
// with a second of silence between, heard by the plain engine, brought back, the stock inventions dropped.
//   WHISPER_CLI=… WHISPER_MODEL=… bun src/transcribe/__tests__/music-eval.ts <all.16k.wav> <piece seconds> <from piece> <pieces> <language> [out.json]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dropHallucinations } from "@/hear/hallucinations";
import { dropPhantoms, type Span } from "@/transcribe/align";
import { readPcm16 } from "@/transcribe/server/job";
import { recognize } from "@/transcribe/server/whisper";
import { believable, MIN_RATE, MIN_WORDS, stitchPlan, unstitch } from "@/transcribe/vad";

const [wav, pieceArg = "20", fromArg = "0", countArg = "60", language = "ru", outFile] = process.argv.slice(2);
const piece = Number(pieceArg);
const from = Number(fromArg);
const count = Number(countArg);
const { samples, sampleRate } = readPcm16(wav);
const stretches: Span[] = [];
for (let k = from; k < from + count && (k + 1) * piece * sampleRate <= samples.length; k++) stretches.push({ start: k * piece, end: (k + 1) * piece });
const plan = stitchPlan(stretches);
const last = plan[plan.length - 1];
const stitched = new Int16Array(Math.ceil((last.at + piece) * sampleRate));
for (const { from: s, at } of plan) stitched.set(samples.subarray(Math.floor(s.start * sampleRate), Math.floor(s.end * sampleRate)), Math.floor(at * sampleRate));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "music-eval-"));
const file = path.join(dir, "music.wav");
const data = Buffer.from(stitched.buffer, stitched.byteOffset, stitched.byteLength);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
fs.writeFileSync(file, Buffer.concat([header, data]));
const seconds = stitched.length / sampleRate;
const t0 = performance.now();
const quick = process.env.MUSIC_QUICK !== "0";
const heard = await recognize({ wav: file, outDir: dir, language, duration: seconds, quick });
const wall = (performance.now() - t0) / 1000;
const per = unstitch(heard.words, plan);
let withRaw = 0;
let withKept = 0;
let accepted = 0;
const rows: Array<{ piece: number; raw: string; kept: string; sure: number; believed: boolean }> = [];
per.forEach((words, k) => {
	const kept = dropHallucinations(dropPhantoms(words, []), () => true);
	const sure = kept.filter((w) => (w.p ?? 1) >= 0.5 && /[\p{L}\p{N}]/u.test(w.text)).length;
	const ok = believable(kept, piece);
	if (words.length) withRaw++;
	if (kept.length) withKept++;
	if (ok) accepted++;
	if (words.length) rows.push({ piece: from + k, raw: words.map((w) => `${w.text}${w.p !== undefined ? `(${w.p})` : ""}`).join(" "), kept: kept.map((w) => w.text).join(" "), sure, believed: ok });
});
console.log(`${stretches.length} pieces of ${piece} s (${(seconds / 60).toFixed(1)} min with the gaps), language ${language}, ${quick ? "one pass per window (-nf)" : "with the engine's second tries"}: heard in ${wall.toFixed(0)} s (load ${os.loadavg()[0].toFixed(1)})`);
console.log(`the engine put words on ${withRaw} pieces; after the stock inventions are dropped, on ${withKept}; the stream rule (≥ ${MIN_WORDS} sure words, ≥ ${MIN_RATE}/s) believes ${accepted}`);
for (const r of rows) console.log(`  #${r.piece}${r.believed ? " BELIEVED" : ""} sure ${r.sure}: ${r.raw.slice(0, 260)}${r.kept !== r.raw.replace(/\([\d.]+\)/g, "") ? `  → kept: ${r.kept.slice(0, 120) || "—"}` : ""}`);
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ pieces: stretches.length, piece, language, wall, withRaw, withKept, accepted, rows }, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
