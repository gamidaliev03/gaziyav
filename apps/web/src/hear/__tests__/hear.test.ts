import { beforeAll, describe, expect, test } from "bun:test";
import { detectBeatsFromEnvelope, EnvelopeBuilder, hopFor } from "@/assist/beats";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { bestCutIn, CUT_RULES, type CutContext, cutPointsNear, HEAD_GUARD, planPauseCuts, snapRange, snapTime, TAIL_GUARD, type TimedWord } from "../cuts";
import { describeMusic, describeSound, reverbOf } from "../describe";
import { analyseFrames, findClicks, findHoles, findHum, keyOf, levelsOf, LoudnessMeter, loudnessOf, SLOW_EVERY, slowFrame } from "../dsp";
import { findBreaths, heardWords, musicGrid, pausesOf, refineWords, segmentsOf } from "../map";

const RATE = 32000;
const FPS = 30;

/** A deterministic noise source. */
function rng(seed = 1) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32 - 0.5;
	};
}

function silence(seconds: number) {
	return new Float32Array(Math.round(seconds * RATE));
}

/** A voiced "syllable": harmonics of f0 with a 15 ms attack and `release` s decay, like a vowel. */
function word(seconds: number, f0 = 150, amp = 0.25, release = 0.03): Float32Array {
	const n = Math.round(seconds * RATE);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const t = i / RATE;
		const env = Math.min(1, t / 0.015) * Math.min(1, (seconds - t) / release);
		let v = 0;
		for (let k = 1; k <= 12; k++) v += Math.sin(2 * Math.PI * f0 * k * t * (1 + 0.02 * Math.sin(2 * Math.PI * 4 * t))) / k;
		out[i] = amp * env * v * 0.5;
	}
	return out;
}

function noise(seconds: number, amp: number, seed = 7, smooth = 0): Float32Array {
	const r = rng(seed);
	const out = new Float32Array(Math.round(seconds * RATE));
	let y = 0;
	for (let i = 0; i < out.length; i++) {
		const x = r() * 2 * amp;
		y = smooth ? y + (1 - smooth) * (x - y) : x;
		out[i] = y;
	}
	return out;
}

/** Joins pieces, returning the samples and where each piece starts. */
function join(pieces: Float32Array[]): { x: Float32Array; at: number[] } {
	const n = pieces.reduce((s, p) => s + p.length, 0);
	const x = new Float32Array(n);
	const at: number[] = [];
	let o = 0;
	for (const p of pieces) {
		at.push(o / RATE);
		x.set(p, o);
		o += p.length;
	}
	return { x, at };
}

function addInto(x: Float32Array, y: Float32Array, from = 0) {
	for (let i = 0; i < y.length && from + i < x.length; i++) x[from + i] += y[i];
}

/**
 * «w1 w2. (breath) w3 w4 w5.» — words of 0.3–0.5 s, a 1.2 s pause with a breath in it, a 0.2 s pause, room tone at
 * about −62 dB under everything.
 */
function utterance() {
	const parts = [silence(0.4), word(0.42), silence(0.12), word(0.35, 170), silence(1.2), word(0.5, 140), silence(0.2), word(0.3), silence(0.6), word(0.45, 160), silence(0.5)];
	const { x, at } = join(parts);
	addInto(x, noise(x.length / RATE, 0.0014, 3));
	// A breath: band-limited noise, 0.32 s, about −36 dB, 0.25 s before word 3.
	const breathAt = at[5] - 0.25 - 0.32;
	const breath = noise(0.32, 0.05, 11, 0.6);
	for (let i = 0; i < breath.length; i++) breath[i] *= Math.sin((Math.PI * i) / breath.length);
	addInto(x, breath, Math.round(breathAt * RATE));
	const words: TimedWord[] = [
		{ text: "Привет", start: at[1], end: at[1] + 0.42 },
		{ text: "друзья.", start: at[3], end: at[3] + 0.35 },
		{ text: "Сегодня", start: at[5], end: at[5] + 0.5 },
		{ text: "я", start: at[7], end: at[7] + 0.3 },
		{ text: "расскажу.", start: at[9], end: at[9] + 0.45 },
	];
	return { x, words, breath: { start: breathAt, end: breathAt + 0.32 } };
}

