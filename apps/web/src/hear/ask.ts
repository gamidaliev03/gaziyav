// Claude asks the sound its own questions: «how much does 0:12–0:18 sound like a tense build-up / calm / a cheering
// crowd / an echoey room / sad piano», and «where does it sound like X». No audio–text model is on this Mac yet, so
// each concept is scored from measured features (level and its slope, onsets, pitch, tonality, brightness, bass,
// key, pulse, room) — a fixed vocabulary in English and Russian, each answer with the reason. Pure.
import { type Frames, frameAt, keyOf, median, percentile, SILENT_DB, type SlowFrame } from "./dsp";
import type { TimedWord } from "./cuts";

export interface Features {
	seconds: number;
	/** Median frame level, dB. */
	level: number;
	/** Level change over the window, dB per second (a line through 0.5 s blocks). */
	slope: number;
	/** The biggest rise between consecutive 0.5 s blocks, dB. */
	jump: number;
	/** Clear onsets per second. */
	onsets: number;
	/** Share of frames with a pitch (voice, melodic instruments). */
	voiced: number;
	/** Share of tonal frames (low spectral flatness). */
	tonal: number;
	/** Median flatness 0…1. */
	flat: number;
	centroid: number;
	/** Level under 200 Hz minus the level, dB. */
	bass: number;
	/** Share of near-silent frames. */
	silent: number;
	/** Words per second recognized here. */
	words: number;
	/** Spread of the pitch, semitones (melody / expressive speech). */
	pitchSpread: number;
	/** How the onsets decay: share of onsets followed by a ≥ 12 dB fall within 0.3 s (plucked, struck). */
	decay: number;
	minor: boolean | null;
	keyConfidence: number;
	/** Steady beat strength (0 = none). */
	pulse: number;
	bpm: number;
	/** Room's reverberation, s (the whole clip), and mains hum. */
	reverb: number | null;
	hum: boolean;
}

export function featuresOf(frames: Frames, from: number, to: number, ctx: { words: TimedWord[]; slow: SlowFrame[]; pulse: number; bpm: number; reverb: number | null; hum: boolean }): Features {
	const f0 = Math.max(0, frameAt(frames, from));
	const f1 = Math.min(frames.n, Math.max(f0 + 1, frameAt(frames, to)));
	const n = f1 - f0;
	const db: number[] = [];
	let silent = 0;
	let voiced = 0;
	let tonal = 0;
	const flats: number[] = [];
	const cents: number[] = [];
	const bass: number[] = [];
	const pitches: number[] = [];
	let onsets = 0;
	let decays = 0;
	// Onsets on a 30 ms average (the beating of a chord's tones is no onset): a rise of 6 dB over 30 ms.
	const smooth = (f: number) => {
		let e = 0;
		for (let k = f - 1; k <= f + 1; k++) e += 10 ** (frames.db[Math.max(0, Math.min(frames.n - 1, k))] / 10);
		return 10 * Math.log10(e / 3 + 1e-12);
	};
	let lastOnset = -100;
	for (let f = f0; f < f1; f++) {
		const d = frames.db[f];
		db.push(d);
		if (d <= SILENT_DB) {
			silent++;
			continue;
		}
		if (frames.voicing[f] > 0.55) voiced++;
		if (frames.flat[f] < 0.08) tonal++;
		flats.push(frames.flat[f]);
		cents.push(frames.centroid[f]);
		bass.push(frames.low[f] - d);
		if (frames.f0[f] > 60 && frames.voicing[f] > 0.6) pitches.push(frames.f0[f]);
		if (f >= f0 + 3 && f - lastOnset >= 5 && smooth(f) - smooth(f - 3) > 6 && d > -60) {
			onsets++;
			lastOnset = f;
			let top = d;
			for (let k = f; k < Math.min(f1, f + 4); k++) top = Math.max(top, frames.db[k]);
			let fell = false;
			for (let k = f + 4; k < Math.min(f1, f + 50); k++) if (frames.db[k] < top - 9) fell = true;
			if (fell) decays++;
		}
	}
	// Level in 0.5 s blocks: its slope and its biggest jump.
	const blocks: number[] = [];
	for (let b = f0; b + 50 <= f1; b += 50) {
		let s = 0;
		for (let k = b; k < b + 50; k++) s += 10 ** (frames.db[k] / 10);
		blocks.push(10 * Math.log10(s / 50 + 1e-12));
	}
	let slope = 0;
	if (blocks.length >= 3) {
		const xs = blocks.map((_, i) => i * 0.5);
		const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
		const my = blocks.reduce((a, b) => a + b, 0) / blocks.length;
		let num = 0;
		let den = 0;
		for (let i = 0; i < blocks.length; i++) {
			num += (xs[i] - mx) * (blocks[i] - my);
			den += (xs[i] - mx) ** 2;
		}
		slope = den > 0 ? num / den : 0;
	}
	let jump = 0;
	for (let i = 1; i < blocks.length; i++) jump = Math.max(jump, blocks[i] - blocks[i - 1]);
	const chroma = new Array(12).fill(0);
	for (const s of ctx.slow) if (s.t >= from && s.t <= to && s.db > SILENT_DB) for (let i = 0; i < 12; i++) chroma[i] += s.chroma[i];
	const key = keyOf(chroma);
	const m = pitches.length ? median(pitches) : 0;
	const st = pitches.map((p) => 12 * Math.log2(p / m));
	const seconds = Math.max(0.01, to - from);
	return {
		seconds,
		level: db.length ? median(db) : -100,
		slope,
		jump,
		onsets: onsets / seconds,
		voiced: voiced / Math.max(1, n),
		tonal: tonal / Math.max(1, n),
		flat: flats.length ? median(flats) : 1,
		centroid: cents.length ? median(cents) : 0,
		bass: bass.length ? median(bass) : -30,
		silent: silent / Math.max(1, n),
		words: ctx.words.filter((w) => w.start < to && w.end > from).length / seconds,
		pitchSpread: st.length >= 10 ? percentile(st, 0.9) - percentile(st, 0.1) : 0,
		decay: onsets ? decays / onsets : 0,
		minor: key && key.confidence > 0.2 ? key.minor : null,
		keyConfidence: key?.confidence ?? 0,
		pulse: ctx.pulse,
		bpm: ctx.bpm,
		reverb: ctx.reverb,
		hum: ctx.hum,
	};
}

