import type { SceneTracks, TimelineTrack } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { MAX_TRANSITION_SECONDS, MIN_TRANSITION_SECONDS } from "@/transitions/limits";

/** Clips closer than this (ticks) count as touching — the same tolerance the cut list uses. */
const ADJACENT_TOLERANCE = TICKS_PER_SECOND / 50;

type WithTransitions = TimelineTrack & { transitions?: Array<{ fromElementId: string; toElementId: string; duration: number }> };

/**
 * A transition lives on a cut: once one of its two clips has left the track (deleted, cut away, moved to another
 * track), the transition goes too. It used to stay behind as an orphan: invisible, counted, and back on screen as
 * soon as some other clips happened to get its ids. Returns the same object when nothing was dropped.
 */
export function dropOrphanTransitions(tracks: SceneTracks): SceneTracks {
	let changed = false;
	const fix = <T extends TimelineTrack>(track: T): T => {
		const list = (track as WithTransitions).transitions;
		if (!list || list.length === 0) return track;
		// Both clips still here AND still touching: a split, a move or a trim that opened the cut leaves no transition
		// hanging on a pair that is no longer a cut (it sat on the left half of a split clip, away from any cut).
		const byId = new Map(track.elements.map((element) => [element.id, element]));
		const touching = (fromId: string, toId: string) => {
			const from = byId.get(fromId);
			const to = byId.get(toId);
			return !!from && !!to && Math.abs(from.startTime + from.duration - to.startTime) <= ADJACENT_TOLERANCE;
		};
		// …and never longer than either clip: a trim that leaves a clip shorter than its transition shortens the
		// transition with it, and a clip too short for the shortest transition loses it (fuzz 03.11).
		const maxTicks = MAX_TRANSITION_SECONDS * TICKS_PER_SECOND;
		const minTicks = MIN_TRANSITION_SECONDS * TICKS_PER_SECOND;
		let dirty = false;
		const kept = list.flatMap((transition) => {
			if (!touching(transition.fromElementId, transition.toElementId)) {
				dirty = true;
				return [];
			}
			const limit = Math.min(maxTicks, (byId.get(transition.fromElementId) as TimelineTrack["elements"][number]).duration, (byId.get(transition.toElementId) as TimelineTrack["elements"][number]).duration);
			if (limit < minTicks) {
				dirty = true;
				return [];
			}
			if (transition.duration <= limit) return [transition];
			dirty = true;
			return [{ ...transition, duration: Math.round(limit) }];
		});
		if (!dirty) return track;
		changed = true;
		return { ...track, transitions: kept };
	};
	const main = fix(tracks.main);
	const overlay = tracks.overlay.map(fix);
	return changed ? { ...tracks, main, overlay } : tracks;
}