function context(x: Float32Array, words: TimedWord[]): CutContext {
	const frames = analyseFrames(x, RATE, 0);
	const levels = levelsOf(frames);
	const refined = refineWords(words, frames, levels);
	const breaths = findBreaths(frames, levels, refined, 0, x.length / RATE);
	return { frames, levels, words: refined, breaths, fps: FPS };
}

const onFrame = (t: number) => Math.abs(t * FPS - Math.round(t * FPS)) < 1e-6;
const inWord = (t: number, words: TimedWord[]) => words.some((w) => t > w.start + 1e-6 && t < w.end - 1e-6);

describe("the signal", () => {
	test("voiced words are periodic with the right pitch, a breath is not", () => {
		const { x, words, breath } = utterance();
		const f = analyseFrames(x, RATE, 0);
		const mid = Math.floor(((words[0].start + words[0].end) / 2) * 100);
		expect(f.voicing[mid]).toBeGreaterThan(0.7);
		expect(Math.abs(f.f0[mid] - 150) / 150).toBeLessThan(0.05);
		const b = Math.floor(((breath.start + breath.end) / 2) * 100);
		expect(f.voicing[b]).toBeLessThan(0.45);
	});

	test("a click in a tone is found to the millisecond; the speech-like signal has none", () => {
		const tone = new Float32Array(3 * RATE);
		for (let i = 0; i < tone.length; i++) tone[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / RATE);
		tone[Math.round(1.5 * RATE)] += 0.4;
		const clicks = findClicks(tone, RATE, 0);
		expect(clicks.length).toBe(1);
		expect(Math.abs(clicks[0].at - 1.5)).toBeLessThan(0.001);
		const { x } = utterance();
		expect(findClicks(x, RATE, 0)).toEqual([]);
		// A word that starts out of digital silence (synthetic voices) is an onset, not a click.
		const clean = join([silence(0.5), word(0.4, 180, 0.5, 0.01), silence(0.5)]).x;
		expect(findClicks(clean, RATE, 0)).toEqual([]);
	});

	test("a hole of digital silence in room tone is found; a fade into silence is not a hole", () => {
		const room = noise(2, 0.003, 5);
		room.fill(0, Math.round(1.0 * RATE), Math.round(1.04 * RATE));
		const holes = findHoles(room, RATE, 0);
		expect(holes.length).toBe(1);
		expect(Math.abs(holes[0].start - 1.0)).toBeLessThan(0.002);
		expect(Math.abs(holes[0].end - 1.04)).toBeLessThan(0.002);
		const fade = join([word(0.5, 150, 0.3, 0.2), silence(0.3), word(0.5)]).x;
		expect(findHoles(fade, RATE, 0)).toEqual([]);
	});

	test("loudness: a −20 dBFS sine reads about −23 LUFS (K-weighted, mono on both channels counts +3 LU)", () => {
		const m = new LoudnessMeter(48000);
		const s = new Float32Array(48000 * 4);
		for (let i = 0; i < s.length; i++) s[i] = 0.1 * Math.sqrt(2) * Math.sin((2 * Math.PI * 1000 * i) / 48000);
		m.push([s, s]);
		const l = loudnessOf(m);
		// 1 kHz sine at −20 dBFS RMS per channel, two channels: −20 + 3.01 − 0.69 + K-weighting (+0.7 dB at 1 kHz) ≈ −17.0 LUFS.
		expect(Math.abs(l.integrated - -17.0)).toBeLessThan(0.3);
	});
});

