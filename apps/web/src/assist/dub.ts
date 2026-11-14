// Translate & dub (Kadr: Auto Dub), on the Lipsync panel's own pipeline: the bundled Whisper hears what the person
// in the clip says, Gaziyav AI translates it into the chosen language, and the translation becomes the panel's
// voice-over text. The panel then voices it in the voice cloned from the clip (MiniMax, or free Qwen on this Mac —
// told the target language) and lipsyncs it or puts it under the clip, with captions from the new voice.
import type { EditorCore } from "@/core";
import { clipPiece, type ClipRef } from "@/studio/client/editor-bridge";
import { useStudioStore } from "@/studio/client/studio-store";
import { transcribeTimeline } from "@/transcribe/timeline";
import { dubLanguage } from "./languages";
import { assistPost } from "./scenes";

export interface DubText {
	/** The translation, as the words to speak. */
	text: string;
	language: string;
	/** What was said, and in which language (Whisper). */
	original: string;
	from: string;
	/** Where the original speech is on the timeline (seconds): the "Voice only" dub keeps this timing. */
	at: number;
	span: number;
}

export async function translateClipSpeech({
	editor,
	clip,
	language,
	signal,
	onStage,
}: {
	editor: EditorCore;
	clip: ClipRef;
	language: string;
	signal: AbortSignal;
	onStage: (text: string, progress?: number) => void;
}): Promise<DubText> {
	const target = dubLanguage(language);
	if (!target) throw new Error("Pick the language to dub into.");
	onStage("Hearing the speech", 0);
	const heard = await transcribeTimeline({
		editor,
		target: { trackId: clip.trackId, elementId: clip.elementId },
		signal,
		title: "Hearing the speech to translate",
		onProgress: (stage, p) => onStage(stage, p),
	});
	// In/Out inside the clip: only that piece is dubbed (as the lipsync sends only that piece).
	const piece = clipPiece(editor, clip);
	const words = heard.words.filter((w) => !piece || (w.end > piece.start + 0.01 && w.start < piece.end - 0.01));
	const original = words
		.map((w) => w.text.trim())
		.filter(Boolean)
		.join(" ")
		.replace(/\s+([,.!?;:…])/g, "$1")
		.trim();
	if (!original) throw new Error("No speech found in this clip — pick a clip where the person talks.");
	if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
	const seconds = Math.max(1, words[words.length - 1].end - words[0].start);
	onStage(`Translating into ${target.name}`);
	// Cancel stops the translation at once (the server stops asking Gaziyav AI too).
	const r = await assistPost<{ text: string; language: string }>("translate", { text: original, language, from: heard.language, seconds }, signal);
	if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
	return { text: r.text, language, original, from: heard.language, at: words[0].start, span: seconds };
}

/** Puts the translation in the panel as the voice-over text, remembered as a dub (so the voice gets the language). */
export function applyDubText(projectId: string, dub: DubText) {
	const s = useStudioStore.getState();
	const before = s.draft(projectId).text;
	s.patch(projectId, { text: dub.text, dub: { language: dub.language, text: dub.text, at: dub.at, span: dub.span } });
	return before;
}
