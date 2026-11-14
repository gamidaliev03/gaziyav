// How it sounds, in plain words with a severity and the fix the app can apply: the recording (noise, hum, clipping,
// mud, sibilance, echo, level), the voice (pitch range, tone, pace, clarity) and the music (tempo, key, energy, mood,
// builds and drops, what plays). DSP only, on this Mac, from the frames the map already has. Pure.
import { type Frames, frameAt, type Hum, keyOf, type Levels, median, percentile, SILENT_DB, type SlowFrame, type Span } from "./dsp";
import type { HeardWord, MusicGrid, Pause, Segment } from "./map";

/** 0 fine / for information, 1 mild, 2 clearly audible, 3 bad. */
export type Severity = 0 | 1 | 2 | 3;

/** A fix the app applies (fix_sound `what`), with the element params it sets. */
export type FixKind = "noise" | "hum" | "mud" | "sibilance" | "echo" | "level" | "duck" | "quieter" | "louder";

export interface Note {
	area: "sound" | "voice" | "music" | "mix";
	/** Short key for code: "noise", "hum", "clipping", "mud", "sibilance", "echo", "level", "pitch", "tone", "pace", … */
	what: string;
	severity: Severity;
	/** One short line for Claude. */
	line: string;
	fix?: FixKind;
	/** Where, when it is a spot (seconds). */
	at?: number[];
}

export interface Loud {
	integrated: number;
	shortTerm: Array<[number, number]>;
	peakDb: number;
	clips: number[];
}

