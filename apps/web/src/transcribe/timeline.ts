// Speech of the timeline: what to send to the recognizer (the selected clip, or the whole edit without
// library music) and how its words map back onto the timeline.
import type { EditorCore } from "@/core";
import { extractTimelineAudio } from "@/media/mediabunny";
import { wordsToCues } from "@/studio/client/captions";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { isRetimableElement } from "@/timeline";
import type { CaptionChunk } from "@/transcription/types";
import { mediaTimeToSeconds, TICKS_PER_SECOND } from "@/wasm";
import { type Span, type Transcript, transcribeTracked, type Word } from "./client";

export interface TimelineTranscript {
	/** Words in timeline seconds. */
	words: Word[];
	/** Speech in timeline seconds. */
	speech: Span[];
	/** Timeline seconds covered by the analysed audio. */
	from: number;
	to: number;
	language: string;
	source: "clip" | "timeline";
}

const secs = (t: number) => t / TICKS_PER_SECOND;

/** Tracks without library music/sounds: the recognizer hears only voices. */
function voiceOnly(tracks: SceneTracks): SceneTracks {
	return {
		...tracks,
		audio: tracks.audio.map((t) => ({
			...t,
			elements: t.elements.filter((el) => !(el.type === "audio" && el.sourceType === "library")),
		})),
	};
}

export function selectedSpeechClip(editor: EditorCore, target?: { trackId: string; elementId: string }): TimelineElement | null {
	const refs = target ? [target] : editor.selection.getSelectedElements();
	if (refs.length !== 1) return null;
	const [ref] = refs;
	const track = editor.timeline.getTrackById({ trackId: ref.trackId });
	const el = track?.elements.find((e) => e.id === ref.elementId) as TimelineElement | undefined;
	if (!el) return null;
	if (el.type === "video" || (el.type === "audio" && el.sourceType === "upload")) return el;
	return null;
}

/** Source seconds → timeline seconds for a clip (constant speed). */
function clipMapper(el: TimelineElement) {
	const rate = isRetimableElement(el) ? (el.retime?.rate ?? 1) : 1;
	const start = secs(el.startTime);
	const trim = secs(el.trimStart);
	const length = secs(el.duration);
	return {
		from: start,
		to: start + length,
		map: (t: number) => start + (t - trim) / rate,
	};
}

function mapTranscript(t: Transcript, map: (s: number) => number, from: number, to: number) {
	const words = t.words
		.map((w) => ({ ...w, start: map(w.start), end: map(w.end) }))
		.filter((w) => w.end > from + 0.01 && w.start < to - 0.01)
		.map((w) => ({ ...w, start: Math.max(from, w.start), end: Math.min(to, w.end) }));
	const speech = t.speech
		.map((s) => ({ start: map(s.start), end: map(s.end) }))
		.filter((s) => s.end > from && s.start < to)
		.map((s) => ({ start: Math.max(from, s.start), end: Math.min(to, s.end) }));
	return { words, speech };
}

export async function transcribeTimeline({
	editor,
	language = "auto",
	wholeTimeline = false,
	target,
	signal,
	onProgress,
	title,
}: {
	editor: EditorCore;
	language?: string;
	/** Ignore the selection (pause removal always works on the whole edit). */
	wholeTimeline?: boolean;
	/** A specific clip instead of the selection (right-click menu). */
	target?: { trackId: string; elementId: string };
	signal?: AbortSignal;
	onProgress?: (stage: string, progress?: number) => void;
	title?: string;
}): Promise<TimelineTranscript> {
	const clip = wholeTimeline ? null : selectedSpeechClip(editor, target);
	if (clip) {
		const mediaId = "mediaId" in clip ? clip.mediaId : null;
		const asset = editor.media.getAssets().find((a) => a.id === mediaId);
		if (asset?.file) {
			const result = await transcribeTracked({ media: asset.file, name: asset.file.name || "clip", language, signal, onProgress, title, elements: [clip.id] });
			const m = clipMapper(clip);
			return { ...mapTranscript(result, m.map, m.from, m.to), from: m.from, to: m.to, language: result.language, source: "clip" };
		}
	}
	onProgress?.("Mixing timeline audio", 0);
	const totalDuration = editor.timeline.getTotalDuration();
	if (!totalDuration) throw new Error("The timeline is empty. Add a clip with speech first.");
	const voices = voiceOnly(editor.scenes.getActiveScene().tracks);
	const heard = [voices.main, ...voices.overlay, ...voices.audio]
		.flatMap((t) => t.elements as Array<{ id: string; type: string }>)
		.filter((el) => el.type === "video" || el.type === "audio")
		.map((el) => el.id);
	const audio = await extractTimelineAudio({
		tracks: voices,
		mediaAssets: editor.media.getAssets(),
		totalDuration,
	});
	if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
	const result = await transcribeTracked({ media: audio, name: "timeline.wav", language, signal, onProgress, title, elements: heard });
	const to = mediaTimeToSeconds({ time: totalDuration });
	return { ...mapTranscript(result, (s) => s, 0, to), from: 0, to, language: result.language, source: "timeline" };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** What «Generate captions» will listen to: «Selected clip · name» or «Whole timeline · 0:42». */
export function speechTargetLabel(editor: EditorCore): string {
	const clip = selectedSpeechClip(editor);
	if (clip) return `Selected clip · ${clip.name}`;
	const total = editor.timeline.getTotalDuration();
	return total ? `Whole timeline · ${clock(secs(total))}` : "Add a clip with speech to the timeline";
}

/** Short ad-style cues (≤ maxWords, 3 by default, split at pauses), each carrying its words for karaoke highlighting. */
export function wordsToCaptionChunks(words: Word[], maxWords?: number): CaptionChunk[] {
	const cues = wordsToCues(words, 0, maxWords);
	return cues.map((cue, i) => {
		const next = cues[i + 1]?.startTime ?? Infinity;
		const own = words.filter((w) => w.start >= cue.startTime - 1e-6 && w.start < next - 1e-6);
		return {
			...cue,
			words: own.map((w) => ({ text: w.text, startTime: w.start, endTime: w.end })),
		};
	});
}
