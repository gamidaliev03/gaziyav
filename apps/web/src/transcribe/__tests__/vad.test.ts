import { describe, expect, test } from "bun:test";
import { alignWords, dropPhantoms, type Span, type Word } from "../align";
import { believable, padded, stitchPlan, unstitch, unvoicedLoud, VAD_PAD, VOICE_EDGE, vadSegmentOf, voiceZones, voicedIslands } from "../vad";
import { VAD_ARGS, VAD_BYTES, VAD_FILE, whisperArgs } from "../server/whisper";
import { originalSpec } from "@/ondevice/manifest";
import { windowsSpec } from "@/ondevice/manifest-win";

// Times as whisper-cli reports them with the app's settings: the voice with 0.4 s around it, two voices less than
const REPORTED: Span[] = [{ start: 14.99, end: 18.59 }, { start: 18.59, end: 22.67 }, { start: 48.53, end: 52.45 }];

describe("the speech detector's stretches", () => {
	test("read from whisper-cli's log lines, nothing else taken for one", () => {
		expect(vadSegmentOf("whisper_vad_segments_from_probs: VAD segment 0: start = 20.16, end = 21.25 (duration: 1.09)")).toEqual({ start: 20.16, end: 21.25 });
		expect(vadSegmentOf("whisper_vad_segments_from_probs: VAD segment 18: start = 6324.71, end = 6325.12 (duration: 0.41)")).toEqual({ start: 6324.71, end: 6325.12 });
		expect(vadSegmentOf("whisper_vad: Including segment 0: 20.16 - 21.35 (duration: 1.19)")).toBeNull();
		expect(vadSegmentOf("whisper_print_progress_callback: progress =  57%")).toBeNull();
		expect(vadSegmentOf("[00:00:15.390 --> 00:00:16.080]   VAD segment 3: start = x, end = y")).toBeNull();
		expect(vadSegmentOf("VAD segment 1: start = 5.00, end = 5.00")).toBeNull();
	});

	test("widened and joined", () => {
		expect(padded([{ start: 10, end: 11 }, { start: 0.1, end: 1 }, { start: 11.5, end: 12 }], 0.4)).toEqual([
			{ start: 0, end: 1.4 },
			{ start: 9.6, end: 12.4 },
		]);
	});

	test("where the voice is: the engine's 0.4 s taken back off the free edges, a pause where two stretches meet", () => {
		const zones = voiceZones(REPORTED);
		const near = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThan(0.001);
		expect(zones.length).toBe(3);
		// free edges: 0.4 − 0.12 inside the reported stretch
		near(zones[0].start, 14.99 + 0.28);
		near(zones[1].end, 22.67 - 0.28);
		near(zones[2].start, 48.53 + 0.28);
		// the meeting point 18.59 is the middle of a pause of at least 0.16 s
		near(zones[0].end, 18.59 - 0.08);
		near(zones[1].start, 18.59 + 0.08);
	});

	test("the pause is found in the sound when a music bed shows it: the level drops between the phrases", () => {
		// voice at −20 dB over a bed at −40 dB; the real pause 18.28–18.88 (the stretches meet at 18.59)
		const levels = new Float32Array(9220).fill(-40);
		for (const [from, to] of [[15, 18.28], [18.88, 22.34], [48.83, 52.13]]) levels.fill(-20, Math.round(from * 100), Math.round(to * 100));
		const zones = voiceZones(REPORTED, levels);
		expect(zones[0].end).toBeCloseTo(18.28, 2);
		expect(zones[1].start).toBeCloseTo(18.88, 2);
		// music as loud as the voice shows no pause: the middle is all that is known
		const flat = voiceZones(REPORTED, new Float32Array(9220).fill(-20));
		expect(flat[0].end).toBeCloseTo(18.51, 2);
		expect(flat[1].start).toBeCloseTo(18.67, 2);
	});

	test("a voice from the file's first second or to its last keeps that edge", () => {
		const levels = new Float32Array(1000).fill(-30); // a 10-s file
		const zones = voiceZones([{ start: 0, end: 3.2 }, { start: 7.1, end: 10 }], levels);
		expect(zones[0].start).toBe(0);
		expect(zones[1].end).toBe(10);
	});
});

