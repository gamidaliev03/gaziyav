import type { FrameRate } from "opencut-wasm";
import type { SceneTracks } from "@/timeline";
import { buildResizeMembers } from "@/timeline/controllers/resize-controller";
import {
	computeGroupResize,
	type GroupResizeMember,
	type GroupResizeUpdate,
	type ResizeSide,
} from "@/timeline/group-resize";
import { withoutLockedClips } from "@/timeline/track-lock";
import type { ElementRef } from "@/timeline/types";
import { addMediaTime, type MediaTime, mediaTime, subMediaTime, TICKS_PER_SECOND } from "@/wasm";
import { listTracks } from "./timeline-edits";

/**
 * Trims from the keyboard, to the frame (CapCut has none): an edge of the selected clips a frame earlier or later,
 * and E, the edge nearer the playhead to the playhead. The limits are the mouse trim's (the next clip, the media's
 * length, one frame at least); the edit is committed like a mouse trim, so the magnet closes what a clip loses.
 */

const frameTicks = (fps: FrameRate) => Math.round((TICKS_PER_SECOND * fps.denominator) / fps.numerator);
const endOf = (clip: { startTime: MediaTime; duration: MediaTime }) => addMediaTime({ a: clip.startTime, b: clip.duration });
const ticks = (value: number) => mediaTime({ ticks: value });

/** Each selected clip with its own limits: the other selected clips are in its way like any clip. */
const membersOf = (tracks: SceneTracks, selection: ElementRef[]) =>
	selection.flatMap((ref) => buildResizeMembers({ tracks, selectedElements: [ref] }));

/** The magnet's clips from `from` on, moved later by `by`: a clip that got longer pushes them (as its dragged edge does). */
function pushedAfter({
	tracks,
	member,
	from,
	by,
}: {
	tracks: SceneTracks;
	member: GroupResizeMember;
	from: MediaTime;
	by: MediaTime;
}): GroupResizeUpdate[] {
	const track = listTracks(tracks).find((t) => t.id === member.trackId);
	return (track?.elements ?? [])
		.filter((el) => el.id !== member.elementId && el.startTime >= from)
		.map((el) => ({
			trackId: member.trackId,
			elementId: el.id,
			patch: { trimStart: el.trimStart, trimEnd: el.trimEnd, startTime: addMediaTime({ a: el.startTime, b: by }), duration: el.duration },
		}));
}

/**
 * ⌥⌘← / ⌥⌘→ move the end of the selected clips a frame earlier / later, ⌥⇧⌘← / ⌥⇧⌘→ their start. On the magnet
 * (`rippleTrackId`: the main track while it is on) one clip keeps its place: what it gains pushes the clips after it,
 * a start shown earlier included, and what it loses is closed up when the edit is committed (a ripple trim).
 * Null when nothing changes (no clip, a locked track, the edge at its limit).
 */
