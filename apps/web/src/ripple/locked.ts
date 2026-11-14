// A locked track is never moved by what an edit sets off (blind3 rule 7, 14.11): the magnet's ripple, its packing and
// Linkage leave its items where they are, and the editor is told in one line how many items over clips that moved
// stayed behind — sync against the picture changed, never silently. Pure: the command manager runs it after a step.
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";

const others = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, ...tracks.audio];
const end = (element: TimelineElement) => element.startTime + element.duration;

/**
 * `before`: the tracks at the start of the step; `made`: what the command itself made; `after`: the step's end (after
 * ripple and linkage). Returns the tracks with every locked track as the command made it, and how many of its items sat
 * over a main clip that moved while they stayed.
 */
export function holdLockedTracks({
	before,
	made,
	after,
}: {
	before: SceneTracks;
	made: SceneTracks;
	after: SceneTracks;
}): { tracks: SceneTracks; leftBehind: number } {
	const locked = others(after).filter((track) => track.locked === true);
	if (locked.length === 0 || before.main.id !== after.main.id) return { tracks: after, leftBehind: 0 };
	const madeById = new Map(others(made).map((track) => [track.id, track]));
	let tracks = after;
	const restore = new Map<string, TimelineTrack>();
	for (const track of locked) {
		const own = madeById.get(track.id);
		if (own && own.elements !== track.elements) restore.set(track.id, { ...track, elements: own.elements } as TimelineTrack);
	}
	if (restore.size) {
		const put = <T extends TimelineTrack>(track: T): T => (restore.get(track.id) as T | undefined) ?? track;
		tracks = { ...after, overlay: after.overlay.map(put), audio: after.audio.map(put) };
	}

	// items over a main clip that moved, left where they were
	const mainNow = new Map(tracks.main.elements.map((element) => [element.id, element]));
	const beforeItems = new Map(others(before).flatMap((track) => track.elements.map((element) => [element.id, element] as const)));
	let leftBehind = 0;
	for (const track of others(tracks)) {
		if (track.locked !== true) continue;
		for (const item of track.elements) {
			const was = beforeItems.get(item.id);
			if (!was || was.startTime !== item.startTime) continue;
			const clip = before.main.elements.find((element) => was.startTime >= element.startTime && was.startTime < end(element as TimelineElement));
			const clipNow = clip ? mainNow.get(clip.id) : undefined;
			if (clip && clipNow && clipNow.startTime !== clip.startTime) leftBehind++;
			else if (clip && !clipNow && tracks.main.elements.length > 0) {
				// its clip went and the film closed over it: the item now sits over other frames
				const next = before.main.elements.find((element) => element.startTime >= end(clip as TimelineElement) && mainNow.has(element.id));
				if (next && (mainNow.get(next.id) as TimelineElement).startTime !== next.startTime) leftBehind++;
			}
		}
	}
	return { tracks, leftBehind };
}
