// A clip a speed change made longer (tlfix B, the lead's rule 13.11): on the magnetic main track it pushes the clips
// after it (the command manager packs the main track after the step, packMainTrack); anywhere else it keeps its
// start and its new length is clamped to the free space before the next clip — the rule of dragging its right edge,
// so the same helpers decide it (buildResizeMembers' bound, computeGroupResize's clamp). Before this a slower clip on
// a track without the magnet covered the next one (timeline-fuzz seed 71420, step 47).
import type { FrameRate } from "opencut-wasm";
import { buildResizeMembers } from "@/timeline/group-resize/members";
import { computeGroupResize } from "@/timeline/group-resize";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { applyElementUpdate } from "@/timeline/update-pipeline";
import { mediaTime } from "@/wasm";

const tracksOf = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio] as TimelineTrack[];

/**
 * `after` with every clip that grew from `before` on a track that is not magnetic cut back to the start of the next
 * clip (as `before` had it). `magnetic`: the magnet is on (it covers the main track only). Returns `after` itself when
 * nothing had to change.
 */
export function fitGrownClips({
	before,
	after,
	magnetic,
	fps,
	only,
}: {
	before: SceneTracks;
	after: SceneTracks;
	magnetic: boolean;
	fps: FrameRate;
	/** The clips whose speed the step changed (the others keep what the step gave them). */
	only: ReadonlySet<string>;
}): SceneTracks {
	if (only.size === 0) return after;
	let out = after;
	for (const track of tracksOf(after)) {
		if (magnetic && track.id === after.main.id) continue;
		const was = tracksOf(before).find((t) => t.id === track.id);
		if (!was) continue;
		for (const element of track.elements as TimelineElement[]) {
			if (!only.has(element.id)) continue;
			const old = (was.elements as TimelineElement[]).find((e) => e.id === element.id);
			if (!old || element.duration <= old.duration || element.startTime !== old.startTime) continue;
			// the bound as the clip had it: the next clip's start (on the tracks before the step, where it did not overlap yet)
			const [bounds] = buildResizeMembers({ tracks: before, selectedElements: [{ trackId: track.id, elementId: element.id }] });
			const bound = bounds?.rightNeighborBound ?? null;
			if (bound === null || element.startTime + element.duration <= bound) continue;
			const [grown] = buildResizeMembers({ tracks: out, selectedElements: [{ trackId: track.id, elementId: element.id }] });
			if (!grown) continue;
			const result = computeGroupResize({
				members: [{ ...grown, rightNeighborBound: bound }],
				side: "right",
				deltaTime: mediaTime({ ticks: bound - (element.startTime + element.duration) }),
				fps,
				exact: true,
			});
			const [update] = result.updates;
			if (!update) continue;
			out = replaceElement(out, track.id, element.id, (current) =>
				applyElementUpdate({ element: current, patch: update.patch as Partial<TimelineElement>, context: { tracks: out, trackId: track.id } }),
			);
		}
	}
	return out;
}

function replaceElement(tracks: SceneTracks, trackId: string, elementId: string, fn: (element: TimelineElement) => TimelineElement): SceneTracks {
	const fix = <T extends TimelineTrack>(track: T): T =>
		track.id !== trackId ? track : ({ ...track, elements: (track.elements as TimelineElement[]).map((e) => (e.id === elementId ? fn(e) : e)) } as T);
	return { overlay: tracks.overlay.map(fix), main: fix(tracks.main), audio: tracks.audio.map(fix) };
}