describe("words, breaths and pauses", () => {
	test("the planted breath is found, inside its pause, and nothing else is a breath", () => {
		const { x, words, breath } = utterance();
		const c = context(x, words);
		expect(c.breaths.length).toBe(1);
		expect(Math.abs(c.breaths[0].start - breath.start)).toBeLessThan(0.06);
		expect(Math.abs(c.breaths[0].end - breath.end)).toBeLessThan(0.06);
		const pauses = pausesOf(c.words, c.frames, c.levels, c.breaths, 0, x.length / RATE);
		const long = pauses.find((p) => p.length > 1);
		expect(long?.breath).toBeDefined();
		expect(long?.kind).toBe("room");
		expect(long?.sentenceEnd).toBe(true);
	});

	test("segments: speech where the words are, room tone in the long pause", () => {
		const { x, words } = utterance();
		const c = context(x, words);
		const segs = segmentsOf(c.frames, c.levels, c.words, 0, x.length / RATE);
		expect(segs.some((s) => s.kind === "speech")).toBe(true);
		expect(segs.some((s) => s.kind === "room" || s.kind === "silence")).toBe(true);
	});
});

describe("cut points", () => {
	test("every planned pause cut is frame-exact, inside a pause with 80/50 ms of air, never through the breath", () => {
		const { x, words } = utterance();
		const c = context(x, words);
		const cuts = planPauseCuts(c, 0, x.length / RATE);
		expect(cuts.length).toBeGreaterThanOrEqual(2);
		for (const cut of cuts) {
			expect(onFrame(cut.start)).toBe(true);
			expect(onFrame(cut.end)).toBe(true);
			expect(inWord(cut.start, c.words) || inWord(cut.end, c.words)).toBe(false);
			for (const w of c.words) {
				// A cut never comes closer to a word than the pads.
				if (cut.start >= w.end - 1e-6) expect(cut.start - w.end).toBeGreaterThanOrEqual(TAIL_GUARD - 1e-6);
				if (cut.end <= w.start + 1e-6 && cut.start < w.start) expect(w.start - cut.end).toBeGreaterThanOrEqual(HEAD_GUARD - 1e-6);
			}
			for (const b of c.breaths) {
				expect(cut.start > b.start + 0.005 && cut.start < b.end - 0.005).toBe(false);
				expect(cut.end > b.start + 0.005 && cut.end < b.end - 0.005).toBe(false);
			}
		}
		// The 1.2 s pause after «друзья.» shrinks to a natural one, the 0.2 s pause is left alone.
		const big = cuts.find((x) => x.start > c.words[1].end && x.end < c.words[2].start);
		expect(big).toBeDefined();
		expect(big!.kept).toBeGreaterThan(0.25);
		expect(big!.kept).toBeLessThan(0.75);
		expect(cuts.some((x) => x.start > c.words[2].end && x.end < c.words[3].start)).toBe(false);
	});

	test("a word the recogniser starts 220 ms late (a numeral after a chapter pause) or ends 200 ms early gets its real edges: no pause cut, cut point or split clips it", () => {
		// claude-produce's 3-min test (09.11): «2.» after a long pause started 70 ms cut — Whisper put the numeral's onset
		// late and the edge was placed 50 ms before that late start.
		const parts = [silence(0.4), word(0.42), silence(1.6), word(0.5, 140), silence(0.8)];
		const { x, at } = join(parts);
		addInto(x, noise(x.length / RATE, 0.0014, 3));
		const attack = at[3];
		const tail = at[1] + 0.42;
		const words: TimedWord[] = [
			{ text: "Глава", start: at[1], end: tail - 0.2 },
			{ text: "2.", start: attack + 0.22, end: attack + 0.5 },
		];
		const c = context(x, words);
		expect(Math.abs(c.words[1].start - attack)).toBeLessThan(0.025);
		expect(Math.abs(c.words[0].end - tail)).toBeLessThan(0.035);
		// remove_pauses: the long pause is cut with 50 ms of air before the real attack and 80 ms after the real tail.
		const big = planPauseCuts(c, 0, x.length / RATE).find((k) => k.start > at[1] + 0.1 && k.end < attack + 0.3);
		expect(big).toBeDefined();
		expect(attack - big!.end).toBeGreaterThanOrEqual(HEAD_GUARD - 0.012);
		expect(big!.start - tail).toBeGreaterThanOrEqual(TAIL_GUARD - 0.012);
		// apply_plan's way: the best cut in the gap, aimed just before the next word.
		const head = bestCutIn(c, c.words[0].end, c.words[1].start, c.words[1].start - 0.2);
		expect(head).not.toBeNull();
		expect(attack - head!.at).toBeGreaterThanOrEqual(HEAD_GUARD - 0.012);
		// A split asked 100 ms into the real word (still before the recogniser's start) leaves the word whole.
		const s = snapTime(c, attack + 0.1);
		expect(s.at <= attack - 0.03 || s.at >= attack + 0.53).toBe(true);
	});

	test("the best cut near a time inside a word lands in a pause; music-free split moves out of the word", () => {
		const { x, words } = utterance();
		const c = context(x, words);
		const t = (c.words[2].start + c.words[2].end) / 2;
		const points = cutPointsNear(c, t, 0.6);
		expect(points.length).toBeGreaterThan(0);
		for (const p of points) {
			expect(onFrame(p.at)).toBe(true);
			expect(inWord(p.at, c.words)).toBe(false);
		}
		const moved = snapTime(c, t);
		expect(inWord(moved.at, c.words)).toBe(false);
		expect(onFrame(moved.at)).toBe(true);
		expect(moved.note).toMatch(/stays whole/);
		const inPause = bestCutIn(c, c.words[1].end, c.words[2].start);
		expect(inPause).not.toBeNull();
		expect(inPause!.db).toBeLessThan(c.levels.floor + 12);
	});

	test("cut_out ranges: a word mostly inside goes whole, one mostly outside stays whole, edges in pauses", () => {
		const { x, words } = utterance();
		const c = context(x, words);
		const w = c.words;
		// From the middle of «друзья.» (more than half of it inside) to a third into «я» (less than half inside).
		const from = w[1].start + (w[1].end - w[1].start) * 0.3;
		const to = w[3].start + (w[3].end - w[3].start) * 0.3;
		const r = snapRange(c, from, to);
		expect(onFrame(r.from) && onFrame(r.to)).toBe(true);
		expect(r.from).toBeLessThanOrEqual(w[1].start + 1e-6);
		expect(r.from).toBeGreaterThanOrEqual(w[0].end + 0.015 - 1e-6);
		expect(r.to).toBeLessThanOrEqual(w[3].start + 1e-6);
		expect(r.to).toBeGreaterThanOrEqual(w[2].end + 0.015 - 1e-6);
		expect(inWord(r.from, w) || inWord(r.to, w)).toBe(false);
		// The join keeps a natural pause: what is left of the two pauses.
		const kept = r.from - w[0].end + (w[3].start - r.to);
		expect(kept).toBeGreaterThan(0.1);
		expect(kept).toBeLessThan(0.7);
	});

	test("the shared cut rules are the agreed ones", () => {
		expect(CUT_RULES).toMatchObject({ cleanSilence: 0.4, checkSilence: 0.15, padAfterWord: 0.08, padBeforeWord: 0.05, fade: 0.03 });
	});
});

