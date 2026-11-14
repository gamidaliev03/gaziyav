import type { MaskableElement, VisualElement } from "./types";
import type { ParamValues } from "@/params";
import type { MediaAsset } from "@/media/types";

interface BaseDragData {
	id: string;
	name: string;
}

export interface MediaDragData extends BaseDragData {
	type: "media";
	mediaType: "image" | "video" | "audio";
	targetElementTypes?: MaskableElement["type"][];
	/** Several tiles dragged together ("a stack"), in Media order; `id` is the first. They land one after another. */
	ids?: string[];
}

export interface TextDragData extends BaseDragData {
	type: "text";
	content: string;
}

export interface StickerDragData extends BaseDragData {
	type: "sticker";
	stickerId: string;
}

export interface GraphicDragData extends BaseDragData {
	type: "graphic";
	definitionId: string;
	params: Partial<ParamValues>;
}

export interface EffectDragData extends BaseDragData {
	type: "effect";
	effectType: string;
	targetElementTypes: VisualElement["type"][];
	/** A filter's look: dropped on a clip it changes that clip's grade, on empty space the new layer carries it. */
	params?: ParamValues;
	/** An effect set (shaders and graphics): dropped on a clip, it puts all of itself there; it needs a clip. */
	applyTo?: (clip: { trackId: string; elementId: string }) => void;
}

/** A result still in its source (an AI generator): dropped on the timeline, it's added to Media first. */
export interface SourceFileDragData extends BaseDragData {
	type: "source-file";
	mediaType: "image" | "video" | "audio";
	/** Seconds; 0 for a picture. */
	dur: number;
	take: () => Promise<MediaAsset>;
}

/**
 * Something whose content loads only when it lands (an animated graphic from the Stickers tab): the drop gives the
 * time under the cursor and `place` puts it on the timeline itself.
 */
export interface DeferredDragData extends BaseDragData {
	type: "deferred";
	elementType: "graphic" | "text";
	/** Seconds, for the drop indicator. */
	dur: number;
	/** `hint.trackId`: the track under the cursor (when it exists) — the clip goes there if it has room, else above. */
	place: (startSeconds: number, hint?: DropHint) => Promise<void>;
}

/** Where a drop landed, for code that places its own clip: the existing track under the cursor, if any. */
export interface DropHint {
	trackId?: string;
	/** The drop opens a new track here (the index the drop line showed): a text dropped between a layer and the main
	 * track went to a new track at the very top (targeted test 05.11). */
	newTrackIndex?: number;
}

/** A sound or music track from the Звук tab's local library (not a project media asset). */
export interface LibraryAudioDragData extends BaseDragData {
	type: "library-audio";
	url: string;
	kind: "sfx" | "music";
	/** Seconds. */
	dur: number;
	cat: string;
	/** dB to the library's level (library/gain.ts). */
	gain?: number;
}

export type TimelineDragData =
	| MediaDragData
	| LibraryAudioDragData
	| TextDragData
	| StickerDragData
	| GraphicDragData
	| EffectDragData
	| SourceFileDragData
	| DeferredDragData;
