// «This footage is used again» — Adobe's mark for a reused source, done on the piece that is really repeated: a thin line
// along the bottom of a clip ONLY over the source range that another clip shows too. Two halves of one split are not a
// repeat (their ranges touch, they don't overlap), and the same media used twice with different ranges gets only the
// overlap marked. All the uses of one media share one colour; another media gets another colour (the owner, 17.11).
import type { TimelineElement, TimelineTrack } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";

/** Eight hues that stay apart on the dark timeline and on each other's clips. */
export const DUPLICATE_LINE_COLORS = [
	"#f5b942", // amber
	"#38bdf8", // sky
	"#a78bfa", // violet
	"#34d399", // emerald
	"#f472b6", // pink
	"#fb923c", // orange
	"#60a5fa", // blue
	"#a3e635", // lime
] as const;

/** Shorter overlaps are a frame of slop at a cut, not a reuse (0.1 s). */
const MIN_OVERLAP = TICKS_PER_SECOND * 0.1;

/** One repeated stretch of a clip, as fractions of its width. */
export interface DuplicateSegment {
	from: number;
	to: number;
}

export interface DuplicateMark {
	/** The line's colour (one per media, the same for all its uses). */
	color: string;
	/** How many clips share this media. */
	uses: number;
	/** The repeated stretches, in clip time (0…1). Empty for a clip whose ranges nobody else shows. */
	segments: DuplicateSegment[];
}

/** A clip's place in the source: what it shows, in ticks (a speed change is not marked: its ranges don't map 1:1). */
interface Use {
	elementId: string;
	trackId: string;
	mediaId: string;
	/** Clip time of the source start and end, and the clip's own length. */
	sourceStart: number;
	sourceEnd: number;
	duration: number;
	startTime: number;
}

const mediaOf = (element: TimelineElement): string => (element as TimelineElement & { mediaId?: string }).mediaId ?? "";
const retimed = (element: TimelineElement): boolean => !!(element as TimelineElement & { retime?: unknown }).retime;

/**
 * Every repeated stretch, per element: `elementId → { color, uses, segments }`. An element with no repetition is not in
 * the map at all (it wears no line).
 */
export function duplicateMarks(tracks: ReadonlyArray<TimelineTrack> | null | undefined): Map<string, DuplicateMark> {
	const out = new Map<string, DuplicateMark>();
	if (!tracks) return out;
	const uses: Use[] = [];
	for (const track of tracks) {
		if (track.type !== "video") continue;
		for (const element of track.elements) {
			const mediaId = mediaOf(element);
			if (!mediaId || retimed(element) || element.duration <= 0) continue;
			uses.push({
				elementId: element.id,
				trackId: track.id,
				mediaId,
				sourceStart: element.trimStart,
				sourceEnd: element.trimStart + element.duration,
				duration: element.duration,
				startTime: element.startTime,
			});
		}
	}
	if (uses.length < 2) return out;
	// The order the media first appears on the timeline decides its colour, so one media keeps one colour for ever.
	const firstSeen = new Map<string, number>();
	for (const use of [...uses].sort((a, b) => a.startTime - b.startTime || a.elementId.localeCompare(b.elementId))) {
		if (!firstSeen.has(use.mediaId)) firstSeen.set(use.mediaId, firstSeen.size);
	}
	const perMedia = new Map<string, Use[]>();
	for (const use of uses) {
		const list = perMedia.get(use.mediaId) ?? [];
		list.push(use);
		perMedia.set(use.mediaId, list);
	}
	const marks = new Map<string, DuplicateMark>();
	for (const [mediaId, list] of perMedia) {
		if (list.length < 2) continue;
		const order = firstSeen.get(mediaId) ?? 0;
		const color = DUPLICATE_LINE_COLORS[order % DUPLICATE_LINE_COLORS.length];
		for (const use of list) {
			const segments: DuplicateSegment[] = [];
			for (const other of list) {
				if (other.elementId === use.elementId) continue;
				const from = Math.max(use.sourceStart, other.sourceStart);
				const to = Math.min(use.sourceEnd, other.sourceEnd);
				if (to - from < MIN_OVERLAP) continue; // touching ranges (a split) are not a repeat
				segments.push({ from: (from - use.sourceStart) / use.duration, to: (to - use.sourceStart) / use.duration });
			}
			if (!segments.length) continue;
			segments.sort((a, b) => a.from - b.from);
			// One stretch when neighbours meet
			const merged: DuplicateSegment[] = [];
			for (const segment of segments) {
				const last = merged.at(-1);
				if (last && segment.from - last.to < 0.002) last.to = Math.max(last.to, segment.to);
				else merged.push({ ...segment });
			}
			marks.set(use.elementId, { color, uses: list.length, segments: merged });
		}
	}
	return marks;
}
