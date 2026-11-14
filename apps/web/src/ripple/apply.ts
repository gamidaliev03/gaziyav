import type { SceneTracks, TimelineTrack } from "@/timeline/types";
import { rippleShiftElements } from "./shift";

export interface RippleAdjustment {
	trackId: string;
	afterTime: number;
	shiftAmount: number;
}

export function applyRippleAdjustments({
	tracks,
	adjustments,
	followText = true,
}: {
	tracks: SceneTracks;
	adjustments: RippleAdjustment[];
	/** Text tracks follow what the main track lost. The editor's magnet leaves that to Linkage (its settings). */
	followText?: boolean;
}): SceneTracks {
	if (adjustments.length === 0) {
		return tracks;
	}

	const adjustmentsByTrack = new Map<string, RippleAdjustment[]>();
	for (const adjustment of adjustments) {
		const trackAdjustments = adjustmentsByTrack.get(adjustment.trackId) ?? [];
		trackAdjustments.push(adjustment);
		adjustmentsByTrack.set(adjustment.trackId, trackAdjustments);
	}

	const mainAdjustments = adjustmentsByTrack.get(tracks.main.id) ?? [];

	return {
		overlay: tracks.overlay.map((track) => {
			const own = adjustmentsByTrack.get(track.id) ?? [];
			// Captions and titles follow what the main track lost (they were left out of sync with the speech).
			if (followText && !own.length && mainAdjustments.length && track.type === "text") {
				return followMainTrack({ track, adjustments: mainAdjustments });
			}
			return applyTrackRippleAdjustments({ track, adjustments: own });
		}),
		main: applyTrackRippleAdjustments({
			track: tracks.main,
			adjustments: adjustmentsByTrack.get(tracks.main.id) ?? [],
		}),
		audio: tracks.audio.map((track) =>
			applyTrackRippleAdjustments({
				track,
				adjustments: adjustmentsByTrack.get(track.id) ?? [],
			}),
		),
	};
}

function applyTrackRippleAdjustments<
	TElement extends TimelineTrack["elements"][number],
	TTrack extends TimelineTrack & { elements: TElement[] },
>({
	track,
	adjustments,
}: {
	track: TTrack;
	adjustments: RippleAdjustment[];
}): TTrack {
	if (adjustments.length === 0) {
		return track;
	}

	const sortedAdjustments = [...adjustments].sort(
		(firstAdjustment, secondAdjustment) =>
			secondAdjustment.afterTime - firstAdjustment.afterTime,
	);

	let elements: TElement[] = track.elements;
	for (const adjustment of sortedAdjustments) {
		elements = rippleShiftElements({
			elements,
			afterTime: adjustment.afterTime,
			shiftAmount: adjustment.shiftAmount,
		});
	}

	return { ...track, elements };
}

/**
 * A text track after a main-track ripple: what lay in the removed time goes (cut to the part outside it), what came
 * after moves back by the same amount. Left as it was if that would make two texts overlap.
 */
function followMainTrack<TTrack extends TimelineTrack>({
	track,
	adjustments,
}: {
	track: TTrack;
	adjustments: RippleAdjustment[];
}): TTrack {
	type El = TimelineTrack["elements"][number];
	let elements = track.elements as El[];
	for (const { afterTime: b, shiftAmount } of [...adjustments].sort((x, y) => y.afterTime - x.afterTime)) {
		const a = b - shiftAmount;
		elements = elements.flatMap((element): El[] => {
			const start = element.startTime as number;
			const end = start + (element.duration as number);
			if (end <= a) return [element];
			if (start >= b) return [{ ...element, startTime: (start - shiftAmount) as El["startTime"] } as El];
			if (start >= a && end <= b) return [];
			if (start < a && end > b) return [{ ...element, duration: ((end - start) - shiftAmount) as El["duration"] } as El];
			if (start < a) return [{ ...element, duration: (a - start) as El["duration"] } as El];
			return [{ ...element, startTime: a as El["startTime"], duration: (end - b) as El["duration"] } as El];
		});
	}
	const sorted = [...elements].sort((x, y) => (x.startTime as number) - (y.startTime as number));
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		if ((prev.startTime as number) + (prev.duration as number) > (sorted[i].startTime as number) + 1e-6) return track;
	}
	return { ...track, elements } as TTrack;
}
