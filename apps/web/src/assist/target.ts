// Which clip an Assist action works on: the right-clicked one, else the selection.
import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import type { TimelineElement, TimelineTrack } from "@/timeline";
import { isRetimableElement } from "@/timeline";
import { getClipTimeAtSourceTime, getSourceTimeAtClipTime } from "@/retime/resolve";
import { mediaTimeToSeconds } from "@/wasm";

export interface ClipRef {
	trackId: string;
	elementId: string;
}

export interface ResolvedClip {
	trackId: string;
	track: TimelineTrack;
	element: TimelineElement;
	asset: MediaAsset | null;
	/** Timeline seconds. */
	at: number;
	length: number;
	/** Source seconds: where the clip's piece starts in its file, and how much of the file it plays. */
	sourceStart: number;
	sourceLength: number;
	rate: number;
	/** Timeline seconds where source second `s` (from the clip's trim start) plays — exact on speed ramps too. */
	timeAt: (s: number) => number;
}

const sec = (t: number | undefined) => (t == null ? 0 : mediaTimeToSeconds({ time: t as never }));

export function allTracks(editor: EditorCore): TimelineTrack[] {
	const t = editor.scenes.getActiveSceneOrNull()?.tracks;
	return t ? ([...t.overlay, t.main, ...t.audio] as TimelineTrack[]) : [];
}

export function resolveClip(editor: EditorCore, ref: ClipRef): ResolvedClip | null {
	const track = editor.timeline.getTrackById({ trackId: ref.trackId }) as TimelineTrack | null | undefined;
	const element = (track?.elements as TimelineElement[] | undefined)?.find((e) => e.id === ref.elementId);
	if (!track || !element) return null;
	const mediaId = "mediaId" in element ? (element as { mediaId?: string }).mediaId : undefined;
	const asset = mediaId ? (editor.media.getAssets().find((a) => a.id === mediaId) ?? null) : null;
	const retime = isRetimableElement(element) ? element.retime : undefined;
	const rate = retime?.rate ?? 1;
	const length = sec(element.duration);
	const at = sec(element.startTime);
	return {
		trackId: track.id,
		track,
		element,
		asset,
		at,
		length,
		sourceStart: sec(element.trimStart),
		sourceLength: getSourceTimeAtClipTime({ clipTime: length, retime, duration: length }),
		rate,
		timeAt: (s) => at + getClipTimeAtSourceTime({ sourceTime: s, retime, duration: length }),
	};
}

/** The selected clips (in timeline order), resolved. */
export function selectedClips(editor: EditorCore): ResolvedClip[] {
	return editor.selection
		.getSelectedElements()
		.map((r) => resolveClip(editor, r))
		.filter((c): c is ResolvedClip => !!c)
		.sort((a, b) => a.at - b.at);
}

/** The clip to act on: the given one (right-click), else the first selected one that `accept`s. */
export function pickClip(editor: EditorCore, ref: ClipRef | undefined, accept: (c: ResolvedClip) => boolean): ResolvedClip | null {
	if (ref) {
		const c = resolveClip(editor, ref);
		return c && accept(c) ? c : null;
	}
	return selectedClips(editor).find(accept) ?? null;
}

export const isVideoClip = (c: ResolvedClip) => c.element.type === "video" && !!c.asset?.file;
export const isPictureClip = (c: ResolvedClip) => (c.element.type === "video" || c.element.type === "image") && !!c.asset?.file;
export const isSoundClip = (c: ResolvedClip) =>
	(c.element.type === "audio" && (c.element.sourceType === "library" || !!c.asset?.file)) ||
	(c.element.type === "video" && !!c.asset?.file && c.asset.hasAudio !== false);