/** The server's analysis of a synthetic sound, without ffmpeg. */
function hear(x: Float32Array, words: TimedWord[] = []) {
	const frames = analyseFrames(x, RATE, 0);
	const levels = levelsOf(frames);
	const slow = [];
	const step = Math.round(SLOW_EVERY * RATE);
	for (let c = 0; c < x.length; c += step) slow.push(slowFrame(x, RATE, c, c / RATE));
	const meter = new LoudnessMeter(RATE);
	meter.push([x, x]);
	const loud = loudnessOf(meter);
	const env = new EnvelopeBuilder(hopFor(RATE));
	env.push(x);
	const b = detectBeatsFromEnvelope(env.env, RATE / env.hop);
	const grid = b.bpm > 0 ? musicGrid(b.beats, b.bpm, frames) : null;
	const hw = heardWords(refineWords(words, frames, levels), frames);
	const to = x.length / RATE;
	const pauses = pausesOf(hw, frames, levels, [], 0, to);
	const segments = segmentsOf(frames, levels, hw, 0, to);
	return { frames, levels, slow, loud, grid, words: hw, pauses, segments, to, hum: findHum(slow, RATE) };
}

describe("how it sounds", () => {
	test("mains hum: a 50 Hz comb in the room tone is heard; plain room tone is not hum", () => {
		const room = noise(8, 0.004, 9);
		expect(hear(room).hum).toBeNull();
		const hum = noise(8, 0.004, 9);
		for (let i = 0; i < hum.length; i++) {
			const t = i / RATE;
			hum[i] += 0.01 * Math.sin(2 * Math.PI * 50 * t) + 0.006 * Math.sin(2 * Math.PI * 100 * t) + 0.004 * Math.sin(2 * Math.PI * 150 * t);
		}
		const h = hear(hum).hum;
		expect(h?.freq).toBe(50);
		expect(h!.harmonics).toBeGreaterThanOrEqual(2);
	});

	test("echo: words ringing out ~0.8 s read as an echoey room, dry words as dry", () => {
		const make = (t60: number) => {
			const parts: Float32Array[] = [silence(0.3)];
			for (let k = 0; k < 5; k++) parts.push(word(0.4, 150 + 10 * k, 0.3, 0.02), silence(1.0));
			const { x, at } = join(parts);
			// The room: every word's energy decays with T60 after it ends.
			for (let k = 0; k < 5; k++) {
				const end = Math.round((at[1 + 2 * k] + 0.4) * RATE);
				const tail = noise(1.0, 0.12, 20 + k);
				for (let i = 0; i < tail.length; i++) tail[i] *= 10 ** ((-3 * (i / RATE)) / t60);
				if (t60 > 0.2) addInto(x, tail, end - Math.round(0.02 * RATE));
			}
			addInto(x, noise(x.length / RATE, 0.0006, 4));
			const words = Array.from({ length: 5 }, (_, k) => ({ text: `w${k}`, start: at[1 + 2 * k], end: at[1 + 2 * k] + 0.4 }));
			return hear(x, words);
		};
		const dry = make(0.1);
		const wet = make(0.8);
		const rDry = reverbOf(dry.frames, dry.levels, dry.words);
		const rWet = reverbOf(wet.frames, wet.levels, wet.words);
		expect(rDry).not.toBeNull();
		expect(rDry!).toBeLessThan(0.3);
		expect(rWet!).toBeGreaterThan(0.5);
		const notes = describeSound({ ...wet, from: 0, rate: RATE }, rWet);
		expect(notes.find((n) => n.what === "echo")?.severity).toBeGreaterThanOrEqual(2);
		expect(notes.find((n) => n.what === "echo")?.fix).toBe("echo");
	});

	test("music: a slow soft A-minor pad is calm, a loud 128 BPM beat is energetic; tempo, bars and key are read", () => {
		const seconds = 16;
		const pad = new Float32Array(seconds * RATE);
		const chords = [
			[220, 261.63, 329.63],
			[146.83, 174.61, 220],
			[164.81, 207.65, 246.94],
			[220, 261.63, 329.63],
		];
		for (let i = 0; i < pad.length; i++) {
			const t = i / RATE;
			const ch = chords[Math.floor(t / 4) % 4];
			let v = 0;
			for (const f of ch) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
			pad[i] = 0.025 * v * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.25 * t));
		}
		const beat = new Float32Array(seconds * RATE);
		const r = rng(5);
		const period = 60 / 128;
		for (let i = 0; i < beat.length; i++) {
			const t = i / RATE;
			const k = t % period;
			const h = t % (period / 2);
			beat[i] = 0.7 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-18 * k) + 0.25 * r() * Math.exp(-70 * h) + 0.12 * Math.sign(Math.sin(2 * Math.PI * 110 * t)) * (Math.floor(t / period) % 4 === 0 ? 1 : 0.6);
		}
		const calm = hear(pad);
		const loud = hear(beat);
		const span = [{ start: 0, end: seconds }];
		const c = describeMusic({ ...calm, from: 0, rate: RATE }, span);
		const e = describeMusic({ ...loud, from: 0, rate: RATE }, span);
		expect(c[0].line).toMatch(/^calm/);
		expect(e[0].line).toMatch(/^energetic/);
		expect(loud.grid).not.toBeNull();
		expect(Math.abs(loud.grid!.bpm - 128)).toBeLessThan(3);
		expect(loud.grid!.downbeats.length).toBeGreaterThan(5);
		// the song's refereed bars given (music, 11.11): they are the grid's bar starts — over its beats only — not the guess
		const g = loud.grid!;
		const given = [g.beats[0] - 5, ...g.beats.filter((_, i) => i % 3 === 1), g.beats[g.beats.length - 1] + 5];
		const three = musicGrid(g.beats, g.bpm, loud.frames, given);
		expect(three?.downbeats).toEqual(g.beats.filter((_, i) => i % 3 === 1));
		expect(three?.beats).toEqual(g.beats);
		expect(musicGrid(g.beats, g.bpm, loud.frames)?.downbeats).toEqual(g.downbeats); // none given: as before
		const chroma = new Array(12).fill(0);
		for (const s of calm.slow) for (let i = 0; i < 12; i++) chroma[i] += s.chroma[i];
		expect(keyOf(chroma)?.key).toBe("A minor");
		// 32 s of synthetic music analysed in-process: ~2 s on a quiet Mac, 7.6 s measured under a build (09.11).
	}, 30_000);
});

