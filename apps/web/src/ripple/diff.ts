import type { SceneTracks, TimelineElement } from "@/timeline/types";
import type { RippleAdjustment } from "./apply";

interface Interval {
	startTime: number;
	endTime: number;
}

interface ElementSpan extends Interval {
	id: string;
}

export function computeRippleAdjustments({
	beforeTracks,
	afterTracks,
}: {
	beforeTracks: SceneTracks;
	afterTracks: SceneTracks;
}): RippleAdjustment[] {
	const beforeTrackList = [
		...beforeTracks.overlay,
		beforeTracks.main,
		...beforeTracks.audio,
	];
	const afterTrackList = [
		...afterTracks.overlay,
		afterTracks.main,
		...afterTracks.audio,
	];
	const afterTracksById = new Map(afterTrackList.map((track) => [track.id, track]));

	return beforeTrackList.flatMap((beforeTrack): RippleAdjustment[] =>
		computeTrackRippleAdjustments({
			trackId: beforeTrack.id,
			beforeElements: beforeTrack.elements,
			afterElements: afterTracksById.get(beforeTrack.id)?.elements ?? [],
		}),
	);
}

function computeTrackRippleAdjustments({
	trackId,
	beforeElements,
	afterElements,
}: {
	trackId: string;
	beforeElements: TimelineElement[];
	afterElements: TimelineElement[];
}): RippleAdjustment[] {
	const beforeElementsById = buildElementSpanMap({ elements: beforeElements });
	const afterElementsById = buildElementSpanMap({ elements: afterElements });
	const { vacatedIntervals, occupiedIntervals } = collectTrackIntervals({
		beforeElementsById,
		afterElementsById,
	});
	const freedIntervals = subtractIntervalSets({
		sourceIntervals: vacatedIntervals,
		overlappingIntervals: occupiedIntervals,
	});

	return buildAdjustments({ trackId, intervals: freedIntervals });
}

function buildElementSpanMap({
	elements,
}: {
	elements: TimelineElement[];
}): Map<string, ElementSpan> {
	return new Map(
		elements.map((element) => [
			element.id,
			{
				id: element.id,
				startTime: element.startTime,
				endTime: element.startTime + element.duration,
			},
		]),
	);
}

function collectTrackIntervals({
	beforeElementsById,
	afterElementsById,
}: {
	beforeElementsById: Map<string, ElementSpan>;
	afterElementsById: Map<string, ElementSpan>;
}): {
	vacatedIntervals: Interval[];
	occupiedIntervals: Interval[];
} {
	const vacatedIntervals: Interval[] = [];
	const occupiedIntervals: Interval[] = [];

	for (const beforeElement of beforeElementsById.values()) {
		const afterElement = afterElementsById.get(beforeElement.id);
		if (!afterElement) {
			// Deleted, or dragged onto another track: either way its time on this track is free (a clip dragged off the
			// magnetic main track left a black gap). Whatever took its place keeps its time (below).
			pushInterval({
				intervals: vacatedIntervals,
				startTime: beforeElement.startTime,
				endTime: beforeElement.endTime,
			});
			continue;
		}

		// The start trimmed inward (the end where it was): the time before the new start is free, so the clip and
		// everything after it close up (as CapCut's magnet does). A move along the track changes the end too.
		if (afterElement.startTime > beforeElement.startTime && afterElement.endTime === beforeElement.endTime) {
			pushInterval({
				intervals: vacatedIntervals,
				startTime: beforeElement.startTime,
				endTime: afterElement.startTime,
			});
		}

		if (beforeElement.endTime > afterElement.endTime) {
			pushInterval({
				intervals: vacatedIntervals,
				startTime: afterElement.endTime,
				endTime: beforeElement.endTime,
			});
		}
	}

	// Time a clip is on after the edit is not free: a clip that came onto the track there, or the neighbour of a cut
	// that moved (a roll: one clip's end and the next one's start go together — the magnet closed the time the start
	// left, and the next clip slid over the one before it).
	for (const afterElement of afterElementsById.values()) {
		pushInterval({
			intervals: occupiedIntervals,
			startTime: afterElement.startTime,
			endTime: afterElement.endTime,
		});
	}

	return {
		vacatedIntervals: normalizeIntervals({ intervals: vacatedIntervals }),
		occupiedIntervals: normalizeIntervals({ intervals: occupiedIntervals }),
	};
}

