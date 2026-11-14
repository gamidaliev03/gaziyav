// Sync by waveform, the timeline side: which clip stays, and where the others go. Pure (ticks, tracks).
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";

export interface SyncClip {
	trackId: string;
	elementId: string;
	/** "video" (a camera's clip with its own sound) or "audio" (separate sound). */
	type: "video" | "audio";
	/** It lies on the main track: it cannot move (the clips there follow each other). */
	main: boolean;
	startTime: number;
	duration: number;
}

/**
 * The clip the others are lined up to. The main track's clip stays where it is (the film's spine does not move);
 * else one sound among several cameras is what they are all lined up to; else the camera, when sound is brought to
 * one camera; else the earliest clip.
 */
export function pickReference(clips: readonly SyncClip[]): SyncClip | { error: string } {
	const onMain = clips.filter((c) => c.main);
	if (onMain.length > 1) return { error: "Clips on the main track follow each other and cannot be lined up to one another: put the cameras on tracks of their own." };
	if (onMain.length === 1) return onMain[0];
	const sounds = clips.filter((c) => c.type === "audio");
	const cameras = clips.filter((c) => c.type === "video");
	if (sounds.length === 1 && cameras.length > 1) return sounds[0];
	if (cameras.length === 1) return cameras[0];
	return [...clips].sort((a, b) => a.startTime - b.startTime || b.duration - a.duration)[0];
}

/**
 * Where a clip goes so that its sound lies on the reference's. `lagTicks`: time in the reference's FILE minus time
 * in this clip's file of the same sound. The clip keeps the piece of its file it shows; when that would start before
 * the timeline's zero, the part before zero is trimmed off.
 */
export function placeSynced(
	reference: { startTime: number; trimStart: number },
	clip: { startTime: number; trimStart: number; duration: number },
	lagTicks: number,
): { startTime: number; trimStart: number; duration: number } | null {
	// the timeline time of the clip's file's own zero
	const zero = reference.startTime - reference.trimStart + lagTicks;
	const startTime = zero + clip.trimStart;
	if (startTime >= 0) return { startTime, trimStart: clip.trimStart, duration: clip.duration };
	const cut = -startTime;
	if (cut >= clip.duration) return null;
	return { startTime: 0, trimStart: clip.trimStart + cut, duration: clip.duration - cut };
}

const rows = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];
const overlaps = (track: TimelineTrack, start: number, end: number, except: ReadonlySet<string>) =>
	(track.elements as TimelineElement[]).some((e) => !except.has(e.id) && e.startTime < end && e.startTime + e.duration > start);

/**
 * The tracks with the moved clips at their new places. A clip stays on its track when there is room; else it goes to
 * another track of the same kind that has room, else to a new one (made by `newTrack`).
 */
export function moveClips(
	tracks: SceneTracks,
	moves: ReadonlyArray<{ trackId: string; elementId: string; startTime: number; trimStart: number; duration: number }>,
	newTrack: (type: "video" | "audio") => TimelineTrack,
): SceneTracks {
	const moving = new Set(moves.map((m) => m.elementId));
	// take the moving clips out, remembering them
	const taken = new Map<string, TimelineElement>();
	const strip = <T extends TimelineTrack>(track: T): T => {
		if (!(track.elements as TimelineElement[]).some((e) => moving.has(e.id))) return track;
		for (const e of track.elements as TimelineElement[]) if (moving.has(e.id)) taken.set(e.id, e);
		return { ...track, elements: (track.elements as TimelineElement[]).filter((e) => !moving.has(e.id)) } as T;
	};
	let next: SceneTracks = { ...tracks, overlay: tracks.overlay.map(strip), main: strip(tracks.main), audio: tracks.audio.map(strip) };
	const none = new Set<string>();
	for (const move of moves) {
		const element = taken.get(move.elementId);
		if (!element) continue;
		const placed = { ...element, startTime: move.startTime, trimStart: move.trimStart, duration: move.duration } as TimelineElement;
		const end = move.startTime + move.duration;
		const kind = element.type === "audio" ? "audio" : "video";
		const own = rows(next).find((t) => t.id === move.trackId);
		const candidates = [own, ...(kind === "audio" ? next.audio : next.overlay.filter((t) => t.type === "video"))].filter((t): t is TimelineTrack => !!t && t.id !== next.main.id && t.type === kind);
		let home = candidates.find((t) => !overlaps(t, move.startTime, end, none));
		if (!home) {
			home = newTrack(kind);
			next = kind === "audio" ? { ...next, audio: [...next.audio, home as SceneTracks["audio"][number]] } : { ...next, overlay: [home as SceneTracks["overlay"][number], ...next.overlay] };
		}
		const homeId = home.id;
		const put = <T extends TimelineTrack>(track: T): T => (track.id === homeId ? ({ ...track, elements: [...(track.elements as TimelineElement[]), placed].sort((a, b) => a.startTime - b.startTime) } as T) : track);
		next = { ...next, overlay: next.overlay.map(put), audio: next.audio.map(put) };
	}
	return next;
}
