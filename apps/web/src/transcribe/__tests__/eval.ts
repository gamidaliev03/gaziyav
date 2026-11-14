// Manual benchmark (not a unit test): bun src/transcribe/__tests__/eval.ts <wav> [truth.json] [text.txt]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { alignWords, dropPhantoms, FINE, frameLevels, speechIslands } from "@/transcribe/align";
import { readPcm16 } from "@/transcribe/server/job";
import { recognize } from "@/transcribe/server/whisper";
import { findCuts, totalLength } from "@/silence/detect";

const [wav, truthFile, textFile] = process.argv.slice(2);
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
function wer(ref: string[], hyp: string[]) {
	const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...new Array(hyp.length).fill(0)]);
	for (let j = 1; j <= hyp.length; j++) d[0][j] = j;
	for (let i = 1; i <= ref.length; i++)
		for (let j = 1; j <= hyp.length; j++)
			d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
	return d[ref.length][hyp.length] / ref.length;
}
const { samples, sampleRate } = readPcm16(wav);
const duration = samples.length / sampleRate;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ev-"));
const t0 = performance.now();
const raw = await recognize({ wav, outDir: out, language: process.env.LANG_CODE || "ru", duration });
const t1 = performance.now();
const levels = frameLevels(samples, sampleRate);
const speech = speechIslands(levels);
const aligned = dropPhantoms(alignWords(raw.words, speech, speechIslands(levels, FINE)), speech);
const t2 = performance.now();
console.log(`audio ${duration.toFixed(1)} s · whisper ${((t1 - t0) / 1000).toFixed(2)} s · align ${(t2 - t1).toFixed(0)} ms · words ${raw.words.length}→${aligned.length} · islands ${speech.length}`);
if (textFile) {
	const ref = norm(fs.readFileSync(textFile, "utf8"));
	const hyp = norm(aligned.map((w) => w.text).join(" "));
	console.log(`WER ${(wer(ref, hyp) * 100).toFixed(1)} % (ref ${ref.length} words)`);
}
if (truthFile) {
	const truth: { text: string; start: number; end: number }[] = JSON.parse(fs.readFileSync(truthFile, "utf8"));
	const stats = (words: { text: string; start: number; end: number }[], label: string) => {
		// Pair by order where normalized texts match (greedy).
		const errs: number[] = [];
		const endErrs: number[] = [];
		let j = 0;
		for (const t of truth) {
			const key = norm(t.text).join(" ");
			for (let k = j; k < Math.min(words.length, j + 4); k++) {
				if (norm(words[k].text).join(" ") === key) {
					errs.push(words[k].start - t.start);
					endErrs.push(words[k].end - t.end);
					j = k + 1;
					break;
				}
			}
		}
		if (process.env.WORST) console.log(errs.map((e, i) => [i, Math.round(e * 1000)]).filter(([, e]) => Math.abs(e) > 100).join(" "));
		const abs = errs.map(Math.abs).sort((a, b) => a - b);
		const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
		const within = abs.filter((e) => e <= 0.1).length / abs.length;
		const p90 = abs[Math.floor(abs.length * 0.9)];
		const endAbs = endErrs.map(Math.abs).reduce((a, b) => a + b, 0) / endErrs.length;
		console.log(`${label}: matched ${errs.length}/${truth.length} · start bias ${(mean * 1000).toFixed(0)} ms · |start| median ${(abs[abs.length >> 1] * 1000).toFixed(0)} ms, p90 ${(p90 * 1000).toFixed(0)} ms, ≤100 ms ${(within * 100).toFixed(0)} % · |end| mean ${(endAbs * 1000).toFixed(0)} ms`);
	};
	stats(raw.words, "raw whisper");
	stats(aligned, "aligned    ");
}
const cuts = findCuts({ words: aligned, speech, duration });
console.log(`pauses: ${cuts.length} cuts, ${totalLength(cuts).toFixed(2)} s removed`);
if (process.env.DUMP) console.log(JSON.stringify(aligned.slice(0, 30)));
fs.rmSync(out, { recursive: true, force: true });
