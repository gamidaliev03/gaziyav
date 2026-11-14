import type { SceneTracks, TrackType } from "@/timeline";
import { getTrackTypeForElementType } from "@/timeline/placement/compatibility";
import { canPlaceTimeSpansOnTrack } from "@/timeline/placement/overlap";
import type {
	GroupMember,
	GroupMoveResult,
	MoveGroup,
	PlannedTrackCreation,
} from "./types";
import { getDisplayTracks, getTrackPlacementById } from "./track-placement";
import {
	addMediaTime,
	maxMediaTime,
	type MediaTime,
	subMediaTime,
	ZERO_MEDIA_TIME,
} from "@/wasm";

export type GroupMoveTarget =
	/** The anchor goes onto this track (the row under the pointer). `insertIndex`: where its stack opens new tracks when
	 * the rows it would take aren't there. */
	| { kind: "existingTrack"; anchorTargetTrackId: string; insertIndex: number }
	/** The anchor's stack opens new tracks on the line above the track now at this display index. */
	| { kind: "newTracks"; anchorInsertIndex: number };

/** The clips of the group that sit on one track: they go to one track together, as they were (a track per clip split
 * two captions of one row onto two new tracks — tester 05.11). */
interface SourceTrack {
	trackId: string;
	displayIndex: number;
	trackType: TrackType;
	members: GroupMember[];
}

/** An existing track, or a new one opened on the line above the track now at display index `at`. */
type Destination = { kind: "track"; trackId: string } | { kind: "new"; at: number };

/**
 * Where a selection dragged together lands. Each track's clips move as one: the anchor's row goes where the pointer
 * is, the rows of its kind (pictures and titles, or sounds) by as many rows, the other kind stays on its tracks — and
 * a row whose clips would overlap something there gets a new track beside it (above for pictures, below for sounds),
 * never an overlap. `newTrackIds`: one per member, fixed for the drag. `keepOriginals` (⌥-drag): the dragged clips
 * stay where they are and copies land, so the originals are in the way like any other clip.
 */
export function resolveGroupMove({
	group,
	tracks,
	anchorStartTime,
	target,
	newTrackIds,
	keepOriginals = false,
}: {
	group: MoveGroup;
	tracks: SceneTracks;
	anchorStartTime: MediaTime;
	target: GroupMoveTarget;
	newTrackIds: readonly string[];
	keepOriginals?: boolean;
}): GroupMoveResult | null {
	const sources = sourceTracksOf(group);
	const anchorSource = sources.find((source) => source.trackId === group.anchor.trackId);
	if (!anchorSource || newTrackIds.length < sources.length) return null;
	const isAudio = (source: SourceTrack) => source.trackType === "audio";
	const own = sources.filter((source) => isAudio(source) === isAudio(anchorSource));

	const destinations = new Map<string, Destination>();
	const mapped =
		target.kind === "existingTrack"
			? mapByRowOffset({ tracks, own, anchorSource, anchorTargetTrackId: target.anchorTargetTrackId })
			: null;
	if (mapped) {
		for (const [sourceId, trackId] of mapped) destinations.set(sourceId, { kind: "track", trackId });
	} else {
		// The whole stack on new tracks at the drop line, in its order (it opened higher up by as many rows as the stack
		// had above the anchor).
		const at = clampToSection({
			tracks,
			audio: isAudio(anchorSource),
			index: target.kind === "newTracks" ? target.anchorInsertIndex : target.insertIndex,
		});
		for (const source of own) destinations.set(source.trackId, { kind: "new", at });
	}
	// Sounds dragged with a picture (or the other way round) only move in time (a picture's group sent the sound onto
	// the main track and refused the move: tester 05.11, «a new-track line, then nothing moves»).
	for (const source of sources) {
		if (!destinations.has(source.trackId)) destinations.set(source.trackId, { kind: "track", trackId: source.trackId });
	}

	const movingIds = new Set(group.members.map((member) => member.elementId));
	let start = anchorStartTime;
	for (let pass = 0; pass <= sources.length; pass++) {
		const ontoMain = new Set(
			sources.flatMap((source) => {
				const destination = destinations.get(source.trackId);
				return destination?.kind === "track" && destination.trackId === tracks.main.id
					? source.members.map((member) => member.elementId)
					: [];
			}),
		);
		start = clampAnchorStartTime({ group, tracks, anchorStartTime, ontoMain, keepOriginals });
		let redirected = false;
		for (const source of sources) {
			const destination = destinations.get(source.trackId);
			if (destination?.kind !== "track") continue;
			if (fitsOnTrack({ tracks, trackId: destination.trackId, members: source.members, start, movingIds, keepOriginals })) continue;
			const placement = getTrackPlacementById({ tracks, trackId: destination.trackId });
			if (!placement) return null;
			destinations.set(source.trackId, {
				kind: "new",
				at: isAudio(source) ? placement.displayIndex + 1 : placement.displayIndex,
			});
			redirected = true;
		}
		// A row moved off the main track can change the clamp (the main track's start rule): check the rest again.
		if (!redirected) break;
	}

	// New tracks in display order; each one's index counts the ones opened before it (MoveElementCommand inserts them
	// in that order). Ids by source track, so they stay the same for the whole drag.
	const inserts = sources
		.map((source, sourceIndex) => ({ source, sourceIndex, destination: destinations.get(source.trackId) }))
		.flatMap(({ source, sourceIndex, destination }) =>
			destination?.kind === "new" ? [{ source, id: newTrackIds[sourceIndex], at: destination.at }] : [],
		)
		.sort((a, b) => a.at - b.at || a.source.displayIndex - b.source.displayIndex);
	const createTracks: PlannedTrackCreation[] = inserts.map((insert, order) => ({
		id: insert.id,
		type: insert.source.trackType,
		index: insert.at + order,
	}));
	const newTrackOf = new Map(inserts.map((insert) => [insert.source.trackId, insert.id]));

	const moves = sources.flatMap((source) => {
		const destination = destinations.get(source.trackId);
		const targetTrackId =
			destination?.kind === "track" ? destination.trackId : (newTrackOf.get(source.trackId) ?? source.trackId);
		return source.members.map((member) => ({
			sourceTrackId: member.trackId,
			targetTrackId,
			elementId: member.elementId,
			newStartTime: addMediaTime({ a: start, b: member.timeOffset }),
		}));
	});

	return {
		moves,
		createTracks,
		targetSelection: moves.map(({ elementId, targetTrackId }) => ({
			trackId: targetTrackId,
			elementId,
		})),
	};
}