describe("seamless cuts on the timeline", () => {
	let removeRangesFromTracks: typeof import("@/silence/remove").removeRangesFromTracks;
	let planFixes: typeof import("../fixes").planFixes;
	beforeAll(async () => {
		await installOpenCutWasm();
		({ removeRangesFromTracks } = await import("@/silence/remove"));
		({ planFixes } = await import("../fixes"));
	}, 60_000);
	const TPS = 120000;
	const clip = (id: string, start: number, duration: number, trimStart = 0, trimEnd = 10, params: Record<string, unknown> = {}) =>
		({ id, type: "video", name: id, mediaId: "m", startTime: start * TPS, duration: duration * TPS, trimStart: trimStart * TPS, trimEnd: trimEnd * TPS, params, animations: undefined }) as never;
	const tracks = (els: unknown[]) => ({ overlay: [], main: { id: "main", type: "video", elements: els }, audio: [] }) as never;

	test("a cut keeps the clip's own fades on its outer edges and puts 30 ms fades at the join", () => {
		const t = tracks([clip("a", 0, 10, 0, 0, { fadeIn: 1, fadeOut: 2, "anim.in": "fade" })]);
		const out = removeRangesFromTracks(t, [{ start: 4 * TPS, end: 5 * TPS }], TPS, 0.03) as unknown as { main: { elements: Array<{ params: Record<string, unknown>; startTime: number; duration: number }> } };
		const [a, b] = out.main.elements;
		expect(a.params.fadeIn).toBe(1);
		expect(a.params.fadeOut).toBe(0.03);
		expect(a.params["anim.in"]).toBe("fade");
		expect(b.params.fadeIn).toBe(0.03);
		expect(b.params.fadeOut).toBe(2);
		expect(b.params["anim.in"]).toBe("none");
		expect(b.startTime).toBe(4 * TPS);
		// Without the seam fade (the panel's own Remove pauses): the join just loses the duplicated fades.
		const plain = removeRangesFromTracks(t, [{ start: 4 * TPS, end: 5 * TPS }], TPS) as unknown as { main: { elements: Array<{ params: Record<string, unknown> }> } };
		expect(plain.main.elements[0].params.fadeOut).toBe(0);
		expect(plain.main.elements[1].params.fadeIn).toBe(0);
	});

	test("fixes: a cut-off word gets its frames back (ripple), a long pause loses frames, music rolls onto the beat, every fixed cut gets fades", () => {
		const t = tracks([clip("a", 0, 4, 0, 6), clip("b", 4, 4, 6, 2)]);
		const remove = ((tr: never, ranges: Array<{ start: number; end: number }>, tps: number, fade: number) => removeRangesFromTracks(tr, ranges.map((r) => ({ start: r.start * tps, end: r.end * tps })), tps, fade)) as unknown as Parameters<typeof planFixes>[4];
		const report = (op: string, seconds: number) => [{ at: 4, defects: [{ kind: "word", severity: 3, detail: "x", fix: { op, seconds } }] }] as never;
		const els = (tr: unknown) => (tr as { main: { elements: Array<{ id: string; startTime: number; duration: number; trimStart: number; trimEnd: number; params: Record<string, unknown> }> } }).main.elements;
		const ext = els(planFixes(t, report("extendLeft", 0.1), [{ at: 4 }], 30, remove).tracks);
		const r = (s: number) => Math.round(s * TPS);
		expect(ext[0].duration).toBe(r(4 + 3 / 30));
		expect(ext[0].trimEnd).toBe(r(6 - 3 / 30));
		expect(ext[1].startTime).toBe(r(4 + 3 / 30));
		expect(ext[0].params.fadeOut).toBe(0.03);
		expect(ext[1].params.fadeIn).toBe(0.03);
		const trim = els(planFixes(t, report("trimLeft", 0.5), [{ at: 4 }], 30, remove).tracks);
		expect(trim[0].duration).toBe(3.5 * TPS);
		expect(trim[1].startTime).toBe(3.5 * TPS);
		const roll = els(planFixes(t, report("roll", -0.07), [{ at: 4 }], 30, remove).tracks);
		expect(roll[0].duration).toBe(r(4 - 2 / 30));
		expect(roll[1].startTime).toBe(r(4 - 2 / 30));
		expect(roll[1].duration).toBe(r(4 + 2 / 30));
		// Every move is whole frames: the timeline stays frame-exact.
		for (const e of [...ext, ...trim, ...roll]) {
			expect(Math.abs(((e.startTime / TPS) * 30) % 1) < 1e-6 || Math.abs(((e.startTime / TPS) * 30) % 1) > 1 - 1e-6).toBe(true);
		}
	});
});

