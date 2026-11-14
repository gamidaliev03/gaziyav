// Captions from speech with the local recognizer (default engine of the Captions tab).
// Returns null when whisper-cli or its model is not installed, so the panel can fall back to in-browser Whisper.
import type { EditorCore } from "@/core";
import type { CaptionChunk } from "@/transcription/types";
import { engineStatus } from "./client";
import { transcribeTimeline, wordsToCaptionChunks } from "./timeline";

export async function generateLocalCaptions({
	editor,
	language = "auto",
	signal,
	onStep,
	maxWords,
}: {
	editor: EditorCore;
	language?: string;
	signal?: AbortSignal;
	onStep?: (step: string) => void;
	/** Words per caption line (the panel's «Words per line»). */
	maxWords?: number;
}): Promise<CaptionChunk[] | null> {
	const status = await engineStatus();
	// Not installed yet: the one-click install of the speech model (in place) instead of a silent in-browser download.
	if (!status.available && !status.needsDownload) return null;
	const t = await transcribeTimeline({
		editor,
		language,
		signal,
		title: "Captions from speech",
		onProgress: (stage, progress) =>
			onStep?.(progress != null && progress > 0 && progress < 1 ? `${stage} ${Math.round(progress * 100)}%` : `${stage}…`),
	});
	if (t.words.length === 0) throw new Error("No speech found. Check that the clip has a voice and its sound is on.");
	// A caption never runs past the speech it was heard in (the clip, or the end of the timeline).
	return wordsToCaptionChunks(t.words, maxWords)
		.filter((c) => c.startTime < t.to - 0.01)
		.map((c) => (c.startTime + c.duration > t.to ? { ...c, duration: Math.max(0.05, t.to - c.startTime) } : c));
}
