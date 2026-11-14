// What moves with the selected main-track clips (tlc2): their detached sound, the titles, pictures and captions that
// Linkage carries with them. Asked of Linkage itself — the selected clips moved a long way later in a copy, and every
// item that applyLinkage then moves is the clip's — so the quiet mark on the timeline can never say something the
// edit will not do. A state, not a selection: nothing here touches the selection.
import { applyLinkage } from "@/timeline/linkage";
import type { LinkageKind } from "@/timeline/timeline-store";
import type { ElementRef, SceneTracks, TimelineElement } from "@/timeline/types";

/** How far the selected clips are moved in the copy: far past anything (a day), so no item is mistaken for another's. */
const PROBE_TICKS = 86_400 * 120_000;

const NONE: ReadonlySet<string> = new Set();

/**
 * The ids of the items on the other tracks that move with the selected main-track clips (none when no main clip is
 * selected). `kinds`: Linkage's kinds when it is on, empty when it is off (captions still follow their speech).
 */
export function linkedItemIds({ tracks, selection, kinds }: { tracks: SceneTracks; selection: readonly ElementRef[]; kinds: ReadonlySet<LinkageKind> }): ReadonlySet<string> {
	const picked = new Set<string>();
	for (const ref of selection) if (ref.trackId === tracks.main.id) picked.add(ref.elementId);
	if (picked.size === 0) return NONE;
	const elements = tracks.main.elements as TimelineElement[];
	if (!elements.some((element) => picked.has(element.id))) return NONE;
	const moved = elements.map((element) => (picked.has(element.id) ? ({ ...element, startTime: element.startTime + PROBE_TICKS } as TimelineElement) : element));
	const after = { ...tracks, main: { ...tracks.main, elements: moved } } as SceneTracks;
	const linked = applyLinkage({ before: tracks, after, kinds });
	if (linked === after) return NONE;
	const selected = new Set(selection.map((ref) => ref.elementId));
	const ids = new Set<string>();
	const compare = (beforeTracks: readonly { elements: readonly TimelineElement[] }[], afterTracks: readonly { elements: readonly TimelineElement[] }[]) => {
		for (let t = 0; t < beforeTracks.length; t++) {
			const now = new Map((afterTracks[t]?.elements ?? []).map((element) => [element.id, element] as const));
			for (const element of beforeTracks[t].elements) {
				if (selected.has(element.id)) continue;
				const next = now.get(element.id);
				// deleted by the probe: not something that moves with the clip
				if (next && next.startTime !== element.startTime) ids.add(element.id);
			}
		}
	};
	compare(tracks.overlay as never, linked.overlay as never);
	compare(tracks.audio as never, linked.audio as never);
	return ids.size > 0 ? ids : NONE;
}

let cache: { tracks: SceneTracks; selection: readonly ElementRef[]; kinds: string; ids: ReadonlySet<string> } | null = null;

/** The same answer for the same tracks, selection and kinds (every track row asks it on each render). */
export function linkedItemIdsCached(tracks: SceneTracks, selection: readonly ElementRef[], kinds: readonly LinkageKind[]): ReadonlySet<string> {
	const key = kinds.join(",");
	if (cache && cache.tracks === tracks && cache.selection === selection && cache.kinds === key) return cache.ids;
	const ids = linkedItemIds({ tracks, selection, kinds: new Set(kinds) });
	cache = { tracks, selection, kinds: key, ids };
	return ids;
}