describe("asking the sound (sounds_like)", () => {
	const ask = async (x: Float32Array, q: string, words: TimedWord[] = [], from = 0, to = x.length / RATE) => {
		const { answer, featuresOf } = await import("../ask");
		const h = hear(x, words);
		const f = featuresOf(h.frames, from, to, { words: h.words, slow: h.slow, pulse: h.grid?.pulse ?? 0, bpm: h.grid && h.grid.pulse >= 5 ? h.grid.bpm : 0, reverb: null, hum: !!h.hum });
		const a = answer(q, f);
		if (process.env.ASKDBG) console.log("ASK", q, a.score, JSON.stringify(f), a.why);
		return a;
	};
	const seconds = 12;
	const pad = () => {
		const x = new Float32Array(seconds * RATE);
		for (let i = 0; i < x.length; i++) {
			const t = i / RATE;
			x[i] = 0.02 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 261.63 * t) + Math.sin(2 * Math.PI * 329.63 * t)) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.25 * t));
		}
		return x;
	};
	const beat = () => {
		const r = rng(5);
		const x = new Float32Array(seconds * RATE);
		const period = 60 / 128;
		for (let i = 0; i < x.length; i++) {
			const t = i / RATE;
			const k = t % period;
			x[i] = (Math.floor(t / period) % 4 === 0 ? 0.8 : 0.5) * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-18 * k) + 0.25 * r() * Math.exp(-70 * (t % (period / 2))) + 0.12 * Math.sign(Math.sin(2 * Math.PI * 110 * t));
		}
		return x;
	};
	test("a soft slow pad sounds calm, not energetic; a loud 128 BPM beat the other way round, with drums", async () => {
		const calm = pad();
		const loud = beat();
		expect((await ask(calm, "calm")).score!).toBeGreaterThanOrEqual(60);
		expect((await ask(calm, "energetic")).score!).toBeLessThanOrEqual(40);
		expect((await ask(loud, "energetic")).score!).toBeGreaterThanOrEqual(60);
		expect((await ask(loud, "спокойно")).score!).toBeLessThanOrEqual(40);
		expect((await ask(loud, "drums")).score!).toBeGreaterThanOrEqual(60);
	});
	test("a rising sound is a build-up, a steady one is not; a sudden jump is a drop", async () => {
		const rise = new Float32Array(8 * RATE);
		const r = rng(9);
		for (let i = 0; i < rise.length; i++) {
			const t = i / RATE;
			rise[i] = 10 ** ((-50 + 5 * t) / 20) * (Math.sin(2 * Math.PI * 330 * t) + r());
		}
		expect((await ask(rise, "tense build-up")).score!).toBeGreaterThanOrEqual(55);
		expect((await ask(pad(), "build-up")).score!).toBeLessThanOrEqual(30);
		const drop = new Float32Array(6 * RATE);
		for (let i = 0; i < drop.length; i++) drop[i] = (i / RATE < 3 ? 0.01 : 0.4) * Math.sin((2 * Math.PI * 110 * i) / RATE);
		expect((await ask(drop, "drop")).score!).toBeGreaterThanOrEqual(70);
	});
	test("a cheering crowd (dense noise bursts) is a crowd; speech is speech, not a crowd; silence is silence", async () => {
		const crowd = new Float32Array(8 * RATE);
		const r = rng(3);
		for (let i = 0; i < crowd.length; i++) crowd[i] = 0.08 * r() * (0.6 + 0.4 * Math.abs(Math.sin(i / 900)));
		expect((await ask(crowd, "crowd cheering")).score!).toBeGreaterThanOrEqual(60);
		const { x, words } = utterance();
		const asSpeech = await ask(x, "speech", words);
		expect(asSpeech.score!).toBeGreaterThanOrEqual(55);
		expect((await ask(x, "applause", words)).score!).toBeLessThanOrEqual(40);
		expect((await ask(silence(4), "тишина")).score!).toBeGreaterThanOrEqual(80);
	});
	test("sad piano: plucked minor notes score high, the beat low; an unknown phrase answers «?»", async () => {
		const notes = [220, 261.63, 329.63, 246.94, 207.65, 220];
		const piano = new Float32Array(seconds * RATE);
		for (let i = 0; i < piano.length; i++) {
			const t = i / RATE;
			const k = Math.floor(t / 0.8);
			const local = t - k * 0.8;
			const f = notes[k % notes.length];
			piano[i] = 0.12 * Math.exp(-4 * local) * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t));
		}
		expect((await ask(piano, "sad piano")).score!).toBeGreaterThanOrEqual(50);
		expect((await ask(beat(), "sad piano")).score!).toBeLessThanOrEqual(40);
		expect((await ask(piano, "a dog barking")).score).toBeNull();
	});
});

