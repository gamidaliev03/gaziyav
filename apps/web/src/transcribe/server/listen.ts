// Speech → words laid on the real sound. One path for the transcription job (captions, the Text view, Assemble,
// Claude's hearing) and for the analysis of a file (production/server/analyze.ts).
//
// Without the speech detector's file it is what it always was: whisper-cli on the whole audio, the words moved onto
// the loud stretches (align.ts), words in silence dropped.
//
// With it (ondevice/manifest.ts brings the file by itself):
// 1. whisper-cli decodes only where the detector hears a voice — music and silence are skipped, so nothing is invented
//    over an intro, and a file with pauses goes faster;
// 2. the detector is checked: loud stretches it heard no voice in (music — but maybe singing, a whisper, a voice
//    through a megaphone) are given to the plain engine once, quickly. A steady stream of words there means the
//    detector missed a voice, and then it is not trusted on this file: the whole file is heard exactly as before the
//    detector existed (measured 11.11 on a whispering, a singing and a robot voice over a beat: with the detector's
//    pieces 17.2 % of the words wrong, the old way 3.7 %). A lone invented «you» over music is no stream, and then:
// 3. the words are laid on the loud stretches that have a voice in them, so under a music bed the pauses between
//    phrases are pauses again (before, the whole clip was one loud stretch and the words were spread over it).
// Any failure of the detector or of step 2 leaves the user with a result: the plain engine's, or step 1's.
import fs from "node:fs";
import path from "node:path";
import { dropHallucinations } from "@/hear/hallucinations";
import { CancelledError } from "@/studio/server/errors";
import { alignWords, dropPhantoms, FINE, type Span, speechIslands, type Word } from "@/transcribe/align";
import { believable, blindZones, padded, stitchPlan, unstitch, unvoicedLoud, voiceZones, voicedIslands, withBlind } from "@/transcribe/vad";
import { findVad, logLine, recognize } from "./whisper";

export interface ListenOptions {
	/** 16 kHz mono WAV and its samples (readPcm16). */
	wav: string;
	samples: Int16Array;
	sampleRate: number;
	/** frameLevels(samples) and speechIslands(levels): the caller has them already. */
	levels: Float32Array;
	islands: Span[];
	/** A folder of the caller's for the engine's files. */
	dir: string;
	language: string;
	duration: number;
	signal?: AbortSignal;
	onProgress?: (fraction: number) => void;
	onStart?: () => void;
	background?: boolean;
}

export interface Heard {
	/** The engine's words, not yet laid on the sound (lay). */
	words: Word[];
	language: string;
	/** The speech detector's finding was used: where a voice is (vad.ts voiceZones). Absent: the words are the plain engine's. */
	voiced?: Span[];
	/**
	 * With the detector's file on this Mac: loud stretches it heard no voice in that the plain engine checked, and in
	 * how many it heard a steady stream of words (any: the detector was not trusted, the file was heard the old way).
	 */
	doubted?: number;
	believed?: number;
}

function writeWav16(file: string, samples: Int16Array, sampleRate: number) {
	const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
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
}

/** The stretches laid end to end with a second of silence between (vad.ts stitchPlan), as 16-bit samples. */
function stitch(samples: Int16Array, sampleRate: number, plan: ReturnType<typeof stitchPlan>): Int16Array {
	const last = plan[plan.length - 1];
	const out = new Int16Array(Math.ceil((last.at + (last.from.end - last.from.start)) * sampleRate));
	for (const { from, at } of plan) {
		const a = Math.max(0, Math.floor(from.start * sampleRate));
		const b = Math.min(samples.length, Math.ceil(from.end * sampleRate));
		out.set(samples.subarray(a, b).subarray(0, Math.max(0, out.length - Math.floor(at * sampleRate))), Math.floor(at * sampleRate));
	}
	return out;
}

