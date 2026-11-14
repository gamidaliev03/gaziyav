import type { ElementRef, SceneTracks } from "@/timeline/types";
import { rangeSelection } from "@/timeline/selection-click";

/**
 * ⇧-click range selection: one rule, timeline/selection-click.ts (tlc2) — from the anchor clip to the clicked one in
 * timeline order (every clip starting between their starts) on the tracks between them. The anchor stays first.
 */
export function getRangeSelection({ tracks, anchor, target }: { tracks: SceneTracks; anchor: ElementRef | null; target: ElementRef }): ElementRef[] {
	return rangeSelection({ tracks, anchor, target });
}