// C11 (10.11): a trim without exact:true on a silent AI clip snapped to the song's words and moved the edge −8.77 s
// «into the pause». A single cut moves at most ±0.35 s; with no pause that near it is cut where asked, and says so.
describe("a single cut stays near where it was asked", () => {
	test("a long sung word after a long pause: no move past ±0.35 s", () => {
		const parts = [silence(0.4), word(0.4), silence(8.5), word(1.6, 220, 0.25, 0.08), silence(0.6)];
		const { x, at } = join(parts);
		addInto(x, noise(x.length / RATE, 0.0014, 5));
		const words: TimedWord[] = [
			{ text: "ма", start: at[1], end: at[1] + 0.4 },
			{ text: "мааама", start: at[3], end: at[3] + 1.6 },
		];
		const c = context(x, words);
		const t = at[3] + 0.8;
		const s = snapTime(c, t);
		expect(Math.abs(s.at - t)).toBeLessThanOrEqual(0.35 + 1 / FPS);
		expect(onFrame(s.at)).toBe(true);
		expect(s.note).toMatch(/cut inside «мааама» where asked/);
		// Near the word's edge it still moves out of the word, into the pause.
		const e = snapTime(c, at[3] + 0.12);
		expect(e.at).toBeLessThanOrEqual(c.words[1].start + 1e-6);
		expect(at[3] + 0.12 - e.at).toBeLessThanOrEqual(0.35 + 1 / FPS);
	});
});
