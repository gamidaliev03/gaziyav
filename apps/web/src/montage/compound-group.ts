// A compound clip drawn as ONE picture (its mask cuts all of it at once, not each clip inside). Flattening (flatten.ts)
// marks the tracks it opens a compound into with the compound itself; the scene builder wraps the layers of those
// tracks into a CompoundGroupNode (services/renderer/compound-group.ts) that the compositor draws through its
// two-picture path: the scene with the compound over it, and the scene without it, mixed by the mask.
// Pure: no editor core, no wasm. The marks live on flattened tracks only (made for playback, never saved).
import type { GraphicElement, TimelineTrack } from "@/timeline/types";

const GROUPS = "compoundGroups";

/** Does the compound need to be drawn as one picture (a mask that is on)? */
export function needsCompoundGroup(compound: GraphicElement): boolean {
	return Array.isArray(compound.masks) && compound.masks.length > 0;
}

/** The track as part of `compound` (outermost compound first when compounds nest). */
export function tagCompoundGroup<T extends TimelineTrack>(track: T, compound: GraphicElement): T {
	return { ...track, [GROUPS]: [compound, ...compoundGroupsOf(track)] } as T;
}

/** The compounds a flattened track belongs to, outermost first. */
export function compoundGroupsOf(track: TimelineTrack): GraphicElement[] {
	const list = (track as unknown as Record<string, unknown>)[GROUPS];
	return Array.isArray(list) ? (list as GraphicElement[]) : [];
}
