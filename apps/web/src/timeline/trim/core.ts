// The four professional trims as pure functions of the tracks: no editor, no DOM. `planTrim` reads what a trim may do
// (its range on whole frames and what stops it); `plan.apply(delta)` gives the tracks after it.
//
// The rules, the same for the mouse, the keys and typed numbers:
//  1. Frames. Every edge a trim moves lands on a frame of the project. A limit that lies between frames (a file that
//     ends 0.6 of a frame after the clip) is not reached: the trim stops on the last whole frame before it.
//  2. Media. No clip shows more than its file has: a trim stops at the file's first and last frame («media»).
//  3. Length. No clip gets shorter than one frame («length»).
//  4. Roll: both clips at the cut change, nothing else moves; the film keeps its length.
//  5. Ripple: the dragged edge changes its clip, the clip keeps its start, and every clip after it on that track moves
//     by as much (a head pulled out shows earlier frames and pushes the clips after it; a head pushed in pulls them).
//  6. Slip: the clip keeps its place and length; its content moves inside it. Keyframes and beat marks stay on their
//     frames of the picture (update-pipeline.ts).
//  7. Slide: the clip keeps its content and length and moves; a neighbour that touches it gives or takes the frames. A
//     side with no touching neighbour is free up to the next clip (or 0). The first clip of the main track stays at 0.
//  8. Linked tracks — the picture leads. A picture that a trim changes or moves takes along its detached sound while
//     that sound is still exactly its sound (timeline/linkage.ts isLockstepPair) and, with Linkage on, the items over it
//     (titles, stickers, effects, sounds, layers). On the main track the editor's Linkage does both for every edit
//     (commands.ts applyLinkageIfEnabled), so undo, redo and the preview show one and the same result; for a picture on
//     a layer track, which Linkage does not follow, the trim moves its detached sound itself (`linkSound`).
//  9. The other way round a sound never leaves its picture by a ripple it is not the subject of: on a track that holds
//     detached sounds still in step with their pictures, a ripple moves the clips up to the first such sound; that sound
//     and what follows it stay, and nothing is pushed into it («linked»). Trimming such a sound by its own edge is a J
//     or L cut, as before.
import type { FrameRate } from "opencut-wasm";
import { getElementKeyframes } from "@/animation";
import { computeGroupResize, type GroupResizeMember } from "@/timeline/group-resize";
import { isLockstepPair, lockstepSounds } from "@/timeline/linkage";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { applyElementUpdate } from "@/timeline/update-pipeline";
import { mediaTime, roundFrameTicks, TICKS_PER_SECOND } from "@/wasm";
import type { TrimLimit, TrimPlan, TrimResult, TrimSide, TrimTarget } from "./types";

/** «No limit» (a day of ticks): a title has no file to run out of. */
const FREE = 24 * 3600 * TICKS_PER_SECOND;
/** Clips this close (ticks) touch: they share a cut. */
export const TOUCH_TICKS = 1;

type Patch = { trimStart?: number; trimEnd?: number; startTime?: number; duration?: number; beats?: number[] };
type Range = { min: number; max: number; minLimit: TrimLimit; maxLimit: TrimLimit };

const endOf = (element: { startTime: number; duration: number }) => element.startTime + element.duration;
/** CapCut's 🔒 (timeline/track-lock.ts): a locked track's clips are not trimmed. */
const isTrackLocked = (track: { locked?: boolean } | null | undefined): boolean => track?.locked === true;
const allTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];
const rateOf = (element: TimelineElement): number => ("retime" in element && element.retime?.rate ? element.retime.rate : 1);
const hasFile = (element: TimelineElement) => (element.type === "video" || element.type === "audio") && element.sourceDuration != null;

export function ticksPerFrame(fps: FrameRate): number {
	return Math.round((TICKS_PER_SECOND * fps.denominator) / fps.numerator);
}

