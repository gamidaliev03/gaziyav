// Markers ride with the film (blind3 F4, 14.11): a marker over a main-track clip marks that clip's frame, so an edit
// that moves the film under it (a ripple delete, a ripple trim, an insert, a clip dragged elsewhere) takes it along by
// the same amount. A marker whose frame is gone (deleted, trimmed off) goes to the cut that closed over it; a marker
// over empty time keeps its place unless the film around it moved, then it goes with what follows it. Pure: the
// command manager applies it after every step and keeps the markers before / after with the step for ⌘Z / ⇧⌘Z.
import type { Bookmark, TimelineElement, VideoTrack } from "@/timeline/types";

const end = (element: TimelineElement) => element.startTime + element.duration;

/** Source ticks per timeline tick: constant speed only (a curve or a reversed file moves by its start alone). */
function rateOf(element: TimelineElement): number | null {
	if ("reversed" in element && element.reversed) return null;
	if (!("retime" in element) || !element.retime) return 1;
	if (element.retime.mode === "curve") return null;
	return element.retime.rate > 0 ? element.retime.rate : null;
}

const mediaOf = (element: TimelineElement): string | null => ("mediaId" in element && typeof element.mediaId === "string" ? `${element.type}:${element.mediaId}` : null);

/**
 * The marker times after a step that changed the main track from `before` to `after`; null when no marker moves.
 * `frameTicks` puts a moved marker on the frame grid (a speed can land it between frames), inside the clip it rides.
 */
export function rideBookmarks({
	before,
	after,
	bookmarks,
	frameTicks = 1,
}: {
	before: VideoTrack;
	after: VideoTrack;
	bookmarks: readonly Bookmark[];
	frameTicks?: number;
}): Bookmark[] | null {
	if (bookmarks.length === 0 || before === after || before.elements === after.elements) return null;
	const was = [...before.elements].sort((a, b) => a.startTime - b.startTime) as TimelineElement[];
	const now = new Map((after.elements as TimelineElement[]).map((element) => [element.id, element]));
	const known = new Set(was.map((element) => element.id));
	const fresh = (after.elements as TimelineElement[]).filter((element) => !known.has(element.id));
	const filmEnd = (elements: readonly TimelineElement[]) => elements.reduce((max, element) => Math.max(max, end(element)), 0);
	const endShift = filmEnd(after.elements as TimelineElement[]) - filmEnd(was);

	/** Where the frame `source` of clip `element` is on the timeline, or null when the clip does not show it. */
	const timeOf = (element: TimelineElement, source: number): number | null => {
		const rate = rateOf(element);
		if (rate == null) return null;
		// to the tick: a speed's division lands a hair before a cut (28000 → 27999.99) and the marker fell a frame back
		const time = Math.round(element.startTime + (source - element.trimStart) / rate);
		return time >= element.startTime && time < end(element) ? time : null;
	};

	/** Where the marker lands, with the clip it rides (its frame must stay inside it). */
	let within: TimelineElement | null = null;
	const place = (time: number): number => {
		within = null;
		const clip = was.find((element) => element.startTime <= time && time < end(element));
		if (clip) {
			const moved = now.get(clip.id);
			const rate = rateOf(clip);
			if (moved && (rate == null || rateOf(moved) == null)) {
				// no source mapping: with the clip's start, kept inside the clip
				return Math.min(Math.max(time + (moved.startTime - clip.startTime), moved.startTime), end(moved) - 1);
			}
			if (rate != null) {
				const source = clip.trimStart + (time - clip.startTime) * rate;
				const there = moved ? timeOf(moved, source) : null;
				if (there != null) {
					within = moved as TimelineElement;
					return there;
				}
				// split off: a new piece of the same media shows that frame now
				const key = mediaOf(clip);
				for (const piece of key ? fresh : []) {
					if (mediaOf(piece) !== key) continue;
					const at = timeOf(piece, source);
					if (at != null) {
						within = piece;
						return at;
					}
				}
				if (moved) {
					// trimmed off: to the cut on its side
					const would = moved.startTime + (source - moved.trimStart) / (rateOf(moved) as number);
					return would < moved.startTime ? moved.startTime : end(moved);
				}
			}
		}
		// over a clip that went, or over empty time: by the film around it
		const prev = [...was].reverse().find((element) => end(element) <= time && now.has(element.id));
		const next = was.find((element) => element.startTime > time && now.has(element.id));
		const prevShift = prev ? (now.get(prev.id) as TimelineElement).startTime - prev.startTime : 0;
		const nextShift = next ? (now.get(next.id) as TimelineElement).startTime - next.startTime : endShift;
		if (prevShift === nextShift) return time + nextShift;
		// the film closed (or opened) here: the marker goes to the cut, never past what followed it
		const cut = next ? (now.get(next.id) as TimelineElement).startTime : filmEnd(after.elements as TimelineElement[]);
		return Math.min(Math.max(time + prevShift, 0), cut);
	};

	let changed = false;
	const out = bookmarks.map((bookmark) => {
		const raw = place(bookmark.time);
		const clip = within as TimelineElement | null;
		let time = Math.round(Math.round(raw / frameTicks) * frameTicks);
		if (clip && time >= end(clip)) time = Math.round(Math.floor(raw / frameTicks) * frameTicks);
		if (clip && time < clip.startTime) time = Math.round(Math.ceil(raw / frameTicks) * frameTicks);
		time = Math.max(0, time);
		if (time === bookmark.time) return bookmark;
		changed = true;
		return { ...bookmark, time: time as Bookmark["time"] };
	});
	return changed ? out.sort((a, b) => a.time - b.time) : null;
}
