import type { ElementRef, OverlayTrack, SceneTracks, TimelineElement } from "@/timeline";
import { copyElementWithFreshKeyframes } from "@/timeline/element-copy";
import { groupRemapper } from "@/timeline/groups";
import { buildEmptyTrack } from "@/timeline/placement";

/**
 * ⌥-drag on the frame (CapCut): the dragged clips stay where they are and copies of them are what the drag moves.
 * Each copy lands at the same time on a new track right above its own; clips from one track share one new track.
 * Returns the copies in the order of `elements` (the drag target first).
 */
export function withFrameDragCopies({
	tracks,
	elements,
	newId,
}: {
	tracks: SceneTracks;
	elements: readonly ElementRef[];
	newId: () => string;
}): { tracks: SceneTracks; copies: ElementRef[] } {
	const wanted = new Set(elements.map((ref) => ref.elementId));
	const copyOf = new Map<string, ElementRef>();
	const regroup = groupRemapper();
	const copyTrack = (track: SceneTracks["main"] | OverlayTrack): OverlayTrack | null => {
		const picked = (track.elements as TimelineElement[]).filter((element) => wanted.has(element.id));
		if (picked.length === 0) return null;
		const empty = buildEmptyTrack({ id: newId(), type: track.type });
		const copies = picked.map((element) => {
			const copy = regroup(copyElementWithFreshKeyframes(element, newId()));
			copyOf.set(element.id, { trackId: empty.id, elementId: copy.id });
			return copy;
		});
		return { ...empty, elements: copies } as OverlayTrack;
	};

	const overlay: OverlayTrack[] = [];
	for (const track of tracks.overlay) {
		const copy = copyTrack(track);
		if (copy) overlay.push(copy);
		overlay.push(track);
	}
	const mainCopy = copyTrack(tracks.main);
	if (mainCopy) overlay.push(mainCopy);

	const copies = elements.flatMap((ref) => {
		const copy = copyOf.get(ref.elementId);
		return copy ? [copy] : [];
	});
	return { tracks: copies.length ? { ...tracks, overlay } : tracks, copies };
}