function sourceTracksOf(group: MoveGroup): SourceTrack[] {
	const byTrack = new Map<string, SourceTrack>();
	for (const member of group.members) {
		const source = byTrack.get(member.trackId);
		if (source) {
			source.members.push(member);
			continue;
		}
		byTrack.set(member.trackId, {
			trackId: member.trackId,
			displayIndex: member.displayIndex,
			trackType: getTrackTypeForElementType({ elementType: member.elementType }),
			members: [member],
		});
	}
	return [...byTrack.values()].sort((a, b) => a.displayIndex - b.displayIndex);
}

/**
 * The anchor's kind of rows on existing tracks: the anchor's onto the target, the others as many rows up or down as it
 * moved (a sideways drag keeps every row), else the nearest free track of their type on their side; null when one has
 * none.
 */
function mapByRowOffset({
	tracks,
	own,
	anchorSource,
	anchorTargetTrackId,
}: {
	tracks: SceneTracks;
	own: readonly SourceTrack[];
	anchorSource: SourceTrack;
	anchorTargetTrackId: string;
}): Map<string, string> | null {
	const display = getDisplayTracks({ tracks });
	const anchorTarget = getTrackPlacementById({ tracks, trackId: anchorTargetTrackId });
	if (!anchorTarget) return null;
	const delta = anchorTarget.displayIndex - anchorSource.displayIndex;
	const result = new Map([[anchorSource.trackId, anchorTarget.trackId]]);
	const used = new Set([anchorTarget.trackId]);
	const usable = (index: number, type: TrackType) => {
		const track = display[index];
		return track !== undefined && track.type === type && !used.has(track.id) && track.locked !== true;
	};
	const anchorAt = own.indexOf(anchorSource);
	for (const step of [-1, 1] as const) {
		let bound = anchorTarget.displayIndex;
		for (let i = anchorAt + step; i >= 0 && i < own.length; i += step) {
			const source = own[i];
			let index = source.displayIndex + delta;
			if ((index - bound) * step <= 0 || !usable(index, source.trackType)) {
				index = bound + step;
				while (index >= 0 && index < display.length && !usable(index, source.trackType)) index += step;
				if (index < 0 || index >= display.length) return null;
			}
			result.set(source.trackId, display[index].id);
			used.add(display[index].id);
			bound = index;
		}
	}
	return result;
}

