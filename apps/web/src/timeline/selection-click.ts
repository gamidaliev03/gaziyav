// One rule for a click on a clip, wherever it lands — the body, an edge, a cut beside it, with the Select or the Trim
// tool (tlc2, docs/TIMELINE.md §4):
//   · a plain click selects that clip alone and makes it the anchor;
//   · ⌘-click adds it (the anchor becomes it) or takes it out (the anchor stays);
//   · ⇧-click selects from the anchor to it in timeline order, on every track from the anchor's to its own
//     (the anchor stays, so the next ⇧-click re-extends from it).
// The anchor is the last clip clicked plainly or with ⌘; without one (a box select, ⌘A), the last selected clip.
import type { ElementRef, SceneTracks, TimelineTrack } from "@/timeline/types";

export interface ClickKeys {
	/** ⇧ */
	range: boolean;
	/** ⌘ (or ⌃ where it is not the right click) */
	toggle: boolean;
}

const same = (a: ElementRef, b: ElementRef) => a.trackId === b.trackId && a.elementId === b.elementId;
const ordered = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];

function locate(tracks: TimelineTrack[], ref: ElementRef) {
	const trackIndex = tracks.findIndex((track) => track.id === ref.trackId);
	const element = trackIndex >= 0 ? tracks[trackIndex].elements.find((el) => el.id === ref.elementId) : undefined;
	return element ? { trackIndex, element } : null;
}

/**
 * ⇧-click: from `anchor` to `target` in timeline order — on each track from the anchor's to the target's (display
 * order, both included; a locked track's clips take no clicks and are left out) every clip that starts between the two
 * clips' starts, both included. The anchor first.
 */
export function rangeSelection({ tracks, anchor, target }: { tracks: SceneTracks; anchor: ElementRef | null; target: ElementRef }): ElementRef[] {
	const list = ordered(tracks);
	const to = locate(list, target);
	const from = anchor ? locate(list, anchor) : null;
	if (!to) return anchor && from ? [anchor] : [];
	if (!from || !anchor) return [target];
	const start = Math.min(from.element.startTime, to.element.startTime);
	const end = Math.max(from.element.startTime, to.element.startTime);
	const result: ElementRef[] = [anchor];
	for (let index = Math.min(from.trackIndex, to.trackIndex); index <= Math.max(from.trackIndex, to.trackIndex); index++) {
		const track = list[index];
		if (track.locked && track.id !== anchor.trackId && track.id !== target.trackId) continue;
		const inRange = track.elements
			.filter((element) => element.startTime >= start && element.startTime <= end && !(track.id === anchor.trackId && element.id === anchor.elementId))
			.sort((a, b) => a.startTime - b.startTime);
		for (const element of inRange) result.push({ trackId: track.id, elementId: element.id });
	}
	return result;
}

/** The selection after a click on `target`, and the anchor after it. */
export function clickSelection({
	tracks,
	current,
	anchor,
	target,
	keys,
}: {
	tracks: SceneTracks;
	current: readonly ElementRef[];
	anchor: ElementRef | null;
	target: ElementRef;
	keys: ClickKeys;
}): { elements: ElementRef[]; anchor: ElementRef } {
	const list = ordered(tracks);
	const liveAnchor = anchor && locate(list, anchor) ? anchor : ([...current].reverse().find((ref) => locate(list, ref)) ?? null);
	if (keys.toggle) {
		const has = current.some((ref) => same(ref, target));
		if (!has) return { elements: [...current, target], anchor: target };
		// a grouped clip (⌘G) goes out with its group, as it came in with it
		const groupId = locate(list, target)?.element.groupId;
		const group = new Set(groupId ? list.flatMap((track) => track.elements.filter((element) => element.groupId === groupId).map((element) => element.id)) : [target.elementId]);
		const elements = current.filter((ref) => !group.has(ref.elementId));
		// the anchor stays where it was, unless it was the clip taken out: then the last one left
		const kept = liveAnchor && !group.has(liveAnchor.elementId) ? liveAnchor : (elements[elements.length - 1] ?? target);
		return { elements, anchor: kept };
	}
	if (keys.range) {
		const from = liveAnchor ?? target;
		return { elements: rangeSelection({ tracks, anchor: from, target }), anchor: from };
	}
	return { elements: [target], anchor: target };
}