/** The frame at or before / at or after a time, in ticks. */
function frameFloor(ticks: number, fps: FrameRate): number {
	const frames = Math.floor((ticks * fps.numerator) / (fps.denominator * TICKS_PER_SECOND) + 1e-9);
	return Math.round((frames * fps.denominator * TICKS_PER_SECOND) / fps.numerator);
}
function frameCeil(ticks: number, fps: FrameRate): number {
	const frames = Math.ceil((ticks * fps.numerator) / (fps.denominator * TICKS_PER_SECOND) - 1e-9);
	return Math.round((frames * fps.denominator * TICKS_PER_SECOND) / fps.numerator);
}

/** The clip as the resize maths wants it, with no neighbour in its way: only its file and one frame limit it. */
function memberOf(trackId: string, element: TimelineElement): GroupResizeMember {
	return {
		trackId,
		elementId: element.id,
		startTime: element.startTime,
		duration: element.duration,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		sourceDuration: element.sourceDuration,
		retime: "retime" in element ? element.retime : undefined,
		beats: element.beats,
		leftNeighborBound: null,
		rightNeighborBound: null,
		leftUnbounded: true,
	};
}

/** How far one edge of a clip may go by itself: its file one way, one frame of length the other. */
function edgeRange(member: GroupResizeMember, side: TrimSide, fps: FrameRate): Range {
	const reach = (ticks: number) => computeGroupResize({ members: [member], side, deltaTime: mediaTime({ ticks }), fps, exact: true }).deltaTime as number;
	const min = Math.max(-FREE, reach(-FREE));
	const max = Math.min(FREE, reach(FREE));
	return side === "right" ? { min, max, minLimit: "length", maxLimit: "media" } : { min, max, minLimit: "media", maxLimit: "length" };
}

/** The clip's fields after its edge moved by `delta` — only the ones that changed (an unchanged start must not wake the main track's «starts at 0» rule). */
function edgePatch(member: GroupResizeMember, side: TrimSide, delta: number, fps: FrameRate): Patch {
	const [update] = computeGroupResize({ members: [member], side, deltaTime: mediaTime({ ticks: delta }), fps, exact: true }).updates;
	const patch: Patch = {};
	if (update.patch.trimStart !== member.trimStart) patch.trimStart = update.patch.trimStart;
	if (update.patch.trimEnd !== member.trimEnd) patch.trimEnd = update.patch.trimEnd;
	if (update.patch.startTime !== member.startTime) patch.startTime = update.patch.startTime;
	if (update.patch.duration !== member.duration) patch.duration = update.patch.duration;
	if (update.patch.beats) patch.beats = update.patch.beats;
	return patch;
}

const both = (a: Range, b: Range): Range => ({
	min: Math.max(a.min, b.min),
	max: Math.min(a.max, b.max),
	minLimit: a.min >= b.min ? a.minLimit : b.minLimit,
	maxLimit: a.max <= b.max ? a.maxLimit : b.maxLimit,
});

/** The range on whole frames: an edge now at `edge` may stand on any frame between its limits. */
function onFrames(range: Range, edge: number, fps: FrameRate): Range {
	const max = range.max >= FREE ? FREE : Math.max(0, frameFloor(edge + range.max, fps) - edge);
	const min = range.min <= -FREE ? -FREE : Math.min(0, frameCeil(edge + range.min, fps) - edge);
	// `|| 0`: never −0
	return { ...range, min: min || 0, max: max || 0 };
}

/** The delta that puts the edge on the frame nearest to what was asked, inside the range. */
function settle({ range, edge, delta, fps, exact }: { range: Range; edge: number; delta: number; fps: FrameRate; exact: boolean }): number {
	const clamped = Math.min(range.max, Math.max(range.min, delta));
	if (exact && clamped === delta) return delta;
	let target = roundFrameTicks({ ticks: edge + clamped, fps });
	if (target - edge > range.max) target = frameFloor(edge + range.max, fps);
	if (target - edge < range.min) target = frameCeil(edge + range.min, fps);
	const settled = target - edge;
	return settled > range.max || settled < range.min ? 0 : settled;
}

