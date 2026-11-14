// Voice activity detection on a waveform peak summary (pure, no browser APIs).
import type { SourceWaveformSummary } from "@/media/waveform-summary";

export interface SourceRange {
	/** Seconds in the source file. */
	start: number;
	end: number;
}

const FRAME_SECONDS = 0.03;
/** Speech is louder than this below the loud parts of the same clip (relative gate). */
const RELATIVE_GATE_DB = 26;
const ABSOLUTE_GATE_DB = -50;
/** Gaps shorter than this are one phrase (no pumping between words). */
const CLOSE_GAP_SECONDS = 0.3;
const MIN_SPEECH_SECONDS = 0.08;
/** Let syllable tails ring out before the music comes back. */
const TAIL_SECONDS = 0.12;

/** Speech ranges (source seconds) from a peak summary. Empty when the clip is silent. */
export function detectSpeech(summary: SourceWaveformSummary): SourceRange[] {
	const { amplitudes, bucketSize, sampleRate } = summary;
	if (!amplitudes.length || !sampleRate) return [];
	const bucketSec = bucketSize / sampleRate;
	const perFrame = Math.max(1, Math.round(FRAME_SECONDS / bucketSec));
	const frameSec = perFrame * bucketSec;
	const frames = new Float32Array(Math.ceil(amplitudes.length / perFrame));
	for (let f = 0; f < frames.length; f++) {
		let peak = 0;
		const end = Math.min(amplitudes.length, (f + 1) * perFrame);
		for (let i = f * perFrame; i < end; i++) if (amplitudes[i] > peak) peak = amplitudes[i];
		frames[f] = peak > 0 ? 20 * Math.log10(peak) : -120;
	}
	const sorted = Float32Array.from(frames).sort();
	const loud = sorted[Math.floor(sorted.length * 0.95)] ?? -120;
	if (loud < -60) return [];
	const gate = Math.max(ABSOLUTE_GATE_DB, loud - RELATIVE_GATE_DB);

	const raw: SourceRange[] = [];
	let open = -1;
	for (let f = 0; f <= frames.length; f++) {
		const active = f < frames.length && frames[f] > gate;
		if (active && open < 0) open = f;
		if (!active && open >= 0) {
			raw.push({ start: open * frameSec, end: f * frameSec });
			open = -1;
		}
	}
	const merged: SourceRange[] = [];
	for (const r of raw) {
		const last = merged[merged.length - 1];
		if (last && r.start - last.end < CLOSE_GAP_SECONDS) last.end = r.end;
		else merged.push({ ...r });
	}
	return merged
		.filter((r) => r.end - r.start >= MIN_SPEECH_SECONDS)
		.map((r) => ({ start: r.start, end: r.end + TAIL_SECONDS }));
}

