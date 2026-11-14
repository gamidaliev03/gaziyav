// CapCut's «Auto lyrics»: the songs on the timeline (audio tracks, not the voices of the clips) heard by the same
// on-device recognizer as Auto captions, cut into sung lines (a pause or 8 words) with word timings for highlighting.
import type { EditorCore } from "@/core";
import { extractTimelineAudio } from "@/media/mediabunny";
import type { SceneTracks } from "@/timeline";
import { transcribeTracked } from "@/transcribe/client";
import type { CaptionChunk } from "@/transcription/types";
import { wordsToLyricLines } from "./lyric-lines";

/** Only the audio tracks: music and sounds, without the clips' own sound. */
function musicOnly(tracks: SceneTracks): SceneTracks {
	return {
		...tracks,
		main: { ...tracks.main, elements: [] },
		overlay: tracks.overlay.map((track) => ({ ...track, elements: [] })),
	} as SceneTracks;
}

export function hasMusic(editor: EditorCore): boolean {
	return editor.scenes.getActiveScene().tracks.audio.some((track) => track.elements.length > 0);
}

export async function generateLyrics({
	editor,
	language = "auto",
	signal,
	onStep,
}: {
	editor: EditorCore;
	language?: string;
	signal?: AbortSignal;
	onStep?: (step: string) => void;
}): Promise<CaptionChunk[]> {
	if (!hasMusic(editor)) throw new Error("Add a song to the timeline first (Audio or Media).");
	onStep?.("Mixing the music…");
	const totalDuration = editor.timeline.getTotalDuration();
	const audio = await extractTimelineAudio({
		tracks: musicOnly(editor.scenes.getActiveScene().tracks),
		mediaAssets: editor.media.getAssets(),
		totalDuration,
	});
	if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
	const result = await transcribeTracked({
		media: audio,
		name: "lyrics.wav",
		language,
		signal,
		title: "Lyrics from the music",
		onProgress: (stage, progress) => onStep?.(progress != null && progress > 0 && progress < 1 ? `${stage} ${Math.round(progress * 100)}%` : `${stage}…`),
	});
	const lines = wordsToLyricLines(result.words);
	if (lines.length === 0) throw new Error("No lyrics heard. Auto lyrics works on songs with vocals.");
	return lines;
}