function buildAdjustments({
	trackId,
	intervals,
}: {
	trackId: string;
	intervals: Interval[];
}): RippleAdjustment[] {
	return intervals.flatMap((interval): RippleAdjustment[] => {
		const shiftAmount = interval.endTime - interval.startTime;
		if (shiftAmount <= 0) {
			return [];
		}

		return [
			{
				trackId,
				afterTime: interval.endTime,
				shiftAmount,
			},
		];
	});
}

function subtractIntervalSets({
	sourceIntervals,
	overlappingIntervals,
}: {
	sourceIntervals: Interval[];
	overlappingIntervals: Interval[];
}): Interval[] {
	const normalizedSourceIntervals = normalizeIntervals({
		intervals: sourceIntervals,
	});
	const normalizedOverlappingIntervals = normalizeIntervals({
		intervals: overlappingIntervals,
	});

	return normalizedSourceIntervals.flatMap((sourceInterval) =>
		subtractSingleInterval({
			sourceInterval,
			overlappingIntervals: normalizedOverlappingIntervals,
		}),
	);
}

function normalizeIntervals({
	intervals,
}: {
	intervals: Interval[];
}): Interval[] {
	const validIntervals: Interval[] = [];
	for (const interval of intervals) {
		pushInterval({
			intervals: validIntervals,
			startTime: interval.startTime,
			endTime: interval.endTime,
		});
	}

	const sortedIntervals = validIntervals.sort(
		(leftInterval, rightInterval) =>
			leftInterval.startTime - rightInterval.startTime,
	);

	if (sortedIntervals.length === 0) {
		return [];
	}

	const mergedIntervals: Interval[] = [{ ...sortedIntervals[0] }];
	for (const interval of sortedIntervals.slice(1)) {
		const previousInterval = mergedIntervals[mergedIntervals.length - 1];
		if (interval.startTime <= previousInterval.endTime) {
			previousInterval.endTime = Math.max(
				previousInterval.endTime,
				interval.endTime,
			);
			continue;
		}

		mergedIntervals.push({ ...interval });
	}

	return mergedIntervals;
}

function subtractSingleInterval({
	sourceInterval,
	overlappingIntervals,
}: {
	sourceInterval: Interval;
	overlappingIntervals: Interval[];
}): Interval[] {
	let remainingIntervals: Interval[] = [{ ...sourceInterval }];

	for (const overlappingInterval of overlappingIntervals) {
		remainingIntervals = remainingIntervals.flatMap((remainingInterval) => {
		if (
			overlappingInterval.endTime <= remainingInterval.startTime ||
			overlappingInterval.startTime >= remainingInterval.endTime
		) {
				return [remainingInterval];
			}

			const nextIntervals: Interval[] = [];
			pushInterval({
				intervals: nextIntervals,
				startTime: remainingInterval.startTime,
				endTime: overlappingInterval.startTime,
			});
			pushInterval({
				intervals: nextIntervals,
				startTime: overlappingInterval.endTime,
				endTime: remainingInterval.endTime,
			});
			return nextIntervals;
		});

		if (remainingIntervals.length === 0) {
			return [];
		}
	}

	return remainingIntervals;
}

function pushInterval({
	intervals,
	startTime,
	endTime,
}: { intervals: Interval[]; startTime: number; endTime: number }): void {
	if (endTime <= startTime) {
		return;
	}

	intervals.push({ startTime, endTime });
}