const limitOf = (range: Range, delta: number): TrimLimit | null => (delta > range.max ? range.maxLimit : delta < range.min ? range.minLimit : null);

/** The pictures whose sound was detached and is still exactly their sound, by what the pair shares. */
function pairedPictureKeys(tracks: SceneTracks): Set<string> {
	const keys = new Set<string>();
	for (const track of [tracks.main, ...tracks.overlay]) {
		for (const element of track.elements) {
			if (element.type === "video" && element.isSourceAudioEnabled === false) keys.add(pairKey(element));
		}
	}
	return keys;
}
const pairKey = (element: TimelineElement) =>
	`${"mediaId" in element ? element.mediaId : ""}|${element.startTime}|${element.duration}|${element.trimStart}|${rateOf(element)}`;

type Changed = Array<{ trackId: string; element: TimelineElement; was: TimelineElement }>;
const NOTHING: Changed = [];

/** The tracks with the patches applied the way a committed edit applies them (keyframes, beat marks and fades follow). */
function withPatches(before: SceneTracks, patches: ReadonlyMap<string, Patch>, linkSound: boolean): { tracks: SceneTracks; changed: Changed } {
	if (patches.size === 0) return { tracks: before, changed: NOTHING };
	const changed: Changed = [];
	const all = new Map(patches);
	if (linkSound) {
		// Rule 8: a picture on a layer track takes its detached sound along (the main track's are Linkage's).
		for (const track of before.overlay) {
			for (const picture of track.elements) {
				const patch = patches.get(picture.id);
				if (!patch || picture.type !== "video" || picture.isSourceAudioEnabled !== false) continue;
				for (const { trackId, element: sound } of lockstepSounds(before, picture)) {
					if (all.has(sound.id) || isTrackLocked(before.audio.find((t) => t.id === trackId))) continue;
					all.set(sound.id, { trimStart: patch.trimStart, trimEnd: patch.trimEnd, startTime: patch.startTime, duration: patch.duration });
				}
			}
		}
	}
	const fix = <T extends TimelineTrack>(track: T): T => {
		if (!track.elements.some((element) => all.has(element.id))) return track;
		const elements = track.elements.map((element) => {
			const patch = all.get(element.id);
			if (!patch) return element;
			const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Patch;
			const keys = Object.keys(clean);
			if (keys.length === 0) return element;
			// A clip that only moved keeps everything else as it is.
			const next =
				keys.length === 1 && keys[0] === "startTime"
					? ({ ...element, startTime: clean.startTime } as typeof element)
					: (applyElementUpdate({ element, patch: clean as Partial<TimelineElement>, context: { tracks: before, trackId: track.id } }) as typeof element);
			changed.push({ trackId: track.id, element: next, was: element });
			return next;
		});
		return { ...track, elements } as T;
	};
	const list = <T extends TimelineTrack>(tracks: T[]): T[] => {
		const next = tracks.map(fix);
		return next.some((track, i) => track !== tracks[i]) ? next : tracks;
	};
	return { tracks: { overlay: list(before.overlay), main: fix(before.main), audio: list(before.audio) }, changed };
}

/**
 * What a trim may do on these tracks. Null when it cannot be made at all: the clip is gone, its track is locked, the
 * clips at a roll no longer touch, or (slip) the clip has no file to slip in.
 */
