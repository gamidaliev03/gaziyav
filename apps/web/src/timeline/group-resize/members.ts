// The members of a resize with their bounds: every other clip of the track bounds the dragged edge (the mouse trim,
// the keyboard trim and a slower speed all fit by these — timeline/retime-room.ts). Pure.
import { isRetimableElement, type SceneTracks } from "@/timeline";
import type { ElementRef } from "@/timeline/types";
import { addMediaTime, type MediaTime, maxMediaTime, minMediaTime } from "@/wasm";
import type { GroupResizeMember } from "./types";

export function buildResizeMembers({
	tracks,
	selectedElements,
}: {
	tracks: SceneTracks;
	selectedElements: ElementRef[];
}): GroupResizeMember[] {
	const trackMap = new Map(
		[...tracks.overlay, tracks.main, ...tracks.audio].map((track) => [
			track.id,
			track,
		]),
	);

	return selectedElements.flatMap(({ trackId, elementId }) => {
		const track = trackMap.get(trackId);
		const element = track?.elements.find((el) => el.id === elementId);
		if (!track || !element) return [];

		// Every other clip of the track bounds the edge, selected ones too: a trim moves only edges, so a neighbour in
		// the same selection (a group) stays where it is — left out, two clips of one group were stretched into each
		// other.
		const otherElements = track.elements.filter((el) => el.id !== element.id);
		const leftNeighborBound = otherElements
			.filter(
				(el) =>
					addMediaTime({ a: el.startTime, b: el.duration }) <=
					element.startTime,
			)
			.reduce<MediaTime | null>((bound, el) => {
				const elementEnd = addMediaTime({
					a: el.startTime,
					b: el.duration,
				});
				return bound === null
					? elementEnd
					: maxMediaTime({ a: bound, b: elementEnd });
			}, null);
		const rightNeighborBound = otherElements
			.filter(
				(el) =>
					el.startTime >= addMediaTime({ a: element.startTime, b: element.duration }),
			)
			.reduce<MediaTime | null>(
				(bound, el) =>
					bound === null
						? el.startTime
						: minMediaTime({ a: bound, b: el.startTime }),
				null,
			);

		return [
			{
				trackId,
				elementId,
				startTime: element.startTime,
				duration: element.duration,
				trimStart: element.trimStart,
				trimEnd: element.trimEnd,
				sourceDuration: element.sourceDuration,
				retime: isRetimableElement(element) ? element.retime : undefined,
				beats: element.beats,
				leftNeighborBound,
				rightNeighborBound,
			},
		];
	});
}
