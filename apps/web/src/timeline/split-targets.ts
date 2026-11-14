// What ⌘B and ⇧⌘B cut (the lead 14.11, Final Cut's blade; docs/TIMELINE.md §4). Pure.
//   ⌘B, clips selected: the selected clips the playhead is inside.
//   ⌘B, nothing selected: the main track's clip under the playhead; what is linked to it stays with its piece (a detached
//       sound in lockstep is cut with it — split-elements.ts).
//   ⇧⌘B: every clip the playhead is inside, on every unlocked track.
// A locked track is never cut; a playhead on a clip's very start or end cuts nothing (no empty undo step).
import { getElementsAtTime } from "./element-utils";
import { withoutLockedClips } from "./track-lock";
import type { ElementRef, SceneTracks } from "./types";

export function splitTargets({
	tracks,
	time,
	selected,
	all,
}: {
	tracks: SceneTracks;
	time: number;
	selected: readonly ElementRef[];
	/** ⇧⌘B */
	all: boolean;
}): ElementRef[] {
	const open = withoutLockedClips(tracks);
	const under = getElementsAtTime({ tracks: open, time });
	if (all) return under;
	if (selected.length > 0) return selected.filter((ref) => under.some((at) => at.trackId === ref.trackId && at.elementId === ref.elementId));
	return under.filter((at) => at.trackId === open.main.id);
}