describe("islands kept where a voice is", () => {
	const zones = voiceZones(REPORTED);

	test("clean speech: the islands begin and end with the voice and stay as they are", () => {
		// the detector noticed «Шум…» 0.37 s late (15.39; the sound starts at 15.02): the island's own edge is the exact one
		const islands: Span[] = [{ start: 15.02, end: 18.28 }, { start: 18.88, end: 22.34 }, { start: 48.84, end: 52.12 }];
		expect(voicedIslands(islands, zones)).toEqual(islands);
		// the soft first consonant as an island of its own, wholly before the zone
		expect(voicedIslands([{ start: 15.02, end: 15.2 }, { start: 15.3, end: 18.28 }], zones)).toEqual([{ start: 15.02, end: 15.2 }, { start: 15.3, end: 18.28 }]);
	});

	test("a voice over music: one island over the whole clip is cut to the phrases, music alone is no island", () => {
		const bed: Span[] = [{ start: 0, end: 92.2 }];
		expect(voicedIslands(bed, zones)).toEqual([{ start: 15.27, end: 18.51 }, { start: 18.67, end: 22.39 }, { start: 48.81, end: 52.17 }]);
		expect(voicedIslands([{ start: 0, end: 14 }, { start: 60, end: 92 }], zones)).toEqual([]);
		// music that stops a second before the voice is no part of it
		expect(voicedIslands([{ start: 0, end: 14.3 }, { start: 15.3, end: 18.28 }], zones)).toEqual([{ start: 15.3, end: 18.28 }]);
	});

	test("words spread over a music bed land in their phrases once the islands are gated", () => {
		// two phrases, 15–18.3 and 48.9–52.2, a music bed under everything from 0 to 92 s
		const say = (texts: string[], from: number, to: number): Word[] => texts.map((text, i) => ({ text, start: from + ((to - from) * i) / texts.length, end: from + ((to - from) * (i + 1)) / texts.length }));
		const raw = [...say(["Шум", "кондиционера", "легко", "убрать."], 15.4, 18.3), ...say(["Добавьте", "субтитры", "для", "всех."], 48.9, 52.2)];
		const bed: Span[] = [{ start: 0, end: 92 }];
		const before = dropPhantoms(alignWords(raw, bed, bed), bed);
		// as it was: one loud stretch, no pause to hold on to — the eight words laid evenly from the first to the last,
		// the end of the first phrase and the start of the second deep in the 30 s of music between them
		expect(before[3].end).toBeGreaterThan(18.33 + 5);
		expect(before[4].start).toBeLessThan(48.9 - 5);
		const two = voiceZones([{ start: 14.99, end: 18.73 }, { start: 48.5, end: 52.59 }]);
		const gated = voicedIslands(bed, two);
		const after = dropPhantoms(alignWords(raw, gated, gated), gated);
		expect(after.map((w) => w.text)).toEqual(raw.map((w) => w.text));
		for (const w of after.slice(0, 4)) {
			expect(w.start).toBeGreaterThanOrEqual(15.39 - VOICE_EDGE - 0.001);
			expect(w.end).toBeLessThanOrEqual(18.33 + VOICE_EDGE + 0.001);
		}
		for (const w of after.slice(4)) {
			expect(w.start).toBeGreaterThanOrEqual(48.9 - VOICE_EDGE - 0.001);
			expect(w.end).toBeLessThanOrEqual(52.19 + VOICE_EDGE + 0.001);
		}
	});
});

describe("loud stretches the engine was not given", () => {
	test("music before, between and after the speech is found; a short breath of music is left alone", () => {
		const islands: Span[] = [
			{ start: 0, end: 9.9 },
			{ start: 10.2, end: 19.9 }, // the intro, breathing at 10 s
			{ start: 20.1, end: 23.4 }, // speech
			{ start: 24.1, end: 27.6 }, // speech
			{ start: 28.2, end: 29.7 }, // 1.5 s of music: too short to ask about
			{ start: 52.4, end: 72.4 }, // the break
		];
		const reported: Span[] = [{ start: 19.76, end: 23.8 }, { start: 23.8, end: 28.05 }];
		expect(unvoicedLoud(islands, reported)).toEqual([{ start: 0, end: 19.76 }, { start: 52.4, end: 72.4 }]);
	});

	test("no voice at all (a song the detector does not take for speech): the whole of it", () => {
		expect(unvoicedLoud([{ start: 0.5, end: 180 }], [])).toEqual([{ start: 0.5, end: 180 }]);
	});

	test("all of it given: nothing to listen to again", () => {
		expect(unvoicedLoud([{ start: 15, end: 18.3 }, { start: 18.9, end: 22.3 }], REPORTED)).toEqual([]);
	});
});

