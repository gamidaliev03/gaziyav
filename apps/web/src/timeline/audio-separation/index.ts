import { cloneAnimations } from "@/animation";
import type { ElementAnimations } from "@/animation/types";
import type { MediaAsset } from "@/media/types";
import { DEFAULTS } from "@/timeline/defaults";
import type {
	CreateUploadAudioElement,
	SceneTracks,
	TimelineElement,
	AudioElement,
	UploadAudioElement,
	VideoElement,
} from "../types";

type MediaAudioState = Pick<MediaAsset, "hasAudio">;

export function isSourceAudioEnabled({
	element,
}: {
	element: VideoElement;
}): boolean {
	return element.isSourceAudioEnabled !== false;
}

export function isSourceAudioSeparated({
	element,
}: {
	element: VideoElement;
}): boolean {
	return !isSourceAudioEnabled({ element });
}

export function canExtractSourceAudio(
	element: TimelineElement,
	mediaAsset: MediaAudioState | null | undefined,
): element is VideoElement {
	return (
		element.type === "video" &&
		isSourceAudioEnabled({ element }) &&
		!!mediaAsset &&
		mediaAsset.hasAudio !== false
	);
}

export function canRecoverSourceAudio(
	element: TimelineElement,
): element is VideoElement {
	return element.type === "video" && isSourceAudioSeparated({ element });
}

export function canToggleSourceAudio(
	element: TimelineElement,
	mediaAsset: MediaAudioState | null | undefined,
): element is VideoElement {
	return (
		canRecoverSourceAudio(element) || canExtractSourceAudio(element, mediaAsset)
	);
}

export function doesElementHaveEnabledAudio({
	element,
	mediaAsset,
}: {
	element: AudioElement | VideoElement;
	mediaAsset?: MediaAudioState | null;
}): boolean {
	if (element.type === "audio") {
		return true;
	}

	return (
		!!mediaAsset &&
		mediaAsset.hasAudio !== false &&
		isSourceAudioEnabled({ element })
	);
}

/** Source ticks per timeline tick (constant speed; 1 without a retime). */
const rateOf = (element: { retime?: { rate: number } }) => (element.retime && element.retime.rate > 0 ? element.retime.rate : 1);

/**
 * What «Restore» does with the detached pieces of `video` (blind3 F3): every piece detached from it goes back into the
 * clip (`remove`) — moved, trimmed, sped or split since, it is still that clip's sound — except one another detached clip
 * of the same file plays with it now (its frames and its time: a split clip's other half), which is that clip's sound
 * from now on (`retag`). A piece of a split clip's other half that still names a clip no longer playing it goes into
 * this clip when this clip plays its frames. For a piece detached before the mark existed: the nearest audio of the
 * same file that plays some of the clip's frames. A clip's own sound and its detached copy are never both heard.
 */
export function detachedSoundOf({ video, tracks }: { video: VideoElement; tracks: SceneTracks }): {
	remove: Array<{ trackId: string; elementId: string }>;
	retag: Array<{ trackId: string; elementId: string; to: string }>;
} {
	const span = (element: { trimStart: number; duration: number; retime?: { rate: number } }) => [element.trimStart, element.trimStart + element.duration * rateOf(element)] as const;
	const at = (element: { startTime: number; duration: number }) => [element.startTime, element.startTime + element.duration] as const;
	const overlaps = (a: readonly [number, number], b: readonly [number, number]) => a[0] < b[1] && a[1] > b[0];
	const mine = span(video);
	const videos = [...tracks.overlay, tracks.main].flatMap((track) => (track.elements as TimelineElement[]).filter((element): element is VideoElement => element.type === "video"));
	const byId = new Map(videos.map((element) => [element.id, element]));
	const pieces = tracks.audio.flatMap((track) =>
		track.elements
			.filter((element): element is UploadAudioElement => element.sourceType === "upload" && element.mediaId === video.mediaId)
			.map((element) => ({ trackId: track.id, element })),
	);
	const playedBy = (piece: UploadAudioElement) =>
		videos.find((other) => other.id !== video.id && other.isSourceAudioEnabled === false && other.mediaId === piece.mediaId && overlaps(span(other), span(piece)) && overlaps(at(other), at(piece)));
	const remove: Array<{ trackId: string; elementId: string }> = [];
	const retag: Array<{ trackId: string; elementId: string; to: string }> = [];
	for (const { trackId, element } of pieces) {
		if (!element.detachedFrom) continue;
		const named = byId.get(element.detachedFrom);
		const ours = element.detachedFrom === video.id || (overlaps(span(element), mine) && (!named || named.mediaId !== video.mediaId || !overlaps(span(named), span(element))));
		if (!ours) continue;
		const other = playedBy(element);
		if (other) retag.push({ trackId, elementId: element.id, to: other.id });
		else remove.push({ trackId, elementId: element.id });
	}
	if (remove.length || retag.length) return { remove, retag };
	const nearest = pieces
		.filter(({ element }) => !element.detachedFrom && overlaps(span(element), mine))
		.sort((a, b) => Math.abs(a.element.startTime - video.startTime) - Math.abs(b.element.startTime - video.startTime))[0];
	return { remove: nearest ? [{ trackId: nearest.trackId, elementId: nearest.element.id }] : [], retag: [] };
}

export function buildSeparatedAudioElement({
	sourceElement,
}: {
	sourceElement: VideoElement;
}): CreateUploadAudioElement {
	return {
		type: "audio",
		sourceType: "upload",
		mediaId: sourceElement.mediaId,
		detachedFrom: sourceElement.id,
		name: sourceElement.name,
		duration: sourceElement.duration,
		startTime: sourceElement.startTime,
		trimStart: sourceElement.trimStart,
		trimEnd: sourceElement.trimEnd,
		sourceDuration: sourceElement.sourceDuration,
		params: {
			volume:
				typeof sourceElement.params.volume === "number"
					? sourceElement.params.volume
					: DEFAULTS.element.volume,
			muted: sourceElement.params.muted === true,
		},
		retime: sourceElement.retime
			? {
					rate: sourceElement.retime.rate,
					maintainPitch: sourceElement.retime.maintainPitch,
				}
			: undefined,
		animations: cloneVolumeAnimations({
			animations: sourceElement.animations,
		}),
	};
}

export function getSourceAudioActionLabel({
	element,
}: {
	element: VideoElement;
}): "Extract audio" | "Recover audio" {
	return isSourceAudioSeparated({ element })
		? "Recover audio"
		: "Extract audio";
}

function cloneVolumeAnimations({
	animations,
}: {
	animations: ElementAnimations | undefined;
}): ElementAnimations | undefined {
	const volumeData = animations?.volume;
	if (!volumeData) {
		return undefined;
	}

	return cloneAnimations({
		animations: { volume: volumeData },
		shouldRegenerateKeyframeIds: true,
	});
}