/** 0…1 from x between a (0) and b (1), clamped; b < a works backwards. */
const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
const mean = (...v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

interface Concept {
	id: string;
	/** Words that name it (English and Russian, lower case, matched as substrings). */
	names: string[];
	score: (f: Features) => number;
	why: (f: Features) => string;
}

/** How excited it sounds: loud, many onsets, a fast steady beat. */
const arousal = (f: Features) => mean(ramp(f.level, -32, -12), ramp(f.onsets, 0.5, 4), ramp(f.bpm, 80, 130), ramp(f.pulse, 2, 8));
const music = (f: Features) => Math.max(ramp(f.tonal, 0.2, 0.6), ramp(f.pulse, 3, 8)) * (1 - ramp(f.words, 0.8, 2)) * (1 - ramp(f.silent, 0.3, 0.8));
const loudness = (f: Features) => `level ${Math.round(f.level)} dB`;

export const CONCEPTS: Concept[] = [
	{ id: "silence", names: ["silence", "silent", "quiet", "тишин", "тихо"], score: (f) => Math.max(ramp(f.silent, 0.3, 0.9), ramp(f.level, -45, -65)), why: (f) => `${Math.round(f.silent * 100)}% digital silence, ${loudness(f)}` },
	{ id: "speech", names: ["speech", "talk", "voice", "speak", "речь", "голос", "говор"], score: (f) => ramp(f.words, 0.3, 1.2) * (0.5 + 0.5 * ramp(f.voiced, 0.15, 0.45)), why: (f) => `${f.words.toFixed(1)} words/s, ${Math.round(f.voiced * 100)}% voiced` },
	{ id: "music", names: ["music", "song", "track", "музык", "песн", "трек"], score: (f) => music(f), why: (f) => `${Math.round(f.tonal * 100)}% tonal, pulse ${f.pulse.toFixed(1)}, ${f.words.toFixed(1)} words/s` },
	{ id: "singing", names: ["sing", "vocal", "пени", "пою", "вокал"], score: (f) => mean(ramp(f.words, 0.3, 1.2), ramp(f.voiced, 0.3, 0.7), ramp(f.pitchSpread, 4, 10), Math.max(ramp(f.tonal, 0.2, 0.5), ramp(f.pulse, 3, 8))), why: (f) => `${Math.round(f.voiced * 100)}% voiced, pitch range ${Math.round(f.pitchSpread)} st, words ${f.words.toFixed(1)}/s` },
	{ id: "calm", names: ["calm", "relax", "peace", "soft", "gentle", "спокой", "тих", "мягк", "расслаб"], score: (f) => (1 - arousal(f)) * (1 - 0.6 * ramp(Math.abs(f.slope), 1, 3)) * (1 - ramp(f.silent, 0.6, 0.95)), why: (f) => `${loudness(f)}, ${f.onsets.toFixed(1)} onsets/s, ${f.bpm ? `${Math.round(f.bpm)} BPM` : "no beat"}, centroid ${Math.round(f.centroid)} Hz` },
	{ id: "energetic", names: ["energetic", "energy", "upbeat", "intense", "powerful", "drive", "энерг", "бодр", "драйв", "мощн"], score: (f) => arousal(f), why: (f) => `${loudness(f)}, ${f.onsets.toFixed(1)} onsets/s, ${f.bpm ? `${Math.round(f.bpm)} BPM` : "no beat"}, pulse ${f.pulse.toFixed(1)}` },
	{ id: "build-up", names: ["build", "rising", "riser", "crescendo", "нараст", "подъ", "разгон"], score: (f) => ramp(f.slope, 0.3, 2) * (0.6 + 0.4 * ramp(f.seconds, 2, 6)) * (1 - ramp(f.silent, 0.4, 0.9)), why: (f) => `level rising ${f.slope.toFixed(1)} dB/s over ${f.seconds.toFixed(1)} s` },
	{ id: "drop", names: ["drop", "hit", "impact", "дроп", "удар"], score: (f) => ramp(f.jump, 4, 12), why: (f) => `biggest jump +${f.jump.toFixed(1)} dB in half a second` },
	{ id: "tense", names: ["tense", "tension", "suspense", "anxious", "dark", "scary", "напряж", "тревож", "мрачн", "страш"], score: (f) => mean(f.minor === true ? 1 : f.minor === false ? 0.2 : 0.5, ramp(f.centroid, 2500, 900), Math.max(ramp(f.slope, 0, 1.5), ramp(f.onsets, 0.5, 3)), 1 - ramp(f.words, 1, 2.5)), why: (f) => `${f.minor === null ? "no clear key" : f.minor ? "minor key" : "major key"}, centroid ${Math.round(f.centroid)} Hz, slope ${f.slope.toFixed(1)} dB/s` },
	{ id: "happy", names: ["happy", "joy", "cheerful", "bright", "fun", "весел", "радост", "светл", "позитив"], score: (f) => (0.6 * (f.minor === false ? 1 : f.minor === true ? 0 : 0.5) + 0.4 * ramp(f.centroid, 1200, 3000)) * (0.5 + 0.5 * arousal(f)), why: (f) => `${f.minor === null ? "no clear key" : f.minor ? "minor key" : "major key"}, centroid ${Math.round(f.centroid)} Hz, ${f.bpm ? `${Math.round(f.bpm)} BPM` : "no beat"}` },
	{ id: "sad", names: ["sad", "melanchol", "sorrow", "груст", "печал", "тоск", "меланх"], score: (f) => (0.6 * (f.minor === true ? 1 : f.minor === false ? 0 : 0.4) + 0.4 * ramp(f.centroid, 2500, 1000)) * (1 - 0.8 * arousal(f)), why: (f) => `${f.minor === null ? "no clear key" : f.minor ? "minor key" : "major key"}, dark (${Math.round(f.centroid)} Hz), ${f.onsets.toFixed(1)} onsets/s` },
	{ id: "drums", names: ["drum", "beat", "percuss", "kick", "барабан", "бит", "ударн"], score: (f) => mean(ramp(f.pulse, 3, 10), ramp(f.onsets, 1, 4)), why: (f) => `pulse ${f.pulse.toFixed(1)}, ${f.onsets.toFixed(1)} onsets/s` },
	{ id: "bass", names: ["bass", "boom", "low end", "бас", "низ"], score: (f) => ramp(f.bass, -14, -4), why: (f) => `under 200 Hz ${f.bass.toFixed(0)} dB vs the whole` },
	{ id: "piano", names: ["piano", "pluck", "guitar", "пианин", "фортеп", "рояль", "гитар"], score: (f) => mean(ramp(f.tonal, 0.2, 0.6), ramp(f.decay, 0.2, 0.7), ramp(f.onsets, 0.3, 2), ramp(f.pitchSpread, 2, 7), 1 - ramp(f.words, 0.5, 1.5)), why: (f) => `${Math.round(f.tonal * 100)}% tonal, ${Math.round(f.decay * 100)}% of the notes decay, melody over ${Math.round(f.pitchSpread)} semitones` },
	{ id: "pads", names: ["pad", "strings", "ambient", "drone", "sustain", "струн", "эмбиент", "пэд"], score: (f) => mean(ramp(f.tonal, 0.3, 0.7), ramp(f.onsets, 1.5, 0.2), 1 - ramp(f.words, 0.3, 1)), why: (f) => `${Math.round(f.tonal * 100)}% tonal, ${f.onsets.toFixed(1)} onsets/s (sustained)` },
	{ id: "crowd", names: ["crowd", "cheer", "applause", "clap", "audience", "толп", "апплод", "ликов", "зрител", "хлоп"], score: (f) => mean(ramp(f.flat, 0.15, 0.4), ramp(f.voiced, 0.4, 0.05), 1 - ramp(f.words, 0.5, 1.5)) * ramp(f.level, -55, -30) * (1 - ramp(f.silent, 0.2, 0.6)), why: (f) => `noise-like (flatness ${f.flat.toFixed(2)}), ${Math.round(f.voiced * 100)}% voiced, ${loudness(f)}` },
	{ id: "noise", names: ["noise", "hiss", "static", "шум", "шипен"], score: (f) => mean(ramp(f.flat, 0.15, 0.45), ramp(f.voiced, 0.3, 0.05), 1 - ramp(f.silent, 0.3, 0.8)), why: (f) => `flatness ${f.flat.toFixed(2)}, ${Math.round(f.voiced * 100)}% voiced` },
	{ id: "echo", names: ["echo", "reverb", "room", "hall", "эхо", "реверб", "гулк", "зал"], score: (f) => (f.reverb === null ? 0 : ramp(f.reverb, 0.3, 0.9)), why: (f) => (f.reverb === null ? "no word ends to measure the room by" : `the voice rings ~${f.reverb.toFixed(2)} s`) },
	{ id: "hum", names: ["hum", "buzz", "mains", "гуд", "фон сети", "жужж"], score: (f) => (f.hum ? 1 : 0), why: (f) => (f.hum ? "50/60 Hz lines in the room tone" : "no mains lines") },
];

const strip = (q: string) => q.toLowerCase().replace(/ё/g, "е");

/** The concepts a question names (several for «sad piano»), or none. */
export function conceptsIn(question: string): Concept[] {
	const q = strip(question);
	return CONCEPTS.filter((c) => c.names.some((n) => q.includes(strip(n))));
}

export interface Answer {
	question: string;
	/** 0…100, null when no concept matched. */
	score: number | null;
	concepts: string[];
	why: string;
}

export function answer(question: string, f: Features): Answer {
	const cs = conceptsIn(question);
	if (!cs.length) return { question, score: null, concepts: [], why: `not in the vocabulary (${CONCEPTS.map((c) => c.id).join(", ")})` };
	const scores = cs.map((c) => c.score(f));
	// «sad piano»: both must hold — the weaker one weighs most.
	const s = cs.length === 1 ? scores[0] : 0.7 * Math.min(...scores) + 0.3 * mean(...scores);
	return { question, score: Math.round(s * 100), concepts: cs.map((c) => c.id), why: cs.map((c) => `${c.id}: ${c.why(f)}`).join("; ") };
}