describe("what the plain engine hears where the detector heard no voice", () => {
	const w = (text: string, start: number, p = 0.9): Word => ({ text, start, end: start + 0.3, p });

	test("a steady stream of sure words is believed (lyrics, a whisper), what the engine invents over music is not", () => {
		const line = (text: string, p = 0.9, from = 0) => text.split(" ").map((t, i) => w(t, from + i * 0.4, p));
		const lyrics = line("Я иду по улице и пою эту песню");
		expect(believable(lyrics, 20)).toBe(true);
		// sung in Spanish in a track of the built-in library, which the detector did not take for a voice
		expect(believable(line("Laimara, Laimara, un Indio me guia la libertà. José Gabriel, José Gabriel, el Condor Kanki"), 20)).toBe(true);
		expect(believable([w("you", 11)], 20)).toBe(false);
		expect(believable([w("Спасибо.", 3), w("Пока.", 12)], 20)).toBe(false);
		// the sign-offs of its training subtitles, however sure it is of them
		expect(believable(line("Thank you. We'll be right back.", 0.99), 20)).toBe(false);
		expect(believable(line("Thank you so much for watching. I'll see you next time.", 0.99), 20)).toBe(false);
		expect(believable(line("*outro music* For more information, visit www.fema.org", 0.9), 20)).toBe(false);
		// one phrase going round and round
		expect(believable([1, 2, 3, 4, 5, 6].flatMap((k) => line("I don't know what you're doing.", 0.9, k * 3)), 20)).toBe(false);
		// four words in a minute and a half of music: not a stream
		expect(believable([w("Night", 1), w("falls", 30), w("so", 60), w("slowly", 85)], 90)).toBe(false);
		// words the engine itself doubts don't count
		expect(believable(lyrics.map((x) => ({ ...x, p: 0.2 })), 20)).toBe(false);
		expect(believable([...line("в в в в в", 0.3), ...line("кто там идёт домой", 0.8, 3)], 20)).toBe(false);
	});

	test("stretches laid end to end and the words brought back to their own time", () => {
		const plan = stitchPlan([{ start: 100, end: 110 }, { start: 300, end: 305 }]);
		expect(plan).toEqual([{ from: { start: 100, end: 110 }, at: 0 }, { from: { start: 300, end: 305 }, at: 11 }]);
		const back = unstitch([w("а", 2), w("б", 9.9), w("тишина", 10.35), w("в", 12)], plan);
		expect(back[0].map((x) => [x.text, x.start, x.end])).toEqual([["а", 102, 102.3], ["б", 109.9, 110]]);
		expect(back[1].map((x) => [x.text, x.start])).toEqual([["в", 301]]);
	});
});

describe("whisper-cli with the detector", () => {
	const base = { model: "/m/ggml-large-v3-turbo-q5_0.bin", wav: "/w/speech.wav", language: "ru", out: "/w/words" };

	test("without the detector's file the command is the one it always was", () => {
		const args = whisperArgs({ ...base, vad: null });
		expect(args).toContain("-np");
		expect(args.join(" ")).not.toContain("vad");
		expect(args.slice(0, 6)).toEqual(["-m", base.model, "-f", base.wav, "-l", "ru"]);
	});

	test("with it: the detector's file, its settings, and the log left on (the stretches are read from it)", () => {
		const args = whisperArgs({ ...base, vad: `/m/${VAD_FILE}` });
		expect(args).not.toContain("-np");
		expect(args.slice(-2 - VAD_ARGS.length)).toEqual(["-vm", `/m/${VAD_FILE}`, ...VAD_ARGS]);
		expect(args).toContain("--vad");
		expect(VAD_ARGS[VAD_ARGS.indexOf("-vp") + 1]).toBe(String(VAD_PAD * 1000));
	});

	test("the second listening is one pass per window (no tries at a higher temperature); nothing else in the command changes", () => {
		const plain = whisperArgs({ ...base, vad: null });
		const quick = whisperArgs({ ...base, vad: null, quick: true });
		expect(quick.filter((a) => !plain.includes(a))).toEqual(["-nf"]);
		expect(plain).not.toContain("-nf");
	});

	test("the detector is an optional file of the speech model in the manifest, with this name and size — on the Mac only", () => {
		const whisper = originalSpec("whisper");
		if (!whisper) throw new Error("no speech model in the manifest");
		const file = whisper.files.find((f) => f.dest === VAD_FILE);
		expect(file?.size).toBe(VAD_BYTES);
		expect(file?.optional).toBe(true);
		expect(windowsSpec(whisper).files.map((f) => f.dest)).toEqual(whisper.files.filter((f) => !f.optional).map((f) => f.dest));
	});
});
