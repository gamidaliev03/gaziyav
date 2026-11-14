// Motion edits, each one ⌘Z: trackers on a clip, their actions, layers following them, reverse, reframe.
import { BatchCommand, type Command } from "@/commands";
import { UpdateProjectSettingsCommand } from "@/commands/project";
import { UpdateElementsCommand } from "@/commands/timeline";
import { setChannel } from "@/animation/keyframes";
import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import type { SceneTracks, TimelineElement, TimelineTrack, VideoElement } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { getSourceTimeAtClipTime } from "@/retime/resolve";
import { TICKS_PER_SECOND, type MediaTime } from "@/wasm";
import { clipSourceSeconds, findVideo, followedClip, followersOf, followPlace, makeFollowResolver, trackerCanvasPoint, trackerCarriedElsewhere } from "./follow";
import { trackBoxAt } from "./tracker";
import type { Tracker } from "./types";

export interface ElementLocation {
	trackId: string;
	element: TimelineElement;
}

function tracksOf(editor: EditorCore): SceneTracks | null {
	return editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
}

export function locate(editor: EditorCore, elementId: string): ElementLocation | null {
	const tracks = tracksOf(editor);
	if (!tracks) return null;
	for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio] as TimelineTrack[]) {
		for (const element of track.elements as TimelineElement[]) if (element.id === elementId) return { trackId: track.id, element };
	}
	return null;
}

function canvasOf(editor: EditorCore): { width: number; height: number } {
	return editor.project.getActiveOrNull()?.settings.canvasSize ?? { width: 1080, height: 1920 };
}

function update(trackId: string, elementId: string, patch: Partial<TimelineElement>): UpdateElementsCommand {
	return new UpdateElementsCommand({ updates: [{ trackId, elementId, patch }] });
}

function run(editor: EditorCore, commands: Command[]) {
	if (!commands.length) return;
	editor.command.execute({ command: commands.length === 1 ? commands[0] : new BatchCommand(commands) });
}

export function addTracker(editor: EditorCore, elementId: string, tracker: Tracker): boolean {
	const at = locate(editor, elementId);
	if (!at || at.element.type !== "video") return false;
	const clip = at.element as VideoElement;
	run(editor, [update(at.trackId, elementId, { trackers: [...(clip.trackers ?? []), tracker] } as Partial<TimelineElement>)]);
	return true;
}

export function updateTracker(editor: EditorCore, elementId: string, trackerId: string, patch: Partial<Tracker>): boolean {
	const at = locate(editor, elementId);
	if (!at || at.element.type !== "video") return false;
	const clip = at.element as VideoElement;
	const trackers = (clip.trackers ?? []).map((t) => (t.id === trackerId ? { ...t, ...patch } : t));
	run(editor, [update(at.trackId, elementId, { trackers } as Partial<TimelineElement>)]);
	return true;
}

/** Live preview of a tracker change (dragging a slider / the box); commit with updateTracker. */
export function previewTracker(editor: EditorCore, elementId: string, trackerId: string, patch: Partial<Tracker>) {
	const at = locate(editor, elementId);
	if (!at || at.element.type !== "video") return;
	const clip = at.element as VideoElement;
	const trackers = (clip.trackers ?? []).map((t) => (t.id === trackerId ? { ...t, ...patch } : t));
	editor.timeline.previewElements({ updates: [{ trackId: at.trackId, elementId, updates: { trackers } as Partial<TimelineElement> }] });
}

/** Detaching keeps the layer where it is now (the current offset goes into its own position). */
function detachPatch(editor: EditorCore, element: TimelineElement): Partial<TimelineElement> {
	const tracks = tracksOf(editor);
	const off = tracks && element.follow ? makeFollowResolver(tracks, canvasOf(editor))(element.follow, editor.playback.getCurrentTime()) : null;
	const params = { ...element.params };
	if (off) {
		const num = (k: string) => (typeof params[k] === "number" ? (params[k] as number) : k.includes("scale") ? 1 : 0);
		// Left exactly where it is drawn now (the same rule as the preview: followPlace).
		const p = followPlace({ x: num("transform.positionX"), y: num("transform.positionY"), scaleX: num("transform.scaleX"), scaleY: num("transform.scaleY"), rotate: num("transform.rotate") }, off);
		params["transform.positionX"] = p.x;
		params["transform.positionY"] = p.y;
		if (off.scale !== 1) {
			params["transform.scaleX"] = p.scaleX;
			params["transform.scaleY"] = p.scaleY;
		}
		if (p.rotate !== num("transform.rotate")) params["transform.rotate"] = p.rotate;
	}
	return { follow: undefined, params } as Partial<TimelineElement>;
}

