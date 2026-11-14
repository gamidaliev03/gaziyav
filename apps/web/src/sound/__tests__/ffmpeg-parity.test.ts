// The page's measure against ffmpeg's ebur128 on real files: tones, pink noise and speech at 48 and 44.1 kHz.
// Runs only with GZ_FFMPEG=<the bundle's ffmpeg> (the Mac's `say` makes the speech):
//   GZ_FFMPEG=<bundle>/Contents/Resources/bin/ffmpeg bun test src/sound/__tests__/ffmpeg-parity.test.ts
import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { measureProgramme } from "../dsp/offline";

const FFMPEG = process.env.GZ_FFMPEG ?? "";
const dir = path.join(process.env.GZ_SOUND_TMP ?? os.tmpdir(), "gz-sound-parity");

function reference(file: string) {
	const r = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
	const tail = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
	const num = (re: RegExp) => Number(tail.match(re)?.[1]);
	return { integrated: num(/I:\s+(-?[\d.]+) LUFS/), range: num(/LRA:\s+(-?[\d.]+) LU/), truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}
function decode(file: string, rate: number): Float32Array[] {
	const raw = execFileSync(FFMPEG, ["-v", "error", "-i", file, "-f", "f32le", "-ac", "2", "-ar", String(rate), "-"], { maxBuffer: 2 ** 31 - 1 });
	const all = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
	const n = all.length >> 1;
	const l = new Float32Array(n);
	const r = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		l[i] = all[2 * i];
		r[i] = all[2 * i + 1];
	}
	return [l, r];
}

describe.skipIf(!FFMPEG)("against ffmpeg's ebur128", () => {
	const cases: Array<{ name: string; rate: number; make: (out: string, rate: number) => void }> = [];
	const lavfi = (graph: string) => (out: string, rate: number) => execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", graph.replaceAll("RATE", String(rate)), "-ac", "2", "-c:a", "pcm_s24le", out]);
	// A tone that starts or stops dead rings between the samples at its edge, and every interpolator rings its own way
	// (ffmpeg's reads 0.4 dB over ours there): the tones fade in and out, as a test tone does.
	const edges = (seconds: number) => `afade=t=in:d=0.05,afade=t=out:st=${seconds - 0.05}:d=0.05`;
	const speech = (voice: string, text: string, gain: number) => (out: string, rate: number) => {
		const aiff = `${out}.aiff`;
		execFileSync("/usr/bin/say", ["-v", voice, "-o", aiff, text]);
		execFileSync(FFMPEG, ["-y", "-v", "error", "-i", aiff, "-af", `volume=${gain}dB`, "-ac", "2", "-ar", String(rate), "-c:a", "pcm_s24le", out]);
		fs.rmSync(aiff, { force: true });
	};
	for (const rate of [48000, 44100]) {
		cases.push({ name: `tone-1k-20dB-${rate}`, rate, make: lavfi(`sine=frequency=1000:sample_rate=RATE:duration=20,volume=-2.06dB,${edges(20)}`) });
		cases.push({ name: `tone-100-${rate}`, rate, make: lavfi(`sine=frequency=100:sample_rate=RATE:duration=15,volume=6dB,${edges(15)}`) });
		cases.push({ name: `tone-8k-${rate}`, rate, make: lavfi(`sine=frequency=8000:sample_rate=RATE:duration=15,volume=3dB,${edges(15)}`) });
		cases.push({ name: `pink-${rate}`, rate, make: lavfi("anoisesrc=color=pink:amplitude=0.35:duration=30:sample_rate=RATE:seed=11") });
		cases.push({ name: `pink-bursts-${rate}`, rate, make: lavfi("anoisesrc=color=pink:amplitude=0.5:duration=40:sample_rate=RATE:seed=5,volume='if(lt(mod(t\\,8)\\,5)\\,1\\,0.05)':eval=frame") });
		cases.push({ name: `speech-en-${rate}`, rate, make: speech("Samantha", "Loudness is measured over the whole programme. Quiet passages are left out of the count, and so is silence. The loudest moment between two samples is the true peak. This sentence is here to make the recording long enough for a steady reading of all three numbers.", 0) });
		cases.push({ name: `speech-ru-${rate}`, rate, make: speech("Milena", "Громкость измеряется за всю программу. Тихие места в счёт не идут, тишина тоже. Самый громкий момент между двумя отсчётами называется истинным пиком. Эта фраза нужна, чтобы запись была достаточно длинной для устойчивого измерения.", 6) });
	}
	fs.mkdirSync(dir, { recursive: true });
	for (const c of cases) {
		test(c.name, async () => {
			const file = path.join(dir, `${c.name}.wav`);
			if (!fs.existsSync(file)) c.make(file, c.rate);
			const want = reference(file);
			const got = await measureProgramme({ channels: decode(file, c.rate), sampleRate: c.rate });
			console.log(`${c.name}: I ${got.integrated.toFixed(2)} / ffmpeg ${want.integrated} · TP ${got.truePeakDb.toFixed(2)} / ${want.truePeak} · LRA ${got.range.toFixed(1)} / ${want.range}`);
			expect(Math.abs(got.integrated - want.integrated)).toBeLessThanOrEqual(0.1);
			expect(Math.abs(got.truePeakDb - want.truePeak)).toBeLessThanOrEqual(0.15);
			expect(Math.abs(got.range - want.range)).toBeLessThanOrEqual(0.6);
		}, 120000);
	}
});
