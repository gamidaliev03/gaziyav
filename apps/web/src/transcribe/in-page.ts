// The browser edition's speech recogniser: the same Transcript the Mac app's local recogniser gives — words with their
// own times and the stretches of speech — heard by the open Whisper model running in the page
// (services/transcription: the model is downloaded once from its publisher, the sound never leaves the tab). Everything
// built on a transcript works from it as in the app: captions, «Remove pauses», the text view.
import { decodeAudioToFloat32 } from "@/media/audio";
import { transcriptionService } from "@/services/transcription/service";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import type { TranscriptionLanguage } from "@/transcription/types";
import type { Span, Word } from "./align";
import type { TranscribeOptions, Transcript } from "./client";

/** Words closer than this are one stretch of speech. */
const SPEECH_GAP = 0.35;

/** The stretches where there is speech: runs of words with no real pause between them. */
export function speechOf(words: readonly Word[]): Span[] {
	const spans: Span[] = [];
	for (const word of words) {
		const last = spans[spans.length - 1];
		if (last && word.start - last.end <= SPEECH_GAP) last.end = Math.max(last.end, word.end);
		else spans.push({ start: word.start, end: word.end });
	}
	return spans;
}

/** The spoken language by its letters, when the model was left to hear it itself (the caption rules differ by language). */
export function languageOf(words: readonly Word[], asked: string): string {
	if (asked !== "auto") return asked;
	const text = words.map((word) => word.text).join("");
	const cyrillic = (text.match(/[а-яё]/gi) ?? []).length;
	const latin = (text.match(/[a-z]/gi) ?? []).length;
	return cyrillic > latin ? "ru" : "en";
}

export async function transcribeInPage({ media, language = "auto", signal, onProgress }: TranscribeOptions): Promise<Transcript> {
	const throwIfAborted = () => {
		if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
	};
	onProgress?.("Preparing audio...", 0);
	const { samples } = await decodeAudioToFloat32({ audioBlob: media, sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE });
	throwIfAborted();
	const cancel = () => transcriptionService.cancel();
	signal?.addEventListener("abort", cancel, { once: true });
	try {
		const result = await transcriptionService.transcribe({
			audioData: samples,
			language: (language === "auto" ? undefined : language) as TranscriptionLanguage | undefined,
			onProgress: (progress) => onProgress?.(progress.status === "loading-model" ? "Downloading the speech model" : "Transcribing speech", progress.progress / 100),
		});
		throwIfAborted();
		const words: Word[] = result.segments.flatMap((segment) => segment.words ?? []).map((word) => ({ text: word.text, start: word.start, end: word.end }));
		return { words, speech: speechOf(words), language: languageOf(words, language), duration: samples.length / DEFAULT_TRANSCRIPTION_SAMPLE_RATE };
	} finally {
		signal?.removeEventListener("abort", cancel);
	}
}
