import type { DragLanding, SceneTracks, TimelineElement } from "@/timeline";
import { packMainTrack } from "@/timeline/placement/main-track";
import { applyRippleAdjustments, computeRippleAdjustments } from "@/ripple";
import type { MediaTime } from "@/wasm";
import type { GroupMoveResult, PlannedElementMove, PlannedTrackCreation } from "./types";

/** The line (display index in the tracks as they are now) where a planned new track opens. */
export function newTrackLine({ createTracks, trackId }: { createTracks: readonly PlannedTrackCreation[]; trackId: string }): number | null {
	const track = createTracks.find((candidate) => candidate.id === trackId);
	if (!track) return null;
	// Its index counts the new tracks opened before it.
	return track.index - createTracks.filter((other) => other.index < track.index).length;
}

/**
 * Where the moved main-track clips end up once the magnet has closed the main track, as the command manager does it
 * after the drop (ripple, then pack): a main clip dragged with a picture into the empty time after the track's end
 * went back to its cut, while the ghost showed it there (tester 05.11).
 */
export function magnetSettledStarts({
	tracks,
	moves,
}: {
	tracks: SceneTracks;
	moves: readonly PlannedElementMove[];
}): Map<string, MediaTime> {
	const main = tracks.main;
	const moved = new Set(moves.map((move) => move.elementId));
	const all = new Map(
		[...tracks.overlay, main, ...tracks.audio].flatMap((track) => track.elements.map((element) => [element.id, element] as const)),
	);
	const ontoMain = moves.flatMap((move) => {
		const element = all.get(move.elementId);
		return move.targetTrackId === main.id && element ? [{ ...element, startTime: move.newStartTime } as TimelineElement] : [];
	});
	const afterMain = { ...main, elements: [...main.elements.filter((element) => !moved.has(element.id)), ...ontoMain] } as typeof main;
	const only = (track: typeof main): SceneTracks => ({ overlay: [], main: track, audio: [] });
	const adjustments = computeRippleAdjustments({ beforeTracks: only(main), afterTracks: only(afterMain) });
	const rippled = applyRippleAdjustments({ followText: false, tracks: only(afterMain), adjustments });
	const known = new Set(main.elements.map((element) => element.id));
	const packed = packMainTrack({
		tracks: { ...tracks, main: rippled.main },
		fresh: new Set(ontoMain.filter((element) => !known.has(element.id)).map((element) => element.id)),
	});
	return new Map(packed.main.elements.map((element) => [element.id, element.startTime]));
}

/**
 * The ghost of a group drop: every member where the plan puts it — on its row, or on the line where its new track
 * opens. `magnet`: the main track closes up after the drop (not for ⌥ copies: that step is final as it is).
 */
export function groupMoveLanding({
	tracks,
	result,
	durations,
	magnet,
}: {
	tracks: SceneTracks;
	result: GroupMoveResult;
	durations: ReadonlyMap<string, MediaTime>;
	magnet: boolean;
}): DragLanding[] {
	const settled = magnet && result.moves.some((move) => move.targetTrackId === tracks.main.id)
		? magnetSettledStarts({ tracks, moves: result.moves })
		: null;
	return result.moves.map((move) => {
		const line = newTrackLine({ createTracks: result.createTracks, trackId: move.targetTrackId });
		const startTime = (move.targetTrackId === tracks.main.id ? settled?.get(move.elementId) : undefined) ?? move.newStartTime;
		return {
			elementId: move.elementId,
			trackId: move.targetTrackId,
			startTime,
			duration: durations.get(move.elementId) ?? (0 as MediaTime),
			...(line === null ? {} : { newTrackAt: line }),
		};
	});
}
