// Runs of clips too narrow to draw one by one (speed, 11.11; from the long-film work of 10.11).
//
// A clip under 3 px wide has no box at all: its 1.5 px inset on each side leaves no width. A two-hour film zoomed to
// fit — ~2 000 clips under a pixel — was 2 792 mounted React clips (58 282 DOM nodes) of which a person saw nothing:
// an empty main track with its transitions' chips on it (rc33, ideal-longform A). Such clips are drawn together as
// runs of the track's colour, on any track (timeline-track); on a crowded track (more than DENSE_MIN_CLIPS in the
// window) they are not mounted at all, and the selected ones are runs of the selection colour. A run takes no
// pointer events: a press there reaches the track, as it did.

/** Clips narrower than this (px) on a crowded track are drawn together as plain runs of their colour. */
export const DENSE_CLIP_PX = 3;
/** Narrow clips stay mounted (as light clips, under their run) unless the track has more clips in its window than this. */
export const DENSE_MIN_CLIPS = 200;

export interface DenseRun {
	left: number;
	right: number;
	count: number;
}

/** The spans (px) merged into runs: spans that touch, overlap or lie less than a pixel apart are one run. */
export function mergeDenseRuns(spans: ReadonlyArray<{ left: number; right: number }>): DenseRun[] {
	const sorted = [...spans].sort((a, b) => a.left - b.left);
	const runs: DenseRun[] = [];
	for (const span of sorted) {
		const last = runs[runs.length - 1];
		if (last && span.left <= last.right + 1) {
			last.right = Math.max(last.right, span.right);
			last.count++;
		} else runs.push({ left: span.left, right: span.right, count: 1 });
	}
	return runs;
}
