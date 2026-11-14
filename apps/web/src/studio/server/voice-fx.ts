// The sound of a trending voice (trending/voices.ts): pitch, pace, EQ and room on the spoken file, then loudness to
// −14 LUFS: measured first (EBU R128), raised or lowered in one gain, peaks held under −1.9 dBFS by a limiter (short
// takes too — a 2 s line can't be levelled by loudnorm's linear mode, it falls short by 3–5 LU).
import { type TrendVoice, trendFilter } from "@/trending/voices";
import { StudioError } from "./errors";
import { findTool, reason, run } from "./tools";

/** The ffmpeg filters of a preset at 48 kHz up to (not including) loudness. */
export const trendChain = (voice: TrendVoice) => `aresample=48000,${trendFilter(voice, 48000)}`;

/** Integrated loudness (LUFS) of what ffmpeg's ebur128 printed. */
export const integrated = (stderr: string) => Number(/I:\s+(-?[\d.]+) LUFS/.exec(stderr.split("Summary:")[1] ?? "")?.[1] ?? Number.NaN);

/** Treats `input` with the preset into `out` (48 kHz mono WAV). */
export async function applyTrendVoice(input: string, voice: TrendVoice, out: string, signal?: AbortSignal) {
	const chain = trendChain(voice);
	const measure = await run(findTool("ffmpeg"), ["-hide_banner", "-nostats", "-i", input, "-af", `${chain},ebur128=framelog=quiet`, "-f", "null", "-"], { timeout: 300, signal });
	const lufs = integrated(measure.stderr);
	if (measure.status !== 0 || !Number.isFinite(lufs)) throw new StudioError(`Couldn't treat the voice: ${reason(measure)}`);
	const gain = Math.max(-20, Math.min(30, -14 - lufs));
	const r = await run(
		findTool("ffmpeg"),
		["-y", "-v", "error", "-i", input, "-af", `${chain},volume=${gain.toFixed(2)}dB,alimiter=limit=0.8:attack=4:release=60:level=false`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", out],
		{ timeout: 300, signal },
	);
	if (r.status !== 0) throw new StudioError(`Couldn't treat the voice: ${reason(r)}`);
}