export function planTrim({
	tracks,
	target,
	fps,
	linkSound = true,
}: {
	tracks: SceneTracks;
	target: TrimTarget;
	fps: FrameRate;
	/** Linkage is on and lists sounds: pictures take their detached sounds along (rules 8 and 9). */
	linkSound?: boolean;
}): TrimPlan | null {
	const track = allTracks(tracks).find((t) => t.id === target.trackId);
	if (!track || isTrackLocked(track)) return null;
	const frame = ticksPerFrame(fps);
	const sorted = [...track.elements].sort((a, b) => a.startTime - b.startTime) as TimelineElement[];
	const find = (id: string) => sorted.find((element) => element.id === id) ?? null;
	const make = ({
		range,
		edge,
		anchors,
		ids,
		patches,
	}: {
		range: Range;
		/** The edge that is put on a frame. */
		edge: number;
		anchors: number[];
		ids: string[];
		patches: (delta: number) => Map<string, Patch>;
	}): TrimPlan => {
		const framed = onFrames(range, edge, fps);
		return {
			target,
			frame,
			anchors,
			min: framed.min,
			max: framed.max,
			minLimit: framed.minLimit,
			maxLimit: framed.maxLimit,
			ids: new Set(ids),
			apply: (asked, { exact = false } = {}): TrimResult => {
				const delta = Math.round(asked);
				const applied = settle({ range: framed, edge, delta, fps, exact });
				const limit = limitOf(framed, delta);
				if (applied === 0) return { tracks, changed: NOTHING, delta: 0, limit };
				return { ...withPatches(tracks, patches(applied), linkSound), delta: applied, limit };
			},
		};
	};

	if (target.kind === "roll") {
		const left = find(target.leftId);
		const right = find(target.rightId);
		if (!left || !right || Math.abs(endOf(left) - right.startTime) > TOUCH_TICKS) return null;
		const out = memberOf(track.id, left);
		const into = memberOf(track.id, right);
		return make({
			range: both(edgeRange(out, "right", fps), edgeRange(into, "left", fps)),
			edge: right.startTime,
			anchors: [right.startTime],
			ids: [left.id, right.id],
			patches: (delta) =>
				new Map([
					[left.id, edgePatch(out, "right", delta, fps)],
					[right.id, edgePatch(into, "left", delta, fps)],
				]),
		});
	}

	const clip = find(target.elementId);
	if (!clip) return null;
	const index = sorted.indexOf(clip);
	const after = sorted.slice(index + 1).filter((element) => element.startTime >= endOf(clip) - TOUCH_TICKS);

	if (target.kind === "ripple") {
		const member = memberOf(track.id, clip);
		// Rule 9: the ripple runs up to the first sound that is still in step with its picture.
		const paired = linkSound && track.type === "audio" ? pairedPictureKeys(tracks) : null;
		const wall = paired ? after.findIndex((element) => element.type === "audio" && paired.has(pairKey(element))) : -1;
		const movers = wall < 0 ? after : after.slice(0, wall);
		const room = wall < 0 ? FREE : after[wall].startTime - (movers.length ? endOf(movers[movers.length - 1]) : endOf(clip));
		const own = edgeRange(member, target.side, fps);
		// How far the clips after it are pushed: by the tail's growth, or by what a head pulled out adds.
		const range: Range =
			target.side === "right"
				? own.max > room
					? { ...own, max: room, maxLimit: "linked" }
					: own
				: own.min < -room
					? { ...own, min: -room, minLimit: "linked" }
					: own;
		const edge = target.side === "right" ? endOf(clip) : clip.startTime;
		return make({
			range,
			edge,
			anchors: [edge],
			ids: [clip.id, ...movers.map((element) => element.id)],
			patches: (delta) => {
				const patch = edgePatch(member, target.side, delta, fps);
				// The clip keeps its start: a head that moved is a change of content and length only.
				if (target.side === "left") delete patch.startTime;
				const shift = target.side === "right" ? delta : -delta;
				const map = new Map<string, Patch>([[clip.id, patch]]);
				for (const element of movers) map.set(element.id, { startTime: element.startTime + shift });
				return map;
			},
		});
	}

	if (target.kind === "slip") {
		if (!hasFile(clip)) return null;
		const rate = rateOf(clip);
		// + moves the content later under the clip's window: the clip then starts earlier in its file. Whole frames only
		// (rule 1): a file that ends between frames is used up to its last whole frame — what the picture carries along
		// (its titles, its keys) moves by as much and must land on frames too.
		const whole = (ticks: number) => Math.floor(ticks / rate / frame + 1e-9) * frame;
		const range: Range = {
			min: -whole(clip.trimEnd) || 0,
			max: whole(clip.trimStart),
			minLimit: "media",
			maxLimit: "media",
		};
		return {
			target,
			frame,
			anchors: [],
			min: range.min,
			max: range.max,
			minLimit: "media",
			maxLimit: "media",
			ids: new Set([clip.id]),
			apply: (delta): TrimResult => {
				// Whole frames from where it is.
				const applied = Math.min(range.max, Math.max(range.min, Math.round(delta / frame) * frame));
				const limit = limitOf(range, delta);
				if (applied === 0) return { tracks, changed: NOTHING, delta: 0, limit };
				const shift = Math.min(clip.trimEnd, Math.max(-clip.trimStart, -Math.round(applied * rate)));
				const patch: Patch = { trimStart: clip.trimStart + shift, trimEnd: clip.trimEnd - shift };
				// Keys move with the picture; one carried past the clip's end is cut there like a tail trim cuts it — the
				// length is named for that (it wakes the pipeline's rule), and only then: it leaves a key at the end.
				if (getElementKeyframes({ animations: clip.animations }).some((key) => key.time + applied > clip.duration)) patch.duration = clip.duration;
				return { ...withPatches(tracks, new Map([[clip.id, patch]]), linkSound), delta: applied, limit };
			},
		};
	}

	// slide
	const before = index > 0 ? sorted[index - 1] : null;
	const next = sorted[index + 1] ?? null;
	const giver = before && Math.abs(endOf(before) - clip.startTime) <= TOUCH_TICKS ? before : null;
	const taker = next && Math.abs(next.startTime - endOf(clip)) <= TOUCH_TICKS ? next : null;
	let range: Range = { min: -FREE, max: FREE, minLimit: "start", maxLimit: "neighbour" };
	const giverMember = giver ? memberOf(track.id, giver) : null;
	const takerMember = taker ? memberOf(track.id, taker) : null;
	if (giverMember) range = both(range, edgeRange(giverMember, "right", fps));
	else {
		// A free left side: up to the clip before it, or the timeline's start. The main track's first clip stays at 0.
		const floor = before ? endOf(before) : 0;
		const pinned = track.id === tracks.main.id && !before;
		range = both(range, { min: pinned ? 0 : floor - clip.startTime, max: pinned ? 0 : FREE, minLimit: before ? "neighbour" : "start", maxLimit: "start" });
	}
	if (takerMember) range = both(range, edgeRange(takerMember, "left", fps));
	else if (next) range = both(range, { min: -FREE, max: next.startTime - endOf(clip), minLimit: "start", maxLimit: "neighbour" });
	return make({
		range,
		edge: clip.startTime,
		anchors: [clip.startTime, endOf(clip)],
		ids: [clip.id, ...(giver ? [giver.id] : []), ...(taker ? [taker.id] : [])],
		patches: (delta) => {
			const map = new Map<string, Patch>([[clip.id, { startTime: clip.startTime + delta }]]);
			if (giver && giverMember) map.set(giver.id, edgePatch(giverMember, "right", delta, fps));
			if (taker && takerMember) map.set(taker.id, edgePatch(takerMember, "left", delta, fps));
			return map;
		},
	});
}

/** The two clips at a cut of a track at `time` (they touch there), or null. */
export function cutAt(track: TimelineTrack, time: number, tolerance = TOUCH_TICKS): { left: TimelineElement; right: TimelineElement } | null {
	let left: TimelineElement | null = null;
	let right: TimelineElement | null = null;
	for (const element of track.elements as TimelineElement[]) {
		if (Math.abs(endOf(element) - time) <= tolerance) left = element;
		if (Math.abs(element.startTime - time) <= tolerance) right = element;
	}
	return left && right && left.id !== right.id ? { left, right } : null;
}

/** True while `sound` is the detached sound of some picture, still in step with it (rule 9's wall). */
export function isPairedSound(tracks: SceneTracks, sound: TimelineElement): boolean {
	if (sound.type !== "audio") return false;
	return [tracks.main, ...tracks.overlay].some((track) => track.elements.some((picture) => isLockstepPair(sound, picture)));
}
