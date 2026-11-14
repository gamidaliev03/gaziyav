// "Follow a tracker": any layer (text, sticker, graphic, AI layer, video) moves with a tracked face / object of a
// video clip. The offset is computed at render time from the tracker (so editing the track moves the layer
// too) and added to the layer's own position — the layer stays freely movable, it just keeps its distance.
import { getElementLocalTime } from "@/animation";
import { buildTransformFromParams } from "@/rendering";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import { getSourceTimeAtClipTime } from "@/retime/resolve";
import type { SceneTracks, TimelineElement, TimelineTrack, VideoElement } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { pictureToCanvas, trackBoxAt } from "./tracker";
import type { FollowLink, Tracker } from "./types";

export interface FollowOffset {
	x: number;
	y: number;
	/** Size ratio vs. attach time (1 unless the layer scales with the object). */
	scale: number;
	/** Degrees turned since attach time (0 unless the layer turns with the object). */
	rotate?: number;
	/** The object's centre now and when attached (canvas px from the centre): a layer that scales or turns with it
	 * keeps its place relative to the object (its distance scales, it goes round the object). */
	cx?: number;
	cy?: number;
	ax?: number;
	ay?: number;
	/** false: the layer keeps its place (only scales / turns). */
	move?: boolean;
}

/** Where a following layer is drawn: its own position, size and angle, carried by the object (one rule for the
 * preview, the export, the selection box and «Detach», which bakes it in). */
export function followPlace(base: { x: number; y: number; scaleX: number; scaleY: number; rotate: number }, off: FollowOffset | null | undefined) {
	if (!off) return base;
	const k = off.scale;
	const turn = off.rotate ?? 0;
	let x = base.x;
	let y = base.y;
	if (off.move !== false) {
		if ((k === 1 && turn === 0) || off.cx === undefined || off.cy === undefined || off.ax === undefined || off.ay === undefined) {
			x += off.x;
			y += off.y;
		} else {
			const a = (turn * Math.PI) / 180;
			const rx = (base.x - off.ax) * k;
			const ry = (base.y - off.ay) * k;
			x = off.cx + rx * Math.cos(a) - ry * Math.sin(a);
			y = off.cy + rx * Math.sin(a) + ry * Math.cos(a);
		}
	}
	return { x, y, scaleX: base.scaleX * k, scaleY: base.scaleY * k, rotate: base.rotate + turn };
}

export type FollowResolver = (link: FollowLink | undefined, timelineTicks: number) => FollowOffset | null;

function allTracks(tracks: SceneTracks): TimelineTrack[] {
	return [tracks.main, ...tracks.overlay, ...tracks.audio] as TimelineTrack[];
}

export function findVideo(tracks: SceneTracks, id: string): VideoElement | null {
	for (const track of allTracks(tracks)) {
		for (const el of track.elements as TimelineElement[]) if (el.id === id && el.type === "video") return el as VideoElement;
	}
	return null;
}

/** Source seconds of a clip's media shown at a timeline time (held at the clip's ends). */
export function clipSourceSeconds(clip: VideoElement, timelineTicks: number): number {
	const clipTime = Math.min(Math.max(0, timelineTicks - clip.startTime), Math.max(0, clip.duration - 1));
	const ticks = clip.trimStart + getSourceTimeAtClipTime({ clipTime, retime: clip.retime, duration: clip.duration });
	return ticks / TICKS_PER_SECOND;
}

/** Where a tracker's centre is on the canvas (px from the centre) at a timeline time, plus its box height. */
export function trackerCanvasPoint({
	clip,
	tracker,
	timelineTicks,
	canvas,
}: {
	clip: VideoElement;
	tracker: Tracker;
	timelineTicks: number;
	canvas: { width: number; height: number };
}): { x: number; y: number; h: number; w: number; angle: number } | null {
	const box = trackBoxAt(tracker, clipSourceSeconds(clip, timelineTicks));
	if (!box) return null;
	const clipTime = Math.min(Math.max(0, timelineTicks - clip.startTime), Math.max(0, clip.duration - 1));
	const localTime = getElementLocalTime({ timelineTime: clip.startTime + clipTime, elementStartTime: clip.startTime, elementDuration: clip.duration });
	const transform = resolveTransformAtTime({
		baseTransform: buildTransformFromParams({ params: clip.params }),
		animations: clip.animations,
		localTime,
	});
	const p = pictureToCanvas({ nx: box.cx, ny: box.cy, frame: tracker.frame, transform, canvas });
	return { x: p.x, y: p.y, h: box.h, w: box.w, angle: box.angle };
}

/** Every video clip that carries tracker `trackerId` (a split / duplicated clip carries the same tracker). */
function carriers(tracks: SceneTracks, trackerId: string): VideoElement[] {
	const out: VideoElement[] = [];
	for (const track of allTracks(tracks)) {
		for (const el of track.elements as TimelineElement[]) {
			if (el.type === "video" && (el as VideoElement).trackers?.some((t) => t.id === trackerId)) out.push(el as VideoElement);
		}
	}
	return out;
}

/**
 * The clip whose tracker a link follows at a timeline time. After a split (⌘B) both halves carry the tracker:
 * the half that is on screen at that time is used, so the layer keeps following across the cut. Only pieces of
 * the same media count; when none is on screen, the nearest one (held at its end).
 */