export function trimEdgeByFrames({
	tracks,
	selection,
	side,
	frames,
	fps,
	rippleTrackId,
}: {
	tracks: SceneTracks;
	selection: ElementRef[];
	side: ResizeSide;
	frames: number;
	fps: FrameRate;
	rippleTrackId: string | null;
}): GroupResizeUpdate[] | null {
	const members = membersOf(withoutLockedClips(tracks), selection);
	if (members.length === 0 || frames === 0) return null;
	const requested = frames * frameTicks(fps);
	const magnet = members.length === 1 && members[0].trackId === rippleTrackId ? members[0] : null;
	if (!magnet) {
		const result = computeGroupResize({ members, side, deltaTime: ticks(requested), fps });
		return result.deltaTime === 0 ? null : result.updates;
	}
	if (side === "right") {
		const result = computeGroupResize({ members: [{ ...magnet, rightNeighborBound: null }], side, deltaTime: ticks(requested), fps });
		if (result.deltaTime === 0) return null;
		return result.deltaTime > 0
			? [...result.updates, ...pushedAfter({ tracks, member: magnet, from: endOf(magnet), by: result.deltaTime })]
			: result.updates;
	}
	if (requested > 0) {
		const result = computeGroupResize({ members: [magnet], side, deltaTime: ticks(requested), fps });
		return result.deltaTime === 0 ? null : result.updates;
	}
	// A start shown earlier: the clip stays where it starts and gets longer. It is lifted by the frames asked for, so
	// neither the clip before nor the timeline's start limits it, only the media; a whole number of frames keeps the
	// rounding of its edge as it is.
	const lifted = { ...magnet, startTime: addMediaTime({ a: magnet.startTime, b: ticks(-requested) }), leftNeighborBound: null };
	const result = computeGroupResize({ members: [lifted], side, deltaTime: ticks(requested), fps });
	if (result.deltaTime === 0) return null;
	const [update] = result.updates;
	const growth = subMediaTime({ a: update.patch.duration, b: magnet.duration });
	return [
		{ ...update, patch: { ...update.patch, startTime: magnet.startTime } },
		...pushedAfter({ tracks, member: magnet, from: endOf(magnet), by: growth }),
	];
}

/**
 * E (Premiere's «Extend Edit»): each selected clip's edge nearer the playhead goes to the playhead (past its end: the
 * end, before its start: the start). A clip that touches that edge on the track goes along: a roll — the cut moves,
 * nothing else does, as far as both clips allow. Null when nothing changes.
 */
export function extendEditToPlayhead({
	tracks,
	selection,
	time,
	fps,
}: {
	tracks: SceneTracks;
	selection: ElementRef[];
	time: MediaTime;
	fps: FrameRate;
}): GroupResizeUpdate[] | null {
	const unlocked = withoutLockedClips(tracks);
	const updates: GroupResizeUpdate[] = [];
	const done = new Set<string>();
	for (const member of membersOf(unlocked, selection)) {
		if (done.has(member.elementId)) continue;
		const start = member.startTime;
		const end = endOf(member);
		const side: ResizeSide = time >= end ? "right" : time <= start ? "left" : time - start < end - time ? "left" : "right";
		const delta = ticks(time - (side === "left" ? start : end));
		if (delta === 0) continue;
		const track = listTracks(unlocked).find((t) => t.id === member.trackId);
		const touching = track?.elements.find(
			(el) => el.id !== member.elementId && !done.has(el.id) && (side === "right" ? el.startTime === end : endOf(el) === start),
		);
		const [neighbor] = touching ? membersOf(unlocked, [{ trackId: member.trackId, elementId: touching.id }]) : [];
		if (!neighbor) {
			const result = computeGroupResize({ members: [member], side, deltaTime: delta, fps });
			if (result.deltaTime !== 0) updates.push(...result.updates);
			done.add(member.elementId);
			continue;
		}
		// The roll: the clip's edge and the neighbour's facing edge move together, so each is bounded by the other
		// one's length and media, not by the other one being in the way.
		const other: ResizeSide = side === "right" ? "left" : "right";
		const clip: GroupResizeMember = side === "right" ? { ...member, rightNeighborBound: null } : { ...member, leftNeighborBound: null };
		const next: GroupResizeMember = other === "right" ? { ...neighbor, rightNeighborBound: null } : { ...neighbor, leftNeighborBound: null };
		const forClip = computeGroupResize({ members: [clip], side, deltaTime: delta, fps }).deltaTime;
		const both = computeGroupResize({ members: [next], side: other, deltaTime: forClip, fps }).deltaTime;
		if (both === 0) continue;
		updates.push(
			...computeGroupResize({ members: [clip], side, deltaTime: both, fps, exact: true }).updates,
			...computeGroupResize({ members: [next], side: other, deltaTime: both, fps, exact: true }).updates,
		);
		done.add(member.elementId);
		done.add(neighbor.elementId);
	}
	return updates.length > 0 ? updates : null;
}