export function removeTracker(editor: EditorCore, elementId: string, trackerId: string): boolean {
	const at = locate(editor, elementId);
	const tracks = tracksOf(editor);
	if (!at || !tracks || at.element.type !== "video") return false;
	const clip = at.element as VideoElement;
	const commands: Command[] = [update(at.trackId, elementId, { trackers: (clip.trackers ?? []).filter((t) => t.id !== trackerId) } as Partial<TimelineElement>)];
	// Another piece of a split clip still carries it: its followers keep following that piece.
	if (!trackerCarriedElsewhere(tracks, trackerId, elementId)) {
		for (const f of followersOf(tracks, elementId, trackerId)) commands.push(update(f.trackId, f.element.id, detachPatch(editor, f.element)));
	}
	run(editor, commands);
	return true;
}

/** The layer starts following the tracker from where it is now (no jump). */
export function attachFollower(
	editor: EditorCore,
	followerId: string,
	clipId: string,
	trackerId: string,
	{ scale = false, rotate = false, move = true }: { scale?: boolean; rotate?: boolean; move?: boolean } = {},
): boolean {
	const tracks = tracksOf(editor);
	const follower = locate(editor, followerId);
	const now = editor.playback.getCurrentTime();
	// The piece of a split clip that is on screen now (all pieces carry the tracker).
	const clip = tracks ? (followedClip(tracks, { clipId, trackerId, anchor: [0, 0] }, now) ?? findVideo(tracks, clipId)) : null;
	const tracker = clip?.trackers?.find((t) => t.id === trackerId);
	if (!follower || !clip || !tracker || followerId === clipId) return false;
	const p = trackerCanvasPoint({ clip, tracker, timelineTicks: now, canvas: canvasOf(editor) });
	if (!p) return false;
	const commands: Command[] = [];
	// Re-attaching: keep the current place first.
	const base = follower.element.follow ? { ...follower.element, ...detachPatch(editor, follower.element) } : follower.element;
	commands.push(
		update(follower.trackId, followerId, {
			params: base.params,
			follow: { clipId, trackerId, anchor: [p.x, p.y], ...(scale ? { size0: p.h } : {}), ...(rotate ? { angle0: p.angle } : {}), ...(move ? {} : { move: false }) },
		} as Partial<TimelineElement>),
	);
	run(editor, commands);
	return true;
}

export function detachFollower(editor: EditorCore, followerId: string): boolean {
	const at = locate(editor, followerId);
	if (!at?.element.follow) return false;
	run(editor, [update(at.trackId, followerId, detachPatch(editor, at.element))]);
	return true;
}

// --- Reverse ---------------------------------------------------------------------------------------------------

/** Ticks → seconds (computed spans of a speed ramp are not whole ticks). */
const secs = (t: number) => t / TICKS_PER_SECOND;
const ticks = (s: number) => Math.round(s * TICKS_PER_SECOND) as MediaTime;

function flipTrackers(trackers: Tracker[] | undefined, b: number): Tracker[] | undefined {
	return trackers?.map((t) => ({
		...t,
		samples: t.samples.map(([time, x, y, w, h, a = 0, c = 1]) => [Math.round((b - time) * 10000) / 10000, x, y, w, h, a, c]).sort((p, q) => p[0] - q[0]),
	}));
}

/**
 * The clip plays `reversed` (a file covering seconds [a, b] of its media, backwards) — same place, same length,
 * same look; the original media stays in the project and comes back with "Reverse" off or ⌘Z.
 */
