// Seeing what you cut: which two frames the player shows while a trim is in the hand — the last frame going out and the
// first coming in at the cut that moves; for a slip the clip's own new first and last frames. Pure: the frames are named
// here (clip, file, second of the file), two-up-player.ts decodes and draws them.
import { getSourceTimeAtClipTime } from "@/retime";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { TOUCH_TICKS } from "./core";

/** What a trim shows the two frames of. An `edge` is one clip's edge, rippled or trimmed the old way. */
export type TwoUpTarget =
	| { kind: "roll"; trackId: string; leftId: string; rightId: string }
	| {
			kind: "edge";
			trackId: string;
			elementId: string;
			side: "left" | "right";
			/** The clip on the other side of the edge will touch it once the trim is made (a ripple, the magnet) even if a gap shows now. */
			closes: boolean;
	  }
	| { kind: "slip"; trackId: string; elementId: string }
	| { kind: "slide"; trackId: string; elementId: string };

export interface TwoUpFrame {
	elementId: string;
	name: string;
	/** A frame of a video file, a still picture, or a clip with no picture of its own (a title, a sound): its name is shown. */
	kind: "video" | "image" | "none";
	mediaId: string | null;
	/** Seconds into the file (a video). */
	sourceSeconds: number;
	/** The same in ticks (the label's timecode). */
	sourceTicks: number;
}

export interface TwoUpView {
	left: TwoUpFrame | null;
	right: TwoUpFrame | null;
	/** English keys of the panes' names. */
	leftLabel: string;
	rightLabel: string;
}

const listTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];
const endOf = (element: TimelineElement) => element.startTime + element.duration;

function frameOf(element: TimelineElement, clipTime: number): TwoUpFrame {
	const kind = element.type === "video" ? "video" : element.type === "image" ? "image" : "none";
	const retime = "retime" in element ? element.retime : undefined;
	const sourceTicks = kind === "video" ? Math.round(element.trimStart + getSourceTimeAtClipTime({ clipTime, retime, duration: element.duration })) : 0;
	return {
		elementId: element.id,
		name: element.name,
		kind,
		mediaId: "mediaId" in element && typeof element.mediaId === "string" ? element.mediaId : null,
		sourceSeconds: sourceTicks / TICKS_PER_SECOND,
		sourceTicks,
	};
}
const first = (element: TimelineElement) => frameOf(element, 0);
/** The last frame the clip shows: one frame before its end. */
const last = (element: TimelineElement, frame: number) => frameOf(element, Math.max(0, element.duration - frame));

/**
 * The two frames of a trim on these tracks (the tracks as the trim shows them now). Null when neither side has a
 * picture to show (titles, sounds): the player then stays as it is.
 */
export function twoUpOf({ tracks, target, frame }: { tracks: SceneTracks; target: TwoUpTarget; frame: number }): TwoUpView | null {
	const track = listTracks(tracks).find((t) => t.id === target.trackId);
	if (!track) return null;
	const elements = track.elements as TimelineElement[];
	const find = (id: string) => elements.find((element) => element.id === id) ?? null;
	let view: TwoUpView;
	if (target.kind === "roll") {
		const out = find(target.leftId);
		const into = find(target.rightId);
		if (!out || !into) return null;
		view = { left: last(out, frame), right: first(into), leftLabel: "Outgoing", rightLabel: "Incoming" };
	} else {
		const clip = find(target.elementId);
		if (!clip) return null;
		// the clips next to it on the track, in one pass (this runs with every move of the hand: no sort of a long track)
		let before: TimelineElement | null = null;
		let after: TimelineElement | null = null;
		for (const element of elements) {
			if (element === clip) continue;
			if (element.startTime < clip.startTime) {
				if (!before || element.startTime > before.startTime) before = element;
			} else if (!after || element.startTime < after.startTime) after = element;
		}
		if (target.kind === "slip") {
			view = { left: first(clip), right: last(clip, frame), leftLabel: "First frame", rightLabel: "Last frame" };
		} else if (target.kind === "slide") {
			const out = before && Math.abs(endOf(before) - clip.startTime) <= TOUCH_TICKS ? before : null;
			const into = after && Math.abs(after.startTime - endOf(clip)) <= TOUCH_TICKS ? after : null;
			view = { left: out ? last(out, frame) : null, right: into ? first(into) : null, leftLabel: "Outgoing", rightLabel: "Incoming" };
		} else if (target.side === "right") {
			const into = after && (target.closes || Math.abs(after.startTime - endOf(clip)) <= TOUCH_TICKS) ? after : null;
			view = { left: last(clip, frame), right: into ? first(into) : null, leftLabel: "Outgoing", rightLabel: "Incoming" };
		} else {
			const out = before && (target.closes || Math.abs(endOf(before) - clip.startTime) <= TOUCH_TICKS) ? before : null;
			view = { left: out ? last(out, frame) : null, right: first(clip), leftLabel: "Outgoing", rightLabel: "Incoming" };
		}
	}
	const hasPicture = (pane: TwoUpFrame | null) => !!pane && pane.kind !== "none";
	return hasPicture(view.left) || hasPicture(view.right) ? view : null;
}