export interface DescribeInput {
	frames: Frames;
	levels: Levels;
	words: HeardWord[];
	pauses: Pause[];
	segments: Segment[];
	loud: Loud;
	slow: SlowFrame[];
	hum: Hum | null;
	grid: MusicGrid | null;
	from: number;
	to: number;
	/** Rate the frames were made at (sibilance needs ≥ 20 kHz). */
	rate: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const time = (t: number) => `${t.toFixed(1)} s`;

function framesIn(frames: Frames, spans: Span[], pick: (f: number) => boolean): number[] {
	const out: number[] = [];
	for (const s of spans) {
		for (let f = Math.max(0, frameAt(frames, s.start)); f < Math.min(frames.n, frameAt(frames, s.end)); f++) if (pick(f)) out.push(f);
	}
	return out;
}

/**
 * Reverberation: how fast the level falls after words that end in a pause, as a T60 estimate (seconds for −60 dB).
 * A dry close mic falls in well under 0.3 s; a bare room takes 0.6 s and more.
 */
export function reverbOf(frames: Frames, levels: Levels, words: HeardWord[]): number | null {
	const t60s: number[] = [];
	const floor = Math.max(levels.floor, -90);
	for (let i = 0; i + 1 < words.length; i++) {
		const gapStart = words[i].end;
		const gapEnd = words[i + 1].start;
		if (gapEnd - gapStart < 0.3) continue;
		// The loudest moment of the phrase's end (Whisper may place a word's end late, inside the room's ring)…
		const a = Math.max(0, frameAt(frames, gapStart - 0.5));
		const b = Math.min(frames.n - 1, frameAt(frames, gapStart + 0.1));
		let fmax = a;
		for (let f = a; f <= b; f++) if (frames.db[f] > frames.db[fmax]) fmax = f;
		const top = frames.db[fmax];
		if (top - floor < 35) continue;
		// …then how long the level takes from −10 to −30 dB below it (the voice's own fade is the first 10 dB).
		const stop = Math.min(frames.n, frameAt(frames, gapEnd));
		let f10 = -1;
		let f30 = -1;
		for (let f = fmax + 1; f < stop; f++) {
			// A 3-frame minimum: syllable wobble doesn't stop the clock.
			const d = Math.max(frames.db[f], frames.db[Math.min(stop - 1, f + 1)], frames.db[Math.min(stop - 1, f + 2)]);
			if (f10 < 0 && d <= top - 10) f10 = f;
			if (f10 >= 0 && d <= Math.max(top - 30, floor + 4)) {
				f30 = f;
				break;
			}
		}
		if (f10 < 0 || f30 <= f10) continue;
		const drop = Math.min(20, top - 10 - Math.max(top - 30, floor + 4));
		if (drop < 8) continue;
		t60s.push(Math.min(3, (60 * (f30 - f10) * 0.01) / drop));
	}
	return t60s.length >= 2 ? Math.round(median(t60s) * 100) / 100 : null;
}

/** The recording itself: noise, hum, clipping, mud, sibilance, echo, level ups and downs. */
export function describeSound(input: DescribeInput, reverb: number | null): Note[] {
	const { frames, levels, words, loud, hum, rate } = input;
	const notes: Note[] = [];
	const speech = words.filter((w) => !w.filler);
	const speechDb = speech.length ? median(speech.map((w) => w.db)) : levels.loud;
	const digital = levels.floor <= -88;
	const snr = speechDb - levels.floor;
	// Noise against what? Only a voice has a background to compare (a steady tone or music has no quiet moments).
	if (speech.length < 3) {
		// no noise note
	} else if (digital) notes.push({ area: "sound", what: "noise", severity: 0, line: "no background noise (digital silence between sounds: synthetic or gated)" });
	else if (levels.floor > -48 || snr < 30) notes.push({ area: "sound", what: "noise", severity: snr < 18 ? 3 : 2, line: `noisy: background ${r1(levels.floor)} dB, only ${Math.round(snr)} dB under the voice`, fix: "noise" });
	else if (levels.floor > -60 || snr < 40) notes.push({ area: "sound", what: "noise", severity: 1, line: `audible room/hiss: background ${r1(levels.floor)} dB (${Math.round(snr)} dB under the voice)`, fix: "noise" });
	else notes.push({ area: "sound", what: "noise", severity: 0, line: `clean: background ${r1(levels.floor)} dB, ${Math.round(snr)} dB under the voice` });
	if (hum) notes.push({ area: "sound", what: "hum", severity: hum.over >= 18 ? 3 : hum.over >= 12 ? 2 : 1, line: `mains hum ${hum.freq} Hz, ${Math.round(hum.over)} dB over the room${hum.harmonics > 1 ? ` (${hum.harmonics} harmonics)` : ""}`, fix: "hum" });
	if (loud.clips.length) notes.push({ area: "sound", what: "clipping", severity: loud.clips.length > 5 ? 3 : 2, line: `clipping in ${loud.clips.length} place${loud.clips.length > 1 ? "s" : ""} (${loud.clips.slice(0, 4).map(time).join(", ")}): distorted, can't be undone — prefer another take there`, at: loud.clips.slice(0, 8) });
	else if (loud.peakDb > -0.5) notes.push({ area: "sound", what: "peak", severity: 1, line: `peaks reach ${r1(loud.peakDb)} dBFS (no room before clipping)` });
	// Tone balance of the voice: voiced frames inside words.
	const voiced = framesIn(frames, speech, (f) => frames.voicing[f] > 0.5 && frames.db[f] > levels.active);
	if (voiced.length >= 30) {
		const mudOver = median(voiced.map((f) => frames.mud[f] - frames.pres[f]));
		// Measured on clear voices (female 212 Hz, male 133 Hz): 150–300 Hz sits 20–23 dB over 1–4 kHz.
		if (mudOver >= 25.5) notes.push({ area: "sound", what: "mud", severity: mudOver >= 29 ? 3 : 2, line: `muddy/boomy voice: 150–300 Hz ${Math.round(mudOver)} dB over the 1–4 kHz presence (clear voices ≈ 20–23 dB)`, fix: "mud" });
		else if (mudOver <= 12) notes.push({ area: "sound", what: "thin", severity: 1, line: `thin voice: little body under 300 Hz (${Math.round(mudOver)} dB over the presence; clear ≈ 20–23)` });
	}
	if (rate >= 20000) {
		// Sibilance: the 5–9 kHz band in the loudest unvoiced moments of the words (s, sh, ch), against the voice's presence.
		const fric = framesIn(frames, speech, (f) => frames.voicing[f] < 0.4 && frames.db[f] > levels.active);
		const pres = framesIn(frames, speech, (f) => frames.voicing[f] > 0.5 && frames.db[f] > levels.active).map((f) => frames.pres[f]);
		if (fric.length >= 8 && pres.length >= 20) {
			const sibPeak = percentile(fric.map((f) => frames.sib[f]), 0.9);
			const over = sibPeak - median(pres);
			const spots = fric.filter((f) => frames.sib[f] - median(pres) >= 17).map((f) => Math.round((frames.t0 + f * 0.01) * 10) / 10);
			// Clear voices measure 11–14 dB here; a sibilant one 17 and more.
			if (over >= 17) notes.push({ area: "sound", what: "sibilance", severity: over >= 21 ? 3 : 2, line: `sibilant/harsh «s» sounds: 5–9 kHz peaks ${Math.round(over)} dB over the voice (clear ≈ 11–14)`, fix: "sibilance", at: [...new Set(spots)].slice(0, 6) });
		}
	}
	if (reverb !== null) {
		if (reverb >= 0.6) notes.push({ area: "sound", what: "echo", severity: reverb >= 1 ? 3 : 2, line: `echoey room: the voice rings ~${r1(reverb)} s after words (a close mic is < 0.3 s)`, fix: "echo" });
		else if (reverb >= 0.38) notes.push({ area: "sound", what: "echo", severity: 1, line: `some room sound (~${r1(reverb)} s tail)`, fix: "echo" });
		else notes.push({ area: "sound", what: "echo", severity: 0, line: `dry, close sound (tail ~${r1(reverb)} s)` });
	}
	// Level consistency while someone talks.
	const talking = loud.shortTerm.filter(([t]) => speech.some((w) => w.start <= t + 1.5 && w.end >= t - 1.5)).map(([, v]) => v).filter((v) => v > -60);
	if (talking.length >= 5) {
		const spread = percentile(talking, 0.9) - percentile(talking, 0.1);
		if (spread >= 6) notes.push({ area: "sound", what: "level", severity: spread >= 10 ? 3 : 2, line: `uneven level: the voice swings ${Math.round(spread)} LU (short-term)`, fix: "level" });
	}
	return notes;
}

/** The voice: pitch range (who), tone (how), pace and clarity. */
export function describeVoice(input: DescribeInput, rhythmPause: number): Note[] {
	const { frames, words, pauses, from, to } = input;
	const speech = words.filter((w) => !w.filler && w.text.replace(/[^\p{L}]/gu, "").length > 0);
	if (speech.length < 4) return [];
	const notes: Note[] = [];
	const pitches: number[] = [];
	for (const w of speech) {
		for (let f = Math.max(0, frameAt(frames, w.start)); f < Math.min(frames.n, frameAt(frames, w.end)); f++) if (frames.voicing[f] > 0.55 && frames.f0[f] > 60) pitches.push(frames.f0[f]);
	}
	if (pitches.length >= 20) {
		const f0 = median(pitches);
		const who = f0 < 85 ? "very low voice" : f0 < 165 ? "low voice (typical adult male range)" : f0 < 255 ? "higher voice (typical adult female range)" : "high voice (a child's or a raised voice)";
		notes.push({ area: "voice", what: "pitch", severity: 0, line: `${who}, median ${Math.round(f0)} Hz` });
		const st = pitches.map((p) => 12 * Math.log2(p / f0));
		const spread = percentile(st, 0.9) - percentile(st, 0.1);
		const level = median(speech.map((w) => w.db));
		const dur = Math.max(1, to - from - pauses.filter((p) => p.length > 1).reduce((s, p) => s + p.length - 1, 0));
		const wpm = (speech.length / dur) * 60;
		const lively = spread >= 7;
		const flat = spread < 3.5;
		const fast = wpm >= 175;
		const slow = wpm < 115;
		const tone = flat ? (slow ? "flat and slow: sounds tired or reading" : "monotone, little melody") : lively && fast ? "energetic, excited" : lively ? "expressive, lively" : fast ? "brisk, matter-of-fact" : slow ? "calm, unhurried" : "calm, conversational";
		notes.push({ area: "voice", what: "tone", severity: flat ? 1 : 0, line: `${tone} (pitch range ${Math.round(spread)} semitones, level ${Math.round(level)} dB)` });
		notes.push({ area: "voice", what: "pace", severity: fast || slow ? 1 : 0, line: `${Math.round(wpm)} words/min (${fast ? "fast" : slow ? "slow" : "normal"}), natural pause ${rhythmPause.toFixed(2)} s` });
	}
	const ps = speech.map((w) => w.p).filter((p): p is number => p !== undefined);
	if (ps.length >= 4) {
		const unsure = ps.filter((p) => p < 0.5).length / ps.length;
		const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
		notes.push({ area: "voice", what: "clarity", severity: unsure > 0.15 ? 2 : unsure > 0.06 ? 1 : 0, line: unsure > 0.06 ? `some words unclear: ${pct(unsure)} recognized unsure (mean confidence ${mean.toFixed(2)})` : `clear diction (mean confidence ${mean.toFixed(2)})` });
	}
	return notes;
}

/** The music: tempo, key, energy, mood, where it builds and drops, what plays. */
export function describeMusic(input: DescribeInput, musicSpans: Span[]): Note[] {
	const { frames, levels, slow, grid, loud } = input;
	const total = musicSpans.reduce((s, x) => s + x.end - x.start, 0);
	if (total < 3) return [];
	const notes: Note[] = [];
	const inMusic = (t: number) => musicSpans.some((s) => t >= s.start && t < s.end);
	const chroma = new Array(12).fill(0);
	for (const s of slow) if (inMusic(s.t) && s.db > SILENT_DB) for (let i = 0; i < 12; i++) chroma[i] += s.chroma[i];
	const key = keyOf(chroma);
	const fr = framesIn(frames, musicSpans, (f) => frames.db[f] > SILENT_DB);
	const centroid = median(fr.map((f) => frames.centroid[f]));
	const lowShare = median(fr.map((f) => frames.low[f] - frames.db[f]));
	const tonal = fr.filter((f) => frames.flat[f] < 0.08).length / Math.max(1, fr.length);
	const lufs = loud.shortTerm.filter(([t]) => inMusic(t)).map(([, v]) => v);
	const level = lufs.length ? median(lufs) : levels.loud;
	// A tempo counts when the beat is clearly heard (a pad's swell has a tempo but no pulse).
	const bpm = grid && grid.pulse >= 5 ? grid.bpm : 0;
	// Onset density: how many clear level rises per second.
	let onsets = 0;
	for (const f of fr) if (f > 2 && frames.db[f] - frames.db[f - 2] > 6) onsets++;
	const density = onsets / Math.max(1, total);
	const arousal = (bpm >= 115 ? 1 : bpm && bpm < 90 ? -1 : 0) + (level > -16 ? 1 : level < -26 ? -1 : 0) + (density > 3 ? 1 : density < 1 ? -1 : 0) + (centroid > 2800 ? 0.5 : centroid < 1500 ? -0.5 : 0);
	const valence = (key ? (key.minor ? -1 : 1) * Math.max(0.3, key.confidence) : 0) + (centroid > 2500 ? 0.4 : centroid < 1400 ? -0.4 : 0);
	const energy = arousal >= 1.5 ? "energetic" : arousal <= -1 ? "calm" : "moderate";
	const mood = arousal >= 1 ? (valence >= 0 ? "upbeat, happy" : "intense, dark") : arousal <= -1 ? (valence >= 0 ? "relaxed, warm" : "sad, melancholic") : valence >= 0 ? "light, easy" : "moody, serious";
	notes.push({
		area: "music",
		what: "character",
		severity: 0,
		line: `${energy} music, ${mood}${bpm ? `, ${Math.round(bpm)} BPM` : ", no steady beat"}${key && key.confidence > 0.25 ? `, ${key.key}` : ""} (level ${Math.round(level)} LUFS, ${centroid > 2800 ? "bright" : centroid < 1500 ? "dark/warm" : "balanced"})`,
	});
	const plays: string[] = [];
	if (grid && grid.pulse >= 5 && density > 1.5) plays.push("drums/beat");
	if (lowShare > -8) plays.push("heavy bass");
	if (tonal > 0.5 && density < 2) plays.push("sustained pads/strings");
	if (input.words.filter((w) => inMusic(w.start)).length >= 3) plays.push("vocals");
	if (plays.length) notes.push({ area: "music", what: "plays", severity: 0, line: `heard: ${plays.join(", ")}` });
	if (bpm >= 115 && bpm <= 135 && grid && density > 2 && lowShare > -12) notes.push({ area: "music", what: "style", severity: 0, line: "feels like dance/electronic (steady four-on-the-floor pulse)" });
	else if (!grid && tonal > 0.5) notes.push({ area: "music", what: "style", severity: 0, line: "feels like ambient/cinematic (no beat, sustained)" });
	// Builds and drops: the short-term loudness rising for ≥ 4 s, or jumping / falling within 2 s.
	const st = loud.shortTerm.filter(([t]) => inMusic(t));
	const events: string[] = [];
	for (let i = 2; i < st.length; i++) {
		const jump = st[i][1] - st[i - 2][1];
		if (jump >= 5) events.push(`drop/hit at ${time(st[i - 1][0])} (+${Math.round(jump)} LU)`);
		if (jump <= -6) events.push(`breakdown at ${time(st[i - 1][0])} (${Math.round(jump)} LU)`);
	}
	for (let i = 4; i < st.length; i++) {
		const rise = st[i][1] - st[i - 4][1];
		let monotone = true;
		for (let k = i - 3; k <= i; k++) if (st[k][1] < st[k - 1][1] - 0.5) monotone = false;
		if (rise >= 4 && monotone) events.push(`builds ${time(st[i - 4][0])}–${time(st[i][0])}`);
	}
	if (events.length) notes.push({ area: "music", what: "shape", severity: 0, line: [...new Set(events)].slice(0, 6).join("; ") });
	return notes;
}