/** The engine's part: the words as it heard them (steps 1 and 2 above). */
export async function hear({ wav, samples, sampleRate, levels, islands, dir, language, duration, signal, onProgress, onStart, background }: ListenOptions): Promise<Heard> {
	// With the detector a second pass may follow, and how long it is shows only after the first: the first pass fills
	// half of the bar, the second (or the end) the rest. Without the detector's file the bar is the engine's own.
	const half = findVad() ? 0.5 : 1;
	const first = await recognize({ wav, outDir: dir, language, duration, signal, onStart, background, vad: true, onProgress: (p) => onProgress?.(p * half) });
	// No detector on this Mac (or it failed): the engine alone, as before the detector existed.
	if (!first.voiced) return { words: first.words, language: first.language };
	const decoded = first.voiced;
	const voiced = voiceZones(decoded, levels);
	const words = first.words;
	const doubt = unvoicedLoud(islands, decoded);
	let believed = 0;
	if (doubt.length) {
		try {
			const plan = stitchPlan(doubt);
			const piece = stitch(samples, sampleRate, plan);
			const again = path.join(dir, "unvoiced");
			fs.mkdirSync(again, { recursive: true });
			const pieceWav = path.join(again, "unvoiced.wav");
			writeWav16(pieceWav, piece, sampleRate);
			const seconds = piece.length / sampleRate;
			const second = await recognize({
				wav: pieceWav,
				outDir: again,
				// The language the voiced part was in; a file with no voiced part is heard as it always was.
				language: first.words.length && first.language ? first.language : language,
				duration: seconds,
				signal,
				background,
				// one pass per window: over music alone the engine's second tries are most of the time and bring nothing
				quick: true,
				onProgress: (p) => onProgress?.(half + (1 - half) * p),
			});
			unstitch(second.words, plan).forEach((heard, k) => {
				// The stock inventions first (credits of subtitle groups, «Спасибо за просмотр» over music), then the stream rule.
				const real = dropHallucinations(dropPhantoms(heard, []), () => true);
				if (believable(real, doubt[k].end - doubt[k].start)) believed++;
			});
		} catch (error) {
			if (error instanceof CancelledError || signal?.aborted) throw error;
			logLine(`[whisper] checking ${doubt.length} stretch(es) without a voice failed: ${(error as Error).message}`);
		}
	}
	if (believed) {
		// The detector missed a voice here: the whole file the old way, as if the detector's file were not on this Mac.
		const whole = path.join(dir, "whole");
		fs.mkdirSync(whole, { recursive: true });
		const plain = await recognize({ wav, outDir: whole, language, duration, signal, background, onProgress: (p) => onProgress?.(Math.max(half, p)) });
		return { words: plain.words, language: plain.language, doubted: doubt.length, believed };
	}
	return { words, language: first.language, voiced: padded(voiced), doubted: doubt.length, believed };
}

/** The stretches the engine's words cover (a pause of half a second or more between two words splits them). */
export function wordStretches(words: Word[], gap = 0.5): Span[] {
	const out: Span[] = [];
	for (const w of words) {
		if (!w.text.trim() || !(w.end >= w.start)) continue;
		const last = out[out.length - 1];
		if (last && w.start - last.end < gap) last.end = Math.max(last.end, w.end);
		else out.push({ start: w.start, end: w.end });
	}
	return out;
}

/** The words laid on the real sound (step 3 above), words in silence dropped. */
export function lay(heard: Heard, levels: Float32Array, islands: Span[]): Word[] {
	const fine = speechIslands(levels, FINE);
	// No detector on this Mac: as it always was.
	if (!heard.voiced && !heard.believed) return dropPhantoms(alignWords(heard.words, islands, fine), islands);
	// Where a bed drowns the voice, the islands of sound are its beats: there the stretch of voice is the island
	// (vad.ts blindZones) — the detector's zone, or, when it was caught missing a voice and the words are the plain
	// engine's, the stretch the engine's own words cover.
	const zones = heard.voiced ?? wordStretches(heard.words);
	const blind = blindZones(islands, zones);
	const sound = withBlind(heard.voiced ? voicedIslands(islands, zones) : islands, blind);
	const soundFine = withBlind(heard.voiced ? voicedIslands(fine, zones) : fine, blind);
	return dropPhantoms(alignWords(heard.words, sound, soundFine, { detector: true }), sound);
}

/** Both parts at once. */
export async function listen(options: ListenOptions): Promise<Heard> {
	const heard = await hear(options);
	return { ...heard, words: lay(heard, options.levels, options.islands) };
}