/** A new track's line inside its kind's section: pictures and titles above the main track, sounds below it. */
function clampToSection({ tracks, audio, index }: { tracks: SceneTracks; audio: boolean; index: number }): number {
	if (!audio) return Math.max(0, Math.min(index, tracks.overlay.length));
	const first = tracks.overlay.length + 1;
	return Math.max(first, Math.min(index, first + tracks.audio.length));
}

function fitsOnTrack({
	tracks,
	trackId,
	members,
	start,
	movingIds,
	keepOriginals,
}: {
	tracks: SceneTracks;
	trackId: string;
	members: readonly GroupMember[];
	start: MediaTime;
	movingIds: ReadonlySet<string>;
	keepOriginals: boolean;
}): boolean {
	const track = getDisplayTracks({ tracks }).find((candidate) => candidate.id === trackId);
	if (!track || track.locked === true) return false;
	const timeSpans = members.map((member) => ({
		startTime: addMediaTime({ a: start, b: member.timeOffset }),
		duration: member.duration,
	}));
	if (hasOverlappingTimeSpans({ timeSpans })) return false;
	return canPlaceTimeSpansOnTrack({
		track: { elements: keepOriginals ? track.elements : track.elements.filter((element) => !movingIds.has(element.id)) },
		timeSpans,
	});
}

function clampAnchorStartTime({
	group,
	tracks,
	anchorStartTime,
	ontoMain,
	keepOriginals,
}: {
	group: MoveGroup;
	tracks: SceneTracks;
	anchorStartTime: MediaTime;
	/** The members that land on the main track. */
	ontoMain: ReadonlySet<string>;
	keepOriginals: boolean;
}): MediaTime {
	const minimumAnchorStartTime = group.members.reduce(
		(minimumStartTime, member) =>
			member.timeOffset < ZERO_MEDIA_TIME
				? maxMediaTime({
						a: minimumStartTime,
						b: subMediaTime({
							a: ZERO_MEDIA_TIME,
							b: member.timeOffset,
						}),
					})
				: minimumStartTime,
		ZERO_MEDIA_TIME,
	);
	let clampedAnchorStartTime =
		anchorStartTime < minimumAnchorStartTime
			? minimumAnchorStartTime
			: anchorStartTime;

	const memberOnMainTrack = group.members.find((member) => ontoMain.has(member.elementId));
	if (!memberOnMainTrack) {
		return clampedAnchorStartTime;
	}

	const movingElementIds = new Set(
		keepOriginals ? [] : group.members.map((member) => member.elementId),
	);
	const requestedMainStartTime = addMediaTime({
		a: clampedAnchorStartTime,
		b: memberOnMainTrack.timeOffset,
	});
	const earliestStationaryMainStartTime = tracks.main.elements
		.filter((element) => !movingElementIds.has(element.id))
		.reduce<MediaTime | null>((earliestStartTime, element) => {
			if (earliestStartTime == null || element.startTime < earliestStartTime) {
				return element.startTime;
			}

			return earliestStartTime;
		}, null);
	if (
		earliestStationaryMainStartTime == null ||
		requestedMainStartTime <= earliestStationaryMainStartTime
	) {
		clampedAnchorStartTime = maxMediaTime({
			a: minimumAnchorStartTime,
			b: subMediaTime({
				a: ZERO_MEDIA_TIME,
				b: memberOnMainTrack.timeOffset,
			}),
		});
	}

	return clampedAnchorStartTime;
}

function hasOverlappingTimeSpans({
	timeSpans,
}: {
	timeSpans: Array<{ startTime: number; duration: number }>;
}): boolean {
	const sortedSpans = [...timeSpans].sort(
		(leftSpan, rightSpan) => leftSpan.startTime - rightSpan.startTime,
	);

	for (let spanIndex = 1; spanIndex < sortedSpans.length; spanIndex += 1) {
		const previousSpan = sortedSpans[spanIndex - 1];
		const currentSpan = sortedSpans[spanIndex];
		if (
			previousSpan.startTime + previousSpan.duration >
			currentSpan.startTime
		) {
			return true;
		}
	}

	return false;
}