export function applyReverse(
	editor: EditorCore,
	elementId: string,
	reversed: MediaAsset,
	a: number,
	b: number,
	{ back = false }: { back?: boolean } = {},
): boolean {
	const at = locate(editor, elementId);
	if (!at || at.element.type !== "video") return false;
	const clip = at.element as VideoElement;
	const s0 = secs(clip.trimStart);
	const s1 = s0 + secs(getSourceTimeAtClipTime({ clipTime: clip.duration, retime: clip.retime, duration: clip.duration }));
	const revLen = reversed.duration ?? b - a;
	run(editor, [
		update(at.trackId, elementId, {
			mediaId: reversed.id,
			trimStart: ticks(Math.max(0, b - s1)),
			trimEnd: ticks(Math.max(0, revLen - (b - s0))),
			sourceDuration: ticks(revLen),
			// `back`: the clip was reversed and then changed (AI effect…): this turns it forwards again.
			reversed: back ? undefined : { mediaId: clip.mediaId, a, b, sourceDuration: clip.sourceDuration },
			trackers: flipTrackers(clip.trackers, b),
		} as Partial<TimelineElement>),
	]);
	return true;
}

/**
 * True when the clip still plays the reversed copy made by Reverse (so "Reverse off" can go back to the original).
 * False when something replaced the picture after Reverse (an AI effect, a lipsync result): going back to the
 * original would throw that away.
 */
export function playsOwnReversedCopy(editor: EditorCore, clip: VideoElement): boolean {
	const link = clip.reversed;
	if (!link) return false;
	const asset = editor.media.getAssets().find((m) => m.id === clip.mediaId);
	return !!asset?.motionProxy?.reverse && asset.motionProxy.of === link.mediaId;
}

/** Back to the original media (same piece of it, as now trimmed). */
export function removeReverse(editor: EditorCore, elementId: string): boolean {
	const at = locate(editor, elementId);
	if (!at || at.element.type !== "video") return false;
	const clip = at.element as VideoElement;
	const link = clip.reversed;
	if (!link) return false;
	const original = editor.media.getAssets().find((m) => m.id === link.mediaId);
	const r0 = secs(clip.trimStart);
	const revLen = clip.sourceDuration != null ? secs(clip.sourceDuration) : link.b - link.a;
	const r1 = revLen - secs(clip.trimEnd);
	const fullLen = link.sourceDuration != null ? secs(link.sourceDuration) : (original?.duration ?? link.b);
	run(editor, [
		update(at.trackId, elementId, {
			mediaId: link.mediaId,
			trimStart: ticks(Math.max(0, link.b - r1)),
			trimEnd: ticks(Math.max(0, fullLen - (link.b - r0))),
			sourceDuration: link.sourceDuration ?? (original?.duration != null ? ticks(original.duration) : undefined),
			reversed: undefined,
			trackers: flipTrackers(clip.trackers, link.b),
		} as Partial<TimelineElement>),
	]);
	return true;
}

// --- Reframe / Make Vertical ------------------------------------------------------------------------------------

export const ASPECTS = [
	{ id: "9:16", label: "9:16 Vertical", width: 1080, height: 1920 },
	{ id: "4:5", label: "4:5 Portrait", width: 1080, height: 1350 },
	{ id: "1:1", label: "1:1 Square", width: 1080, height: 1080 },
	{ id: "16:9", label: "16:9 Landscape", width: 1920, height: 1080 },
] as const;
export type AspectId = (typeof ASPECTS)[number]["id"];

/** Ramer–Douglas–Peucker on (t, v): keeps the keys needed to stay within `tol` of the sampled path. */
function simplify(points: Array<[number, number]>, tol: number): Array<[number, number]> {
	if (points.length < 3) return points;
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const stack: Array<[number, number]> = [[0, points.length - 1]];
	while (stack.length) {
		const [i, j] = stack.pop()!;
		let worst = -1;
		let dist = tol;
		for (let k = i + 1; k < j; k++) {
			const f = (points[k][0] - points[i][0]) / Math.max(1e-9, points[j][0] - points[i][0]);
			const d = Math.abs(points[k][1] - (points[i][1] + (points[j][1] - points[i][1]) * f));
			if (d > dist) {
				dist = d;
				worst = k;
			}
		}
		if (worst >= 0) {
			keep[worst] = 1;
			stack.push([i, worst], [worst, j]);
		}
	}
	return points.filter((_, k) => keep[k]);
}

/**
 * Position keyframes (and a cover scale) that keep the tracked face / subject in frame on a canvas of `canvas`
 * size. Camera-like: the track is smoothed hard, keys every 0.2 s, then thinned to what the path needs.
 */
