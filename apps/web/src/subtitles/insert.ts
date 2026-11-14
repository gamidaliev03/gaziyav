import type { EditorCore } from "@/core";
import {
	AddTrackCommand,
	BatchCommand,
	DeleteElementsCommand,
	InsertElementCommand,
	RemoveTrackCommand,
} from "@/commands";
import { isCaptionElement } from "./apply-style";
import { primeFont } from "@/fonts/bundled";
import { TICKS_PER_SECOND } from "@/wasm";
import {
	buildStyledCaptionElement,
	buildSubtitleTextElement,
	type CaptionFaceBox,
} from "./build-subtitle-text-element";
import { chunkCaptionWords } from "./chunk";
import {
	getCaptionStyle,
	getDefaultCaptionStyleId,
	type CaptionStyleId,
} from "./styles";
import type { SubtitleCue } from "./types";

/**
 * Re-chunks captions that carry word timings with the style's limits (Hormozi
 * 1–3 words, Karaoke 3–6 …) and the Russian rules; others stay as they are.
 */
export function chunkCaptionsForStyle({
	captions,
	styleId,
	maxWords,
}: {
	captions: SubtitleCue[];
	styleId: CaptionStyleId;
	/** The panel's «Words per line» over the style's own count (its character limit scales with it). */
	maxWords?: number;
}): SubtitleCue[] {
	const allTimed = captions.length > 0 && captions.every((caption) => caption.words?.length);
	if (!allTimed) return captions;
	const own = getCaptionStyle(styleId).limits;
	const limits =
		maxWords && maxWords !== own.maxWords
			? { ...own, maxWords, maxChars: Math.max(own.maxChars, Math.round((own.maxChars * maxWords) / Math.max(1, own.maxWords))) }
			: own;
	// Re-chunking adds a short linger after the last word; it never runs past where the captions it came from end
	// (they stop with the clip: a tail past the video left black frames with text at the end of the export).
	const end = Math.max(...captions.map((caption) => caption.startTime + caption.duration));
	return chunkCaptionWords({
		words: captions.flatMap((caption) => caption.words ?? []),
		limits,
	})
		.filter((cue) => cue.startTime < end - 0.01)
		.map((cue) => (cue.startTime + cue.duration > end ? { ...cue, duration: Math.max(0.05, end - cue.startTime) } : cue));
}

/**
 * Inserts captions on a new text track as one undo step. `style` defaults to
 * the style chosen in the Captions tab; cues imported from .ass files keep
 * their own look. `faceBox` (0…1 of the frame) keeps captions off the face.
 */
export function insertCaptionChunksAsTextTrack({
	editor,
	captions,
	style,
	faceBox,
	replace = false,
	kind = "captions",
	maxWords,
	source,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
	style?: CaptionStyleId;
	faceBox?: CaptionFaceBox | null;
	/** The id of the clip the speech was heard in: `caption.source`, so the captions follow that clip (linkage). */
	source?: string;
	/** Words on screen at once (the Captions panel's «Words per line»); the style's own count otherwise. */
	maxWords?: number;
	/** CapCut's «Delete current captions»: the captions already on the timeline go in the same undo step. */
	replace?: boolean;
	/** Auto lyrics marks its lines as lyrics: «Delete current lyrics» replaces lyrics only, «Delete current captions» captions only. */
	kind?: "captions" | "lyrics";
}): string | null {
	if (captions.length === 0) {
		return null;
	}
	const styleId = style ?? getDefaultCaptionStyleId();
	const captionStyle = getCaptionStyle(styleId);
	const keepOwnLook = captions.some((caption) => caption.style);
	const cues = keepOwnLook ? captions : chunkCaptionsForStyle({ captions, styleId, maxWords });
	// Fonts are local files; start loading so the first frame uses them.
	void primeFont(String(captionStyle.params.fontFamily));

	const canvasSize = editor.project.getActive().settings.canvasSize;
	const built = cues.map((caption, index) =>
		keepOwnLook
					? buildSubtitleTextElement({ index, caption, canvasSize })
					: buildStyledCaptionElement({
							index,
							caption,
							canvasSize,
							style: captionStyle,
							faceBox,
						}),
	);
	const tagged = source ? built.map((element) => ({ ...element, params: { ...element.params, "caption.source": source } })) : built;
	const elements = kind === "lyrics" ? tagged.map((element) => ({ ...element, params: { ...element.params, "caption.lyrics": true } })) : tagged;
	const ofKind = (element: Parameters<typeof isCaptionElement>[0]) =>
		isCaptionElement(element) && (kind === "lyrics") === (element.params["caption.lyrics"] === true);
	// A second run over the same speech (a retry after a cancel that couldn't stop the model download, or the
	// Captions tab opened again mid-run) gave two identical tracks: the track that is already there is kept.
	const overlay = editor.scenes.getActiveScene().tracks.overlay;
	const same = replace ? null : overlay.find((track) => track.type === "text" && isSameCaptionTrack(track.elements, elements));
	if (same) return same.id;
	// Delete current captions: a track of captions only goes as a whole (no empty track left); elsewhere the captions.
	const captionTracks = replace ? overlay.filter((track) => track.elements.some((element) => ofKind(element))) : [];
	const wholeTracks = captionTracks.filter((track) => track.elements.every((element) => ofKind(element)));
	const current = captionTracks
		.filter((track) => !wholeTracks.includes(track))
		.flatMap((track) => track.elements.filter((element) => ofKind(element)).map((element) => ({ trackId: track.id, elementId: element.id })));
	const addTrackCommand = new AddTrackCommand({ type: "text", index: 0 });
	const trackId = addTrackCommand.getTrackId();
	const insertCommands = elements.map(
		(element) => new InsertElementCommand({ placement: { mode: "explicit", trackId }, element }),
	);
	editor.command.execute({
		command: new BatchCommand([
			...wholeTracks.map((track) => new RemoveTrackCommand(track.id)),
			...(current.length ? [new DeleteElementsCommand({ elements: current })] : []),
			addTrackCommand,
			...insertCommands,
		]),
	});
	// Inserting selects the last caption; a style click would then restyle only it.
	editor.selection.clearSelection();

	return trackId;
}

/** The same captions (count, start within 10 ms, text) as the elements about to be inserted. */
export function isSameCaptionTrack(
	existing: readonly { startTime: number; params?: Record<string, unknown> }[],
	incoming: readonly { startTime: number; params?: Record<string, unknown> }[],
): boolean {
	if (existing.length === 0 || existing.length !== incoming.length) return false;
	const byStart = (list: typeof existing) => [...list].sort((a, b) => a.startTime - b.startTime);
	const a = byStart(existing);
	const b = byStart(incoming);
	return a.every(
		(element, i) =>
			Math.abs(element.startTime - b[i].startTime) < TICKS_PER_SECOND / 100 && element.params?.content === b[i].params?.content,
	);
}