export function followedClip(tracks: SceneTracks, link: FollowLink, timelineTicks: number, list?: VideoElement[]): VideoElement | null {
	const all = list ?? carriers(tracks, link.trackerId);
	if (!all.length) return null;
	const primary = all.find((c) => c.id === link.clipId) ?? null;
	const covers = (c: VideoElement) => timelineTicks >= c.startTime && timelineTicks < c.startTime + c.duration;
	if (primary && covers(primary)) return primary;
	const media = primary?.mediaId;
	const same = media ? all.filter((c) => c.mediaId === media) : all;
	const hit = same.find(covers);
	if (hit) return hit;
	let best = primary;
	let bestGap = Number.POSITIVE_INFINITY;
	if (!best) {
		for (const c of same) {
			const gap = timelineTicks < c.startTime ? c.startTime - timelineTicks : timelineTicks - (c.startTime + c.duration);
			if (gap < bestGap) {
				bestGap = gap;
				best = c;
			}
		}
	}
	return best;
}

/** A resolver over one set of tracks (cheap to build; build one per scene/frame). */
export function makeFollowResolver(tracks: SceneTracks, canvas: { width: number; height: number }): FollowResolver {
	const byTracker = new Map<string, VideoElement[]>();
	return (link, timelineTicks) => {
		if (!link) return null;
		let list = byTracker.get(link.trackerId);
		if (!list) {
			list = carriers(tracks, link.trackerId);
			byTracker.set(link.trackerId, list);
		}
		const clip = followedClip(tracks, link, timelineTicks, list);
		const tracker = clip?.trackers?.find((t) => t.id === link.trackerId);
		if (!clip || !tracker) return null;
		const p = trackerCanvasPoint({ clip, tracker, timelineTicks, canvas });
		if (!p) return null;
		return {
			x: p.x - link.anchor[0],
			y: p.y - link.anchor[1],
			scale: link.size0 && link.size0 > 0 ? p.h / link.size0 : 1,
			...(link.angle0 !== undefined ? { rotate: p.angle - link.angle0 } : {}),
			cx: p.x,
			cy: p.y,
			ax: link.anchor[0],
			ay: link.anchor[1],
			...(link.move === false ? { move: false } : {}),
		};
	};
}

/**
 * Every element that follows a tracker of `clipId` (for "Attached layers" lists and cleanup). A follower linked
 * to another piece of the same split clip (same media, same tracker) counts too.
 */
export function followersOf(tracks: SceneTracks, clipId: string, trackerId?: string): Array<{ trackId: string; element: TimelineElement }> {
	const out: Array<{ trackId: string; element: TimelineElement }> = [];
	const self = findVideo(tracks, clipId);
	const sibling = (link: FollowLink) => {
		if (link.clipId === clipId) return true;
		if (!self || !self.trackers?.some((t) => t.id === link.trackerId)) return false;
		const other = findVideo(tracks, link.clipId);
		return !other || other.mediaId === self.mediaId;
	};
	for (const track of allTracks(tracks)) {
		for (const el of track.elements as TimelineElement[]) {
			if (el.follow && sibling(el.follow) && (!trackerId || el.follow.trackerId === trackerId)) out.push({ trackId: track.id, element: el });
		}
	}
	return out;
}

/** True when some clip other than `exceptClipId` still carries the tracker (a split piece). */
export function trackerCarriedElsewhere(tracks: SceneTracks, trackerId: string, exceptClipId: string): boolean {
	return carriers(tracks, trackerId).some((c) => c.id !== exceptClipId);
}

/** AI layers (Remotion) that follow a tracker: their offset path at 30 Hz, from each layer's start. */
export function addFollowPaths<T extends { from: number; dur: number; follow?: FollowLink; fp?: number[] }>(
	items: T[],
	tracks: SceneTracks,
	canvas: { width: number; height: number },
): T[] {
	if (!items.some((it) => it.follow)) return items;
	const resolve = makeFollowResolver(tracks, canvas);
	return items.map((it) => {
		if (!it.follow) return it;
		const n = Math.max(1, Math.ceil(it.dur * 30) + 1);
		const fp: number[] = [];
		for (let i = 0; i < n; i++) {
			const off = resolve(it.follow, Math.round((it.from + i / 30) * TICKS_PER_SECOND));
			fp.push(off ? Math.round(off.x * 10) / 10 : 0, off ? Math.round(off.y * 10) / 10 : 0, off ? Math.round(off.scale * 1000) / 1000 : 1);
		}
		return { ...it, fp };
	});
}

/** Raw sample of a tracker at a source second (linear between samples, held at the ends). */
function rawAt(samples: number[][], t: number): number[] | null {
	const n = samples.length;
	if (!n) return null;
	if (t <= samples[0][0]) return samples[0];
	if (t >= samples[n - 1][0]) return samples[n - 1];
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (samples[mid][0] <= t) lo = mid;
		else hi = mid;
	}
	const a = samples[lo];
	const b = samples[hi];
	const f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
	return a.map((v, i) => (i === 6 ? Math.min(v, b[i] ?? v) : v + ((b[i] ?? v) - v) * f));
}

/**
 * Trackers of a clip re-timed for a new file that replaces it from its start (a lipsync result: second 0 of the
 * new file = the clip's first frame on the timeline). Same tracker ids, so layers that follow them keep following.
 */
export function trackersForResult(original: VideoElement, lengthSeconds: number, fps = 30): Tracker[] | undefined {
	if (!original.trackers?.length) return undefined;
	const n = Math.max(1, Math.round(lengthSeconds * fps));
	return original.trackers.map((tracker) => {
		const samples: number[][] = [];
		for (let i = 0; i <= n; i++) {
			const u = Math.min(lengthSeconds, i / fps);
			const row = rawAt(tracker.samples, clipSourceSeconds(original, original.startTime + Math.round(u * TICKS_PER_SECOND)));
			if (row) samples.push([Math.round(u * 10000) / 10000, ...row.slice(1)]);
		}
		return { ...tracker, samples };
	});
}