export function reframePatch(
	clip: VideoElement,
	tracker: Tracker | null,
	canvas: { width: number; height: number },
	frame: [number, number],
	zoom = 1,
): Partial<TimelineElement> {
	const [fw, fh] = tracker?.frame ?? frame;
	const contain = Math.min(canvas.width / fw, canvas.height / fh);
	const cover = Math.max(canvas.width / fw, canvas.height / fh);
	const scale = (cover / contain) * Math.max(1, zoom);
	const dw = fw * contain * scale;
	const dh = fh * contain * scale;
	const maxX = Math.max(0, (dw - canvas.width) / 2);
	const maxY = Math.max(0, (dh - canvas.height) / 2);
	const camera = tracker ? { ...tracker, smoothing: Math.max(0.85, tracker.smoothing) } : null;
	const xs: Array<[number, number]> = [];
	const ys: Array<[number, number]> = [];
	const duration = secs(clip.duration);
	const steps = Math.max(1, Math.ceil(duration / 0.2));
	for (let i = 0; i <= steps; i++) {
		const t = Math.min(duration, (i * duration) / steps);
		const box = camera ? trackBoxAt(camera, clipSourceSeconds(clip, clip.startTime + ticks(Math.min(t, duration - 1e-3)))) : null;
		const cx = box ? box.cx : 0.5;
		const cy = box ? box.cy : 0.5;
		xs.push([t, Math.round(Math.max(-maxX, Math.min(maxX, -(cx - 0.5) * dw)) * 10) / 10]);
		ys.push([t, Math.round(Math.max(-maxY, Math.min(maxY, -(cy - 0.5) * dh)) * 10) / 10]);
	}
	const channel = (pts: Array<[number, number]>) => ({
		keys: simplify(pts, 2).map(([t, v]) => ({
			id: generateUUID(),
			time: ticks(t),
			value: v,
			segmentToNext: "linear" as const,
			tangentMode: "auto" as const,
		})),
	});
	let animations = clip.animations;
	for (const path of ["transform.scaleX", "transform.scaleY"]) animations = setChannel({ animations, propertyPath: path, channel: undefined });
	const xKeys = channel(xs);
	const yKeys = channel(ys);
	const still = (c: { keys: Array<{ value: number }> }) => c.keys.every((k) => Math.abs(k.value - c.keys[0].value) < 0.5);
	animations = setChannel({ animations, propertyPath: "transform.positionX", channel: still(xKeys) ? undefined : xKeys });
	animations = setChannel({ animations, propertyPath: "transform.positionY", channel: still(yKeys) ? undefined : yKeys });
	return {
		animations,
		params: {
			...clip.params,
			"transform.scaleX": scale,
			"transform.scaleY": scale,
			"transform.positionX": xs[0][1],
			"transform.positionY": ys[0][1],
			"transform.rotate": 0,
		},
	} as Partial<TimelineElement>;
}

/** Reframe clips (one ⌘Z with the canvas change when an aspect is given). */
export function applyReframe(
	editor: EditorCore,
	clips: Array<{ elementId: string; tracker: Tracker | null; isNew?: boolean }>,
	aspect: AspectId | null,
	zoom = 1,
): boolean {
	const target = aspect ? ASPECTS.find((a) => a.id === aspect) : null;
	const current = canvasOf(editor);
	const canvas = target ? { width: target.width, height: target.height } : current;
	const commands: Command[] = [];
	if (target && (current.width !== target.width || current.height !== target.height)) {
		commands.push(new UpdateProjectSettingsCommand({ canvasSize: { width: target.width, height: target.height } }));
	}
	for (const { elementId, tracker, isNew } of clips) {
		const at = locate(editor, elementId);
		if (!at || at.element.type !== "video") continue;
		const clip = at.element as VideoElement;
		const asset = editor.media.getAssets().find((m) => m.id === clip.mediaId);
		const frame: [number, number] = [asset?.width ?? 1920, asset?.height ?? 1080];
		const patch = reframePatch(clip, tracker, canvas, frame, zoom);
		// A tracker found for the reframe is added in the same step (one ⌘Z undoes both).
		if (isNew && tracker) (patch as Partial<VideoElement>).trackers = [...(clip.trackers ?? []), tracker];
		commands.push(update(at.trackId, elementId, patch));
	}
	if (!commands.length) return false;
	run(editor, commands);
	return true;
}
